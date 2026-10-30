/** Las columnas DATE (vigencias) llegan como 'AAAA-MM-DD': un día del calendario, sin zona horaria. */
import { types } from 'pg';
import '../../infraestructura/postgres';
import { presentarDeteccion } from '../../infraestructura/presentacionDetecciones';

jest.mock('../../infraestructura/servicios/configuracion', () => ({ politicaAutorizacion: () => ({ criterio: 'confianza', confianzaMinima: 0.82, fuenteConfianza: 'ocr', verificarVehiculo: false }) }));
jest.mock('../../infraestructura/servicios/media', () => ({ urlMedia: (ruta: unknown) => ruta ?? null }));

it('el lector de DATE de node-postgres devuelve el día tal cual (no la medianoche UTC del servidor)', () => {
  expect(types.getTypeParser(types.builtins.DATE)('2026-10-29')).toBe('2026-10-29');
});

it('la vigencia del permiso en la ficha de un paso conserva su día', () => {
  const dto = presentarDeteccion({ id: 1, vehiculo_autorizado_id: 7, propietario: 'Rosa Vera', autorizado_inicio: '2026-10-29', autorizado_vence: '2026-12-31', autorizado_horario: null });
  expect(dto.datos_permiso).toMatchObject({ fecha_inicio: '2026-10-29', fecha_fin: '2026-12-31' });
});
