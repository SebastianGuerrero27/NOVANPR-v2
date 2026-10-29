import { Router } from 'express';
import { authMiddleware, requierePermiso } from '../middlewares/auth';
import { configuracion } from '../../../contenedor/configuracion';
import { actorDe, controlador } from '../respuesta';

/**
 * Configuración del sistema (configuracion:gestionar, solo Administrador).
 *
 *   GET /   parámetros editables (valor vigente y origen) y datos del entorno (solo lectura)
 *   PUT /   { valores: { clave: valor } } — cada valor se valida según el tipo declarado del
 *           parámetro antes de guardar; una clave desconocida o un valor inválido responden 400
 *           sin guardar nada. Cada cambio queda en la auditoría.
 *   GET    /correo          correo saliente (SMTP) guardado, sin la contraseña, y de dónde sale hoy
 *   PUT    /correo          alta o edición; la contraseña vacía conserva la guardada
 *   DELETE /correo          quita la cuenta: vuelven a regir las variables SMTP_* del servidor
 *   POST   /correo/probar   { destino? } envía un correo de prueba (por omisión, a quien lo pide)
 *
 * Reglas en dominio/configuracion.ts y casos de uso en aplicacion/configuracion.ts.
 */
const router = Router();
router.use(authMiddleware, requierePermiso('configuracion:gestionar'));

const CONTEXTO = 'CONFIG';

router.get('/', controlador(CONTEXTO, 'No se pudo consultar la configuración.', async (_req, res) => {
  res.json(await configuracion.consultar());
}));

router.put('/', controlador(CONTEXTO, 'No se pudo guardar la configuración.', async (req, res) => {
  const { cambiados, parametros } = await configuracion.guardar(req.body?.valores, actorDe(req));
  res.json({ message: cambiados ? 'Configuración guardada.' : 'No hubo cambios.', parametros });
}));

router.get('/correo', controlador(CONTEXTO, 'No se pudo consultar el correo saliente.', async (_req, res) => {
  res.json(await configuracion.consultarCorreo());
}));

router.put('/correo', controlador(CONTEXTO, 'No se pudo guardar el correo saliente.', async (req, res) => {
  res.json({ message: 'Correo saliente guardado.', correo: await configuracion.guardarCorreo(req.body, actorDe(req)) });
}));

router.delete('/correo', controlador(CONTEXTO, 'No se pudo quitar el correo saliente.', async (req, res) => {
  res.json({ message: 'Correo saliente quitado.', correo: await configuracion.eliminarCorreo(actorDe(req)) });
}));

router.post('/correo/probar', controlador(CONTEXTO, 'No se pudo enviar el correo de prueba.', async (req, res) => {
  res.json(await configuracion.probarCorreo(req.body, actorDe(req)));
}));

export default router;
