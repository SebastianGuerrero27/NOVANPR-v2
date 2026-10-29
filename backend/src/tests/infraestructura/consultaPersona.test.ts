import { casosConsultaPersona } from '../../aplicacion/consultaPersona';
import { ProveedorNombresEcuadorApi } from '../../infraestructura/servicios/consultaPersona';
const solicitar = jest.fn();
const auditoria = { operacion: jest.fn().mockResolvedValue(undefined) };
const actor = { id: 1, nombre: 'Guardia', email: 'guardia@example.com', rol: 'Guardia', ip: null };
const crear = (clave = 'secreto-prueba') => casosConsultaPersona({ proveedor: new ProveedorNombresEcuadorApi(clave, solicitar), auditoria });
beforeEach(() => { solicitar.mockReset(); auditoria.operacion.mockClear(); });
it('sin clave no realiza consultas externas', async () => {
  await expect(crear('').consultar('0123456789', actor)).rejects.toMatchObject({ tipo: 'no_disponible' });
  expect(solicitar).not.toHaveBeenCalled();
});
it('valida el formato y los permisos antes de consultar', async () => {
  await expect(crear().consultar('123', actor)).rejects.toMatchObject({ tipo: 'validacion' });
  await expect(crear().consultar('0123456789', { ...actor, rol: 'Desconocido' })).rejects.toMatchObject({ tipo: 'prohibido' });
  expect(solicitar).not.toHaveBeenCalled();
});
it.each(['Guardia', 'Admin', 'GestorPermisos'])('devuelve solo cédula y nombre a %s, sin perder ceros ni auditar datos personales', async rol => {
  solicitar.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { id: '0123456789', full_name: 'ANA TORRES', birth_date: 'dato innecesario' }, error: null }) });
  await expect(crear().consultar('0123456789', { ...actor, rol })).resolves.toEqual({ cedula: '0123456789', nombre: 'ANA TORRES' });
  expect(solicitar).toHaveBeenCalledWith('https://api.ecuadorapi.com/api/v1/cedulas/0123456789/nombres', expect.objectContaining({ redirect: 'error', headers: expect.objectContaining({ Authorization: 'Bearer secreto-prueba' }) }));
  expect(JSON.stringify(auditoria.operacion.mock.calls)).not.toMatch(/0123456789|ANA TORRES|secreto-prueba/);
});
it('rechaza una respuesta correspondiente a otra persona', async () => {
  solicitar.mockResolvedValue({ ok: true, json: async () => ({ data: { id: '9999999999', full_name: 'OTRA PERSONA' } }) });
  await expect(crear().consultar('0123456789', actor)).rejects.toMatchObject({ tipo: 'no_disponible' });
});
it.each([401, 402, 429, 503])('un error %s no se reintenta ni expone la respuesta externa', async status => {
  solicitar.mockResolvedValue({ ok: false, status });
  await expect(crear().consultar('0123456789', actor)).rejects.toMatchObject({ tipo: 'no_disponible' });
  expect(solicitar).toHaveBeenCalledTimes(1);
});
it('informa cuando no hay un resultado', async () => {
  solicitar.mockResolvedValue({ status: 404 });
  await expect(crear().consultar('0123456789', actor)).rejects.toMatchObject({ tipo: 'no_encontrado' });
});
