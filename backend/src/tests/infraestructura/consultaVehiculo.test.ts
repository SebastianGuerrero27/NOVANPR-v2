import { ProveedorEcuadorApi } from '../../infraestructura/servicios/consultaVehiculo';
import { casosConsultaVehiculo } from '../../aplicacion/consultaVehiculo';

const solicitar = jest.fn();
const auditoria = { operacion: jest.fn().mockResolvedValue(undefined) };
const actor = { id: 9, email: 'gestor@example.com', nombre: 'Gestor', rol: 'GestorPermisos', ip: null };
const proveedor = () => new ProveedorEcuadorApi('clave-prueba', solicitar);
beforeEach(() => { solicitar.mockReset(); auditoria.operacion.mockClear(); });
it('sin clave deja la consulta deshabilitada y no invoca al proveedor', async () => {
  const p = new ProveedorEcuadorApi('', solicitar);
  await expect(casosConsultaVehiculo({ proveedor: p, auditoria }).consultar('ABC1234', actor)).rejects.toMatchObject({ tipo: 'no_disponible' });
  expect(solicitar).not.toHaveBeenCalled();
});
it('valida la placa antes de realizar una consulta con costo', async () => {
  await expect(casosConsultaVehiculo({ proveedor: proveedor(), auditoria }).consultar('???', actor)).rejects.toMatchObject({ tipo: 'validacion' });
  expect(solicitar).not.toHaveBeenCalled();
});
it('mapea exclusivamente los datos técnicos de la placa consultada y audita', async () => {
  solicitar.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { plate: 'ABC-1234', brand: 'TOYOTA', model: 'COROLLA', color: 'BLANCO', vehicle_class: 'AUTOMOVIL', owner: 'No se devuelve' }, error: null }) });
  const r = await casosConsultaVehiculo({ proveedor: proveedor(), auditoria }).consultar('abc-1234', actor);
  expect(r).toEqual({ placa: 'ABC1234', marca: 'TOYOTA', modelo: 'COROLLA', color: 'blanco', tipo_vehiculo: 'AUTOMOVIL' });
  expect(solicitar).toHaveBeenCalledTimes(1);
  expect(solicitar).toHaveBeenCalledWith('https://api.ecuadorapi.com/api/v1/placas/ABC1234', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer clave-prueba' }), redirect: 'error' }));
  expect(JSON.stringify(auditoria.operacion.mock.calls)).not.toContain('clave-prueba');
});
it('no acepta datos de otra placa', async () => {
  solicitar.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { plate: 'ZZZ9999', brand: 'Toyota' } }) });
  await expect(proveedor().consultar('ABC1234')).rejects.toThrow('placa consultada');
});
it('404 informa ausencia de resultado', async () => {
  solicitar.mockResolvedValue({ status: 404 });
  await expect(casosConsultaVehiculo({ proveedor: proveedor(), auditoria }).consultar('ABC1234', actor)).rejects.toMatchObject({ tipo: 'no_encontrado' });
});
it.each([401, 402, 429, 503])('un error %s no se reintenta ni expone respuestas del proveedor', async status => {
  solicitar.mockResolvedValue({ status, ok: false });
  await expect(casosConsultaVehiculo({ proveedor: proveedor(), auditoria }).consultar('ABC1234', actor)).rejects.toMatchObject({ tipo: 'no_disponible' });
  expect(solicitar).toHaveBeenCalledTimes(1);
});

it('el estado local no consume consultas y refleja que falta configuración', () => {
  const p = new ProveedorEcuadorApi('', solicitar);
  const casos = casosConsultaVehiculo({ proveedor: p, auditoria });
  expect(casos.estado(actor)).toMatchObject({ capacidad_local: true, estado_proveedor: 'sin_comprobar', habilitado: false, puede_consultar: false, reintentar_en_s: 0 });
  expect(solicitar).not.toHaveBeenCalled();
  expect(() => casos.estado({ ...actor, rol: 'desconocido' })).toThrow('permiso');
});

it('un proveedor temporalmente no disponible pausa consultas nuevas sin contactar de nuevo', async () => {
  let ahora = 100000;
  const p = new ProveedorEcuadorApi('clave-prueba', solicitar, () => ahora);
  const casos = casosConsultaVehiculo({ proveedor: p, auditoria });
  solicitar.mockResolvedValue({ status: 503, ok: false });
  await expect(casos.consultar('ABC1234', actor)).rejects.toMatchObject({ tipo: 'no_disponible' });
  expect(casos.estado(actor)).toMatchObject({ capacidad_local: true, estado_proveedor: 'error_reciente', habilitado: true, puede_consultar: false, reintentar_en_s: 60 });
  expect(auditoria.operacion).toHaveBeenLastCalledWith(actor, 'CONSULTA_VEHICULO', 'vehiculo', null, expect.stringContaining('error:http_503'));
  await expect(casos.consultar('PBA5678', actor)).rejects.toMatchObject({ tipo: 'no_disponible' });
  expect(solicitar).toHaveBeenCalledTimes(1);
  ahora += 60000;
  expect(casos.estado(actor)).toMatchObject({ puede_consultar: true, reintentar_en_s: 0, mensaje: null });
});

it('respeta Retry-After del proveedor sin reintentar una consulta', async () => {
  let ahora = 100000;
  const p = new ProveedorEcuadorApi('clave-prueba', solicitar, () => ahora);
  solicitar.mockResolvedValue({ status: 429, ok: false, headers: { get: () => '120' } });
  await expect(p.consultar('ABC1234')).rejects.toThrow('límite');
  ahora += 119000;
  expect(p.estado().reintentar_en_s).toBe(1);
  await expect(p.consultar('PBA5678')).rejects.toThrow('límite');
  expect(solicitar).toHaveBeenCalledTimes(1);
  ahora += 1000;
  expect(p.estado().puede_consultar).toBe(true);
});

it.each([[401, 'autenticación'], [402, 'saldo']])('distingue el fallo de cuenta %s sin exponer la clave', async (status, mensaje) => {
  solicitar.mockResolvedValue({ status, ok: false });
  const p = proveedor();
  await expect(casosConsultaVehiculo({ proveedor: p, auditoria }).consultar('ABC1234', actor)).rejects.toMatchObject({ tipo: 'no_disponible', message: expect.stringContaining(mensaje) });
  expect(p.estado().reintentar_en_s).toBeGreaterThan(60);
  expect(JSON.stringify(p.estado())).not.toContain('clave-prueba');
});

it('una respuesta no JSON pausa la consulta sin romper el flujo manual', async () => {
  solicitar.mockResolvedValue({ status: 200, ok: true, json: async () => { throw new Error('HTML no válido'); } });
  const p = proveedor();
  await expect(casosConsultaVehiculo({ proveedor: p, auditoria }).consultar('ABC1234', actor)).rejects.toMatchObject({ tipo: 'no_disponible', message: expect.stringContaining('incompatible') });
  expect(p.estado().puede_consultar).toBe(false);
});
