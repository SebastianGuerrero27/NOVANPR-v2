import sql from '../postgres';
import { getDB } from '../db';
import type { RepositorioControlVehicular } from '../../aplicacion/controlVehicular';

/**
 * Movimientos del reporte de control vehicular: ingresos y salidas ya procesados, con el titular,
 * el tipo y la marca del padrón y el motivo de la alerta. Las salidas se toman de cualquier cámara
 * (la de salida suele ser otra que la de ingreso).
 */
export const repositorioControlVehicularSql: RepositorioControlVehicular = {
  async movimientos(desde, hasta, camara) {
    const r = await getDB().request()
      .input('desde', sql.DateTime, desde).input('hasta', sql.DateTime, hasta).input('camara', sql.Int, camara)
      .query(`
        SELECT TOP 20000 d.id, COALESCE(d.tipo_movimiento, 'ingreso') AS tipo_movimiento, d.fecha_hora_ingreso,
               COALESCE(d.placa_validada, d.placa_reconocida) AS placa, d.persona_ingreso, COALESCE(NULLIF(d.motivo_ingreso, ''), v.motivo_ingreso) AS motivo_ingreso,
               d.tipo_vehiculo, d.vehiculo_tipo, d.vehiculo_marca, d.estado_validacion, d.evidencia_lectura,
               v.propietario, v.tipo_vehiculo AS autorizado_tipo, v.marca AS autorizado_marca, a.motivo AS alerta_motivo
        FROM DeteccionVehiculo d
        LEFT JOIN VehiculosAutorizados v ON v.id = d.vehiculo_autorizado_id
        LEFT JOIN ListaNegra a ON a.id = d.alerta_id
        WHERE d.fecha_hora_ingreso >= @desde AND d.fecha_hora_ingreso <= @hasta
          AND d.estado_procesamiento IN ('procesado', 'no_legible')
          AND (COALESCE(d.tipo_movimiento, 'ingreso') = 'salida' OR @camara::integer IS NULL OR d.camara_id = @camara::integer)
        ORDER BY d.fecha_hora_ingreso`);
    return r.recordset;
  },

  async nombreCamara(id) {
    const r = await getDB().request().input('id', sql.Int, id).query('SELECT nombre FROM Camaras WHERE id = @id');
    return r.recordset[0]?.nombre ?? null;
  },
};
