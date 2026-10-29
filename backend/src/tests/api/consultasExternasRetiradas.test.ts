import express from 'express';
import request from 'supertest';

jest.mock('../../contenedor/sesiones', () => ({
  decodificarToken: (token: string) => token === 'prueba' ? { id: 1, rol: 'Admin', nombre: 'Prueba' } : null,
  cuentaVigente: async () => ({ vigente: true }),
}));
jest.mock('../../contenedor/listas', () => ({ listas: {
  registrar: jest.fn().mockResolvedValue({ accion: 'creado', item: { id: 1, placa: 'PBA1234', propietario: 'Ana Pérez' } }),
} }));
// Importar un conector desde el router hace fallar la prueba, incluso sin llamar al proveedor.
jest.mock('../../contenedor/consultaPersona', () => { throw new Error('El router no debe cargar consultas de cédula'); });
jest.mock('../../contenedor/consultaVehiculo', () => { throw new Error('El router no debe cargar consultas de placa'); });

import { autorizadosRouter } from '../../interfaz/http/rutas/listas';
import { listas } from '../../contenedor/listas';

const app = express();
app.use(express.json());
app.use('/listas', autorizadosRouter);

it.each([
  ['post', '/consultar-persona'],
  ['post', '/consultar-vehiculo'],
  ['get', '/estado-consulta-vehiculo'],
] as const)('%s %s queda retirada para clientes antiguos, sin proveedor', async (metodo, ruta) => {
  expect((await request(app)[metodo](`/listas${ruta}`)).status).toBe(401);
  const res = await request(app)[metodo](`/listas${ruta}`).set('Authorization', 'Bearer prueba');
  expect(res.status).toBe(410);
  expect(res.body.codigo).toBe('CONSULTA_EXTERNA_RETIRADA');
});

it('mantiene el registro manual de nombre, cédula y vehículo', async () => {
  const datos = { propietario: 'Ana Pérez', cedula: '0123456789', placa: 'PBA1234', marca: 'Toyota', modelo: 'Corolla' };
  const res = await request(app).post('/listas').set('Authorization', 'Bearer prueba').send(datos);
  expect(res.status).toBe(201);
  expect(listas.registrar).toHaveBeenCalledWith(expect.anything(), datos, expect.objectContaining({ id: 1 }));
});
