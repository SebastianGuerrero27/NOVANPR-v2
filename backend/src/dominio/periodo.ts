import { type Validado, validarEntero, validarFecha } from './validacion';

/**
 * Períodos de consulta del reporte consolidado (dominio puro).
 *
 * Las fechas llegan como texto en la consulta (?desde=…&hasta=…) y se validan antes de tocar la
 * base: una fecha inválida se rechaza en lugar de reemplazarse en silencio por el período por
 * omisión. Ojo: `new Date('2026-02-30')` no falla, devuelve el 2 de marzo; por eso el día se
 * comprueba siempre con validarFecha().
 *
 * validarFechaHora complementa a validarFecha (dominio/validacion.ts, solo AAAA-MM-DD); puede
 * integrarse allí si otro módulo necesita fechas con hora.
 */

/** Máximo de un INT de SQL Server: tope de los identificadores (cámara, detección…). */
export const ID_MAXIMO = 2_147_483_647;

const DIA_MS = 86_400_000;

// AAAA-MM-DD [T|espacio HH:MM [:SS [.fracción]] [Z | ±HH[:]MM]]
const RE_FECHA_HORA = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):?(\d{2}))?)?$/;

/**
 * Fecha AAAA-MM-DD o fecha y hora ISO 8601 (la que envía el frontend con toISOString()).
 * Se interpreta igual que `new Date(texto)`: la fecha sola es la medianoche UTC; con hora y sin
 * zona, la hora local del servidor.
 */
export function validarFechaHora(valor: unknown, r: { etiqueta: string; requerido?: boolean }): Validado<Date | null> {
  // Un arreglo (?desde=a&desde=b) no se convierte a texto: String(['2026-10-01']) === '2026-10-01'
  if (valor !== undefined && valor !== null && typeof valor !== 'string') return { ok: false, error: `${r.etiqueta}: formato AAAA-MM-DD o AAAA-MM-DDTHH:MM:SS.` };
  const texto = String(valor ?? '').trim();
  if (!texto) return r.requerido ? { ok: false, error: `El campo «${r.etiqueta}» es obligatorio.` } : { ok: true, valor: null };
  const m = RE_FECHA_HORA.exec(texto);
  if (!m) return { ok: false, error: `${r.etiqueta}: formato AAAA-MM-DD o AAAA-MM-DDTHH:MM:SS.` };
  const dia = validarFecha(m[1], r);
  if (!dia.ok) return dia;
  const [hora, minuto, segundo, zonaHoras, zonaMinutos] = [m[2], m[3], m[4], m[5], m[6]].map(v => Number(v ?? 0));
  if (hora > 23 || minuto > 59 || segundo > 59 || zonaHoras > 14 || zonaMinutos > 59) {
    return { ok: false, error: `${r.etiqueta}: hora inválida.` };
  }
  const fecha = new Date(texto.replace(' ', 'T'));
  return Number.isNaN(fecha.getTime()) ? { ok: false, error: `${r.etiqueta} no existe.` } : { ok: true, valor: fecha };
}

// ─── Reporte consolidado ─────────────────────────────────────────────────────

export const DIAS_MAXIMOS_REPORTE = 366;

export interface PeriodoReporte {
  desde: Date;
  hasta: Date;
  /** null = todas las cámaras */
  camara: number | null;
}

/**
 * Período del reporte: sin fechas, los últimos 7 días locales hasta ahora (`omision`, que
 * calcula quien llama con el calendario de la institución). La fecha final debe ser posterior
 * a la inicial y el período no puede superar un año.
 */
export function leerPeriodoReporte(
  consulta: { desde?: unknown; hasta?: unknown; camara?: unknown },
  omision: { desde: Date; hasta: Date },
): Validado<PeriodoReporte> {
  const desde = validarFechaHora(consulta.desde, { etiqueta: 'Fecha inicial' });
  if (!desde.ok) return desde;
  const hasta = validarFechaHora(consulta.hasta, { etiqueta: 'Fecha final' });
  if (!hasta.ok) return hasta;
  const inicio = desde.valor ?? omision.desde;
  const fin = hasta.valor ?? omision.hasta;
  if (fin <= inicio) return { ok: false, error: 'La fecha final debe ser posterior a la inicial.' };
  if (fin.getTime() - inicio.getTime() > DIAS_MAXIMOS_REPORTE * DIA_MS) return { ok: false, error: 'El período máximo es de un año.' };
  const camara = validarEntero(consulta.camara, { etiqueta: 'Cámara', min: 1, max: ID_MAXIMO });
  if (!camara.ok) return camara;
  return { ok: true, valor: { desde: inicio, hasta: fin, camara: camara.valor } };
}
