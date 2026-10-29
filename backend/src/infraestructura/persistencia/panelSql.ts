import sql from '../postgres';
import { getDB } from '../db';
import type { RepositorioPanel } from '../../aplicacion/panel';
import { hoyLocalSql } from '../servicios/tiempo';
import { REGISTRO_COMPLETO_SQL } from './registroCompletoSql';

/**
 * Repositorio SQL Server del panel de inicio. Cada indicador es una consulta de agregación
 * sobre los registros reales; las de un mismo panel se ejecutan en paralelo.
 */

const CONTEOS = `
  COUNT(*) AS total,
  SUM(CASE WHEN estado_validacion = 'autorizado' THEN 1 ELSE 0 END) AS autorizados,
  SUM(CASE WHEN estado_validacion = 'alerta' THEN 1 ELSE 0 END) AS alertas,
  SUM(CASE WHEN estado_validacion = 'no_reconocido' THEN 1 ELSE 0 END) AS no_registrados,
  SUM(CASE WHEN estado_validacion = 'pendiente_revision' OR estado_procesamiento = 'pendiente_ocr' THEN 1 ELSE 0 END) AS pendientes,
  SUM(CASE WHEN validado_manualmente = 1 THEN 1 ELSE 0 END) AS validados`;

/** Pasos que cuentan en los indicadores (procesados, ilegibles o a la espera de OCR). */
const BASE = `estado_procesamiento IN ('procesado', 'no_legible', 'pendiente_ocr')`;

const db = () => getDB();

export const repositorioPanelSql: RepositorioPanel = {
  async operacion(p) {
    const q = (consulta: string) => db().request()
      .input('hoy', sql.DateTime, p.hoy).input('ayer', sql.DateTime, p.ayer).input('hace7', sql.DateTime, p.hace7)
      .input('mismaHoraAyer', sql.DateTime, p.mismaHoraAyer).input('desfase', sql.Int, p.desfase).input('dias', sql.Int, p.diasAviso)
      .query(consulta);
    const h = hoyLocalSql();

    const [dia, ayer, porHora, tendencia, camaras, cola, alertas, listas, movimientos, registrosAcceso] = await Promise.all([
      q(`SELECT ${CONTEOS} FROM DeteccionVehiculo WHERE ${BASE} AND fecha_hora_ingreso >= @hoy`),
      q(`SELECT COUNT(*) AS total FROM DeteccionVehiculo WHERE ${BASE} AND fecha_hora_ingreso >= @ayer AND fecha_hora_ingreso < @mismaHoraAyer`),
      q(`
        SELECT DATEPART(HOUR, DATEADD(MINUTE, @desfase, fecha_hora_ingreso)) AS hora, ${CONTEOS}
        FROM DeteccionVehiculo WHERE ${BASE} AND fecha_hora_ingreso >= @hoy
        GROUP BY DATEPART(HOUR, DATEADD(MINUTE, @desfase, fecha_hora_ingreso))`),
      q(`
        SELECT CAST(DATEADD(MINUTE, @desfase, fecha_hora_ingreso) AS DATE) AS fecha, ${CONTEOS}
        FROM DeteccionVehiculo WHERE ${BASE} AND fecha_hora_ingreso >= @hace7
        GROUP BY CAST(DATEADD(MINUTE, @desfase, fecha_hora_ingreso) AS DATE)`),
      q(`
        SELECT c.id, c.nombre, c.ubicacion, c.activa, c.estado, c.ultimo_ping, c.tiempo_respuesta_ms,
               (SELECT COUNT(*) FROM DeteccionVehiculo d WHERE d.camara_id = c.id AND d.fecha_hora_ingreso >= @hoy) AS detecciones_hoy
        FROM Camaras c ORDER BY c.nombre`),
      q(`SELECT COUNT(*) AS n FROM DeteccionVehiculo WHERE estado_validacion = 'pendiente_revision' AND validado_manualmente = 0`),
      q(`
        SELECT TOP 5 d.*, c.nombre AS camara_nombre, c.ubicacion AS camara_ubicacion, l.motivo AS alerta_motivo, l.nivel_alerta
        FROM DeteccionVehiculo d LEFT JOIN Camaras c ON c.id = d.camara_id LEFT JOIN ListaNegra l ON l.id = d.alerta_id
        WHERE d.estado_validacion = 'alerta' ORDER BY d.fecha_hora_ingreso DESC`),
      q(`
        SELECT
          (SELECT COUNT(*) FROM ListaBlanca WHERE activo = 1 AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= ${h})) AS autorizados_vigentes,
          (SELECT COUNT(*) FROM ListaBlanca WHERE activo = 1 AND fecha_vencimiento >= ${h}
             AND fecha_vencimiento <= DATEADD(DAY, @dias, ${h})) AS autorizados_por_vencer,
          (SELECT COUNT(*) FROM ListaBlanca WHERE activo = 1 AND fecha_vencimiento < ${h}) AS autorizados_vencidos,
            (SELECT COUNT(*) FROM ListaNegra WHERE activo = 1 AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= ${h})) AS alertas_vigentes`),
      // Balance del guardia sobre los ingresos de hoy (cualquier estado, como «Todos los accesos»):
      // entradas = siguen sin salida (bajan al registrar la salida), salidas = ya salieron;
      // entradas + salidas = ingresos. «dentro» conserva el criterio de Monitoreo (autorizados sin salida).
      q(`SELECT
          COALESCE(SUM(CASE WHEN fecha_hora_ingreso >= @hoy THEN 1 ELSE 0 END), 0) AS ingresos,
          COALESCE(SUM(CASE WHEN fecha_hora_ingreso >= @hoy AND fecha_hora_salida IS NULL THEN 1 ELSE 0 END), 0) AS entradas,
          COALESCE(SUM(CASE WHEN fecha_hora_ingreso >= @hoy AND fecha_hora_salida IS NOT NULL THEN 1 ELSE 0 END), 0) AS salidas,
          COALESCE(SUM(CASE WHEN estado_validacion = 'autorizado' AND fecha_hora_salida IS NULL THEN 1 ELSE 0 END), 0) AS dentro,
          COALESCE(SUM(CASE WHEN ${REGISTRO_COMPLETO_SQL} THEN 1 ELSE 0 END), 0) AS registros_completos
        FROM DeteccionVehiculo d WHERE ${BASE} AND COALESCE(tipo_movimiento, 'ingreso') = 'ingreso'`),
      // Mismo total histórico que /detecciones sin filtros: incluye ingresos y salidas,
      // cualquier validación y registros abiertos o cerrados, con la misma base del historial.
      q(`SELECT COUNT(*) AS registros_acceso FROM DeteccionVehiculo WHERE ${BASE}`),
    ]);

    return {
      movimientos: { ...movimientos.recordset[0], registros_acceso: registrosAcceso.recordset[0]?.registros_acceso ?? 0 },
      hoy: dia.recordset[0],
      ayer: ayer.recordset[0],
      porHora: porHora.recordset,
      tendencia: tendencia.recordset,
      camaras: camaras.recordset,
      cola: cola.recordset[0],
      alertas: alertas.recordset,
      listas: listas.recordset[0],
    };
  },

  async accesos(p) {
    const q = (consulta: string) => db().request()
      .input('hoy', sql.DateTime, p.hoy).input('hace7', sql.DateTime, p.hace7).input('dias', sql.Int, p.diasAviso)
      .input('uid', sql.Int, p.usuarioId)
      .query(consulta);
    const h = hoyLocalSql();

    const [solicitudes, padron, categorias] = await Promise.all([
      q(`
        SELECT TOP 5 s.id, s.placa, s.propietario, s.categoria, s.motivo, s.fecha_solicitud, u.nombre_completo AS solicitante,
               (SELECT COUNT(*) FROM SolicitudesAcceso WHERE estado = 'pendiente' AND solicitado_por <> @uid) AS total
        FROM SolicitudesAcceso s JOIN Usuarios u ON u.id = s.solicitado_por
        -- Separación de funciones: las solicitudes propias no son trabajo pendiente de quien las registró
        WHERE s.estado = 'pendiente' AND s.solicitado_por <> @uid ORDER BY s.fecha_solicitud`),
      q(`
        SELECT
          COUNT(*) AS total, SUM(CASE WHEN placa IS NULL THEN 1 ELSE 0 END) AS sin_placa,
          SUM(CASE WHEN (fecha_vencimiento IS NULL OR fecha_vencimiento >= ${h}) AND (fecha_inicio IS NULL OR fecha_inicio <= ${h}) THEN 1 ELSE 0 END) AS vigentes,
          SUM(CASE WHEN fecha_vencimiento >= ${h} AND fecha_vencimiento <= DATEADD(DAY, @dias, ${h}) THEN 1 ELSE 0 END) AS por_vencer,
          SUM(CASE WHEN fecha_vencimiento < ${h} THEN 1 ELSE 0 END) AS vencidos,
          SUM(CASE WHEN fecha_inicio > ${h} THEN 1 ELSE 0 END) AS por_iniciar,
          SUM(CASE WHEN horario IS NOT NULL THEN 1 ELSE 0 END) AS con_horario
        FROM ListaBlanca WHERE activo = 1 AND registrado_por = @uid`),
      q(`SELECT categoria, COUNT(*) AS n FROM ListaBlanca WHERE activo = 1 AND registrado_por = @uid GROUP BY categoria`),
    ]);

    return {
      solicitudes: solicitudes.recordset,
      padron: padron.recordset[0],
      categorias: categorias.recordset,
      denegados: {},
      reincidentes: [],
      recientes: [],
    };
  },

  async administracion() {
    const usuarios = await db().request().query(`
      SELECT r.codigo, u.estado, u.bloqueado,
             CASE WHEN u.bloqueado_hasta > SYSDATETIME() THEN 1 ELSE 0 END AS bloqueo_temporal, COUNT(*) AS n
      FROM Usuarios u JOIN Roles r ON r.id = u.rol_id
      GROUP BY r.codigo, u.estado, u.bloqueado, CASE WHEN u.bloqueado_hasta > SYSDATETIME() THEN 1 ELSE 0 END`);

    return {
      usuarios: usuarios.recordset,
    };
  },
};
