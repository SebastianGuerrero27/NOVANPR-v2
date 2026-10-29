import type { Deteccion } from './tipos';

/**
 * Estado del acceso de un movimiento, para el color de sus celdas. Solo dos casos van en rojo;
 * todo lo que entra al registro queda en blanco:
 *   alerta       la placa está en la lista negra (rojo, con la marca ALERTA)
 *   sin_lectura  el motor no leyó la placa (ilegible o vehículo sin placa visible) y nadie la ha
 *                confirmado todavía (rojo)
 *   registrado   cualquier otro paso: autorizado, por validar, no registrado o con salida (blanco)
 * Un paso que el motor aún está leyendo (pendiente de OCR) no se pinta: la lectura llega en
 * menos de un segundo.
 */
export type EstadoAcceso = 'alerta' | 'sin_lectura' | 'registrado';

type Movimiento = Pick<Deteccion, 'estado_validacion' | 'validado_manualmente'>
  & Partial<Pick<Deteccion, 'placa' | 'estado_procesamiento'>>;

export function estadoAcceso(d: Movimiento): EstadoAcceso {
  if (d.estado_validacion === 'alerta') return 'alerta';
  // La placa confirmada por el guardia o el ingreso autorizado (p. ej. un vehículo sin placa
  // identificado por su titular) ya entraron al registro
  const resuelto = d.validado_manualmente || d.estado_validacion === 'autorizado';
  if (!d.placa && !resuelto && d.estado_procesamiento !== 'pendiente_ocr') return 'sin_lectura';
  return 'registrado';
}

export const ESTADOS_ACCESO: Record<EstadoAcceso, { clase: string; etiqueta: string }> = {
  alerta: { clase: 'fila-alerta', etiqueta: 'Alerta · lista negra' },
  sin_lectura: { clase: 'fila-sin-lectura', etiqueta: 'Sin lectura de placa' },
  registrado: { clase: '', etiqueta: 'Registrado' },
};

/** Mismos datos obligatorios que la hoja de registros; la salida todavía no es un faltante. */
export function faltantesSalida(d: Partial<Deteccion>): string[] {
  if (d.datos_faltantes_registro) return d.datos_faltantes_registro.filter(c => c !== 'Salida');
  const presentes = (...v: unknown[]) => v.some(x => typeof x === 'string' && !['', '-', '—', 'desconocido', 'sin clasificar', 'sin identificar', 'unknown', 'n/a', 'sin placa'].includes(x.trim().toLowerCase()));
  const faltantes: string[] = [];
  if (!presentes(d.persona_ingreso, d.autorizado?.propietario)) faltantes.push('Nombre');
  if (!presentes(d.placa_validada, d.placa_reconocida, d.placa)) faltantes.push('Placa');
  if (!presentes(d.tipo_vehiculo, d.vehiculo?.tipo)) faltantes.push('Tipo de vehículo');
  if (!presentes(d.vehiculo?.marca)) faltantes.push('Marca');
  if (!presentes(d.motivo_ingreso)) faltantes.push('Motivo');
  if (!d.fecha_hora_ingreso || !Number.isFinite(new Date(d.fecha_hora_ingreso).getTime())) faltantes.push('Fecha de ingreso');
  return faltantes;
}
export const puedeRegistrarSalida = (d: Partial<Deteccion>) =>
  d.tipo_movimiento !== 'salida' && !d.fecha_hora_salida && faltantesSalida(d).length === 0;
