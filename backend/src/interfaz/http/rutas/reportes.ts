import { Router } from 'express';
import { authMiddleware, requierePermiso } from '../middlewares/auth';
import { reportes } from '../../../contenedor/reportes';
import { controlVehicular } from '../../../contenedor/controlVehicular';
import { actorDe, controlador } from '../respuesta';

/**
 * Reporte consolidado de un período (reportes:ver).
 *
 *   GET /?desde=ISO&hasta=ISO&camara=id
 *   GET /control-vehicular?desde&hasta&camara&turno=completo|diurno|nocturno&formato=pdf|xlsx
 *       hoja de control vehicular de la garita (PDF o Excel), con la descarga auditada
 *
 * Por omisión, los últimos 7 días locales; máximo 366 días. Fechas AAAA-MM-DD o ISO 8601 y
 * cámara entera positiva: un valor inválido responde 400 (dominio/periodo.ts).
 */
const router = Router();
router.use(authMiddleware, requierePermiso('reportes:ver'));

router.get('/', controlador('REPORTES', 'No se pudo generar el reporte.', async (req, res) => {
  res.json(await reportes.consolidado(req.query));
}));

router.get('/control-vehicular', controlador('REPORTES control vehicular', 'No se pudo generar el reporte de control vehicular.', async (req, res) => {
  const r = await controlVehicular.generar(req.query, actorDe(req));
  res.setHeader('Content-Type', r.tipo);
  res.setHeader('Content-Disposition', `attachment; filename="${r.nombre}"`);
  res.send(r.contenido);
}));

export default router;
