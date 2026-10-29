jest.mock('../../infraestructura/servicios/configuracion', () => ({ politicaAutorizacion: () => ({ criterio: 'validez_y_confianza', confianzaMinima: 0.8, fuenteConfianza: 'ocr', verificarVehiculo: false }) }));
jest.mock('../../infraestructura/servicios/media', () => ({ urlMedia: (ruta: unknown) => ruta ?? null }));
import { presentarDeteccion } from '../../infraestructura/presentacionDetecciones';

const franja = { dias: [1, 3, 5], desde: '07:00', hasta: '19:00' };

it.each([JSON.stringify([franja]), [franja]])('la ficha entrega franjas interpretadas aunque el horario se conserve como JSON (%j)', horario => {
  const dto = presentarDeteccion({ id: 15, datos_permiso: { propietario: 'Titular de prueba', horario } });
  expect(dto.datos_permiso.horario).toEqual([franja]);
  expect(dto.datos_permiso).not.toHaveProperty('horario_error');
});

it('la ficha puede sobrescribir el horario del padrón con una restricción propia serializada', () => {
  const dto = presentarDeteccion({ id: 15, vehiculo_autorizado_id: 7,
    autorizado_horario: JSON.stringify([{ ...franja, dias: [2] }]), datos_permiso: { horario: JSON.stringify([franja]) } });
  expect(dto.datos_permiso.horario).toEqual([franja]);
});

it.each([{}, '{incorrecto', [{ dias: 'lunes', desde: '07:00', hasta: '19:00' }]])('un horario histórico dañado queda señalado para corrección, no como permiso 24/7 (%j)', horario => {
  const dto = presentarDeteccion({ id: 15, datos_permiso: { horario } });
  expect(dto.datos_permiso.horario).toBeNull();
  expect(dto.datos_permiso.horario_error).toMatch(/no es válido/);
});

it('señala también el horario inválido del padrón sin una ficha propia', () => {
  const dto = presentarDeteccion({ id: 15, vehiculo_autorizado_id: 7, autorizado_horario: '{}' });
  expect(dto.datos_permiso.horario_error).toMatch(/no es válido/);
});

it.each([null, '[]'])('conserva la ausencia explícita de restricción (%j)', horario => {
  const dto = presentarDeteccion({ id: 15, datos_permiso: { horario } });
  expect(dto.datos_permiso.horario).toBeNull();
  expect(dto.datos_permiso).not.toHaveProperty('horario_error');
});
