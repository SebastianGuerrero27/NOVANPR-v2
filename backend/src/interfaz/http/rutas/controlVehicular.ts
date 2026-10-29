import { Router } from 'express';
import { authMiddleware, requierePermiso } from '../middlewares/auth';
import { controlVehicular } from '../../../contenedor/controlVehicular';
import { actorDe, controlador } from '../respuesta';

/**
 * Hoja de control vehicular de la garita, montada en /api/reportes (reportes:ver). Los informes de accesos por fecha y del historial de un
 * vehículo se arman en el navegador con /api/detecciones; aquí queda la hoja oficial de la garita.
 *
 *   GET /control-vehicular?desde&hasta&camara&turno=completo|diurno|nocturno&formato=pdf|xlsx
 *       hoja de control vehicular de la garita (PDF o Excel), con la descarga auditada
 *
 * Por omisión, los últimos 7 días locales; máximo 366 días. Fechas AAAA-MM-DD o ISO 8601 y
 * cámara entera positiva: un valor inválido responde 400 (dominio/periodo.ts).
 */
const router = Router();
router.use(authMiddleware, requierePermiso('reportes:ver'));

router.get('/control-vehicular', controlador('REPORTES control vehicular', 'No se pudo generar el reporte de control vehicular.', async (req, res) => {
  const r = await controlVehicular.generar(req.query, actorDe(req));
  res.setHeader('Content-Type', r.tipo);
  res.setHeader('Content-Disposition', `attachment; filename="${r.nombre}"`);
  res.send(r.contenido);
}));

export default router;
