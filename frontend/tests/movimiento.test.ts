import { expect, it } from 'vitest';
import { horasDelMovimiento } from '../src/dominio/movimiento';

it('un ingreso entra a su hora y sale cuando se registra su salida', () => {
  expect(horasDelMovimiento({ tipo_movimiento: 'ingreso', fecha_hora_ingreso: 'A', fecha_hora_salida: null })).toEqual({ entrada: 'A', salida: null });
  expect(horasDelMovimiento({ tipo_movimiento: 'ingreso', fecha_hora_ingreso: 'A', fecha_hora_salida: 'B' })).toEqual({ entrada: 'A', salida: 'B' });
});

it('el paso de la cámara de salida es una hora de salida, sin entrada', () => {
  expect(horasDelMovimiento({ tipo_movimiento: 'salida', fecha_hora_ingreso: 'C', fecha_hora_salida: null })).toEqual({ entrada: null, salida: 'C' });
});
