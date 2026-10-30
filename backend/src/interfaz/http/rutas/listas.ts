import express, { Router } from 'express';
import { authMiddleware, requierePermiso } from '../middlewares/auth';
import { type DefinicionLista, LISTA_BLANCA, LISTA_NEGRA } from '../../../dominio/listas';
import { listas } from '../../../contenedor/listas';
import { actorDe, controlador, idDe } from '../respuesta';

/**
 * Listas de control (lista blanca y lista negra). CRUD con el mismo contrato:
 *
 *   GET    /       registros activos (vigentes y vencidos, con la marca `vigente`)
 *   GET    /:id    detalle de un registro
 *   POST   /       alta (reactiva el registro si la placa se había retirado)
 *   PUT    /:id    edición
 *   DELETE /:id    retiro (baja lógica; en la lista blanca, «desactivar»), motivo opcional
 *
 * Solo lista blanca:
 *   POST   /importar        permisos desde un .xlsx o .csv (id, nombres, cedula, institucion, cargo,
 *                           placa, marca, modelo, tipo, color); ?simular=si es la vista previa
 *   GET    /mis-permisos    los que otorgó el usuario (?estado=activos|retirados|todos; activos por omisión)
 *   POST   /:id/reactivar   vuelve a activar un permiso desactivado con sus mismos datos (motivo
 *                           auditado): el administrador, cualquiera; los demás, solo los suyos
 *
 * Solo lista blanca, administrador (padron:supervisar):
 *   GET    /registro        permisos de todos los usuarios (?usuario=, ?estado=activos|retirados|todos)
 *                           y el resumen de lo que otorgó cada gestor
 *   DELETE /:id/definitivo  elimina un permiso retirado o vencido sin ingresos en el historial
 *
 * Lectura: listas:ver. Cambios: el permiso de cada lista (padron:gestionar para la lista
 * blanca, alertas:gestionar para la lista negra). Las reglas están en dominio/listas.ts y los
 * casos de uso en aplicacion/listas.ts.
 */
function crearRouter(def: DefinicionLista): Router {
  const router = Router();
  const lectura = [authMiddleware, requierePermiso('listas:ver')];
  const edicion = [authMiddleware, requierePermiso(def.permisoEdicion)];
  const alta = def.tipo === 'alertas' ? [authMiddleware, requierePermiso('alertas:restringir')] : edicion;
  const contexto = `LISTAS ${def.nombre}`;
  // Los clientes anteriores reciben un cierre explícito; ninguna de estas rutas carga
  // conectores externos ni puede consumir créditos del proveedor.
  if (def.tipo === 'autorizados') {
    const retirada = (_req: unknown, res: import('express').Response) => {
      res.status(410).json({ error: 'Las consultas externas de placa y cédula fueron retiradas. Complete los datos manualmente.', codigo: 'CONSULTA_EXTERNA_RETIRADA' });
    };
    router.get('/estado-consulta-vehiculo', authMiddleware, retirada);
    router.post('/consultar-persona', authMiddleware, retirada);
    router.post('/consultar-vehiculo', authMiddleware, retirada);
  }

  if (def.tipo === 'autorizados') router.post('/:id(\\d+)/placa', authMiddleware, requierePermiso('detecciones:validar'),
    controlador(contexto, 'No se pudo completar la placa.', async (req, res) => {
      if (req.body?.identidad_confirmada !== true) { res.status(400).json({ message: 'Confirme la identidad de la persona antes de asignar la placa.' }); return; }
      const id = idDe(req, res);
      if (id !== null) res.json({ item: await listas.completarPlaca(def, id, req.body?.placa, actorDe(req)) });
    }));

  if (def.tipo === 'autorizados') router.get('/mis-permisos', ...lectura, controlador(contexto, 'No se pudieron consultar sus permisos.', async (req, res) => {
    res.json(await listas.misPermisos(req.query, actorDe(req)));
  }));

  if (def.tipo === 'autorizados') router.post('/:id(\\d+)/reactivar', ...edicion, controlador(contexto, 'No se pudo activar el permiso.', async (req, res) => {
    const id = idDe(req, res);
    if (id !== null) res.json({ message: 'Permiso activado.', item: await listas.reactivar(def, id, req.body?.motivo, actorDe(req)) });
  }));

  // Importación desde Excel/CSV: el cuerpo es el archivo; ?simular=si devuelve la vista previa sin guardar
  if (def.tipo === 'autorizados') router.post('/importar', ...edicion, express.raw({ type: () => true, limit: '5mb' }),
    controlador(contexto, 'No se pudo importar el archivo.', async (req, res) => {
      const contenido = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      res.json(await listas.importar(def, contenido, req.query.archivo, actorDe(req), req.query.simular === 'si'));
    }));

  // Registro de permisos del administrador: los de todos los usuarios, incluidos los retirados
  if (def.tipo === 'autorizados') {
    const supervision = [authMiddleware, requierePermiso('padron:supervisar')];
    router.get('/registro', ...supervision, controlador(contexto, 'No se pudo consultar el registro de permisos.', async (req, res) => {
      res.json(await listas.registroPermisos(req.query));
    }));
    router.delete('/:id(\\d+)/definitivo', ...supervision, controlador(contexto, 'No se pudo eliminar el permiso.', async (req, res) => {
      const id = idDe(req, res);
      if (id === null) return;
      await listas.eliminarDefinitivo(def, id, actorDe(req));
      res.json({ message: 'Permiso eliminado definitivamente.' });
    }));
  }

  router.get('/', ...lectura, controlador(contexto, `No se pudo consultar la ${def.nombre}.`, async (req, res) => {
    res.json(await listas.listar(def, actorDe(req)));
  }));

  router.get('/:id(\\d+)', ...lectura, controlador(contexto, 'No se pudo consultar el registro.', async (req, res) => {
    const id = idDe(req, res);
    if (id !== null) res.json(await listas.obtener(def, id, actorDe(req)));
  }));

  router.post('/', ...alta, controlador(contexto, 'No se pudo guardar el registro.', async (req, res) => {
    const { item, accion } = await listas.registrar(def, req.body, actorDe(req));
    res.status(accion === 'reactivado' ? 200 : 201).json({
      message: accion === 'reactivado' ? 'Registro reactivado.' : 'Registro creado.',
      item,
    });
  }));

  router.put('/:id(\\d+)', ...edicion, controlador(contexto, 'No se pudo actualizar el registro.', async (req, res) => {
    const id = idDe(req, res);
    if (id !== null) res.json({ message: 'Registro actualizado.', item: await listas.editar(def, id, req.body, actorDe(req)) });
  }));

  router.delete('/:id(\\d+)', ...edicion, controlador(contexto, 'No se pudo retirar el registro.', async (req, res) => {
    const id = idDe(req, res);
    if (id === null) return;
    await listas.retirar(def, id, req.body?.motivo, actorDe(req));
    res.json({ message: def.tipo === 'autorizados' ? 'Permiso desactivado.' : 'Registro retirado de la lista.' });
  }));

  return router;
}

export const autorizadosRouter = crearRouter(LISTA_BLANCA);
export const alertasRouter = crearRouter(LISTA_NEGRA);
