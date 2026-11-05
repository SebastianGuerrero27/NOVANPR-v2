import { expect, it } from 'vitest';
import { esEvidenciaSinPlaca } from '../src/dominio/evidencia';

it('distingue la evidencia de un vehículo sin matrícula de la evidencia de lectura de una placa', () => {
  const moto = { motivo: 'vehiculo_sin_placa', tipo_vehiculo: 'motocicleta', confianza_vehiculo: 0.619,
    movimiento_max: 0.238, duracion_s: 1 };
  const lectura = { valido: true, formato: true, dentro_cuadro: true, caracteres: 6, lecturas: 2, verificador_coincide: true, motivos: [] };
  expect(esEvidenciaSinPlaca(moto)).toBe(true);
  expect(esEvidenciaSinPlaca(lectura)).toBe(false);
  expect(esEvidenciaSinPlaca(null)).toBe(false);
});
