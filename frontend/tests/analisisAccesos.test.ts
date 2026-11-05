import { expect, it } from 'vitest';
import { agrupar, duracion, franjaHabitual, hallazgos, lunesDe, promedioSemanal, unidadPara } from '../src/dominio/analisisAccesos';
import type { AnalisisHistorial, ResumenHistorial } from '../src/dominio/tipos';

const dia = (d: string, ingresos: number, c: Partial<AnalisisHistorial['por_dia'][number]> = {}) =>
  ({ dia: d, ingresos, autorizados: ingresos, no_registrados: 0, alertas: 0, pendientes: 0, ...c });

it('agrupa por semana de lunes a domingo, con ceros en las semanas sin ingresos', () => {
  expect(lunesDe('2026-11-03')).toBe('2026-11-02');
  expect(lunesDe('2026-11-08')).toBe('2026-11-02');
  const barras = agrupar([dia('2026-10-14', 2), dia('2026-10-16', 1, { autorizados: 0, alertas: 1 }), dia('2026-11-03', 1)], 'semana', '2026-10-12', '2026-11-03');
  expect(barras.map(b => [b.clave, b.ingresos])).toEqual([['2026-10-12', 3], ['2026-10-19', 0], ['2026-10-26', 0], ['2026-11-02', 1]]);
  expect(barras[0]).toMatchObject({ autorizados: 2, alertas: 1, titulo: expect.stringMatching(/^Semana del 12 oct al 18 oct 2026$/) });
  expect(agrupar([dia('2026-10-14', 2)], 'mes', '2026-09-20', '2026-10-31').map(b => [b.clave, b.ingresos])).toEqual([['2026-09', 0], ['2026-10', 2]]);
  expect(agrupar([], 'dia', '2026-11-03', '2026-11-01')).toEqual([]);
});

it('la unidad del gráfico depende del largo del período', () => {
  expect(unidadPara('2026-11-01', '2026-11-30')).toBe('dia');
  expect(unidadPara('2026-08-01', '2026-11-30')).toBe('semana');
  expect(unidadPara('2026-01-01', '2026-11-30')).toBe('mes');
});

it('duraciones y franja habitual', () => {
  expect(duracion(45)).toBe('45 min');
  expect(duracion(135)).toBe('2 h 15 min');
  expect(duracion(120)).toBe('2 h');
  expect(duracion(1500)).toBe('1 d 1 h');
  const h = Array(24).fill(0);
  h[23] = 2; h[0] = 3; h[8] = 4;
  expect(franjaHabitual(h)).toEqual([23, 5]);   // 23:00 a 01:00 cruza la medianoche
  expect(promedioSemanal(14, '2026-10-01', '2026-10-14')).toBe(7);
});

const resumen = (c: Partial<ResumenHistorial> = {}): ResumenHistorial => ({
  total: 10, ingresos: 10, salidas: 0, con_salida: 8, autorizados: 8, alertas: 1, no_registrados: 1, pendientes: 0, sin_lectura: 0,
  placas: 1, camara: 10, manuales: 0, primero: '2026-10-05T12:00:00Z', ultimo: '2026-11-01T12:00:00Z', ...c,
});
const analisis = (c: Partial<AnalisisHistorial> = {}): AnalisisHistorial => {
  const horas = Array(24).fill(0);
  horas[7] = 6; horas[8] = 3; horas[23] = 1;
  return {
    por_dia: [dia('2026-10-06', 4), dia('2026-10-13', 3), dia('2026-10-20', 2), dia('2026-11-01', 1)],
    por_dia_semana: [0, 6, 0, 3, 0, 0, 1], por_hora: horas, dia_hora: [],
    permanencia: { n: 8, media_min: 135, mediana_min: 110, p90_min: 240 },
    frecuentes: [{ placa: 'PZX1010', ingresos: 7, ultimo: '2026-11-01T12:00:00Z', persona: null }, { placa: 'PZX2020', ingresos: 3, ultimo: '2026-10-20T12:00:00Z', persona: null }],
    personas: [{ nombre: 'Rosa Vera', ingresos: 9, placas: 1, ultimo: '2026-11-01T12:00:00Z' }],
    ...c,
  };
};

it('hallazgos de un vehículo: día y franja habituales, frecuencia, permanencia, avisos y último ingreso', () => {
  const barras = agrupar(analisis().por_dia, 'semana', '2026-10-05', '2026-11-03');
  const textos = hallazgos(analisis(), resumen(), 'vehiculo', { desde: '2026-10-05', hasta: '2026-11-03', barras, unidad: 'semana' }, '2026-11-03').map(h => h.texto);
  expect(textos).toEqual([
    'Ingresa con más frecuencia los martes: 6 de 10 ingresos (60 %).',
    'Suele ingresar entre las 07:00 y las 09:00: 9 de 10 ingresos (90 %).',
    'Siempre lo ingresó Rosa Vera.',
    'La semana con más ingresos fue la del 5 oct al 11 oct 2026: 4 ingresos.',
    'Ingresó 4 días distintos; en promedio 2,3 veces por semana.',
    'Permanece en promedio 2 h 15 min (mediana 1 h 50 min); el 90 % sale antes de 4 h.',
    '1 ingreso en lista negra (alerta).',
    '1 ingreso no autorizado.',
    '2 ingresos sin salida registrada.',
    '1 ingreso de noche (22:00 a 06:00), fuera de su horario habitual.',
    'Último ingreso: 01 nov 2026 (hace 2 días).',
  ]);
});

it('hallazgos de una persona y de un período', () => {
  const p = { desde: '2026-10-05', hasta: '2026-11-03', barras: [], unidad: 'semana' as const };
  const persona = hallazgos(analisis(), resumen(), 'persona', p, '2026-11-03').map(h => h.texto);
  expect(persona).toContain('Usó 2 vehículos: PZX-1010 (7 veces) y PZX-2020 (3 veces).');
  const periodo = hallazgos(analisis({ por_dia_semana: [0, 4, 0, 4, 0, 0, 2] }), resumen({ placas: 2, con_salida: 10 }), 'periodo', p).map(h => h.texto);
  expect(periodo[0]).toBe('Los días con más ingresos son los martes y jueves: 4 ingresos cada uno.');
  expect(periodo[1]).toBe('Hora pico: de 07:00 a 09:00 llegan 9 de 10 ingresos (90 %).');
  expect(periodo).toContain('El 80 % de los ingresos fue autorizado (8 de 10).');
  expect(periodo).toContain('Ingresaron 2 vehículos distintos; el más frecuente, PZX-1010, ingresó 7 veces.');
  expect(periodo.some(t => t.startsWith('Último ingreso'))).toBe(false);
  // Sin ingresos no hay nada que contar; con pocos no se afirma una costumbre
  expect(hallazgos(analisis({ por_dia_semana: [0, 0, 0, 0, 0, 0, 0] }), resumen(), 'vehiculo', p)).toEqual([]);
  const pocos = hallazgos(analisis({ por_dia_semana: [0, 1, 0, 1, 0, 0, 0], permanencia: null }), resumen({ ingresos: 2, con_salida: 2, alertas: 0, no_registrados: 0 }), 'vehiculo', p, '2026-11-03');
  expect(pocos.some(h => h.tipo === 'patron')).toBe(false);
});
