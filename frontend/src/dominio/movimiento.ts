import type { Deteccion } from './tipos';

/**
 * Hora de entrada y de salida de una fila de registros. Cada paso guarda su momento en
 * `fecha_hora_ingreso` (el nombre viene de cuando todo registro era un ingreso): el paso de una
 * cámara de salida es una hora de salida, sin entrada. Un ingreso lleva además la hora en que salió,
 * si ya salió.
 */
export function horasDelMovimiento(d: Pick<Deteccion, 'tipo_movimiento' | 'fecha_hora_ingreso' | 'fecha_hora_salida'>): {
  entrada: string | null;
  salida: string | null;
} {
  return d.tipo_movimiento === 'salida'
    ? { entrada: null, salida: d.fecha_hora_ingreso }
    : { entrada: d.fecha_hora_ingreso, salida: d.fecha_hora_salida ?? null };
}
