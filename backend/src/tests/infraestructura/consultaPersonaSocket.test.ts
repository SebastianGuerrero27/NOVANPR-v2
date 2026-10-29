import { ProveedorNombresSocketStudio } from '../../infraestructura/servicios/consultaPersona';
const solicitar = jest.fn();
const proveedor = () => new ProveedorNombresSocketStudio('token-prueba', solicitar);
beforeEach(() => solicitar.mockReset());
it('sin token queda deshabilitado', () => expect(new ProveedorNombresSocketStudio('', solicitar).habilitado()).toBe(false));
it('utiliza el endpoint y mapea exclusivamente identificación y nombres', async () => {
  solicitar.mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 200, cedula: '0123456789', nombres: 'ANA TORRES', estado: 'VIGENTE', otro: 'no se entrega' }) });
  await expect(proveedor().consultar('0123456789')).resolves.toEqual({ cedula: '0123456789', nombre: 'ANA TORRES' });
  expect(solicitar).toHaveBeenCalledWith('https://api.socketsudio.com/v1/cedula/0123456789', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-prueba' }), redirect: 'error' }));
});
it('rechaza una identificación diferente', async () => {
  solicitar.mockResolvedValue({ ok: true, json: async () => ({ cedula: '9999999999', nombres: 'OTRA PERSONA' }) });
  await expect(proveedor().consultar('0123456789')).rejects.toThrow('incompatible');
});
it.each([401, 403, 429, 503])('no reintenta ante un error %s', async status => {
  solicitar.mockResolvedValue({ ok: false, status });
  await expect(proveedor().consultar('0123456789')).rejects.toThrow();
  expect(solicitar).toHaveBeenCalledTimes(1);
});
it('404 no inventa un nombre', async () => {
  solicitar.mockResolvedValue({ status: 404 });
  await expect(proveedor().consultar('0123456789')).resolves.toBeNull();
});
