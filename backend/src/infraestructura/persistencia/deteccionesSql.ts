import sql, { PostgresRequest } from '../postgres';
import { getDB } from '../db';
import { DATOS_INGRESO_COMPLETOS_SQL, REGISTRO_COMPLETO_SQL } from './registroCompletoSql';
import type { Cruce, RepositorioDetecciones } from '../../aplicacion/detecciones';
import type { Decision } from '../../dominio/decisionAcceso';
import { FUENTE_VIDEO_PRUEBA, type FiltrosDetecciones, VENTANA_MISMO_PASO_S } from '../../dominio/detecciones';
import { guardarAtributosVehiculo, guardarMetadatosCaptura, type LecturaAutomatica, registrarLecturaAutomatica } from '../servicios/metadatosDeteccion';
import { desfaseMinutos } from '../servicios/tiempo';

/**
 * Repositorio SQL Server de los pasos vehiculares (DeteccionVehiculo), con la cámara, la alerta,
 * el permiso y la persona que validó, más los descartes del motor (AuditoriaDescartes).
 */

const SELECT_DETECCION = `
  SELECT d.*,
         c.nombre AS camara_nombre, c.ubicacion AS camara_ubicacion,
         l.motivo AS alerta_motivo, l.nivel_alerta,
         v.propietario, v.departamento, v.tipo_vehiculo AS autorizado_tipo, v.categoria AS autorizado_categoria,
         v.horario AS autorizado_horario, v.fecha_inicio AS autorizado_inicio, v.fecha_vencimiento AS autorizado_vence, v.marca AS autorizado_marca, v.modelo AS autorizado_modelo,
         v.cedula AS autorizado_cedula, v.institucion AS autorizado_institucion, v.cargo AS autorizado_cargo,
         v.motivo_ingreso AS autorizado_motivo,
         uv.nombre_completo AS validador_nombre, uv.email AS validador_email
  FROM DeteccionVehiculo d
  LEFT JOIN Camaras c ON c.id = d.camara_id
  LEFT JOIN ListaNegra l ON l.id = d.alerta_id
  LEFT JOIN VehiculosAutorizados v ON v.id = d.vehiculo_autorizado_id
  LEFT JOIN Usuarios uv ON uv.id = d.usuario_validador_id`;

/** Placa sin separadores, para comparar lecturas y correcciones. */
const PLACA_D = "REPLACE(COALESCE(d.placa_validada, d.placa_reconocida, ''), '-', '')";

/**
 * Forma canónica de una placa para la búsqueda aproximada: cada carácter que el OCR confunde se
 * reemplaza por el primero de su grupo (los mismos grupos de dominio/coincidenciaPlacas.ts:
 * 0ODQ, 1IL, 8B, 5S, 2Z, 6G, 4A, 7T).
 */
const canonica = (expr: string) => `TRANSLATE(${expr}, 'ODQILBSZGAT', '00011852647')`;

const sinTildes = (expr: string) => `TRANSLATE(LOWER(COALESCE(${expr}, '')), 'áéíóúüñ', 'aeiouun')`;

/** Segundos desde la medianoche local del ingreso (franja horaria del historial). */
const SEGUNDO_DEL_DIA = "EXTRACT(EPOCH FROM (d.fecha_hora_ingreso + (@desfase * INTERVAL '1 minute'))::time)";

const orden = (f: FiltrosDetecciones) => (f.orden === 'antiguo' ? 'd.fecha_hora_ingreso ASC, d.id ASC' : 'd.fecha_hora_ingreso DESC, d.id DESC');

const db = () => getDB();

/** Filtros del historial, la exportación y la eliminación masiva (ya validados en el dominio). */
function aplicarFiltros(f: FiltrosDetecciones, request: PostgresRequest): string[] {
  const w: string[] = [`d.estado_procesamiento IN ('procesado', 'no_legible', 'pendiente_ocr')`];
  if (f.completos !== undefined) w.push(`${f.completos ? '' : 'NOT '}${REGISTRO_COMPLETO_SQL}`);
  if (f.cerrados !== undefined) {
    w.push("COALESCE(d.tipo_movimiento, 'ingreso') = 'ingreso'");
    w.push(`d.fecha_hora_salida IS ${f.cerrados ? 'NOT ' : ''}NULL`);
  }
  if (f.placa) {
    request.input('placa', sql.VarChar(22), `%${f.placa}%`);
    w.push(f.aproximada ? `${canonica(PLACA_D)} LIKE ${canonica('@placa')}` : `${PLACA_D} LIKE @placa`);
  }
  if (f.buscar) {
    request.input('buscar', sql.NVarChar(102), `%${f.buscar}%`);
    // Sin distinguir tildes ni mayúsculas: «maria perez» encuentra a «María Pérez»
    const texto = (e: string) => `${sinTildes(e)} LIKE ${sinTildes('@buscar')}`;
    w.push(`(${PLACA_D} ILIKE REPLACE(@buscar, '-', '')
      OR ${texto('d.persona_ingreso')} OR ${texto('d.motivo_ingreso')}
      OR ${texto('d.vehiculo_marca')} OR ${texto('d.vehiculo_modelo')}
      OR d.datos_permiso->>'cedula' LIKE @buscar
      OR EXISTS (SELECT 1 FROM VehiculosAutorizados permiso_busqueda
        WHERE permiso_busqueda.id = d.vehiculo_autorizado_id
          AND (${texto('permiso_busqueda.propietario')} OR permiso_busqueda.cedula LIKE @buscar)))`);
  }
  if (f.movimiento) w.push(`COALESCE(d.tipo_movimiento, 'ingreso') = '${f.movimiento === 'salida' ? 'salida' : 'ingreso'}'`);
  if (f.origen === 'manual') w.push("d.fuente = 'manual'");
  else if (f.origen === 'video') w.push(`d.fuente = '${FUENTE_VIDEO_PRUEBA}'`);
  else if (f.origen === 'camara') w.push(`COALESCE(d.fuente, 'rtsp') NOT IN ('manual', '${FUENTE_VIDEO_PRUEBA}')`);
  if (f.horaDesde !== undefined || f.horaHasta !== undefined) {
    // Franja en hora local; "hasta" incluye su minuto completo y 22:00–06:00 cruza la medianoche
    request.input('desfase', sql.Int, desfaseMinutos());
    const desde = f.horaDesde !== undefined ? `${SEGUNDO_DEL_DIA} >= ${f.horaDesde * 60}` : null;
    const hasta = f.horaHasta !== undefined ? `${SEGUNDO_DEL_DIA} < ${(f.horaHasta + 1) * 60}` : null;
    const cruza = desde && hasta && f.horaDesde! > f.horaHasta!;
    w.push(cruza ? `(${desde} OR ${hasta})` : [desde, hasta].filter(Boolean).join(' AND '));
  }
  if (f.estados.length) {
    f.estados.forEach((e, i) => request.input(`est${i}`, sql.VarChar(30), e));
    w.push(`d.estado_validacion IN (${f.estados.map((_, i) => `@est${i}`).join(',')})`);
  }
  if (f.camara !== null) {
    request.input('camara', sql.Int, f.camara);
    w.push('d.camara_id = @camara');
  }
  if (f.validado !== null) w.push(`d.validado_manualmente = ${f.validado ? 1 : 0}`);
  if (f.desde) {
    request.input('desde', sql.DateTime, f.desde);
    w.push('d.fecha_hora_ingreso >= @desde');
  }
  if (f.hasta) {
    request.input('hasta', sql.DateTime, f.hasta);
    w.push('d.fecha_hora_ingreso <= @hasta');
  }
  return w;
}

/** Decisión sobre el paso: estado, vínculos con las listas y restricción temporal. */
function parametrosDecision(request: PostgresRequest, cruce: Cruce, decision: Decision): PostgresRequest {
  return request
    .input('estado', sql.VarChar(30), decision.estado)
    .input('alerta', sql.Int, cruce.alerta?.id ?? null)
    .input('autorizado', sql.Int, cruce.permiso?.id ?? null)
    .input('restriccion', sql.VarChar(30), decision.restriccion);
}

export const repositorioDeteccionesSql: RepositorioDetecciones = {
  async obtener(id) {
    const r = await db().request().input('id', sql.Int, id).query(`${SELECT_DETECCION} WHERE d.id = @id`);
    return r.recordset[0] ?? null;
  },

  /**
   * Ingreso del mismo paso físico: misma placa (o, sin placa, el mismo tracking) en la misma cámara
   * dentro de la ventana, medida en milisegundos igual que en el motor. El tracking solo cuenta sin
   * placa: sus números vuelven a empezar cuando el motor se reinicia y podrían ser de otro vehículo.
   */
  async mismoPaso(trackingId, pista, camaraId, tipoMovimiento) {
    const r = await db().request()
      .input('tid', sql.Int, trackingId)
      .input('placa', sql.VarChar(20), pista)
      .input('camara', sql.Int, camaraId)
      .input('movimiento', sql.VarChar(10), tipoMovimiento)
      .input('ventana', sql.Int, VENTANA_MISMO_PASO_S * 1000)
      .query(`
        SELECT TOP 1 id, fecha_hora_ingreso FROM DeteccionVehiculo
        WHERE ((LEN(@placa) < 4 AND tracking_id = @tid AND @tid > 0)
               OR (LEN(@placa) >= 4 AND REPLACE(REPLACE(COALESCE(placa_reconocida, ''), '-', ''), ' ', '') = @placa))
          AND ((camara_id = @camara) OR (camara_id IS NULL AND @camara IS NULL))
          AND tipo_movimiento = @movimiento
          AND estado_procesamiento IN ('pendiente_ocr', 'procesado')
          AND fecha_hora_ingreso > DATEADD(MILLISECOND, -@ventana, GETDATE())
        ORDER BY fecha_hora_ingreso DESC`);
    return r.recordset[0] ?? null;
  },

  async existeCamara(id) {
    const r = await db().request().input('cid', sql.Int, id).query('SELECT id FROM Camaras WHERE id = @cid');
    return r.recordset.length > 0;
  },

  async direccionCamara(id) {
    const r = await db().request().input('id', sql.Int, id).query('SELECT direccion FROM Camaras WHERE id = @id');
    const direccion = r.recordset[0]?.direccion;
    return direccion === 'salida' ? 'salida' : direccion === 'ingreso' ? 'ingreso' : null;
  },

  async crearIngreso(n) {
    const r = await db().request()
      .input('tid', sql.Int, n.trackingId)
      .input('pista', sql.VarChar(20), n.pista)
      .input('ruta', sql.VarChar(255), n.ruta)
      .input('conf', sql.Float, n.confianza)
      .input('fuente', sql.VarChar(255), n.fuente)
      .input('camara', sql.Int, n.camaraId)
      .input('movimiento', sql.VarChar(10), n.tipoMovimiento)
      .query(`
        INSERT INTO DeteccionVehiculo (tracking_id, placa_reconocida, ruta_imagen_ingreso, confianza_deteccion, fuente,
                                       camara_id, tipo_movimiento, estado_procesamiento, estado_validacion, fecha_hora_ingreso)
        OUTPUT INSERTED.id, INSERTED.fecha_hora_ingreso
        VALUES (@tid, @pista, @ruta, @conf,
                -- Una cámara de prueba (video cargado) no es el flujo real: su origen queda guardado en el paso
                CASE WHEN EXISTS (SELECT 1 FROM Camaras WHERE id = @camara AND rtsp_url LIKE 'video://%') THEN '${FUENTE_VIDEO_PRUEBA}' ELSE @fuente END,
                @camara, @movimiento, 'pendiente_ocr', 'pendiente_revision', GETDATE())`);
    return r.recordset[0];
  },

  async guardarSalida(id, lectura) {
    await db().request()
      .input('id', sql.Int, id)
      .input('placa', sql.VarChar(20), lectura.placa)
      .input('confianza', sql.Float, lectura.confianza)
      .input('ruta', sql.VarChar(255), lectura.rutaPlaca)
      .query(`UPDATE DeteccionVehiculo SET
          placa_reconocida = @placa, confianza_ocr = @confianza,
          ruta_imagen_placa = COALESCE(@ruta, ruta_imagen_placa),
          fecha_hora_procesamiento = GETDATE(), estado_procesamiento = 'procesado',
          estado_validacion = 'salida_registrada', decision_automatica = 'salida_registrada',
          alerta_id = NULL, vehiculo_autorizado_id = NULL, restriccion_acceso = NULL
        WHERE id = @id AND tipo_movimiento = 'salida'`);
  },

  async validarSalida(id, lectura) {
    await db().request()
      .input('id', sql.Int, id)
      .input('placa', sql.VarChar(20), lectura.placa)
      .input('usuario', sql.Int, lectura.usuarioId)
      .query(`UPDATE DeteccionVehiculo SET
          placa_validada = @placa, validado_manualmente = 1, usuario_validador_id = @usuario,
          fecha_validacion = GETDATE(), estado_procesamiento = 'procesado',
          estado_validacion = 'salida_registrada', decision_automatica = COALESCE(decision_automatica, 'salida_registrada'),
          alerta_id = NULL, vehiculo_autorizado_id = NULL, restriccion_acceso = NULL
        WHERE id = @id AND tipo_movimiento = 'salida'`);
  },

  async crearSalidaManual({ placa, camaraId, usuarioId, rutaImagen }) {
    const r = await db().request()
      .input('placa', sql.VarChar(20), placa)
      .input('camara', sql.Int, camaraId)
      .input('usuario', sql.Int, usuarioId)
      .input('ruta', sql.VarChar(255), rutaImagen ?? null)
      .query(`INSERT INTO DeteccionVehiculo (
          placa_reconocida, placa_validada, camara_id, tipo_movimiento, fuente, fecha_hora_ingreso,
          fecha_hora_procesamiento, estado_procesamiento, estado_validacion, decision_automatica,
          validado_manualmente, usuario_validador_id, fecha_validacion, ruta_imagen_ingreso
        )
        OUTPUT INSERTED.id
        VALUES (@placa, @placa, @camara, 'salida', 'manual', GETDATE(), GETDATE(),
                'procesado', 'salida_registrada', 'salida_registrada', TRUE, @usuario, GETDATE(), @ruta)`);
    return r.recordset[0].id;
  },

  async guardarDatosIngreso(id, x) {
    const request = db().request().input('id', sql.Int, id);
    const campos: string[] = [];
    // La edición de una celda actualiza únicamente ese dato del registro, sin reemplazar la ficha
    // ni modificar el permiso de lista blanca. Se mantienen coherentes las copias del formulario.
    const ficha = { ...x.datosPermiso };
    if (x.cedula !== undefined) ficha.cedula = x.cedula;
    if (x.persona !== undefined) ficha.propietario = x.persona;
    if (x.tipo !== undefined) ficha.tipo_vehiculo = x.tipo;
    if (x.marca !== undefined) ficha.marca = x.marca;
    if (x.modelo !== undefined) ficha.modelo = x.modelo;
    if (x.color !== undefined) ficha.color = x.color;
    if (Object.keys(ficha).length) {
      request.input('datosPermiso', sql.NVarChar(10000), JSON.stringify(ficha));
      campos.push("datos_permiso = COALESCE(datos_permiso, '{}'::jsonb) || CAST(@datosPermiso AS jsonb)");
    }
    if (x.persona !== undefined) { request.input('persona', sql.VarChar(150), x.persona); campos.push('persona_ingreso = @persona'); }
    if (x.motivo !== undefined) { request.input('motivo', sql.VarChar(300), x.motivo); campos.push('motivo_ingreso = @motivo'); }
    if (x.tipo !== undefined) { request.input('tipo', sql.VarChar(50), x.tipo); campos.push('vehiculo_tipo = @tipo'); campos.push('tipo_vehiculo = @tipo'); }
    if (x.marca !== undefined) { request.input('marca', sql.VarChar(50), x.marca); campos.push('vehiculo_marca = @marca'); }
    if (x.modelo !== undefined) { request.input('modelo', sql.VarChar(50), x.modelo); campos.push('vehiculo_modelo = @modelo'); }
    if (x.color !== undefined) { request.input('color', sql.VarChar(30), x.color); campos.push('vehiculo_color = @color'); }
    if (campos.length) await request.query(`UPDATE DeteccionVehiculo SET ${campos.join(', ')} WHERE id = @id`);
  },

  async autorizarIngresoSinPlaca(id, usuarioId) {
    const crear = await db().request().input('id', sql.Int, id).input('usuario', sql.Int, usuarioId).query(`
      INSERT INTO VehiculosAutorizados
        (placa, propietario, tipo_vehiculo, marca, modelo, color, categoria, registrado_por, activo, fecha_registro)
      SELECT NULL, d.persona_ingreso, d.tipo_vehiculo, d.vehiculo_marca, d.vehiculo_modelo, d.vehiculo_color,
             'FUNCIONARIO', @usuario, TRUE, CURRENT_TIMESTAMP
      FROM DeteccionVehiculo d
      WHERE d.id = @id
        AND d.persona_ingreso IS NOT NULL
        AND d.tipo_vehiculo IS NOT NULL
        AND d.vehiculo_marca IS NOT NULL
        AND d.vehiculo_modelo IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM VehiculosAutorizados v
          WHERE v.activo = TRUE AND v.placa IS NULL
            AND v.propietario = d.persona_ingreso
            AND v.tipo_vehiculo = d.tipo_vehiculo
            AND v.marca = d.vehiculo_marca
            AND v.modelo = d.vehiculo_modelo
        )
      RETURNING id`);
    const permisoId = crear.recordset[0]?.id ?? (await db().request()
      .input('id', sql.Int, id)
      .query(`
        SELECT v.id
        FROM VehiculosAutorizados v
        JOIN DeteccionVehiculo d
          ON v.placa IS NULL
         AND v.propietario = d.persona_ingreso
         AND v.tipo_vehiculo = d.tipo_vehiculo
         AND v.marca = d.vehiculo_marca
         AND v.modelo = d.vehiculo_modelo
        WHERE d.id = @id AND v.activo = TRUE
        ORDER BY v.id DESC LIMIT 1`)).recordset[0]?.id;
    if (!permisoId) return;
    await db().request().input('id', sql.Int, id).input('usuario', sql.Int, usuarioId).input('permiso', sql.Int, permisoId).query(`
      UPDATE DeteccionVehiculo d
      SET estado_validacion = 'autorizado',
          estado_procesamiento = 'procesado',
          decision_automatica = COALESCE(decision_automatica, 'autorizado'),
          validado_manualmente = 1,
          usuario_validador_id = @usuario,
          fecha_validacion = GETDATE(),
          vehiculo_autorizado_id = @permiso
      WHERE d.id = @id
        AND d.placa IS NULL AND d.placa_reconocida IS NULL AND d.placa_validada IS NULL`);
  },

  guardarMetadatos: (id, metadatos) => guardarMetadatosCaptura(db(), id, metadatos as never),

  guardarVehiculo: (id, vehiculo) => guardarAtributosVehiculo(db(), id, vehiculo as never),

  registrarLecturaAutomatica: (id, l) => registrarLecturaAutomatica(db(), id, l as LecturaAutomatica),

  async marcarNoLegible(id, rutaPlaca) {
    await db().request()
      .input('id', sql.Int, id)
      .input('ruta', sql.VarChar(255), rutaPlaca)
      .query(`
        UPDATE DeteccionVehiculo SET
          placa_reconocida = NULL, confianza_ocr = NULL,
          alerta_id = NULL, vehiculo_autorizado_id = NULL, restriccion_acceso = NULL,
          verificacion_vehiculo = NULL, verificacion_detalle = NULL,
          ruta_imagen_placa = COALESCE(@ruta, ruta_imagen_placa, ruta_imagen_ingreso),
          fecha_hora_procesamiento = GETDATE(),
          estado_procesamiento = 'no_legible', estado_validacion = 'pendiente_revision'
        WHERE id = @id`);
  },

  /** Otro paso ya procesado con la misma placa, en la misma cámara y dentro de la ventana. */
  async pasoProcesadoConPlaca(idExcluido, placa, camaraId, tipoMovimiento) {
    const r = await db().request()
      .input('id', sql.Int, idExcluido)
      .input('placa', sql.VarChar(20), placa)
      .input('camara', sql.Int, camaraId)
      .input('movimiento', sql.VarChar(10), tipoMovimiento)
      .input('ventana', sql.Int, VENTANA_MISMO_PASO_S * 1000)
      .query(`
        SELECT TOP 1 id FROM DeteccionVehiculo
        WHERE id <> @id AND estado_procesamiento = 'procesado'
          AND REPLACE(REPLACE(COALESCE(placa_reconocida, ''), '-', ''), ' ', '') = @placa
          AND ((camara_id = @camara) OR (camara_id IS NULL AND @camara IS NULL))
          AND tipo_movimiento = @movimiento
          AND fecha_hora_ingreso > DATEADD(MILLISECOND, -@ventana, GETDATE())
        ORDER BY fecha_hora_ingreso DESC`);
    return r.recordset[0]?.id ?? null;
  },

  async eliminarPendiente(id) {
    await db().request().input('id', sql.Int, id)
      .query(`DELETE FROM DeteccionVehiculo WHERE id = @id AND estado_procesamiento = 'pendiente_ocr'`);
  },

  async guardarVeredicto(id, valida, evidencia) {
    await db().request()
      .input('id', sql.Int, id)
      .input('valida', sql.Bit, valida)
      .input('evidencia', sql.NVarChar(1500), evidencia)
      .query('UPDATE DeteccionVehiculo SET lectura_valida = @valida, evidencia_lectura = @evidencia WHERE id = @id');
  },

  async observacion(id) {
    const r = await db().request().input('id', sql.Int, id).query(`
      SELECT confianza_deteccion, fecha_hora_ingreso, vehiculo_marca AS marca, vehiculo_color AS color, vehiculo_tipo AS tipo
      FROM DeteccionVehiculo WHERE id = @id`);
    return r.recordset[0] ?? null;
  },

  async guardarVerificacion(id, resultado, detalle) {
    await db().request()
      .input('id', sql.Int, id)
      .input('res', sql.VarChar(20), resultado)
      .input('det', sql.VarChar(255), detalle)
      .query('UPDATE DeteccionVehiculo SET verificacion_vehiculo = @res, verificacion_detalle = @det WHERE id = @id');
  },

  async guardarDecisionAutomatica(id, x, cruce, decision) {
    await parametrosDecision(db().request(), cruce, decision)
      .input('id', sql.Int, id)
      .input('placa', sql.VarChar(20), x.placa || null)
      .input('conf', sql.Float, x.confianza)
      .input('ruta', sql.VarChar(255), x.rutaPlaca)
      .input('tipo', sql.VarChar(50), x.tipo)
      .query(`
        UPDATE DeteccionVehiculo SET
          placa_reconocida = @placa, confianza_ocr = @conf,
          ruta_imagen_placa = COALESCE(@ruta, ruta_imagen_placa),
          fecha_hora_procesamiento = GETDATE(), estado_procesamiento = 'procesado',
          estado_validacion = @estado, alerta_id = @alerta, vehiculo_autorizado_id = @autorizado,
          restriccion_acceso = @restriccion, tipo_vehiculo = COALESCE(@tipo, tipo_vehiculo)
        WHERE id = @id`);
  },

  async registrarDescarte(x) {
    await db().request()
      .input('tid', sql.Int, x.trackingId)
      .input('motivo', sql.VarChar(100), x.motivo)
      .input('texto', sql.VarChar(50), x.texto)
      .input('conf', sql.Float, x.confianza)
      .input('fuente', sql.VarChar(255), x.fuente)
      .input('camara', sql.Int, x.camaraId)
      .query(`INSERT INTO AuditoriaDescartes (tracking_id, motivo, texto_candidato, confianza, fuente, camara_id)
              VALUES (@tid, @motivo, @texto, @conf, @fuente, @camara)`);
  },

  async contar(f) {
    const request = db().request();
    const w = aplicarFiltros(f, request);
    return (await request.query(`SELECT COUNT(*) AS n FROM DeteccionVehiculo d WHERE ${w.join(' AND ')}`)).recordset[0].n;
  },

  async pagina(f, offset, tamano) {
    const request = db().request();
    const w = aplicarFiltros(f, request);
    request.input('offset', sql.Int, offset).input('tamano', sql.Int, tamano);
    const r = await request.query(`${SELECT_DETECCION} WHERE ${w.join(' AND ')}
      ORDER BY ${orden(f)} LIMIT @tamano OFFSET @offset`);
    return r.recordset;
  },

  /** Totales del historial con los mismos filtros: estados, movimientos, origen, placas distintas y período. */
  async resumenHistorial(f) {
    const request = db().request();
    const w = aplicarFiltros(f, request);
    const r = await request.query(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN COALESCE(d.tipo_movimiento, 'ingreso') = 'ingreso' THEN 1 ELSE 0 END) AS ingresos,
        SUM(CASE WHEN d.tipo_movimiento = 'salida' THEN 1 ELSE 0 END) AS salidas,
        SUM(CASE WHEN d.fecha_hora_salida IS NOT NULL THEN 1 ELSE 0 END) AS con_salida,
        SUM(CASE WHEN d.estado_validacion = 'autorizado' THEN 1 ELSE 0 END) AS autorizados,
        SUM(CASE WHEN d.estado_validacion = 'alerta' THEN 1 ELSE 0 END) AS alertas,
        SUM(CASE WHEN d.estado_validacion = 'no_reconocido' THEN 1 ELSE 0 END) AS no_registrados,
        SUM(CASE WHEN d.estado_validacion = 'pendiente_revision' OR d.estado_procesamiento = 'pendiente_ocr' THEN 1 ELSE 0 END) AS pendientes,
        SUM(CASE WHEN ${PLACA_D} = '' THEN 1 ELSE 0 END) AS sin_lectura,
        COUNT(DISTINCT NULLIF(${PLACA_D}, '')) AS placas,
        SUM(CASE WHEN d.fuente = 'manual' THEN 1 ELSE 0 END) AS manuales,
        SUM(CASE WHEN d.fuente = '${FUENTE_VIDEO_PRUEBA}' THEN 1 ELSE 0 END) AS video_prueba,
        MIN(d.fecha_hora_ingreso) AS primero, MAX(d.fecha_hora_ingreso) AS ultimo
      FROM DeteccionVehiculo d WHERE ${w.join(' AND ')}`);
    const x = r.recordset[0] ?? {};
    const n = (v: unknown) => Number(v ?? 0);
    return {
      total: n(x.total), ingresos: n(x.ingresos), salidas: n(x.salidas), con_salida: n(x.con_salida),
      autorizados: n(x.autorizados), alertas: n(x.alertas), no_registrados: n(x.no_registrados), pendientes: n(x.pendientes),
      sin_lectura: n(x.sin_lectura), placas: n(x.placas), manuales: n(x.manuales), video_prueba: n(x.video_prueba),
      camara: n(x.total) - n(x.manuales) - n(x.video_prueba),
      primero: x.primero ?? null, ultimo: x.ultimo ?? null,
    };
  },

  async recientes(limite, buscar) {
    const request = db().request().input('n', sql.Int, limite);
    const filtro = buscar
      ? (request.input('buscar', sql.NVarChar(100), `%${buscar}%`),
        `AND (
          REPLACE(COALESCE(d.placa_validada, d.placa_reconocida, ''), '-', '') ILIKE @buscar
          OR translate(lower(COALESCE(v.propietario, '')), 'áéíóúüñ', 'aeiouun') LIKE translate(lower(@buscar), 'áéíóúüñ', 'aeiouun')
          OR translate(lower(COALESCE(d.persona_ingreso, '')), 'áéíóúüñ', 'aeiouun') LIKE translate(lower(@buscar), 'áéíóúüñ', 'aeiouun')
        )`)
      : '';
    const r = await request.query(`
      ${SELECT_DETECCION}
      WHERE d.estado_procesamiento IN ('procesado', 'no_legible', 'pendiente_ocr')
        AND COALESCE(d.tipo_movimiento, 'ingreso') = 'ingreso' AND NOT ${REGISTRO_COMPLETO_SQL}
        ${filtro}
      ORDER BY d.fecha_hora_ingreso DESC LIMIT @n`);
    return r.recordset;
  },

  async registrarSalida(id) {
    const r = await db().request().input('id', sql.Int, id).query(`
      UPDATE DeteccionVehiculo d
      SET fecha_hora_salida = CURRENT_TIMESTAMP
      WHERE d.id = @id AND COALESCE(d.tipo_movimiento, 'ingreso') = 'ingreso' AND d.fecha_hora_salida IS NULL
        AND ${DATOS_INGRESO_COMPLETOS_SQL} AND d.fecha_hora_ingreso <= CURRENT_TIMESTAMP
      RETURNING id`);
    return r.recordset.length > 0;
  },

  async exportar(f) {
    const request = db().request();
    const w = aplicarFiltros(f, request);
    return (await request.query(`${SELECT_DETECCION} WHERE ${w.join(' AND ')} ORDER BY ${orden(f)}`)).recordset;
  },

  async historialPlaca(placa, excluirId) {
    const request = db().request().input('placa', sql.VarChar(20), placa);
    if (excluirId !== undefined) request.input('id', sql.Int, excluirId);
    const r = await request.query(`
      ${SELECT_DETECCION}
      WHERE ${excluirId !== undefined ? 'd.id <> @id AND ' : ''}${PLACA_D} = @placa
      ORDER BY d.fecha_hora_ingreso DESC LIMIT 10`);
    return r.recordset;
  },

  async auditoriaDe(id) {
    const r = await db().request().input('id', sql.Int, id).query(`
      SELECT fecha, accion, usuario_email, detalle FROM AuditoriaOperaciones
      WHERE entidad = 'deteccion' AND entidad_id = @id ORDER BY fecha DESC`);
    return r.recordset;
  },

  async guardarValidacion(id, x, cruce, decision) {
    await parametrosDecision(db().request(), cruce, decision)
      .input('id', sql.Int, id)
      .input('placa', sql.VarChar(20), x.placa)
      .input('tipo', sql.VarChar(50), x.tipo)
      .input('usuario', sql.Int, x.usuarioId)
      .query(`
        UPDATE DeteccionVehiculo SET
          -- Conserva la lectura y decisión automáticas (métricas de evaluación)
          placa_ocr_original = COALESCE(placa_ocr_original, placa_reconocida),
          decision_automatica = COALESCE(decision_automatica, estado_validacion),
          validado_manualmente = 1, placa_validada = @placa, usuario_validador_id = @usuario, fecha_validacion = GETDATE(),
          estado_procesamiento = 'procesado', estado_validacion = @estado,
          alerta_id = @alerta, vehiculo_autorizado_id = @autorizado, restriccion_acceso = @restriccion,
          tipo_vehiculo = COALESCE(@tipo, tipo_vehiculo)
        WHERE id = @id`);
  },

  async crearManual(x, cruce, decision) {
    const r = await parametrosDecision(db().request(), cruce, decision)
      .input('placa', sql.VarChar(20), x.placa)
      .input('camara', sql.Int, x.camaraId)
      .input('tipo', sql.VarChar(50), x.tipo)
      .input('marca', sql.VarChar(50), x.marca)
      .input('usuario', sql.Int, x.usuarioId)
      .input('ruta', sql.VarChar(255), x.rutaImagen ?? null)
      .query(`
        INSERT INTO DeteccionVehiculo (placa_reconocida, placa_validada, fuente, camara_id, estado_procesamiento, estado_validacion,
                                       alerta_id, vehiculo_autorizado_id, restriccion_acceso, tipo_vehiculo, validado_manualmente,
                                       usuario_validador_id, fecha_validacion, fecha_hora_ingreso, fecha_hora_procesamiento, decision_automatica,
                                       ruta_imagen_ingreso, vehiculo_tipo, vehiculo_marca)
        OUTPUT INSERTED.id
        VALUES (NULL, @placa, 'manual', @camara, 'procesado', @estado, @alerta, @autorizado, @restriccion, @tipo, 1, @usuario,
                GETDATE(), GETDATE(), GETDATE(), 'manual', @ruta, @tipo, @marca)`);
    return r.recordset[0].id;
  },

  async eliminar(id) {
    await db().request().input('id', sql.Int, id).query('DELETE FROM DeteccionVehiculo WHERE id = @id');
  },

  async eliminarFiltradas(f) {
    const request = db().request();
    const w = f ? aplicarFiltros(f, request) : ['1 = 1'];
    const r = await request.query(`
      WITH eliminadas AS (
        DELETE FROM DeteccionVehiculo d
        WHERE ${w.join(' AND ')}
        RETURNING d.id, d.ruta_imagen_ingreso, d.ruta_imagen_placa
      )
      SELECT id, ruta_imagen_ingreso, ruta_imagen_placa FROM eliminadas`);
    return r.recordset;
  },
};
