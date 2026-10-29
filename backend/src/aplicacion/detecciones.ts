import {
  type Actor, errorNoEncontrado, errorProhibido, errorValidacion, type PuertoAuditoria, type PuertoEventos,
} from './comun';
import {
  type Decision, decidirAcceso, type EstadoValidacion, MOTIVO_RESTRICCION, type PoliticaAutorizacion,
} from '../dominio/decisionAcceso';
import {
  csvDetecciones, type DatosIngreso, ETIQUETA_ESTADO, type FilaExportacion, type FiltrosDetecciones, fechaHoraLocal, hayDatosIngreso,
  leerDatosIngreso, leerDatosValidacion, leerFiltros, leerLimite, leerPaginacion, leerPlacaConsulta, leerRegistroManual, lecturaUtilizable,
  normalizarFuente, REGLA_MOTIVO_ELIMINACION, REGLA_MOTIVO_ELIMINACION_MASIVA, serializarEvidencia, tieneFiltros,
} from '../dominio/detecciones';
import { describirHorario, evaluarVigencia, validarHorario, type Vigencia } from '../dominio/horario';
import { type Rol, tienePermiso } from '../dominio/permisos';
import { normalizarPlaca, validarEntero, validarPlaca, validarTexto } from '../dominio/validacion';
import { faltantesIngreso } from '../dominio/registroCompleto';

/**
 * Detecciones vehiculares: cada registro es un paso por un acceso.
 *
 * Servicio ANPR (X-Servicio-Token): fase 1 (captura, pendiente de OCR), fase 2 (lectura y cruce
 * con las listas) y descartes. Sus cuerpos se interpretan igual que siempre: la cámara informa lo
 * que lee y el cruce tolera los errores del OCR, así que aquí NO se exige el formato de placa.
 *
 * Personal: historial con filtros, recientes, exportación, situación de una placa, detalle,
 * validación (con excepción auditada), registro manual y eliminación (individual o masiva). Lo
 * que escribe una persona sí se valida con dominio/validacion.ts (placa ANT, motivos, tipo…).
 *
 * La decisión de acceso la toma la política pura de dominio/decisionAcceso.ts; este módulo reúne
 * las evidencias, persiste el resultado y lo difunde (Socket.IO y centro de notificaciones).
 */

export type Fila = Record<string, any>;

/** « · ingresa: … · motivo: …» para la auditoría (un campo borrado se anota como tal). */
function describirDatosIngreso(x: DatosIngreso): string {
  const parte = (etiqueta: string, v: string | null | undefined) => (v === undefined ? '' : ` · ${etiqueta}: ${v ?? '(borrado)'}`);
  return parte('ingresa', x.persona) + parte('cédula', x.cedula) + parte('motivo de ingreso', x.motivo)
    + parte('tipo de vehículo', x.tipo) + parte('marca', x.marca) + parte('modelo', x.modelo) + parte('color', x.color);
}

/** Detección tal como la entrega la API y los eventos en tiempo real. */
export type DeteccionDTO = Record<string, any> & { id: number; placa: string | null; estado_validacion: EstadoValidacion };

/** Evidencias de las listas para una placa en el instante del paso. */
export interface Cruce {
  /** Coincidencia con la lista negra (tolerante a homoglifos del OCR) */
  alerta: Fila | null;
  /** Permiso de la lista blanca (coincidencia exacta); no se considera si hay alerta */
  permiso: Fila | null;
  vigencia: Vigencia | null;
}

export interface NuevoIngreso {
  trackingId: number;
  /** Placa adelantada por el motor (≥ 4 caracteres) o null */
  pista: string | null;
  ruta: string;
  confianza: number | null;
  fuente: string;
  camaraId: number | null;
  tipoMovimiento: 'ingreso' | 'salida';
}

export interface LecturaAutomatica {
  placaOriginal: string;
  confianza: number | null;
  decision: string;
  lecturaVerificador: unknown;
  latenciaMs: unknown;
}

/** Atributos observados del vehículo en el paso (segundo factor). */
export interface Observacion {
  confianza_deteccion: number | null;
  fecha_hora_ingreso: Date | string;
  marca: string | null;
  color: string | null;
  tipo: string | null;
}

export interface ResumenHistorial {
  total: number;
  ingresos: number;
  salidas: number;
  con_salida: number;
  autorizados: number;
  alertas: number;
  no_registrados: number;
  pendientes: number;
  sin_lectura: number;
  /** Placas distintas leídas o confirmadas */
  placas: number;
  /** Por origen: cámara en vivo y registro manual */
  camara: number;
  manuales: number;
  primero: Date | string | null;
  ultimo: Date | string | null;
}

export interface Descarte {
  trackingId: number;
  motivo: string;
  texto: string | null;
  confianza: number | null;
  fuente: string | null;
  camaraId: number | null;
}

export interface RepositorioDetecciones {
  obtener(id: number): Promise<Fila | null>;
  /** Ingreso del mismo paso físico (misma placa, o sin placa el mismo tracking, y misma cámara) dentro de la ventana */
  mismoPaso(trackingId: number, pista: string, camaraId: number | null, tipoMovimiento: 'ingreso' | 'salida'): Promise<{ id: number; fecha_hora_ingreso: Date } | null>;
  existeCamara(id: number): Promise<boolean>;
  direccionCamara(id: number): Promise<'ingreso' | 'salida' | null>;
  crearIngreso(n: NuevoIngreso): Promise<{ id: number; fecha_hora_ingreso: Date }>;
  guardarSalida(id: number, lectura: { placa: string; confianza: number | null; rutaPlaca: string | null }): Promise<void>;
  validarSalida(id: number, lectura: { placa: string; usuarioId: number }): Promise<void>;
  guardarMetadatos(id: number, metadatos: unknown): Promise<void>;
  /** Atributos del vehículo (tipo, color, marca, modelo) que llegan después del registro */
  guardarVehiculo(id: number, vehiculo: Record<string, unknown>): Promise<void>;
  registrarLecturaAutomatica(id: number, l: LecturaAutomatica): Promise<void>;
  marcarNoLegible(id: number, rutaPlaca: string | null): Promise<void>;
  /** Otro paso ya procesado con la misma placa en la ventana de 35 s */
  pasoProcesadoConPlaca(idExcluido: number, placa: string, camaraId: number | null, tipoMovimiento: 'ingreso' | 'salida'): Promise<number | null>;
  eliminarPendiente(id: number): Promise<void>;
  guardarVeredicto(id: number, valida: boolean | null, evidencia: string | null): Promise<void>;
  observacion(id: number): Promise<Observacion | null>;
  guardarVerificacion(id: number, resultado: string, detalle: string): Promise<void>;
  guardarDecisionAutomatica(id: number, d: { placa: string; confianza: number | null; rutaPlaca: string | null; tipo: string | null },
    cruce: Cruce, decision: Decision): Promise<void>;
  registrarDescarte(d: Descarte): Promise<void>;
  contar(f: FiltrosDetecciones): Promise<number>;
  pagina(f: FiltrosDetecciones, offset: number, tamano: number): Promise<Fila[]>;
  /** Totales del historial con los mismos filtros (estados, movimientos, origen, placas distintas y período) */
  resumenHistorial(f: FiltrosDetecciones): Promise<ResumenHistorial>;
  recientes(limite: number, buscar?: string | null): Promise<Fila[]>;
  registrarSalida(id: number): Promise<boolean>;
  exportar(f: FiltrosDetecciones): Promise<Fila[]>;
  /** Últimos 10 pasos de una placa (sin contar `excluirId`) */
  historialPlaca(placa: string, excluirId?: number): Promise<Fila[]>;
  auditoriaDe(id: number): Promise<Fila[]>;
  guardarValidacion(id: number, d: { placa: string | null; tipo: string | null; usuarioId: number }, cruce: Cruce, decision: Decision): Promise<void>;
  crearManual(d: { placa: string; camaraId: number | null; tipo: string | null; marca: string | null; usuarioId: number; rutaImagen?: string },
    cruce: Cruce, decision: Decision): Promise<number>;
  crearSalidaManual(d: { placa: string; camaraId: number; usuarioId: number; rutaImagen?: string }): Promise<number>;
  /** Nombres y apellidos de quien ingresa y motivo de ingreso (solo los campos presentes) */
  guardarDatosIngreso(id: number, d: DatosIngreso): Promise<void>;
  /** Crea/vincula un permiso por nombre para un ingreso sin placa ya identificado en garita. */
  autorizarIngresoSinPlaca?(id: number, usuarioId: number): Promise<void>;
  eliminar(id: number): Promise<void>;
  /** Elimina las que cumplen los filtros (todas si `f` es null) y devuelve sus rutas de evidencia */
  eliminarFiltradas(f: FiltrosDetecciones | null): Promise<{ id: number; ruta_imagen_ingreso: string | null; ruta_imagen_placa: string | null }[]>;
}

/** Búsqueda en las listas de control: lista negra aproximada y permiso exacto de la lista blanca. */
export interface PuertoListasDetecciones {
  alerta(placa: string): Promise<{ row: Fila; coincidencia: 'exacta' | 'aproximada' } | null>;
  permiso(placa: string): Promise<Fila | null>;
}

export interface CuadroHistorial { t: number; miniatura: string }

export interface PuertoEvidenciaManual {
  /** Miniaturas (JPEG en base64, la más reciente primero) si `camaraId` es la cámara que procesa el motor */
  cuadros(camaraId: number): Promise<{ disponible: boolean; motivo?: string; cuadros: CuadroHistorial[] }>;
  /** Guarda como foto de evidencia el cuadro de esa hora; su ruta /media/…, o null si ya no está */
  guardar(camaraId: number, t: number): Promise<string | null>;
}

/** Encabezado del reporte PDF de Registro de Salidas. */
export interface InfoReporteSalidas {
  generado: Date;
  zona: string;
  /** Período consultado (null = sin límite) */
  desde: Date | null;
  hasta: Date | null;
  /** Texto buscado en la consulta, si lo hubo */
  buscar: string | null;
  elaboradoPor: string;
}

export interface DependenciasDetecciones {
  pdfRegistros?: (filas: Fila[], info: InfoReporteSalidas) => Promise<Buffer>;
  repositorio: RepositorioDetecciones;
  listas: PuertoListasDetecciones;
  /** Representación de una fila para la API (imágenes firmadas y motivo de revisión) */
  presentar(fila: Fila, detalle?: boolean): DeteccionDTO;
  politica: () => PoliticaAutorizacion;
  /** Segundo factor: atributos registrados frente a observados (marca, color, tipo) */
  compararVehiculo(registrado: Fila, observado: Observacion): { resultado: 'coincide' | 'no_coincide' | 'sin_datos'; detalle: string };
  avisos: {
    /** Aviso de garita o al gestor que otorgó el permiso; sin esperar */
    decision(dto: DeteccionDTO, decision: Decision, permiso: Fila | null): void;
    /** La persona atendió el paso: sus alarmas pendientes se resuelven */
    resolverPorDeteccion(id: number): Promise<void>;
  };
  evidencia: { eliminar(rutas: (string | null | undefined)[]): Promise<number> };
  /**
   * Alta en la lista blanca desde la autorización de un paso (mismo caso de uso que el formulario:
   * valida, crea o reactiva, audita y avisa). Lanza el error de validación o conflicto.
   */
  padron?: { registrar(entrada: Record<string, unknown>, actor: Actor): Promise<{ accion: 'creado' | 'reactivado' }> };
  /** Conserva la primera foto de una placa registrada, sin depender del historial. */
  evidenciaListas?: { conservar(fila: Fila): Promise<void> };
  /** Últimos 30 s de la cámara que procesa el motor, para la foto del registro manual */
  evidenciaManual?: PuertoEvidenciaManual;
  eventos: PuertoEventos;
  auditoria: PuertoAuditoria;
  tiempo: { ahora(): Date; zona: string };
}

type Entrada = Record<string, any>;
const CONFIANZA_MINIMA_DETECCION_REGISTRO = 0.23;
const cuerpo = (entrada: unknown): Entrada => (entrada && typeof entrada === 'object' ? entrada as Entrada : {});

/** Una abstención explícita no debe recuperar la matrícula candidata del registro anterior. */
function evidenciaTextoNoMatricula(estado: unknown, lecturaValida: unknown, evidencia: unknown): string | null {
  if (!evidencia || typeof evidencia !== 'object' || Array.isArray(evidencia)) return null;
  const ev = evidencia as Entrada;
  if (estado !== 'no_legible' || ev.motivo !== 'texto_no_matricula') return null;
  if (lecturaValida !== false) throw errorValidacion('El texto sin matrícula debe informar lectura_valida=false.');
  const texto = typeof ev.observacion_ocr === 'string' ? ev.observacion_ocr.trim().replace(/\s+/g, ' ') : '';
  if (!texto || texto.length > 240 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(texto)) {
    throw errorValidacion('La observación OCR debe contener entre 1 y 240 caracteres de texto.');
  }
  const confianza = ev.confianza_texto_ocr;
  if (typeof confianza !== 'number' || !Number.isFinite(confianza) || confianza < 0 || confianza > 1) {
    throw errorValidacion('La confianza del texto OCR debe ser un número entre 0 y 1.');
  }
  const serializada = serializarEvidencia({ ...ev, observacion_ocr: texto });
  if (!serializada) throw errorValidacion('La evidencia del texto OCR no cabe en el registro.');
  return serializada;
}

const entradaListas = (c: Cruce) => ({
  alerta: c.alerta ? { id: c.alerta.id as number, coincidencia: c.alerta.coincidencia } : null,
  permiso: c.permiso ? { id: c.permiso.id as number, vigencia: c.vigencia! } : null,
});

export function casosDetecciones(d: DependenciasDetecciones) {
  /** Lee la detección completa y la difunde a las sesiones conectadas. */
  async function difundir(id: number, evento: 'deteccion:nueva' | 'deteccion:actualizada'): Promise<DeteccionDTO | null> {
    const fila = await d.repositorio.obtener(id);
    if (!fila) return null;
    try { await d.evidenciaListas?.conservar(fila); }
    catch (error) { console.warn('[EVIDENCIA LISTAS] No se pudo conservar la foto del paso:', (error as Error).message); }
    const dto = d.presentar(fila);
    d.eventos.emitir(evento, dto);
    if (dto.estado_validacion === 'alerta') d.eventos.emitir('deteccion:alerta', dto);
    return dto;
  }

  /** Lista negra (aproximada) y, si no hay alerta, permiso exacto con su estado en el instante del paso. */
  async function cruzarListas(placa: string, instante: Date): Promise<Cruce> {
    const alerta = await d.listas.alerta(placa);
    if (alerta) return { alerta: { ...alerta.row, coincidencia: alerta.coincidencia }, permiso: null, vigencia: null };
    const permiso = await d.listas.permiso(placa);
    return { alerta: null, permiso, vigencia: permiso ? evaluarVigencia(permiso, instante, d.tiempo.zona) : null };
  }

  const filtros = (consulta: Entrada) => {
    const f = leerFiltros(consulta);
    if (!f.ok) throw errorValidacion(f.error);
    return f.valor;
  };

  /**
   * Cruce con las listas, segundo factor y decisión de acceso de un paso con lectura utilizable.
   * Lo comparten la lectura del motor (fase 2) y su reevaluación (fase 3): las mismas reglas.
   */
  async function decidirLectura(id: number, l: {
    placa: string; confianza: number | null; rutaPlaca: string | null; validez: boolean | null; lecturaVerificador: unknown; latenciaMs: unknown;
  }) {
    const obs = await d.repositorio.observacion(id);
    if (!obs) throw errorNoEncontrado('Ingreso no encontrado.');

    // El acceso se juzga en el instante del paso (horario y vigencia del permiso)
    let placa = l.placa;
    const cruce = await cruzarListas(placa, new Date(obs.fecha_hora_ingreso));
    let tipo: string | null = null;
    if (cruce.permiso) {
      placa = normalizarPlaca(cruce.permiso.placa) || placa;
      tipo = cruce.permiso.tipo_vehiculo || tipo;
    }

    // Segundo factor: marca / color / tipo observados frente a los registrados (posible placa clonada)
    const registrado = cruce.alerta ?? cruce.permiso;
    let verificacion: ReturnType<DependenciasDetecciones['compararVehiculo']> | null = null;
    if (registrado) {
      verificacion = d.compararVehiculo(registrado, obs);
      if (verificacion.resultado === 'no_coincide') console.warn(`[SEGUNDO FACTOR] Ingreso #${id} ${placa}: ${verificacion.detalle}`);
      await d.repositorio.guardarVerificacion(id, verificacion.resultado, verificacion.detalle.substring(0, 255));
    }

    const decision = decidirAcceso({
      origen: 'automatico',
      ...entradaListas(cruce),
      lectura: { lecturaValida: l.validez, confianzaOcr: l.confianza, confianzaDeteccion: obs.confianza_deteccion ?? null },
      verificacionVehiculo: verificacion?.resultado ?? null,
      politica: d.politica(),
    });
    console.log(`[DECISION] Ingreso #${id} ${placa}: ${decision.estado} (${decision.regla}: ${decision.motivos.join('; ')})`);

    await d.repositorio.guardarDecisionAutomatica(id, { placa, confianza: l.confianza, rutaPlaca: l.rutaPlaca, tipo }, cruce, decision);
    await d.repositorio.registrarLecturaAutomatica(id, {
      placaOriginal: placa, confianza: l.confianza, decision: decision.estado, lecturaVerificador: l.lecturaVerificador, latenciaMs: l.latenciaMs,
    });
    const dto = await difundir(id, 'deteccion:actualizada');
    return { dto, decision, permiso: cruce.permiso };
  }

  const avisarSiCorresponde = (dto: DeteccionDTO | null, decision: Decision, permiso: Fila | null) => {
    if (dto && (decision.estado === 'alerta' || decision.estado === 'autorizado')) d.avisos.decision(dto, decision, permiso);
  };

  async function registrarTextoNoMatricula(id: number, actual: Fila, evidencia: string, rutaPlaca: string | null,
    latenciaMs: unknown, permitirPendiente = false) {
    const estadoAutomatico = actual.estado_procesamiento === 'procesado' || actual.estado_procesamiento === 'no_legible'
      || (permitirPendiente && actual.estado_procesamiento === 'pendiente_ocr');
    // Una observación automática tardía no cambia lo confirmado por el personal ni rebaja alertas.
    if (actual.validado_manualmente || actual.estado_validacion === 'alerta' || !estadoAutomatico) {
      return { message: 'Se conserva la decisión vigente del paso.', reevaluado: false, cambio: false,
        deteccion: await difundir(id, 'deteccion:actualizada') };
    }
    await d.repositorio.marcarNoLegible(id, rutaPlaca ?? actual.ruta_imagen_placa ?? null);
    await d.repositorio.guardarVeredicto(id, false, evidencia);
    await d.repositorio.registrarLecturaAutomatica(id, {
      placaOriginal: '', confianza: 0, decision: 'pendiente_revision', lecturaVerificador: null, latenciaMs,
    });
    return { message: 'Texto observado conservado sin asignar una matrícula.', reevaluado: true,
      cambio: actual.estado_validacion !== 'pendiente_revision', deteccion: await difundir(id, 'deteccion:actualizada') };
  }

  return {
    // ─── Servicio ANPR ─────────────────────────────────────────────────────────

    /**
     * Fase 1 · captura. Un paso físico = un registro: se reutiliza el ingreso de la misma placa (o,
     * sin placa, del mismo tracking) en la misma cámara dentro de la ventana de 35 s.
     */
    async ingreso(entrada: unknown) {
      const b = cuerpo(entrada);
      const { tracking_id, ruta_imagen_ingreso, confianza_deteccion = null, fuente, camara_id = null, placa = null } = b;
      if (!ruta_imagen_ingreso) throw errorValidacion('La ruta de la imagen de ingreso es obligatoria.');
      if (typeof confianza_deteccion !== 'number' || !Number.isFinite(confianza_deteccion)
          || confianza_deteccion < 0 || confianza_deteccion > 1) {
        throw errorValidacion('La confianza de detección debe ser un número entre 0 y 1.');
      }
      if (confianza_deteccion < CONFIANZA_MINIMA_DETECCION_REGISTRO) {
        await d.repositorio.registrarDescarte({
          trackingId: Number.isInteger(tracking_id) ? tracking_id : -1,
          motivo: 'confianza_deteccion_baja',
          texto: typeof placa === 'string' ? normalizarPlaca(placa).substring(0, 50) : null,
          confianza: confianza_deteccion,
          fuente: normalizarFuente(fuente),
          camaraId: Number.isInteger(camara_id) ? camara_id : null,
        });
        return {
          nuevo: false,
          respuesta: { message: 'Paso descartado: confianza de detección inferior al 23 %.', descartado: true },
        };
      }
      const trackingId = Number.isInteger(tracking_id) ? tracking_id : -1;
      const pista = typeof placa === 'string' ? normalizarPlaca(placa) : '';

      let camaraId: number | null = null;
      if (camara_id !== null && Number.isInteger(Number(camara_id)) && await d.repositorio.existeCamara(Number(camara_id))) camaraId = Number(camara_id);
      let tipoMovimiento: NuevoIngreso['tipoMovimiento'] = 'ingreso';
      if (camaraId !== null) {
        const direccion = await d.repositorio.direccionCamara(camaraId);
        if (direccion === null) throw errorValidacion('No se pudo determinar la dirección de la cámara.');
        tipoMovimiento = direccion;
      }

      const previo = await d.repositorio.mismoPaso(trackingId, pista, camaraId, tipoMovimiento);
      if (previo) {
        return {
          nuevo: false,
          respuesta: { message: 'Registro existente reutilizado (mismo paso físico).', ingreso_id: previo.id, fecha_hora_ingreso: previo.fecha_hora_ingreso, deduplicado: true },
        };
      }

      const creado = await d.repositorio.crearIngreso({
        trackingId, pista: pista.length >= 4 ? pista : null, ruta: String(ruta_imagen_ingreso).substring(0, 255),
        confianza: typeof confianza_deteccion === 'number' ? confianza_deteccion : null, fuente: normalizarFuente(fuente), camaraId,
        tipoMovimiento,
      });
      await d.repositorio.guardarMetadatos(creado.id, b.metadatos);
      await difundir(creado.id, 'deteccion:nueva');
      const mensaje = tipoMovimiento === 'salida' ? 'Salida registrada (pendiente de OCR).' : 'Ingreso registrado (pendiente de OCR).';
      return { nuevo: true, respuesta: { message: mensaje, ingreso_id: creado.id, fecha_hora_ingreso: creado.fecha_hora_ingreso } };
    },

    /** Fase 2 · lectura OCR, segundo factor y decisión de acceso. */
    async completarOcr(entrada: unknown) {
      const { ingreso_id, placa_reconocida, confianza_ocr, ruta_imagen_placa, estado_procesamiento = 'procesado',
        lectura_verificador = null, latencia_ms = null, lectura_valida = null, evidencia_lectura = null } = cuerpo(entrada);
      // Veredicto del motor sobre la lectura (null si el motor no lo informa)
      const validez: boolean | null = typeof lectura_valida === 'boolean' ? lectura_valida : null;
      const evidencia = serializarEvidencia(evidencia_lectura);
      if (!Number.isInteger(ingreso_id)) throw errorValidacion('El ID de ingreso es obligatorio.');
      const id = ingreso_id as number;

      const textoNoMatricula = evidenciaTextoNoMatricula(estado_procesamiento, lectura_valida, evidencia_lectura);
      if (textoNoMatricula) {
        const actual = await d.repositorio.obtener(id);
        if (!actual) throw errorNoEncontrado('Registro vehicular no encontrado.');
        const ruta = typeof ruta_imagen_placa === 'string' && ruta_imagen_placa ? ruta_imagen_placa.substring(0, 255) : null;
        return registrarTextoNoMatricula(id, actual, textoNoMatricula, ruta, latencia_ms, true);
      }

      const placa = normalizarPlaca(placa_reconocida);
      const confianza = typeof confianza_ocr === 'number' ? confianza_ocr : null;
      const rutaPlaca = ruta_imagen_placa || null;
      const lecturaAutomatica = (decision: string) => d.repositorio.registrarLecturaAutomatica(id, {
        placaOriginal: placa, confianza, decision, lecturaVerificador: lectura_verificador, latenciaMs: latencia_ms,
      });

      // Sin lectura utilizable: queda para validación del personal (no se elimina la evidencia). Se
      // guarda lo que el motor explicó (p. ej. un vehículo sin placa visible) para mostrar el motivo
      if (!lecturaUtilizable(estado_procesamiento, placa)) {
        await d.repositorio.marcarNoLegible(id, rutaPlaca);
        if (evidencia) await d.repositorio.guardarVeredicto(id, validez, evidencia);
        await lecturaAutomatica('pendiente_revision');
        return { message: 'Ingreso pendiente de validación manual.', deteccion: await difundir(id, 'deteccion:actualizada') };
      }

      const actual = await d.repositorio.obtener(id);
      if (!actual) throw errorNoEncontrado('Registro vehicular no encontrado.');
      const tipoMovimiento = actual.tipo_movimiento === 'salida' ? 'salida' : 'ingreso';
      // Mismo paso físico ya procesado con la misma placa: se consolida
      const previo = await d.repositorio.pasoProcesadoConPlaca(id, placa, actual.camara_id ?? null, tipoMovimiento);
      if (previo !== null) {
        await d.repositorio.eliminarPendiente(id);
        d.eventos.emitir('deteccion:eliminada', { id, consolidado_en: previo });
        return { message: 'Detección consolidada con el paso previo.', deduplicado: true, ingreso_id: previo };
      }

      await d.repositorio.guardarVeredicto(id, validez, evidencia);
      if (actual.tipo_movimiento === 'salida') {
        await d.repositorio.guardarSalida(id, { placa, confianza, rutaPlaca });
        await lecturaAutomatica('salida_registrada');
        return { message: 'Salida registrada.', deteccion: await difundir(id, 'deteccion:actualizada') };
      }
      const { dto, decision, permiso } = await decidirLectura(id, {
        placa, confianza, rutaPlaca, validez, lecturaVerificador: lectura_verificador, latenciaMs: latencia_ms,
      });
      if (dto) d.avisos.decision(dto, decision, permiso);
      return { message: 'OCR completado.', deteccion: dto };
    },

    /**
     * Fase 3 · reevaluación. El motor registra el paso en menos de 1 s con las evidencias que tiene;
     * cuando llegan el segundo OCR o los atributos del vehículo reenvía su veredicto y el paso se
     * decide de nuevo con las mismas reglas. Se conserva lo que decidió el personal, una alerta no
     * se rebaja y solo se avisa si el estado cambia. También corrige el paso cuando otra pista del
     * mismo vehículo leyó mejor la placa (con su foto: `ruta_imagen_placa`).
     */
    async reevaluar(entrada: unknown) {
      const { ingreso_id, placa_reconocida = null, confianza_ocr = null, lectura_verificador = null, lectura_valida = null,
        evidencia_lectura = null, vehiculo = null, ruta_imagen_placa = null, estado_procesamiento = null } = cuerpo(entrada);
      const rutaPlaca = typeof ruta_imagen_placa === 'string' && ruta_imagen_placa ? ruta_imagen_placa.substring(0, 255) : null;
      if (!Number.isInteger(ingreso_id)) throw errorValidacion('El ID de ingreso es obligatorio.');
      const id = ingreso_id as number;
      const actual = await d.repositorio.obtener(id);
      if (!actual) throw errorNoEncontrado('Ingreso no encontrado.');

      // Un rótulo de otra pista del mismo vehículo aporta texto, no sustituye su matrícula.
      const observacion = cuerpo(entrada).observacion_ocr;
      if (observacion !== undefined) {
        const o = cuerpo(observacion);
        const comprobada = evidenciaTextoNoMatricula('no_legible', false, {
          motivo: 'texto_no_matricula', observacion_ocr: o.texto, confianza_texto_ocr: o.confianza,
        });
        if (!comprobada) throw errorValidacion('Observación OCR no válida.');
        const texto = JSON.parse(comprobada) as Entrada;
        let anterior: Entrada = {};
        try { anterior = cuerpo(JSON.parse(actual.evidencia_lectura || '{}')); } catch { /* Evidencia histórica dañada. */ }
        const evidencia = serializarEvidencia({ ...anterior, observacion_ocr: texto.observacion_ocr,
          confianza_texto_ocr: texto.confianza_texto_ocr });
        if (!evidencia) throw errorValidacion('La observación OCR no cabe en el registro.');
        await d.repositorio.guardarVeredicto(id, actual.lectura_valida == null ? null : Boolean(actual.lectura_valida), evidencia);
        return { message: 'Observación OCR añadida al mismo acceso.', reevaluado: true, cambio: false,
          deteccion: await difundir(id, 'deteccion:actualizada') };
      }

      const textoNoMatricula = evidenciaTextoNoMatricula(estado_procesamiento, lectura_valida, evidencia_lectura);
      if (vehiculo && typeof vehiculo === 'object' && !Array.isArray(vehiculo)) await d.repositorio.guardarVehiculo(id, vehiculo);
      if (textoNoMatricula) return registrarTextoNoMatricula(id, actual, textoNoMatricula, rutaPlaca, actual.latencia_ms ?? null);
      const placa = normalizarPlaca(placa_reconocida) || normalizarPlaca(actual.placa_reconocida);
      // Una alerta o confirmación manual mantiene su decisión; una foto tardía de la misma
      // matrícula sí puede completar la evidencia que todavía falta en su registro de lista.
      if ((rutaPlaca || typeof lectura_valida === 'boolean')
        && placa === normalizarPlaca(actual.placa_validada || actual.placa_reconocida) && lectura_valida !== false) {
        try { await d.evidenciaListas?.conservar({ ...actual, ruta_imagen_placa: rutaPlaca ?? actual.ruta_imagen_placa,
          evidencia_lectura: evidencia_lectura ?? actual.evidencia_lectura,
          lectura_valida: typeof lectura_valida === 'boolean' ? lectura_valida : actual.lectura_valida }); }
        catch (error) { console.warn('[EVIDENCIA LISTAS] No se pudo conservar el recorte tardío:', (error as Error).message); }
      }
      if (actual.tipo_movimiento === 'salida' && !actual.validado_manualmente && actual.estado_procesamiento === 'procesado' && placa) {
        const confianza = typeof confianza_ocr === 'number' ? confianza_ocr : typeof actual.confianza_ocr === 'number' ? actual.confianza_ocr : null;
        await d.repositorio.guardarSalida(id, { placa, confianza, rutaPlaca: null });
        if (typeof lectura_valida === 'boolean') await d.repositorio.guardarVeredicto( id, lectura_valida, serializarEvidencia(evidencia_lectura));
        return { message: 'Salida actualizada.', reevaluado: true, cambio: false, deteccion: await difundir(id, 'deteccion:actualizada') };
      }
      if (actual.validado_manualmente || actual.estado_procesamiento !== 'procesado' || actual.estado_validacion === 'alerta' || !placa) {
        return { message: 'Se conserva la decisión vigente del paso.', reevaluado: false, deteccion: await difundir(id, 'deteccion:actualizada') };
      }

      // Con un veredicto nuevo del motor (llegó el segundo OCR) se reemplaza el anterior
      const anterior = actual.lectura_valida === null || actual.lectura_valida === undefined ? null : Boolean(actual.lectura_valida);
      const validez = typeof lectura_valida === 'boolean' ? lectura_valida : anterior;
      if (typeof lectura_valida === 'boolean') await d.repositorio.guardarVeredicto(id, validez, serializarEvidencia(evidencia_lectura));
      const confianza = typeof confianza_ocr === 'number' ? confianza_ocr : typeof actual.confianza_ocr === 'number' ? actual.confianza_ocr : null;

      const { dto, decision, permiso } = await decidirLectura(id, {
        placa, confianza, rutaPlaca, validez, lecturaVerificador: lectura_verificador ?? actual.lectura_verificador ?? null,
        latenciaMs: actual.latencia_ms ?? null,
      });
      const cambio = decision.estado !== actual.estado_validacion;
      if (dto && cambio) d.avisos.decision(dto, decision, permiso);
      return {
        message: cambio ? `Paso reevaluado: ${actual.estado_validacion} → ${decision.estado}.` : 'Paso reevaluado sin cambios.',
        reevaluado: true, cambio, deteccion: dto,
      };
    },

    /** Auditoría de los falsos positivos que el motor descartó. */
    async descarte(entrada: unknown) {
      const { tracking_id, motivo, texto_candidato, confianza, fuente, camara_id } = cuerpo(entrada);
      await d.repositorio.registrarDescarte({
        trackingId: Number.isInteger(tracking_id) ? tracking_id : -1,
        motivo: String(motivo || 'falso_positivo_ocr').substring(0, 100),
        texto: texto_candidato ? String(texto_candidato).substring(0, 50) : null,
        confianza: typeof confianza === 'number' ? confianza : null,
        fuente: normalizarFuente(fuente),
        camaraId: Number.isInteger(camara_id) ? camara_id : null,
      });
      return { success: true };
    },

    // ─── Consultas del personal ───────────────────────────────────────────────

    async listar(consulta: Entrada) {
      const f = filtros(consulta);
      const p = leerPaginacion(consulta);
      if (!p.ok) throw errorValidacion(p.error);
      const { pagina, tamano } = p.valor;
      const total = await d.repositorio.contar(f);
      const filas = await d.repositorio.pagina(f, (pagina - 1) * tamano, tamano);
      return { items: filas.map(x => d.presentar(x)), total, pagina, tamano };
    },

    /** Historial completo: totales de lo que cumple los filtros, para leer la consulta de un vistazo. */
    resumenHistorial: (consulta: Entrada) => d.repositorio.resumenHistorial(filtros(consulta)),

    async recientes(limite: unknown, busqueda?: unknown) {
      const texto = typeof busqueda === 'string' ? busqueda.trim() : '';
      if (texto.length > 100) throw errorValidacion('La búsqueda no puede superar 100 caracteres.');
      return (await d.repositorio.recientes(leerLimite(limite), texto || null)).map(x => d.presentar(x));
    },

    /** Reporte PDF de Registro de Salidas (solo registros completos con salida); queda en la auditoría. */
    async exportarPdf(consulta: Entrada, actor: Actor) {
      const f = filtros({ ...consulta, cerrados: 'si', completos: 'si' });
      const filas = await d.repositorio.exportar(f);
      if (!d.pdfRegistros) throw new Error('Generador PDF no configurado.');
      const ahora = d.tiempo.ahora();
      const contenido = await d.pdfRegistros(filas, {
        generado: ahora, zona: d.tiempo.zona, desde: f.desde, hasta: f.hasta, buscar: f.buscar ?? null, elaboradoPor: actor.nombre,
      });
      await d.auditoria.operacion(actor, 'EXPORTACION', 'deteccion', null, `PDF · ${filas.length} registros con salida · ${JSON.stringify(consulta).substring(0, 300)}`);
      return { nombre: `registros_${ahora.toISOString().slice(0, 10)}.pdf`, contenido };
    },

    async exportar(consulta: Entrada, actor: Actor) {
      const f = filtros(consulta);
      const filas = await d.repositorio.exportar(f);
      const contenido = csvDetecciones(filas as FilaExportacion[]);
      await d.auditoria.operacion(actor, 'EXPORTACION', 'deteccion', null, `${filas.length} registros · ${JSON.stringify(consulta).substring(0, 300)}`);
      return { nombre: `ingresos_anpr_${d.tiempo.ahora().toISOString().slice(0, 10)}.csv`, contenido };
    },

    /** Situación actual de una placa en las listas y sus últimos pasos. */
    async buscarPlaca(valor: unknown) {
      const p = leerPlacaConsulta(valor);
      if (!p.ok) throw errorValidacion(p.error);
      const placa = p.valor;
      const cruce = await cruzarListas(placa, d.tiempo.ahora());
      const decision = decidirAcceso({ origen: 'manual', ...entradaListas(cruce), politica: d.politica() });
      const historial = await d.repositorio.historialPlaca(placa);
      const horario = cruce.permiso ? validarHorario(cruce.permiso.horario) : null;
      return {
        placa,
        estado: decision.estado === 'no_reconocido' ? (cruce.permiso ? 'restringido' : 'no_registrado') : decision.estado,
        restriccion: decision.restriccion,
        motivo: decision.restriccion ? MOTIVO_RESTRICCION[decision.restriccion] : null,
        alerta: cruce.alerta,
        autorizado: cruce.permiso ? { ...cruce.permiso, horario: horario!.horario,
          ...(horario!.error ? { horario_error: 'El horario guardado no es válido. Seleccione un horario antes de guardar.' } : {}),
          horario_texto: describirHorario(cruce.permiso.horario) } : null,
        ultimos_ingresos: historial.map(x => d.presentar(x)),
      };
    },

    /** Detalle con la lectura automática, la captura, la auditoría y los pasos anteriores de la placa. */
    async detalle(id: number) {
      const fila = await d.repositorio.obtener(id);
      if (!fila) throw errorNoEncontrado('Detección no encontrada.');
      const dto = d.presentar(fila, true);
      const [auditoria, anteriores] = await Promise.all([
        d.repositorio.auditoriaDe(id),
        dto.placa ? d.repositorio.historialPlaca(normalizarPlaca(dto.placa), id) : Promise.resolve([] as Fila[]),
      ]);
      return { ...dto, auditoria, pasos_anteriores: anteriores.map(x => d.presentar(x)) };
    },

    // ─── Acciones del personal ────────────────────────────────────────────────

    /**
     * Corrección o confirmación de la placa por el personal. Con `excepcion`, una persona con
     * accesos:excepcion concede el paso pese a la restricción temporal del permiso (motivo auditado).
     */
    async validar(id: number, entrada: unknown, actor: Actor) {
      const b = cuerpo(entrada);
      const placaEntrada = b.placa_validada;
      const placa = placaEntrada == null || (typeof placaEntrada === 'string' && !placaEntrada.trim())
        ? { ok: true as const, valor: { placa: null } }
        : validarPlaca(placaEntrada);
      if (!placa.ok) throw errorValidacion(placa.error);
      const excepcion = b.excepcion === true;
      if (excepcion && !tienePermiso(actor.rol as Rol, 'accesos:excepcion')) {
        throw errorProhibido('No tiene permiso para autorizar ingresos por excepción.');
      }
      const datos = leerDatosValidacion(b, excepcion);
      if (!datos.ok) throw errorValidacion(datos.error);
      const { tipoVehiculo, observacion } = datos.valor;
      const actual = await d.repositorio.obtener(id);
      if (!actual) throw errorNoEncontrado('Detección no encontrada.');
      const ingreso = leerDatosIngreso(excepcion ? { ...b, motivo_ingreso: observacion } : b, actual.tipo_movimiento !== 'salida');
      if (!ingreso.ok) throw errorValidacion(ingreso.error);
      if (actual.tipo_movimiento === 'salida') {
        if (excepcion) throw errorValidacion('La excepción de acceso solo se aplica a ingresos.');
        await d.repositorio.validarSalida(id, { placa: placa.valor.placa ?? '', usuarioId: actor.id });
        await d.auditoria.operacion(actor, 'SALIDA_VALIDACION', 'deteccion', id, `${actual.placa_reconocida || 'sin lectura'} → ${placa.valor.placa}`);
        return { message: 'Lectura de salida corregida.', deteccion: await difundir(id, 'deteccion:actualizada') };
      }

      const instante = new Date(actual.fecha_hora_ingreso);
      let cruce: Cruce = placa.valor.placa
        ? await cruzarListas(placa.valor.placa, instante)
        : { alerta: null, permiso: null, vigencia: null };
      // Placa confirmada con la ficha completa y sin permiso ni alerta: se agrega a la lista blanca
      // (mismo caso de uso que el formulario) y el paso se decide con ese permiso. Nunca con una
      // placa de la lista negra; un permiso existente (aunque esté fuera de horario) no se duplica.
      let padron: { accion: 'creado' | 'reactivado' } | null = null;
      let avisoPadron: string | null = null;
      const fichaPermiso = b.datos_permiso && typeof b.datos_permiso === 'object' && !Array.isArray(b.datos_permiso) ? b.datos_permiso as Entrada : null;
      if (placa.valor.placa && fichaPermiso && !excepcion && !cruce.alerta && !cruce.permiso && d.padron
          && tienePermiso(actor.rol as Rol, 'padron:gestionar')) {
        try {
          // El motivo de este ingreso queda como motivo habitual del permiso
          padron = await d.padron.registrar({ motivo_ingreso: b.motivo_ingreso, ...fichaPermiso, placa: placa.valor.placa }, actor);
          cruce = await cruzarListas(placa.valor.placa, instante);
        } catch (e) {
          avisoPadron = `La placa se confirmó, pero no se agregó a la lista blanca: ${(e as Error).message}`;
        }
      }
      const decision = decidirAcceso({ origen: 'manual', ...entradaListas(cruce), excepcion, politica: d.politica() });
      const final = cruce.permiso ? normalizarPlaca(cruce.permiso.placa) || placa.valor.placa : placa.valor.placa;
      await d.repositorio.guardarValidacion(id, {
        placa: final, tipo: tipoVehiculo || cruce.permiso?.tipo_vehiculo || null, usuarioId: actor.id,
      }, cruce, decision);
      if (hayDatosIngreso(ingreso.valor)) await d.repositorio.guardarDatosIngreso(id, ingreso.valor);

      const antes = actual.placa_validada || actual.placa_reconocida || 'sin lectura';
      await d.auditoria.operacion(actor, decision.regla === 'R2-excepcion' ? 'EXCEPCION_ACCESO' : 'VALIDACION', 'deteccion', id,
        `${antes} → ${final} (${ETIQUETA_ESTADO[decision.estado]}${decision.restriccion ? ` · ${MOTIVO_RESTRICCION[decision.restriccion]}` : ''})${observacion && !excepcion ? ` · ${observacion}` : ''}`
        + describirDatosIngreso(ingreso.valor) + (padron ? ` · ${padron.accion === 'reactivado' ? 'permiso reactivado' : 'agregado'} en la lista blanca` : ''));
      // La persona atendió el paso: sus alarmas se resuelven
      await d.avisos.resolverPorDeteccion(id);
      const dto = await difundir(id, 'deteccion:actualizada');
      // Si la corrección revela una alerta se avisa; si confirma un permiso, se avisa a quien lo otorgó
      if (decision.estado !== actual.estado_validacion) avisarSiCorresponde(dto, decision, cruce.permiso);
      return {
        message: padron ? `Autorización registrada; la placa se ${padron.accion === 'reactivado' ? 'reactivó' : 'agregó'} en la lista blanca.` : 'Autorización registrada.',
        deteccion: dto, lista_blanca: padron?.accion ?? null, ...(avisoPadron ? { aviso: avisoPadron } : {}),
      };
    },

    /**
     * Paso registrado a mano (cámara fuera de servicio, placa ilegible…). Se cruza con las listas
     * igual que una lectura automática y NO modifica la lista blanca.
     */
    /**
     * Miniaturas de los últimos 30 s de la cámara (dos por segundo) para que el guardia elija la foto
     * de evidencia de un registro manual: el vehículo que el motor no registró ya pasó cuando se
     * registra a mano. Solo la cámara que procesa el motor tiene historial.
     */
    async cuadrosRegistroManual(camaraIdEntrada: unknown) {
      const id = validarEntero(camaraIdEntrada, { etiqueta: 'Cámara', min: 1, max: 2_147_483_647, requerido: true });
      if (!id.ok) throw errorValidacion(id.error);
      if (id.valor === null) throw errorValidacion('Indique la cámara.');
      if (!d.evidenciaManual) return { disponible: false, motivo: 'Sin historial de video.', cuadros: [] };
      return d.evidenciaManual.cuadros(id.valor);
    },

    async registroManual(entrada: unknown, actor: Actor) {
      const r = leerRegistroManual(cuerpo(entrada));
      if (!r.ok) throw errorValidacion(r.error);
      const { placa, motivo, camaraId, tipoVehiculo, marca, cuadroT } = r.valor;
      const ingreso = leerDatosIngreso(cuerpo(entrada));
      if (!ingreso.ok) throw errorValidacion(ingreso.error);
      const direccion = camaraId === null ? 'ingreso' : await d.repositorio.direccionCamara(camaraId);
      if (direccion === null) throw errorValidacion('La cámara seleccionada no existe o no tiene una dirección válida.');
      // Foto elegida de los últimos 30 s de la cámara: se guarda antes de crear el registro
      let rutaImagen: string | null = null;
      if (cuadroT !== null && camaraId !== null) {
        rutaImagen = d.evidenciaManual ? await d.evidenciaManual.guardar(camaraId, cuadroT) : null;
        if (!rutaImagen) throw errorValidacion('La foto elegida ya no está en los últimos 30 s de la cámara. Elija otra o registre sin foto.');
      }
      const conFoto = rutaImagen ? { rutaImagen } : {};
      const notaFoto = rutaImagen ? ' · con foto de evidencia' : '';
      if (direccion === 'salida') {
        if (camaraId === null) throw errorValidacion('La salida manual requiere una cámara configurada como salida.');
        const id = await d.repositorio.crearSalidaManual({ placa, camaraId, usuarioId: actor.id, ...conFoto });
        await d.auditoria.operacion(actor, 'REGISTRO_SALIDA_MANUAL', 'deteccion', id, `${placa} · ${motivo}${notaFoto}`);
        return { message: 'Salida registrada manualmente.', deteccion: await difundir(id, 'deteccion:nueva') };
      }
      const cruce = await cruzarListas(placa, d.tiempo.ahora());
      const decision = decidirAcceso({ origen: 'manual', ...entradaListas(cruce), politica: d.politica() });
      const id = await d.repositorio.crearManual({
        placa, camaraId, tipo: tipoVehiculo || cruce.permiso?.tipo_vehiculo || null,
        marca, usuarioId: actor.id, ...conFoto,
      }, cruce, decision);
      if (hayDatosIngreso(ingreso.valor)) await d.repositorio.guardarDatosIngreso(id, ingreso.valor);
      await d.auditoria.operacion(actor, 'REGISTRO_MANUAL', 'deteccion', id,
        `${placa} (${ETIQUETA_ESTADO[decision.estado]}) · ${motivo}${describirDatosIngreso(ingreso.valor)}${notaFoto}`);
      const dto = await difundir(id, 'deteccion:nueva');
      avisarSiCorresponde(dto, decision, cruce.permiso);
      return { message: 'Ingreso registrado manualmente.', deteccion: dto };
    },

    /**
     * Nombres y apellidos de quien ingresa y motivo de ingreso (hoja de control vehicular de la
     * garita), después de registrado el paso. Solo en ingresos; el cambio queda en la auditoría.
     */
    async editarIngreso(id: number, entrada: unknown, actor: Actor) {
      const datos = leerDatosIngreso(cuerpo(entrada));
      if (!datos.ok) throw errorValidacion(datos.error);
      if (!hayDatosIngreso(datos.valor)) throw errorValidacion('Indique el titular o algún dato del vehículo.');
      const actual = await d.repositorio.obtener(id);
      if (!actual) throw errorNoEncontrado('Detección no encontrada.');
      if (actual.tipo_movimiento === 'salida') throw errorValidacion('Los nombres y el motivo se registran en el ingreso, no en la salida.');
      await d.repositorio.guardarDatosIngreso(id, datos.valor);
      const actualizado = await d.repositorio.obtener(id);
      const sinPlaca = actualizado
        && !actualizado.placa
        && !actualizado.placa_reconocida
        && !actualizado.placa_validada;
      const datosVehiculoCompletos = actualizado?.persona_ingreso
        && actualizado.vehiculo_tipo
        && actualizado.vehiculo_marca
        && actualizado.vehiculo_modelo;
      if (sinPlaca && datosVehiculoCompletos && d.repositorio.autorizarIngresoSinPlaca) {
        await d.repositorio.autorizarIngresoSinPlaca(id, actor.id);
      }
      await d.auditoria.operacion(actor, 'INGRESO_DATOS', 'deteccion', id,
        `${actual.placa_validada || actual.placa_reconocida || 'sin placa'}${describirDatosIngreso(datos.valor)}`);
      return { message: 'Datos del ingreso guardados.', deteccion: await difundir(id, 'deteccion:actualizada') };
    },

    /** Marca la hora de salida únicamente cuando la ficha de ingreso está completa. */
    async registrarSalida(id: number, actor: Actor) {
      const actual = await d.repositorio.obtener(id);
      if (!actual) throw errorNoEncontrado('Detección no encontrada.');
      if (actual.tipo_movimiento === 'salida') throw errorValidacion('El registro seleccionado ya es un movimiento de salida.');
      if (actual.fecha_hora_salida) throw errorValidacion('La hora de salida ya fue registrada.');
      const faltantes = faltantesIngreso(actual);
      if (faltantes.length) throw errorValidacion(`Complete los datos antes de registrar la salida. Falta: ${faltantes.join(', ')}.`);
      if (new Date(actual.fecha_hora_ingreso).getTime() > d.tiempo.ahora().getTime()) throw errorValidacion('La fecha de ingreso no puede ser posterior a la salida.');
      if (!await d.repositorio.registrarSalida(id)) throw errorValidacion('No se pudo registrar la salida. El ingreso cambió, tiene datos incompletos o ya tiene salida. Actualice el registro.');
      await d.auditoria.operacion(actor, 'REGISTRO_SALIDA', 'deteccion', id,
        `${actual.placa_validada || actual.placa_reconocida || 'sin lectura'} · ${d.tiempo.ahora().toISOString()}`);
      return { message: 'Hora de salida registrada.', deteccion: await difundir(id, 'deteccion:actualizada') };
    },

    /** Elimina una detección y su evidencia fotográfica, con motivo auditado. */
    async eliminar(id: number, motivo: unknown, actor: Actor) {
      const m = validarTexto(motivo, REGLA_MOTIVO_ELIMINACION);
      if (!m.ok) throw errorValidacion(m.error);
      const fila = await d.repositorio.obtener(id);
      if (!fila) throw errorNoEncontrado('Detección no encontrada.');
      await d.repositorio.eliminar(id);
      const archivos = await d.evidencia.eliminar([fila.ruta_imagen_ingreso, fila.ruta_imagen_placa]);
      await d.auditoria.operacion(actor, 'DETECCION_ELIMINADA', 'deteccion', id,
        `${fila.placa_validada || fila.placa_reconocida || 'sin lectura'} del ${fechaHoraLocal(fila.fecha_hora_ingreso)} · ${archivos} imágenes · ${m.valor}`);
      d.eventos.emitir('deteccion:eliminada', { id });
      await d.avisos.resolverPorDeteccion(id);
      return { message: 'Detección eliminada.', id };
    },

    /**
     * Eliminación masiva: todas las detecciones o las que cumplen los filtros del historial. Exige
     * escribir ELIMINAR y un motivo; borra la evidencia y queda en la auditoría con la cantidad y
     * los filtros usados.
     */
    async eliminarMasivo(consulta: Entrada, entrada: unknown, actor: Actor) {
      const b = cuerpo(entrada);
      if (b.confirmacion !== 'ELIMINAR') throw errorValidacion('Escriba ELIMINAR para confirmar.');
      const m = validarTexto(b.motivo, REGLA_MOTIVO_ELIMINACION_MASIVA);
      if (!m.ok) throw errorValidacion(m.error);
      const f = filtros(consulta);
      // Sin filtros se eliminan todas, en cualquier estado de procesamiento
      const conFiltros = tieneFiltros(consulta);
      const filas = await d.repositorio.eliminarFiltradas(conFiltros ? f : null);
      const archivos = await d.evidencia.eliminar(filas.flatMap(x => [x.ruta_imagen_ingreso, x.ruta_imagen_placa]));
      const alcance = conFiltros ? `filtros ${JSON.stringify(consulta).substring(0, 200)}` : 'todas las detecciones';
      await d.auditoria.operacion(actor, 'DETECCIONES_ELIMINADAS', 'deteccion', null, `${filas.length} registros y ${archivos} imágenes · ${alcance} · ${m.valor}`);
      d.eventos.emitir('deteccion:eliminadas', { total: filas.length });
      return { message: `${filas.length} ${filas.length === 1 ? 'registro eliminado' : 'registros eliminados'}.`, total: filas.length };
    },
  };
}

export type CasosDetecciones = ReturnType<typeof casosDetecciones>;
