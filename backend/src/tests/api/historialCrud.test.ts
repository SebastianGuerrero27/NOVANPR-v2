import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

jest.mock('../../infraestructura/db', () => ({
  getDB: () => ({ request: () => {
    const entradas: Record<string, unknown> = {};
    const r: any = {
      input: (nombre: string, a: unknown, b?: unknown) => { entradas[nombre] = b === undefined ? a : b; return r; },
      query: async () => ({ recordset: [{ estado: 'activo', bloqueado: false, bloqueado_hasta: null,
        codigo: ({ 1: 'ADMIN', 3: 'GUARDIA', 4: 'GESTOR_PERMISOS' } as Record<number, string>)[Number(entradas.id)] }] }),
    };
    return r;
  } }),
}));

jest.mock('../../contenedor/detecciones', () => ({ detecciones: {
  listar: jest.fn().mockResolvedValue({ items: [], total: 0 }),
  registroManual: jest.fn().mockResolvedValue({ message: 'Ingreso registrado manualmente.', deteccion: { id: 15 } }),
  editarRegistro: jest.fn().mockResolvedValue({ message: 'Registro corregido.', deteccion: { id: 15 } }),
  eliminar: jest.fn().mockResolvedValue({ message: 'Detección eliminada.', id: 15 }),
  eliminarMasivo: jest.fn().mockResolvedValue({ message: 'Detecciones eliminadas.', total: 2 }),
  exportarHistorialPdf: jest.fn().mockResolvedValue({ nombre: 'historial_filtrado.pdf', contenido: Buffer.from('%PDF-prueba') }),
} }));

import rutas from '../../interfaz/http/rutas/detecciones';
import { detecciones } from '../../contenedor/detecciones';
import { errorConflicto } from '../../aplicacion/comun';

const IDS = { Admin: 1, Guardia: 3, GestorPermisos: 4 } as const;
type Rol = keyof typeof IDS;
const sesion = (rol: Rol, rolToken: Rol = rol) => `Bearer ${jwt.sign({
  id: IDS[rol], email: `${rol}@example.test`, nombre: rol, rol: rolToken,
}, process.env.JWT_SECRET!)}`;

describe('Historial completo · CRUD y autorización HTTP', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/detecciones', rutas);
  beforeEach(() => jest.clearAllMocks());

  it('administración puede consultar, crear, corregir y eliminar usando los casos de uso auditados', async () => {
    const cabecera = sesion('Admin');
    await request(app).get('/api/detecciones').set('Authorization', cabecera).expect(200);
    await request(app).post('/api/detecciones/registro-manual').set('Authorization', cabecera)
      .send({ placa: 'PBA1234', motivo: 'Ingreso sin lectura de la cámara' }).expect(201);
    const cuerpo = { persona_ingreso: 'Ana Pérez', motivo_correccion: 'Corrección del titular anotado' };
    await request(app).patch('/api/detecciones/15/registro').set('Authorization', cabecera).send(cuerpo).expect(200);
    expect(detecciones.editarRegistro).toHaveBeenCalledWith(15, cuerpo, expect.objectContaining({ id: 1, rol: 'Admin' }));
    await request(app).delete('/api/detecciones/15').set('Authorization', cabecera).send({ motivo: 'Registro duplicado' }).expect(200);
    expect(detecciones.eliminar).toHaveBeenCalledWith(15, 'Registro duplicado', expect.objectContaining({ id: 1, rol: 'Admin' }));
  });

  it.each(['Guardia', 'GestorPermisos'] as Rol[])('%s no corrige los datos administrativos del historial', async rol => {
    await request(app).patch('/api/detecciones/15/registro').set('Authorization', sesion(rol))
      .send({ marca: 'Toyota', motivo_correccion: 'Corrección de marca' }).expect(403);
    expect(detecciones.editarRegistro).not.toHaveBeenCalled();
  });

  it('el guardia elimina un registro individual con el motivo y el actor vigentes de la sesión', async () => {
    await request(app).delete('/api/detecciones/15').set('Authorization', sesion('Guardia'))
      .send({ motivo: 'Registro duplicado' }).expect(200);
    expect(detecciones.eliminar).toHaveBeenCalledWith(15, 'Registro duplicado', expect.objectContaining({ id: 3, rol: 'Guardia' }));
    expect(detecciones.eliminarMasivo).not.toHaveBeenCalled();
  });

  it('el gestor de permisos no elimina registros individuales', async () => {
    await request(app).delete('/api/detecciones/15').set('Authorization', sesion('GestorPermisos'))
      .send({ motivo: 'Registro duplicado' }).expect(403);
    expect(detecciones.eliminar).not.toHaveBeenCalled();
  });

  it.each(['Guardia', 'GestorPermisos'] as Rol[])('%s no elimina todos ni los registros filtrados aunque confirme la acción', async rol => {
    const confirmacion = { confirmacion: 'ELIMINAR', motivo: 'Depuración autorizada de registros' };
    await request(app).delete('/api/detecciones').set('Authorization', sesion(rol)).send(confirmacion).expect(403);
    await request(app).delete('/api/detecciones?placa=PBA1234').set('Authorization', sesion(rol)).send(confirmacion).expect(403);
    expect(detecciones.eliminarMasivo).not.toHaveBeenCalled();
  });

  it('el borrado masivo sigue reservado al administrador', async () => {
    const confirmacion = { confirmacion: 'ELIMINAR', motivo: 'Depuración autorizada de registros' };
    await request(app).delete('/api/detecciones').set('Authorization', sesion('Admin')).send(confirmacion).expect(200);
    expect(detecciones.eliminarMasivo).toHaveBeenCalledWith({}, confirmacion, expect.objectContaining({ id: 1, rol: 'Admin' }));
  });

  it('un token antiguo de administrador no permite al guardia un borrado masivo', async () => {
    await request(app).delete('/api/detecciones').set('Authorization', sesion('Guardia', 'Admin'))
      .send({ confirmacion: 'ELIMINAR', motivo: 'Depuración autorizada' }).expect(403);
    expect(detecciones.eliminarMasivo).not.toHaveBeenCalled();
  });

  it('usa el rol vigente de la cuenta aunque el token conserve un rol administrativo anterior', async () => {
    await request(app).patch('/api/detecciones/15/registro').set('Authorization', sesion('Guardia', 'Admin'))
      .send({ marca: 'Toyota', motivo_correccion: 'Corrección de marca' }).expect(403);
    expect(detecciones.editarRegistro).not.toHaveBeenCalled();
  });

  it('mantiene el registro operativo de garita para guardias sin conceder corrección histórica al gestor', async () => {
    await request(app).post('/api/detecciones/registro-manual').set('Authorization', sesion('Guardia'))
      .send({ placa: 'PBA1234', motivo: 'Cámara fuera de servicio' }).expect(201);
    await request(app).post('/api/detecciones/registro-manual').set('Authorization', sesion('GestorPermisos')).send({}).expect(403);
    expect(detecciones.registroManual).toHaveBeenCalledTimes(1);
  });

  it('sin sesión rechaza todas las mutaciones', async () => {
    await request(app).post('/api/detecciones/registro-manual').send({}).expect(401);
    await request(app).patch('/api/detecciones/15/registro').send({}).expect(401);
    await request(app).delete('/api/detecciones/15').send({}).expect(401);
    await request(app).delete('/api/detecciones').send({}).expect(401);
    expect(detecciones.registroManual).not.toHaveBeenCalled();
    expect(detecciones.editarRegistro).not.toHaveBeenCalled();
    expect(detecciones.eliminar).not.toHaveBeenCalled();
    expect(detecciones.eliminarMasivo).not.toHaveBeenCalled();
  });

  it('un cierre vinculado o una edición concurrente responde 409 para que la interfaz conserve el formulario', async () => {
    jest.mocked(detecciones.editarRegistro).mockRejectedValueOnce(errorConflicto('La placa tiene una entrada y una salida vinculadas.'));
    const r = await request(app).patch('/api/detecciones/15/registro').set('Authorization', sesion('Admin'))
      .send({ placa: 'PBC5678', motivo_correccion: 'Corrección de la lectura' }).expect(409);
    expect(r.body.error).toContain('vinculadas');
  });

  it('el PDF del listado recibe los mismos filtros de la lista y devuelve un archivo, no un informe de solo salidas', async () => {
    const consulta = { buscar: 'Rosa', persona: 'Vera', camara: '4', estado: 'pendiente_revision', movimiento: 'salida',
      placa: 'PZX1010', exacta: 'si', unir_salidas: 'si', orden: 'reciente' };
    const r = await request(app).get('/api/detecciones/historial/reporte.pdf').query(consulta)
      .set('Authorization', sesion('Admin')).expect(200);
    expect(r.headers['content-type']).toMatch(/^application\/pdf/);
    expect(r.headers['content-disposition']).toContain('historial_filtrado.pdf');
    expect(detecciones.exportarHistorialPdf).toHaveBeenCalledWith(consulta, expect.objectContaining({ id: 1, rol: 'Admin' }));
  });

  it('el PDF del listado exige sesión y permiso de consulta del historial', async () => {
    await request(app).get('/api/detecciones/historial/reporte.pdf').expect(401);
    await request(app).get('/api/detecciones/historial/reporte.pdf').set('Authorization', sesion('GestorPermisos')).expect(403);
    expect(detecciones.exportarHistorialPdf).not.toHaveBeenCalled();
  });
});
