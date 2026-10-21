import { normalizarPlaca, RE_PLACA_AUTO, RE_PLACA_MOTO, type Validado } from './validacion';

/**
 * Reporte de control vehicular de la garita: la hoja que el guardia llenaba a mano («ECU 911 -
 * AMBATO · Reporte de control vehicular · Parqueadero - Garita»), con fecha, nombres y apellidos,
 * tipo de vehículo, marca, placa, hora de ingreso, hora de salida y observaciones (el motivo del
 * ingreso), y la línea del turno con el agente entrante y su firma.
 *
 * Lógica pura: turnos, emparejamiento de cada ingreso con su salida y textos. La consulta a la base
 * y el archivo (PDF o Excel) quedan fuera (aplicacion/controlVehicular.ts).
 */

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

// ─── Turno y formato ─────────────────────────────────────────────────────────

export type Turno = 'completo' | 'diurno' | 'nocturno';

/** Horarios de los turnos de la garita; el nocturno empieza un día y termina al siguiente. */
export const TURNOS: Record<Turno, { etiqueta: string; horario: string }> = {
  completo: { etiqueta: 'Día completo', horario: '00:00 – 24:00' },
  diurno: { etiqueta: 'Diurno', horario: '07:00 – 19:00' },
  nocturno: { etiqueta: 'Nocturno', horario: '19:00 – 07:00' },
};
const INICIO_DIURNO = 7;
const INICIO_NOCTURNO = 19;

export function leerTurno(valor: unknown): Validado<Turno> {
  if (valor === undefined || valor === null || valor === '') return { ok: true, valor: 'completo' };
  return typeof valor === 'string' && valor in TURNOS
    ? { ok: true, valor: valor as Turno }
    : { ok: false, error: 'Turno: use completo, diurno o nocturno.' };
}

export type FormatoReporte = 'pdf' | 'xlsx';
export const TIPO_ARCHIVO: Record<FormatoReporte, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function leerFormato(valor: unknown): Validado<FormatoReporte> {
  if (valor === undefined || valor === null || valor === '') return { ok: true, valor: 'pdf' };
  return valor === 'pdf' || valor === 'xlsx' ? { ok: true, valor } : { ok: false, error: 'Formato: use pdf o xlsx.' };
}

/** Fecha local (AAAA-MM-DD) de un instante, con el desfase de la zona en minutos (-300 en Ecuador). */
export const diaLocal = (instante: Date, desfase: number) => new Date(instante.getTime() + desfase * 60_000).toISOString().slice(0, 10);

/**
 * Día (AAAA-MM-DD local) en que empezó el turno que contiene `instante`, o null si queda fuera del
 * turno. Un ingreso a las 02:00 pertenece al turno nocturno que empezó el día anterior.
 */
export function diaDelTurno(instante: Date, turno: Turno, desfase: number): string | null {
  const local = new Date(instante.getTime() + desfase * 60_000);
  const hora = local.getUTCHours();
  if (turno === 'completo') return local.toISOString().slice(0, 10);
  if (turno === 'diurno') return hora >= INICIO_DIURNO && hora < INICIO_NOCTURNO ? local.toISOString().slice(0, 10) : null;
  if (hora >= INICIO_NOCTURNO) return local.toISOString().slice(0, 10);
  if (hora < INICIO_DIURNO) return new Date(local.getTime() - DIA_MS).toISOString().slice(0, 10);
  return null;
}

/** Horas que el turno nocturno del último día se extiende sobre el día siguiente. */
export const extensionTurno = (turno: Turno) => (turno === 'nocturno' ? INICIO_DIURNO * HORA_MS : 0);

// ─── Movimientos y filas ─────────────────────────────────────────────────────

/** Ingreso o salida tal como lo entrega la base (DeteccionVehiculo con el padrón y la alerta). */
export interface MovimientoControl {
  id: number;
  tipo_movimiento: 'ingreso' | 'salida';
  fecha_hora_ingreso: Date | string;
  placa: string | null;
  persona_ingreso: string | null;
  motivo_ingreso: string | null;
  /** Tipo confirmado por el personal */
  tipo_vehiculo: string | null;
  /** Tipo y marca observados por la cámara */
  vehiculo_tipo: string | null;
  vehiculo_marca: string | null;
  /** Datos del padrón (lista blanca) */
  propietario: string | null;
  autorizado_tipo: string | null;
  autorizado_marca: string | null;
  estado_validacion: string;
  alerta_motivo: string | null;
  /** Evidencia del motor: en un paso sin placa trae el tipo de vehículo que vio */
  evidencia_lectura: string | null;
}

export interface FilaControl {
  fecha: string;
  nombres: string;
  tipo: string;
  marca: string;
  placa: string;
  ingreso: string;
  salida: string;
  observaciones: string;
}

/** Columnas de la hoja, en su orden. */
export const COLUMNAS_CONTROL: { clave: keyof FilaControl; titulo: string }[] = [
  { clave: 'fecha', titulo: 'FECHA' },
  { clave: 'nombres', titulo: 'NOMBRES Y APELLIDOS' },
  { clave: 'tipo', titulo: 'TIPO DE VEHÍCULO' },
  { clave: 'marca', titulo: 'MARCA' },
  { clave: 'placa', titulo: 'PLACA DE IDENTIFICACIÓN' },
  { clave: 'ingreso', titulo: 'HORA DE INGRESO' },
  { clave: 'salida', titulo: 'HORA DE SALIDA' },
  { clave: 'observaciones', titulo: 'OBSERVACIONES' },
];

/** Una salida se empareja con un ingreso de la misma placa a lo sumo este tiempo después. */
const MAX_PERMANENCIA_MS = DIA_MS;

const dos = (n: number) => String(n).padStart(2, '0');
const local = (f: Date | string, desfase: number) => new Date(new Date(f).getTime() + desfase * 60_000);
const horaLocal = (f: Date | string, desfase: number) => { const l = local(f, desfase); return `${dos(l.getUTCHours())}:${dos(l.getUTCMinutes())}`; };
const fechaCorta = (f: Date | string, desfase: number) => { const l = local(f, desfase); return `${dos(l.getUTCDate())}-${dos(l.getUTCMonth() + 1)}-${l.getUTCFullYear()}`; };
const capital = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/** Placa como se escribe en la hoja (ABC-1234, AB-123C); sin placa, «S/P». */
export function placaHoja(placa: string | null): string {
  const p = normalizarPlaca(placa);
  if (!p) return 'S/P';
  if (RE_PLACA_AUTO.test(p)) return `${p.slice(0, 3)}-${p.slice(3)}`;
  if (RE_PLACA_MOTO.test(p)) return `${p.slice(0, 2)}-${p.slice(2)}`;
  return p;
}

function tipoSinPlaca(evidencia: string | null): string | null {
  if (!evidencia) return null;
  try {
    const e = JSON.parse(evidencia);
    return typeof e?.tipo_vehiculo === 'string' && typeof e?.motivo === 'string' ? e.tipo_vehiculo : null;
  } catch {
    return null;
  }
}

/**
 * Filas de la hoja: los ingresos de los turnos del período (días `primerDia` a `ultimoDia`), en
 * orden, cada uno con la primera salida de su misma placa antes del siguiente ingreso de esa placa
 * (y dentro de las 24 h). Sin el nombre de quien ingresó se usa el titular del padrón; el tipo y la
 * marca, los confirmados o del padrón antes que los observados por la cámara.
 */
export function filasControlVehicular(
  movimientos: MovimientoControl[],
  o: { turno: Turno; desfase: number; primerDia: string; ultimoDia: string },
): FilaControl[] {
  const ordenados = [...movimientos].sort((a, b) => new Date(a.fecha_hora_ingreso).getTime() - new Date(b.fecha_hora_ingreso).getTime());
  const usadas = new Set<number>();
  const filas: FilaControl[] = [];
  ordenados.forEach((m, i) => {
    if (m.tipo_movimiento !== 'ingreso') return;
    const dia = diaDelTurno(new Date(m.fecha_hora_ingreso), o.turno, o.desfase);
    if (!dia || dia < o.primerDia || dia > o.ultimoDia) return;

    const placa = normalizarPlaca(m.placa);
    const inicio = new Date(m.fecha_hora_ingreso).getTime();
    let salida: MovimientoControl | undefined;
    if (placa) {
      for (const s of ordenados.slice(i + 1)) {
        const t = new Date(s.fecha_hora_ingreso).getTime();
        if (t - inicio > MAX_PERMANENCIA_MS) break;
        if (normalizarPlaca(s.placa) !== placa) continue;
        if (s.tipo_movimiento === 'ingreso') break;          // volvió a entrar sin salida registrada
        if (!usadas.has(s.id)) { salida = s; usadas.add(s.id); break; }
      }
    }

    const sinPlaca = tipoSinPlaca(m.evidencia_lectura);
    const observaciones = [
      m.motivo_ingreso,
      m.estado_validacion === 'alerta' ? `Lista negra${m.alerta_motivo ? `: ${m.alerta_motivo}` : ''}` : null,
      !m.motivo_ingreso && !placa && sinPlaca ? 'Sin placa visible' : null,
    ].filter(Boolean).join(' · ');
    filas.push({
      fecha: fechaCorta(m.fecha_hora_ingreso, o.desfase),
      nombres: m.persona_ingreso || m.propietario || '',
      tipo: capital(m.tipo_vehiculo || m.autorizado_tipo || m.vehiculo_tipo || sinPlaca),
      marca: capital(m.autorizado_marca || m.vehiculo_marca),
      placa: placaHoja(m.placa),
      ingreso: horaLocal(m.fecha_hora_ingreso, o.desfase),
      salida: salida ? horaLocal(salida.fecha_hora_ingreso, o.desfase) : '',
      observaciones,
    });
  });
  return filas;
}

// ─── Encabezado ──────────────────────────────────────────────────────────────

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** «lunes 19 de octubre de 2026» a partir de AAAA-MM-DD. */
export function fechaLarga(dia: string): string {
  const f = new Date(`${dia}T12:00:00Z`);
  return `${DIAS[f.getUTCDay()]} ${f.getUTCDate()} de ${MESES[f.getUTCMonth()]} de ${f.getUTCFullYear()}`;
}

/** «Ambato, lunes 19 de octubre de 2026» o, en un período, «Ambato, del lunes 19 al martes 20 de octubre de 2026». */
export function lineaFecha(ciudad: string, primerDia: string, ultimoDia: string): string {
  if (primerDia === ultimoDia) return `${ciudad}, ${fechaLarga(primerDia)}`;
  return `${ciudad}, del ${fechaLarga(primerDia)} al ${fechaLarga(ultimoDia)}`;
}

/** Todo lo que se imprime en la hoja: encabezado, línea del turno y filas. */
export interface HojaControl {
  sede: string;
  titulo: string;
  lugar: string;
  lineaFecha: string;
  agente: string;
  turno: string;
  horario: string;
  /** Cámara del reporte; null = todas */
  camara: string | null;
  /** Fecha y hora de generación (local) */
  generado: string;
  filas: FilaControl[];
}

export const TITULO_CONTROL = 'REPORTE DE CONTROL VEHICULAR';

/** Fecha y hora local «19-10-2026 08:46». */
export const fechaHoraHoja = (f: Date, desfase: number) => `${fechaCorta(f, desfase)} ${horaLocal(f, desfase)}`;
