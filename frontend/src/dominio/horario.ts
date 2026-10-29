import type { Franja } from './tipos';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const ERROR_HORARIO_GUARDADO = 'El horario guardado no es válido. Revise las franjas o seleccione un horario antes de guardar.';

/** Interpreta el JSON histórico sin confundir un dato dañado con un permiso sin restricción. */
export function leerHorarioFormulario(entrada: unknown): { horario: Franja[] | null; error: string | null } {
  let valor = entrada;
  if (typeof valor === 'string' && valor.trim()) {
    try { valor = JSON.parse(valor); } catch { return { horario: null, error: ERROR_HORARIO_GUARDADO }; }
  }
  if (valor === null || valor === undefined || valor === '') return { horario: null, error: null };
  if (!Array.isArray(valor)) return { horario: null, error: ERROR_HORARIO_GUARDADO };
  let invalido = valor.length > 7;
  const horario = valor.map((fila: unknown): Franja => {
    const f = fila && typeof fila === 'object' && !Array.isArray(fila) ? fila as Record<string, unknown> : {};
    const originales = Array.isArray(f.dias) ? f.dias.map(Number) : [];
    if (!originales.length || originales.some(d => !Number.isInteger(d) || d < 1 || d > 7)) invalido = true;
    const dias = [...new Set(originales.filter(d => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b);
    const desde = typeof f.desde === 'string' ? f.desde : '';
    const hasta = typeof f.hasta === 'string' ? f.hasta : '';
    if (!HHMM.test(desde) || !HHMM.test(hasta) || desde === hasta) invalido = true;
    return { dias, desde, hasta };
  });
  return { horario: horario.length ? horario : null, error: invalido ? ERROR_HORARIO_GUARDADO : null };
}

export const horarioValido = (entrada: unknown): boolean => !leerHorarioFormulario(entrada).error;
