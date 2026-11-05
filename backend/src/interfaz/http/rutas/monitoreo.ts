import { Router } from 'express';
import { authMiddleware, requierePermiso } from '../middlewares/auth';
import { monitoreo } from '../../../contenedor/camaras';
import { actorDe, controlador } from '../respuesta';

/**
 * Monitoreo en vivo.
 *
 *   GET  /estado   estado de los motores ANPR y de cada cámara en análisis   operacion:monitorear
 *   POST /ticket   credencial de 60 s para el video (WebRTC de MediaMTX o    operacion:monitorear
 *                  WebSocket de pistas del motor que atiende la cámara)
 *
 * Los casos de uso están en aplicacion/monitoreo.ts.
 */
const router = Router();
router.use(authMiddleware);

router.get('/estado', requierePermiso('operacion:monitorear'), controlador('MONITOREO estado', 'No se pudo consultar el estado del motor ANPR.', async (_req, res) => {
  res.json(await monitoreo.estado());
}));

router.post('/ticket', requierePermiso('operacion:monitorear'), controlador('MONITOREO ticket', 'No se pudo emitir la credencial de video.', async (req, res) => {
  res.json(monitoreo.ticket(req.body?.alcance, req.body?.camara_id, actorDe(req)));
}));

export default router;
