import {
  cumpleCriterioLectura, type EstadoValidacion, MOTIVO_RESTRICCION, type PoliticaAutorizacion, type RestriccionAcceso,
} from './decisionAcceso';
import { describirHorario } from './horario';
import {
  normalizarPlaca, RE_PLACA_MOTO, type ReglaTexto, type Validado, validarEntero, validarPlaca, validarTexto,
} from './validacion';
import { validarFechaHora } from './periodo';
import { celdaCsv } from './auditoria';
import { datosRegistro } from './registroCompleto';
import { leerRegistroLista, LISTA_BLANCA } from './listas';

/**
 * Detecciones vehiculares (dominio puro): cada registro es un paso por un acceso.
 *
 * Reúne las reglas del paso que no dependen de la base ni del transporte: la ventana que agrupa
 * las capturas de un mismo paso físico, cuándo una lectura del motor es utilizable, el tipo de
 * vehículo según el formato de la placa, por qué un paso quedó pendiente, la lectura validada
 * de lo que escribe el personal (dominio/validacion.ts) y el formato de la exportación CSV.
 *
 * Las lecturas del motor ANPR NO se validan con el formato de placa: la cámara informa lo que
 * lee y el cruce con las listas tolera los errores típicos del OCR.
 */

/** Segundos en que dos capturas del mismo tracking o de la misma placa son un solo paso físico. */
export const VENTANA_MISMO_PASO_S = 35;

/**
 * Tipo de entrada de una detección (`rtsp`, `manual`…), nunca una URL: el motor llegó a enviar la
 * URL de lectura de MediaMTX, que lleva su token de servicio, y quedaba en la base y en las
 * respuestas. Una URL RTSP se reduce a `rtsp`; cualquier otro valor que no sea un identificador
 * corto se descarta.
 */
export function normalizarFuente(valor: unknown, omision = 'rtsp'): string {
  if (typeof valor !== 'string' || !valor.trim()) return omision;
  const v = valor.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return /^rtsps?:/i.test(v) ? 'rtsp' : omision;
  return /^[a-z_]{1,20}$/.test(v) ? v : omision;
}

export const ESTADOS_VALIDACION: readonly EstadoValidacion[] = ['autorizado', 'alerta', 'no_reconocido', 'pendiente_revision', 'salida_registrada'];

export const ETIQUETA_ESTADO: Record<EstadoValidacion, string> = {
  autorizado: 'Autorizado', alerta: 'Alerta', no_reconocido: 'No registrado', pendiente_revision: 'Pendiente de revisión',
  salida_registrada: 'Salida registrada',
};

// ─── Lectura del motor ───────────────────────────────────────────────────────

/** Lecturas con que el motor informa que no pudo leer la placa (ya normalizadas). */
const SIN_LECTURA = ['NOLEGIBLE', 'SINRECONOCER'];

/** ¿La lectura del motor permite cruzar la placa con las listas? Si no, decide el personal. */
export function lecturaUtilizable(estadoProcesamiento: unknown, placa: string): boolean {
  return estadoProcesamiento === 'procesado' && placa.length >= 4 && !SIN_LECTURA.includes(placa);
}

/**
 * Tipo de vehículo según el formato de placa ANT (motos: 2 letras + 3 dígitos + letra). Admite
 * el formato antiguo de 3 dígitos porque también se aplica a las lecturas del motor.
 */
export function tipoPorFormato(placa: string): string | null {
  if (RE_PLACA_MOTO.test(placa)) return 'Motocicleta';
  if (/^[A-Z]{3}\d{3,4}$/.test(placa)) return 'Automóvil';
  return null;
}

// ─── Estado de un paso guardado ──────────────────────────────────────────────

/** Evidencias con que el motor respalda (o no) su lectura: formato, cuadro, caracteres, consenso… */
export interface EvidenciaLectura {
  valido?: boolean;
  motivos?: string[];
  /** 'vehiculo_sin_placa': el motor vio un vehículo en la zona de interés sin placa que leer */
  motivo?: string;
  [campo: string]: unknown;
}

/** Motivo que envía el motor cuando registra un vehículo sin placa visible (solo su foto como evidencia). */
export const MOTIVO_SIN_PLACA = 'vehiculo_sin_placa';

/** El paso es un vehículo sin placa visible registrado por el motor (evidencia: la foto). */
export const esSinPlaca = (p: { evidencia_lectura?: string | null }) => evidenciaDe(p)?.motivo === MOTIVO_SIN_PLACA;

/** Campos del paso guardado que explican su estado (columnas de DeteccionVehiculo y del permiso). */
export interface PasoGuardado {
  estado_validacion: string;
  estado_procesamiento: string;
  validado_manualmente?: boolean | number | null;
  vehiculo_autorizado_id?: number | null;
  lectura_valida?: boolean | number | null;
  evidencia_lectura?: string | null;
  verificacion_vehiculo?: string | null;
  verificacion_detalle?: string | null;
  confianza_ocr?: number | null;
  confianza_deteccion?: number | null;
  restriccion_acceso?: string | null;
  autorizado_horario?: string | null;
  autorizado_inicio?: Date | string | null;
  autorizado_vence?: Date | string | null;
}

/** Longitud de la columna DeteccionVehiculo.evidencia_lectura (NVARCHAR) */
export const MAX_EVIDENCIA = 1500;
/** Campos de la evidencia que se omiten, del menos al más importante, si no cabe en la columna */
const EVIDENCIA_PRESCINDIBLE = ['etapas_ms', 'lecturas_rapidas_crudas', 'cuadrilatero', 'motivos'];

/**
 * Evidencia del motor como JSON que cabe en la columna. Antes se cortaba el texto a 1500
 * caracteres: si lo excedía quedaba un JSON inválido y el detalle del paso perdía sus evidencias.
 * Ahora se omiten campos prescindibles; si aun así no cabe (o no es un objeto), no se guarda.
 */
export function serializarEvidencia(evidencia: unknown): string | null {
  if (!evidencia || typeof evidencia !== 'object' || Array.isArray(evidencia)) return null;
  const copia: Record<string, unknown> = { ...(evidencia as Record<string, unknown>) };
  let json = JSON.stringify(copia);
  for (const campo of EVIDENCIA_PRESCINDIBLE) {
    if (json.length <= MAX_EVIDENCIA) break;
    delete copia[campo];
    json = JSON.stringify(copia);
  }
  return json.length <= MAX_EVIDENCIA ? json : null;
}

/** Evidencias guardadas del veredicto del motor; null si faltan o el JSON está dañado. */
export function evidenciaDe(p: { evidencia_lectura?: string | null }): EvidenciaLectura | null {
  if (!p.evidencia_lectura) return null;
  try { return JSON.parse(p.evidencia_lectura); } catch { return null; }
}

const fechaCorta = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : '');

/** Explicación de una restricción temporal del permiso (fuera de horario, no vigente, vencido). */
export function motivoRestriccion(p: PasoGuardado): string | null {
  const r = p.restriccion_acceso as RestriccionAcceso | null | undefined;
  if (!r || !MOTIVO_RESTRICCION[r]) return null;
  const detalle = r === 'fuera_horario' ? `horario autorizado: ${describirHorario(p.autorizado_horario)}`
    : r === 'no_iniciada' ? `vigente desde ${fechaCorta(p.autorizado_inicio)}`
      : `venció el ${fechaCorta(p.autorizado_vence)}`;
  return `${MOTIVO_RESTRICCION[r]} (${detalle}).`;
}

/**
 * Por qué un paso quedó pendiente de confirmación (lectura no confirmada, confianza o vehículo)
 * o fue denegado por una restricción temporal del permiso. `politica` es la política de
 * autorización automática vigente: la misma que decidió el paso.
 */
export function motivoRevision(p: PasoGuardado, politica: PoliticaAutorizacion): string | null {
  if (p.estado_validacion === 'no_reconocido' && !p.validado_manualmente) return motivoRestriccion(p);
  if (p.estado_procesamiento === 'no_legible' && p.estado_validacion === 'pendiente_revision' && !p.validado_manualmente) {
    return esSinPlaca(p)
      ? 'Vehículo sin placa visible: verifique el ingreso con la foto del vehículo y registre la placa si la tiene.'
      : 'La placa no se pudo leer: verifique el ingreso con la foto.';
  }
  if (p.estado_validacion !== 'pendiente_revision' || p.validado_manualmente || p.estado_procesamiento !== 'procesado') return null;
  const enPadron = Boolean(p.vehiculo_autorizado_id);
  const ev = evidenciaDe(p);
  if (p.lectura_valida === false || p.lectura_valida === 0) {
    const motivos = ev?.motivos?.length ? ev.motivos.join('; ') : 'evidencias insuficientes';
    return `${enPadron ? 'La placa está en el padrón, pero la' : 'La'} lectura no está confirmada (${motivos}). Verifique la placa antes de decidir.`;
  }
  if (!enPadron) return null;
  if (p.verificacion_vehiculo === 'no_coincide') return `La placa está en el padrón, pero el vehículo observado no coincide (${p.verificacion_detalle}).`;
  const c = cumpleCriterioLectura({
    lecturaValida: p.lectura_valida === null ? null : Boolean(p.lectura_valida),
    confianzaOcr: p.confianza_ocr ?? null,
    confianzaDeteccion: p.confianza_deteccion ?? null,
  }, politica);
  if (!c.confianzaOk) {
    return `La placa está en el padrón, pero la confianza (${(c.evaluada * 100).toFixed(1)} %) es menor al ${(c.minimo * 100).toFixed(0)} % requerido para autorizar automáticamente. Confirme la placa.`;
  }
  return 'La placa está en el padrón; confirme el ingreso.';
}

/** Fecha y hora en la zona de la institución (exportación y auditoría). */
export const fechaHoraLocal = (f: Date | string) => new Date(f).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' });

// ─── Datos que escribe el personal ───────────────────────────────────────────

/** Identificadores INT de SQL Server. */
const MAX_ID = 2_147_483_647;
/** Columnas placa_reconocida / placa_validada: VARCHAR(20). */
const MAX_PLACA_BUSQUEDA = 20;

const REGLA_TIPO_VEHICULO: ReglaTexto = { etiqueta: 'Tipo de vehículo', tipo: 'alfanumerico', max: 50 };
export const REGLA_MOTIVO_ELIMINACION: ReglaTexto = { etiqueta: 'Motivo de la eliminación', tipo: 'libre', min: 3, max: 300, requerido: true };
export const REGLA_MOTIVO_ELIMINACION_MASIVA: ReglaTexto = { ...REGLA_MOTIVO_ELIMINACION, min: 5 };

type Entrada = Record<string, unknown>;

export interface DatosValidacion {
  tipoVehiculo: string | null;
  observacion: string | null;
}

/**
 * Datos complementarios de la confirmación de una placa (la placa se valida aparte, antes del
 * permiso de excepción). Con excepción, la observación es su motivo: obligatoria y auditada.
 */
export function leerDatosValidacion(entrada: Entrada, excepcion: boolean): Validado<DatosValidacion> {
  const tipo = validarTexto(entrada.tipo_vehiculo, REGLA_TIPO_VEHICULO);
  if (!tipo.ok) return tipo;
  const observacion = validarTexto(entrada.observacion, excepcion
    ? { etiqueta: 'Motivo de la excepción', tipo: 'libre', min: 5, max: 300, requerido: true }
    : { etiqueta: 'Observación', tipo: 'libre', max: 300 });
  if (!observacion.ok) return observacion;
  return { ok: true, valor: { tipoVehiculo: tipo.valor, observacion: observacion.valor } };
}

/** Nombres y apellidos de quien ingresa: columna de la hoja «Reporte de control vehicular» de la garita. */
export const REGLA_PERSONA_INGRESO: ReglaTexto = { etiqueta: 'Nombres y apellidos', tipo: 'nombre', max: 150 };
/** Motivo del ingreso (reunión, recorrido, mantenimiento…): la columna «Observaciones» de esa hoja. */
export const REGLA_MOTIVO_INGRESO: ReglaTexto = { etiqueta: 'Motivo de ingreso', tipo: 'libre', max: 300 };

/**
 * Resto del formulario «Autorizar ingreso» (`datos_permiso`): cada campo tiene su columna en
 * DeteccionVehiculo. Titular, cédula, motivo y vehículo van en los campos propios de DatosIngreso.
 */
export interface FichaIngreso {
  institucion: string | null;
  cargo: string | null;
  departamento: string | null;
  categoria: string | null;
  observaciones: string | null;
  /** Vigencia propuesta para el permiso (AAAA-MM-DD) */
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
  /** Franjas horarias serializadas (JSON) o null = sin restricción horaria */
  horario: string | null;
}

/** Quién ingresa y por qué. Un campo ausente (undefined) no cambia lo guardado; null lo borra. */
export interface DatosIngreso {
  ficha?: FichaIngreso;
  cedula?: string | null;
  persona?: string | null;
  motivo?: string | null;
  tipo?: string | null;
  marca?: string | null;
  modelo?: string | null;
  color?: string | null;
}

const fechaIso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function leerDatosIngreso(entrada: Entrada, vehiculoObligatorio = false): Validado<DatosIngreso> {
  const valor: DatosIngreso = {};
  if (entrada.datos_permiso !== undefined) {
    if (!entrada.datos_permiso || typeof entrada.datos_permiso !== 'object' || Array.isArray(entrada.datos_permiso)) return { ok: false, error: 'Datos del permiso inválidos.' };
    const r = leerRegistroLista(LISTA_BLANCA, entrada.datos_permiso as Record<string, unknown>);
    if (!r.ok) return r;
    const x = r.valor.datos;
    valor.ficha = {
      institucion: x.institucion, cargo: x.cargo, departamento: x.departamento, categoria: x.categoria, observaciones: x.observaciones,
      vigenciaDesde: fechaIso(r.valor.inicio), vigenciaHasta: fechaIso(r.valor.vence), horario: r.valor.horario,
    };
    // Lo que el formulario repite en el cuerpo (titular, motivo, vehículo) se toma de la ficha si no llega aparte
    Object.assign(valor, { cedula: x.cedula, persona: x.propietario, motivo: x.motivo_ingreso,
      tipo: x.tipo_vehiculo, marca: x.marca, modelo: x.modelo, color: x.color });
  }
  if (entrada.persona_ingreso !== undefined) {
    const persona = validarTexto(entrada.persona_ingreso, REGLA_PERSONA_INGRESO);
    if (!persona.ok) return persona;
    valor.persona = persona.valor;
  }
  if (entrada.cedula !== undefined) {
    const cedula = validarTexto(entrada.cedula, { etiqueta: 'Cédula', tipo: 'libre', max: 10 });
    if (!cedula.ok) return cedula;
    if (cedula.valor !== null && !/^\d{10}$/.test(cedula.valor)) {
      return { ok: false, error: 'Cédula: ingrese 10 dígitos, conservando los ceros iniciales.' };
    }
    valor.cedula = cedula.valor;
  }
  if (entrada.motivo_ingreso !== undefined) {
    const motivo = validarTexto(entrada.motivo_ingreso, REGLA_MOTIVO_INGRESO);
    if (!motivo.ok) return motivo;
    valor.motivo = motivo.valor;
  }
  const reglasVehiculo: [Exclude<keyof DatosIngreso, 'ficha'>, string, ReglaTexto][] = [
    ['tipo', 'tipo_vehiculo', REGLA_TIPO_VEHICULO],
    ['marca', 'marca', { etiqueta: 'Marca', tipo: 'alfanumerico', max: 50 }],
    ['modelo', 'modelo', { etiqueta: 'Modelo', tipo: 'alfanumerico', max: 50 }],
    ['color', 'color', { etiqueta: 'Color', tipo: 'letras', max: 30 }],
  ];
  for (const [campo, nombre, regla] of reglasVehiculo) {
    if (vehiculoObligatorio || entrada[nombre] !== undefined) {
      const validado = validarTexto(entrada[nombre], { ...regla, requerido: vehiculoObligatorio });
      if (!validado.ok) return validado;
      valor[campo] = validado.valor;
    }
  }
  return { ok: true, valor };
}

/** Hay algo que guardar de quien ingresa. */
export const hayDatosIngreso = (d: DatosIngreso) => Object.values(d).some(v => v !== undefined);

export interface RegistroManual {
  placa: string;
  motivo: string;
  camaraId: number | null;
  /** Hora (s desde 1970) del cuadro de los últimos 30 s de la cámara que el guardia eligió como foto */
  cuadroT: number | null;
  tipoVehiculo: string | null;
  marca: string | null;
}

/** Paso registrado a mano: placa con formato ANT, motivo y, opcionalmente, cámara y tipo de vehículo. */
export function leerRegistroManual(entrada: Entrada): Validado<RegistroManual> {
  const placa = validarPlaca(entrada.placa);
  if (!placa.ok) return placa;
  const motivo = validarTexto(entrada.motivo, { etiqueta: 'Motivo del registro manual', tipo: 'libre', min: 5, max: 300, requerido: true });
  if (!motivo.ok) return motivo;
  const tipo = validarTexto(entrada.tipo_vehiculo, REGLA_TIPO_VEHICULO);
  if (!tipo.ok) return tipo;
  const marca = validarTexto(entrada.marca, { etiqueta: 'Marca', tipo: 'alfanumerico', max: 50 });
  if (!marca.ok) return marca;
  const camara = validarEntero(entrada.camara_id, { etiqueta: 'Cámara', min: 1, max: MAX_ID });
  if (!camara.ok) return camara;
  const cuadro = entrada.cuadro_t;
  const hayCuadro = cuadro !== undefined && cuadro !== null;
  if (hayCuadro && (typeof cuadro !== 'number' || !Number.isFinite(cuadro) || cuadro <= 0)) {
    return { ok: false, error: 'Foto de evidencia: indique la hora del cuadro elegido.' };
  }
  if (hayCuadro && camara.valor === null) return { ok: false, error: 'La foto de evidencia requiere la cámara asociada.' };
  return {
    ok: true,
    valor: {
      placa: placa.valor.placa, motivo: motivo.valor as string, camaraId: camara.valor, tipoVehiculo: tipo.valor,
      marca: marca.valor,
      cuadroT: hayCuadro ? cuadro as number : null,
    },
  };
}

/** Placa de la consulta de situación: al menos 3 letras o números, sin exigir el formato completo. */
export function leerPlacaConsulta(valor: unknown): Validado<string> {
  const placa = normalizarPlaca(valor);
  if (placa.length < 3) return { ok: false, error: 'Ingrese al menos 3 caracteres de la placa.' };
  if (placa.length > MAX_PLACA_BUSQUEDA) return { ok: false, error: `Placa: máximo ${MAX_PLACA_BUSQUEDA} caracteres.` };
  return { ok: true, valor: placa };
}

/**
 * Fecha (AAAA-MM-DD) o fecha y hora ISO 8601 que exista en el calendario (validarFechaHora de
 * dominio/periodo.ts). El frontend envía el inicio y el fin del día local en UTC (toISOString).
 */
export const leerFechaHora = (valor: unknown, etiqueta: string): Validado<Date | null> => validarFechaHora(valor, { etiqueta });

// ─── Filtros del historial ───────────────────────────────────────────────────

/**
 * Origen de un paso: la cámara en vivo (flujo RTSP) o el registro manual del personal. Se guarda
 * en DeteccionVehiculo.fuente ('rtsp' o 'manual').
 */
export const ORIGENES = ['camara', 'manual'] as const;
export type OrigenPaso = typeof ORIGENES[number];

export const ETIQUETA_ORIGEN: Record<OrigenPaso, string> = { camara: 'Cámara en vivo', manual: 'Registro manual' };

/** Origen del paso según su columna `fuente` (sin valor: la cámara RTSP, el valor por omisión). */
export function origenDe(fuente: string | null | undefined): OrigenPaso {
  return fuente === 'manual' ? 'manual' : 'camara';
}

export interface FiltrosDetecciones {
  cerrados?: boolean;
  completos?: boolean;
  /** Parte de la placa, solo letras y números */
  placa: string | null;
  /** La placa tolera las confusiones típicas del OCR (O/0, I/1, B/8, S/5…) */
  aproximada?: boolean;
  buscar?: string;
  estados: EstadoValidacion[];
  camara: number | null;
  /** Validado por el personal (null = indistinto) */
  validado: boolean | null;
  desde: Date | null;
  hasta: Date | null;
  movimiento?: 'ingreso' | 'salida';
  origen?: OrigenPaso;
  /** Franja horaria local en minutos desde la medianoche; si desde > hasta cruza la medianoche */
  horaDesde?: number;
  horaHasta?: number;
  orden?: 'reciente' | 'antiguo';
}

type Consulta = Record<string, unknown>;

/** Claves de filtro del historial, la exportación y la eliminación masiva. */
export const CLAVES_FILTRO = ['placa', 'buscar', 'estado', 'camara', 'validado', 'desde', 'hasta', 'cerrados', 'completos',
  'movimiento', 'origen', 'hora_desde', 'hora_hasta'] as const;

/** Hora del día "HH:MM" (00:00 a 23:59) en minutos desde la medianoche; null si no se indicó. */
export function leerHoraDelDia(valor: unknown, etiqueta: string): Validado<number | null> {
  if (valor === undefined || valor === null || valor === '') return { ok: true, valor: null };
  const m = typeof valor === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(valor.trim()) : null;
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { ok: false, error: `${etiqueta}: use el formato HH:MM (00:00 a 23:59).` };
  return { ok: true, valor: Number(m[1]) * 60 + Number(m[2]) };
}

/** ¿La consulta trae algún filtro? Sin ninguno, la eliminación masiva alcanza a todo el historial. */
export const tieneFiltros = (q: Consulta) => CLAVES_FILTRO.some(k => Boolean(q[k]));

/**
 * Filtros escritos en la pantalla del historial. La placa es una búsqueda parcial ("pba-12" →
 * "PBA12"); estado y validado provienen de listas cerradas y un valor desconocido se ignora.
 */
export function leerFiltros(q: Consulta): Validado<FiltrosDetecciones> {
  const buscar = validarTexto(q.buscar, { etiqueta: 'Búsqueda', tipo: 'libre', max: 100 });
  if (!buscar.ok) return buscar;
  const placa = normalizarPlaca(q.placa);
  if (placa.length > MAX_PLACA_BUSQUEDA) return { ok: false, error: `Placa: máximo ${MAX_PLACA_BUSQUEDA} caracteres.` };
  const estados = String(q.estado ?? '').split(',')
    .filter((e): e is EstadoValidacion => (ESTADOS_VALIDACION as readonly string[]).includes(e));
  const camara = validarEntero(q.camara, { etiqueta: 'Cámara', min: 1, max: MAX_ID });
  if (!camara.ok) return camara;
  const desde = leerFechaHora(q.desde, 'Fecha inicial');
  if (!desde.ok) return desde;
  const hasta = leerFechaHora(q.hasta, 'Fecha final');
  if (!hasta.ok) return hasta;
  const validado = q.validado === 'si' ? true : q.validado === 'no' ? false : null;
  if (q.cerrados !== undefined && q.cerrados !== 'si' && q.cerrados !== 'no') return { ok: false, error: 'Cerrados: use si o no.' };
  if (q.completos !== undefined && q.completos !== 'si' && q.completos !== 'no') return { ok: false, error: 'Completos: use si o no.' };
  if (q.movimiento !== undefined && q.movimiento !== 'ingreso' && q.movimiento !== 'salida') return { ok: false, error: 'Movimiento: use ingreso o salida.' };
  if (q.origen !== undefined && !(ORIGENES as readonly unknown[]).includes(q.origen)) return { ok: false, error: 'Origen: use camara o manual.' };
  if (q.orden !== undefined && q.orden !== 'reciente' && q.orden !== 'antiguo') return { ok: false, error: 'Orden: use reciente o antiguo.' };
  const horaDesde = leerHoraDelDia(q.hora_desde, 'Hora inicial');
  if (!horaDesde.ok) return horaDesde;
  const horaHasta = leerHoraDelDia(q.hora_hasta, 'Hora final');
  if (!horaHasta.ok) return horaHasta;
  return { ok: true, valor: { placa: placa || null, estados, camara: camara.valor, validado, desde: desde.valor, hasta: hasta.valor,
    ...(buscar.valor ? { buscar: buscar.valor } : {}),
    ...(placa && q.aproximada === 'si' ? { aproximada: true } : {}),
    ...(q.cerrados === undefined ? {} : { cerrados: q.cerrados === 'si' }),
    ...(q.completos === undefined ? {} : { completos: q.completos === 'si' }),
    ...(q.movimiento === undefined ? {} : { movimiento: q.movimiento as 'ingreso' | 'salida' }),
    ...(q.origen === undefined ? {} : { origen: q.origen as OrigenPaso }),
    ...(horaDesde.valor === null ? {} : { horaDesde: horaDesde.valor }),
    ...(horaHasta.valor === null ? {} : { horaHasta: horaHasta.valor }),
    ...(q.orden === undefined ? {} : { orden: q.orden as 'reciente' | 'antiguo' }) } };
}

/** Página y tamaño del historial: enteros; sin valor o fuera de rango se ajustan (25 por página, de 5 a 100). */
export function leerPaginacion(q: Consulta): Validado<{ pagina: number; tamano: number }> {
  const pagina = validarEntero(q.pagina, { etiqueta: 'Página', max: 1_000_000 });
  if (!pagina.ok) return pagina;
  const tamano = validarEntero(q.tamano, { etiqueta: 'Tamaño de página' });
  if (!tamano.ok) return tamano;
  return { ok: true, valor: { pagina: Math.max(1, pagina.valor || 1), tamano: Math.min(100, Math.max(5, tamano.valor || 25)) } };
}

/** Cantidad de pasos recientes del monitoreo (1 a 50, 20 por omisión). La envía la aplicación, no una persona. */
export function leerLimite(valor: unknown): number {
  const n = validarEntero(valor, { etiqueta: 'Límite' });
  return Math.min(50, Math.max(1, (n.ok ? n.valor : null) || 20));
}

// ─── Exportación CSV ─────────────────────────────────────────────────────────

/** Fila del historial con las columnas que se exportan (DeteccionVehiculo + cámara, padrón y alerta). */
export interface FilaExportacion {
  id: number;
  fecha_hora_ingreso: Date | string;
  tipo_movimiento?: 'ingreso' | 'salida';
  placa_validada: string | null;
  placa_reconocida: string | null;
  placa_ocr_original: string | null;
  estado_validacion: string;
  validado_manualmente: boolean | number | null;
  validador_email: string | null;
  camara_nombre: string | null;
  camara_ubicacion: string | null;
  tipo_vehiculo: string | null;
  vehiculo_tipo: string | null;
  vehiculo_marca: string | null;
  vehiculo_color: string | null;
  verificacion_vehiculo: string | null;
  propietario: string | null;
  departamento: string | null;
  alerta_motivo: string | null;
  nivel_alerta: string | null;
  confianza_deteccion: number | null;
  confianza_ocr: number | null;
  persona_ingreso?: string | null;
  motivo_ingreso?: string | null;
  fecha_hora_salida?: Date | string | null;
  fuente?: string | null;
}

const CABECERA_CSV = ['ID', 'Fecha y hora', 'Movimiento', 'Placa', 'Lectura OCR', 'Estado', 'Validado por operador', 'Validador', 'Cámara', 'Ubicación',
  'Tipo de vehículo', 'Marca observada', 'Color observado', 'Verificación del vehículo', 'Propietario (padrón)', 'Departamento',
  'Motivo de alerta', 'Nivel de alerta', 'Confianza detección (%)', 'Confianza OCR (%)', 'Nombres y apellidos', 'Motivo de ingreso',
  'Hora de salida', 'Origen'];

/** Marca de orden de bytes: Excel abre el UTF-8 con tildes correctas. */
const BOM_UTF8 = String.fromCharCode(0xfeff);
const porcentaje = (v: number | null) => (typeof v === 'number' ? (v * 100).toFixed(1) : '');

/**
 * CSV del historial; empieza con BOM para que Excel respete las tildes del UTF-8. Cada celda va
 * entre comillas y un texto que empieza como fórmula lleva un apóstrofo (inyección CSV, OWASP).
 */
export function csvDetecciones(filas: FilaExportacion[]): string {
  const lineas = filas.map(d => [
    d.id, fechaHoraLocal(d.fecha_hora_ingreso), d.tipo_movimiento === 'salida' ? 'Salida' : 'Ingreso',
    datosRegistro(d).placa || '', d.placa_ocr_original || d.placa_reconocida || '',
    ETIQUETA_ESTADO[d.estado_validacion as EstadoValidacion] ?? d.estado_validacion, d.validado_manualmente ? 'Sí' : 'No', d.validador_email || '',
    d.camara_nombre || '', d.camara_ubicacion || '', datosRegistro(d).tipo || '', datosRegistro(d).marca || '',
    d.vehiculo_color || '', d.verificacion_vehiculo || '', d.propietario || '', d.departamento || '',
    d.alerta_motivo || '', d.nivel_alerta || '', porcentaje(d.confianza_deteccion), porcentaje(d.confianza_ocr),
    datosRegistro(d).nombre || '', datosRegistro(d).motivo || '',
    d.fecha_hora_salida ? fechaHoraLocal(d.fecha_hora_salida) : '', ETIQUETA_ORIGEN[origenDe(d.fuente)],
  ].map(celdaCsv).join(','));
  return BOM_UTF8 + [CABECERA_CSV.map(celdaCsv).join(','), ...lineas].join('\n');
}
