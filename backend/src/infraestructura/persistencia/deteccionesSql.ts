import sql, { PostgresRequest } from '../postgres';
import { getDB } from '../db';
import { DATOS_INGRESO_COMPLETOS_SQL, REGISTRO_COMPLETO_SQL } from './registroCompletoSql';
import type { Cruce, RepositorioDetecciones } from '../../aplicacion/detecciones';
import type { Decision } from '../../dominio/decisionAcceso';
import { type FiltrosDetecciones, palabrasBusqueda, VENTANA_MISMO_PASO_S } from '../../dominio/detecciones';
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
  LEFT JOIN ListaBlanca v ON v.id = d.vehiculo_autorizado_id
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

/** Hora local (Ecuador) del paso: los días, días de la semana y horas del análisis del historial. */
const HORA_LOCAL = "(d.fecha_hora_ingreso + (@desfase * INTERVAL '1 minute'))";

/** Solo ingresos: el análisis cuenta entradas (la salida de un ingreso va en su misma fila). */
const ES_INGRESO = "COALESCE(d.tipo_movimiento, 'ingreso') = 'ingreso'";

/**
 * Clase del ingreso en los gráficos por estado: una sola por fila, para que las series sumen el total
 * (una lista negra cuenta como alerta aunque se haya autorizado después).
 */
const CLASE_ESTADO = `CASE WHEN d.estado_validacion = 'alerta' THEN 'alertas'
  WHEN d.estado_validacion = 'autorizado' THEN 'autorizados'
  WHEN d.estado_validacion = 'no_reconocido' THEN 'no_registrados' ELSE 'pendientes' END`;

/** Nombre de la persona del paso: quien ingresó o, si no se anotó, el titular de su permiso. */
const PERSONA_D = `COALESCE(NULLIF(TRIM(d.persona_ingreso), ''),
  (SELECT NULLIF(TRIM(p.propietario), '') FROM ListaBlanca p WHERE p.id = d.vehiculo_autorizado_id))`;

const orden = (f: FiltrosDetecciones) => (f.orden === 'antiguo' ? 'd.fecha_hora_ingreso ASC, d.id ASC' : 'd.fecha_hora_ingreso DESC, d.id DESC');

const db = () => getDB();

// Lote corto: entre lotes el hilo atiende a las demás peticiones
const LOTE_EXPORTACION = 500;

/** Una palabra de la búsqueda en alguno de los datos del paso (sin tildes ni mayúsculas). */
function coincidePalabra(parametro: string): string {
  const texto = (e: string) => `${sinTildes(e)} LIKE ${sinTildes(parametro)}`;
  return `(${texto('d.persona_ingreso')} OR ${texto('d.motivo_ingreso')}
      OR ${texto('d.vehiculo_marca')} OR ${texto('d.vehiculo_modelo')}
      OR d.cedula_ingreso LIKE ${parametro}
      OR EXISTS (SELECT 1 FROM ListaBlanca permiso_busqueda
        WHERE permiso_busqueda.id = d.vehiculo_autorizado_id
          AND (${texto('permiso_busqueda.propietario')} OR permiso_busqueda.cedula LIKE ${parametro})))`;
}

/** Filtros del historial, la exportación y la eliminación masiva (ya validados en el dominio). */
function aplicarFiltros(f: FiltrosDetecciones, request: PostgresRequest): string[] {
  const w: string[] = [`d.estado_procesamiento IN ('procesado', 'no_legible', 'pendiente_ocr')`];
  if (f.completos !== undefined) w.push(`${f.completos ? '' : 'NOT '}${REGISTRO_COMPLETO_SQL}`);
  if (f.cerrados !== undefined) {
    w.push("COALESCE(d.tipo_movimiento, 'ingreso') = 'ingreso'");
    w.push(`d.fecha_hora_salida IS ${f.cerrados ? 'NOT ' : ''}NULL`);
  }
  if (f.placa) {
    request.input('placa', sql.VarChar(22), f.exacta ? f.placa : `%${f.placa}%`);
    w.push(f.aproximada ? `${canonica(PLACA_D)} LIKE ${canonica('@placa')}` : f.exacta ? `${PLACA_D} = @placa` : `${PLACA_D} LIKE @placa`);
  }
  if (f.buscar) {
    request.input('buscar', sql.NVarChar(102), `%${f.buscar}%`);
    // Sin distinguir tildes ni mayúsculas, y cada palabra en cualquier campo y orden: «maria perez» y
    // «perez maria» encuentran a «María José Pérez López». La placa se compara con el texto completo.
    const palabras = palabrasBusqueda(f.buscar);
    const bloques = palabras.length > 1
      ? palabras.map((p, i) => (request.input(`buscar${i}`, sql.NVarChar(102), `%${p}%`), coincidePalabra(`@buscar${i}`)))
      : [coincidePalabra('@buscar')];
    w.push(`(${PLACA_D} ILIKE REPLACE(@buscar, '-', '') OR (${bloques.join(' AND ')}))`);
  }
  if (f.persona) {
    // Solo los datos de la persona: nombres y apellidos o cédula de quien ingresó o del titular del permiso
    const bloques = palabrasBusqueda(f.persona).map((p, i) => {
      request.input(`persona${i}`, sql.NVarChar(102), `%${p}%`);
      const v = `@persona${i}`;
      return `(${sinTildes('d.persona_ingreso')} LIKE ${sinTildes(v)} OR d.cedula_ingreso LIKE ${v}
        OR EXISTS (SELECT 1 FROM ListaBlanca permiso_persona WHERE permiso_persona.id = d.vehiculo_autorizado_id
          AND (${sinTildes('permiso_persona.propietario')} LIKE ${sinTildes(v)} OR permiso_persona.cedula LIKE ${v})))`;
    });
    w.push(`(${bloques.join(' AND ')})`);
  }
  if (f.movimiento) w.push(`COALESCE(d.tipo_movimiento, 'ingreso') = '${f.movimiento === 'salida' ? 'salida' : 'ingreso'}'`);
  // Una salida que ya cerró un ingreso se muestra en la fila de ese ingreso, no como otra fila
  if (f.unirSalidas) w.push("NOT (d.tipo_movimiento = 'salida' AND EXISTS (SELECT 1 FROM DeteccionVehiculo i WHERE i.salida_deteccion_id = d.id))");
  if (f.origen === 'manual') w.push("d.fuente = 'manual'");
  else if (f.origen === 'camara') w.push("COALESCE(d.fuente, 'rtsp') <> 'manual'");
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
        VALUES (@tid, @pista, @ruta, @conf, @fuente, @camara, @movimiento, 'pendiente_ocr', 'pendiente_revision', GETDATE())`);
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
          placa_ocr_original = COALESCE(placa_ocr_original, placa_reconocida),
          placa_reconocida = CASE WHEN CAST(@placa AS varchar(20)) IS NULL THEN NULL ELSE placa_reconocida END,
          placa_validada = CAST(@placa AS varchar(20)), validado_manualmente = 1, usuario_validador_id = @usuario,
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
    const poner = (columna: string, tipo: unknown, valor: string | null) => {
      request.input(columna, tipo, valor);
      campos.push(`${columna} = @${columna}`);
    };
    // La edición de una celda actualiza únicamente ese dato del registro, sin modificar el permiso de
    // lista blanca. En los datos que también tiene el permiso, '' = vaciado a propósito: no se repone
    // del permiso al presentarlo (NULL = nunca escrito; ver presentacionDetecciones.ts)
    const vaciable = (v: string | null) => v ?? '';
    if (x.cedula !== undefined) poner('cedula_ingreso', sql.VarChar(10), vaciable(x.cedula));
    if (x.ficha) {
      poner('institucion_ingreso', sql.VarChar(150), vaciable(x.ficha.institucion));
      poner('cargo_ingreso', sql.VarChar(150), vaciable(x.ficha.cargo));
      poner('departamento_ingreso', sql.VarChar(100), vaciable(x.ficha.departamento));
      poner('categoria_permiso', sql.VarChar(20), x.ficha.categoria);
      poner('observaciones_permiso', sql.VarChar(255), x.ficha.observaciones);
      poner('vigencia_desde', sql.Date, x.ficha.vigenciaDesde);
      poner('vigencia_hasta', sql.Date, x.ficha.vigenciaHasta);
      poner('horario_permiso', sql.VarChar(600), x.ficha.horario);
    }
    if (x.persona !== undefined) { request.input('persona', sql.VarChar(150), x.persona); campos.push('persona_ingreso = @persona'); }
    if (x.motivo !== undefined) { request.input('motivo', sql.VarChar(300), x.motivo); campos.push('motivo_ingreso = @motivo'); }
    if (x.tipo !== undefined) { request.input('tipo', sql.VarChar(50), x.tipo); campos.push('vehiculo_tipo = @tipo'); campos.push('tipo_vehiculo = @tipo'); }
    if (x.marca !== undefined) { request.input('marca', sql.VarChar(50), x.marca); campos.push('vehiculo_marca = @marca'); }
    if (x.modelo !== undefined) { request.input('modelo', sql.VarChar(50), x.modelo); campos.push('vehiculo_modelo = @modelo'); }
    if (x.color !== undefined) { request.input('color', sql.VarChar(30), x.color); campos.push('vehiculo_color = @color'); }
    if (campos.length) await request.query(`UPDATE DeteccionVehiculo SET ${campos.join(', ')} WHERE id = @id`);
  },

  async guardarEdicionRegistro(id, x) {
    const request = db().request().input('id', sql.Int, id);
    const campos: string[] = [];
    const poner = (columna: string, parametro: string, maximo: number, valor: string | null) => {
      request.input(parametro, sql.VarChar(maximo), valor);
      campos.push(`${columna} = @${parametro}`);
    };
    if (x.datos.cedula !== undefined) poner('cedula_ingreso', 'cedula', 10, x.datos.cedula ?? '');
    if (x.datos.persona !== undefined) poner('persona_ingreso', 'persona', 150, x.datos.persona);
    if (x.datos.motivo !== undefined) poner('motivo_ingreso', 'motivo', 300, x.datos.motivo);
    if (x.datos.tipo !== undefined) {
      poner('vehiculo_tipo', 'tipo', 50, x.datos.tipo);
      campos.push('tipo_vehiculo = @tipo');
    }
    if (x.datos.marca !== undefined) poner('vehiculo_marca', 'marca', 50, x.datos.marca);
    if (x.datos.modelo !== undefined) poner('vehiculo_modelo', 'modelo', 50, x.datos.modelo);
    if (x.datos.color !== undefined) poner('vehiculo_color', 'color', 30, x.datos.color);
    if (x.placa !== undefined) {
      request.input('placa', sql.VarChar(20), x.placa)
        .input('anterior', sql.VarChar(20), x.placaAnterior ?? '')
        .input('usuario', sql.Int, x.usuarioId);
      // PostgresRequest conserva valores, no el OID de input(): el parámetro del CASE IS NULL
      // necesita un tipo explícito, también cuando el formulario deja la matrícula vacía.
      campos.push(
        'placa_ocr_original = COALESCE(placa_ocr_original, placa_reconocida)',
        'decision_automatica = COALESCE(decision_automatica, estado_validacion)',
        'placa_validada = CAST(@placa AS varchar(20))',
        'placa_reconocida = CASE WHEN CAST(@placa AS varchar(20)) IS NULL THEN NULL ELSE placa_reconocida END',
        'validado_manualmente = TRUE', 'usuario_validador_id = @usuario', 'fecha_validacion = CURRENT_TIMESTAMP',
        'estado_procesamiento = \'procesado\'',
        'estado_validacion = CASE WHEN tipo_movimiento = \'salida\' THEN \'salida_registrada\' ELSE \'pendiente_revision\' END',
        'alerta_id = NULL', 'vehiculo_autorizado_id = NULL', 'restriccion_acceso = NULL',
        'verificacion_vehiculo = NULL', 'verificacion_detalle = NULL',
      );
    }
    if (!campos.length) return true;
    const guardas = x.placa === undefined ? '' : `
      AND UPPER(REGEXP_REPLACE(COALESCE(registro.placa_validada, registro.placa_reconocida, ''), '[^A-Za-z0-9]', '', 'g')) = @anterior
      AND COALESCE(registro.tipo_movimiento, 'ingreso') = 'ingreso'
      AND registro.salida_deteccion_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM DeteccionVehiculo vinculado WHERE vinculado.salida_deteccion_id = registro.id)`;
    const r = await request.query(`UPDATE DeteccionVehiculo AS registro SET ${campos.join(', ')} WHERE registro.id = @id${guardas}`);
    return r.rowsAffected[0] === 1;
  },

  async autorizarIngresoSinPlaca(id, usuarioId) {
    const crear = await db().request().input('id', sql.Int, id).input('usuario', sql.Int, usuarioId).query(`
      INSERT INTO ListaBlanca
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
          SELECT 1 FROM ListaBlanca v
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
        FROM ListaBlanca v
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

  /**
   * Cuándo y quiénes ingresan, con los mismos filtros del historial y en hora de Ecuador: ingresos por
   * día (por estado), por día de la semana y por hora, la matriz día × hora, la permanencia de los que
   * registran salida y los vehículos y personas más frecuentes. Cuenta solo ingresos.
   */
  async analisisHistorial(f) {
    const consulta = async (cuerpo: (w: string) => string) => {
      const request = db().request();
      const w = [...aplicarFiltros(f, request), ES_INGRESO].join(' AND ');
      request.input('desfase', sql.Int, desfaseMinutos());
      return (await request.query(cuerpo(w))).recordset;
    };
    const n = (v: unknown) => Number(v ?? 0);
    const [dias, celdas, estancia, placas, personas] = await Promise.all([
      consulta(w => `SELECT to_char(${HORA_LOCAL}, 'YYYY-MM-DD') AS dia, ${CLASE_ESTADO} AS clase, COUNT(*) AS n
        FROM DeteccionVehiculo d WHERE ${w} GROUP BY 1, 2 ORDER BY 1`),
      consulta(w => `SELECT EXTRACT(ISODOW FROM ${HORA_LOCAL})::int AS dia_semana, EXTRACT(HOUR FROM ${HORA_LOCAL})::int AS hora, COUNT(*) AS n
        FROM DeteccionVehiculo d WHERE ${w} GROUP BY 1, 2`),
      consulta(w => `SELECT COUNT(*) AS n, AVG(s) / 60 AS media, percentile_cont(0.5) WITHIN GROUP (ORDER BY s) / 60 AS mediana,
          percentile_cont(0.9) WITHIN GROUP (ORDER BY s) / 60 AS p90
        FROM (SELECT EXTRACT(EPOCH FROM (d.fecha_hora_salida - d.fecha_hora_ingreso)) AS s FROM DeteccionVehiculo d
          WHERE ${w} AND d.fecha_hora_salida IS NOT NULL AND d.fecha_hora_salida >= d.fecha_hora_ingreso) x`),
      consulta(w => `SELECT ${PLACA_D} AS placa, COUNT(*) AS ingresos, MAX(d.fecha_hora_ingreso) AS ultimo,
          (ARRAY_AGG(${PERSONA_D} ORDER BY d.fecha_hora_ingreso DESC) FILTER (WHERE ${PERSONA_D} IS NOT NULL))[1] AS persona
        FROM DeteccionVehiculo d WHERE ${w} AND ${PLACA_D} <> '' GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 10`),
      consulta(w => `SELECT MIN(nombre) AS nombre, COUNT(*) AS ingresos, COUNT(DISTINCT NULLIF(placa, '')) AS placas, MAX(fecha) AS ultimo
        FROM (SELECT ${PERSONA_D} AS nombre, ${PLACA_D} AS placa, d.fecha_hora_ingreso AS fecha FROM DeteccionVehiculo d WHERE ${w}) x
        WHERE nombre IS NOT NULL GROUP BY ${sinTildes('nombre')} ORDER BY 2 DESC, 4 DESC LIMIT 10`),
    ]);
    const porDia = new Map<string, { dia: string; ingresos: number; autorizados: number; no_registrados: number; alertas: number; pendientes: number }>();
    for (const x of dias) {
      const fila = porDia.get(x.dia) ?? { dia: x.dia, ingresos: 0, autorizados: 0, no_registrados: 0, alertas: 0, pendientes: 0 };
      fila[x.clase as 'autorizados' | 'no_registrados' | 'alertas' | 'pendientes'] += n(x.n);
      fila.ingresos += n(x.n);
      porDia.set(x.dia, fila);
    }
    // Días de la semana de lunes (0) a domingo (6); horas de 0 a 23
    const diaHora = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    for (const x of celdas) diaHora[n(x.dia_semana) - 1][n(x.hora)] += n(x.n);
    const e = estancia[0];
    return {
      por_dia: [...porDia.values()],
      por_dia_semana: diaHora.map(horas => horas.reduce((s, v) => s + v, 0)),
      por_hora: Array.from({ length: 24 }, (_, h) => diaHora.reduce((s, horas) => s + horas[h], 0)),
      dia_hora: diaHora,
      permanencia: e && n(e.n) > 0
        ? { n: n(e.n), media_min: Math.round(n(e.media)), mediana_min: Math.round(n(e.mediana)), p90_min: Math.round(n(e.p90)) }
        : null,
      frecuentes: placas.map(x => ({ placa: x.placa, ingresos: n(x.ingresos), ultimo: x.ultimo, persona: x.persona ?? null })),
      personas: personas.map(x => ({ nombre: x.nombre, ingresos: n(x.ingresos), placas: n(x.placas), ultimo: x.ultimo })),
    };
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
        MIN(d.fecha_hora_ingreso) AS primero, MAX(d.fecha_hora_ingreso) AS ultimo
      FROM DeteccionVehiculo d WHERE ${w.join(' AND ')}`);
    const x = r.recordset[0] ?? {};
    const n = (v: unknown) => Number(v ?? 0);
    return {
      total: n(x.total), ingresos: n(x.ingresos), salidas: n(x.salidas), con_salida: n(x.con_salida),
      autorizados: n(x.autorizados), alertas: n(x.alertas), no_registrados: n(x.no_registrados), pendientes: n(x.pendientes),
      sin_lectura: n(x.sin_lectura), placas: n(x.placas), manuales: n(x.manuales),
      camara: n(x.total) - n(x.manuales),
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

  async cerrarIngresoConSalida(salidaId, placa, minimoSegundos, soloIngresoConfirmado = false) {
    // Una matrícula ausente no identifica un vehículo: nunca emparejar ingresos por null o vacío.
    if (typeof placa !== 'string' || !placa.trim()) return null;
    const r = await db().request()
      .input('salida', sql.Int, salidaId).input('placa', sql.VarChar(20), placa).input('minimo', sql.Int, minimoSegundos)
      .query(`
        UPDATE DeteccionVehiculo d
        SET fecha_hora_salida = s.fecha_hora_ingreso, salida_deteccion_id = s.id
        FROM DeteccionVehiculo s
        WHERE s.id = @salida AND d.id = (
          SELECT i.id FROM DeteccionVehiculo i
          WHERE REPLACE(COALESCE(i.placa_validada, i.placa_reconocida, ''), '-', '') = @placa
            AND i.tipo_movimiento = 'ingreso' AND i.fecha_hora_salida IS NULL
            AND i.fecha_hora_ingreso <= s.fecha_hora_ingreso - make_interval(secs => @minimo)
            ${soloIngresoConfirmado ? 'AND (i.lectura_valida IS TRUE OR i.validado_manualmente IS TRUE)' : ''}
          ORDER BY i.fecha_hora_ingreso DESC LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING d.id`);
    return r.recordset[0]?.id ?? null;
  },

  async ingresoCerradoPor(salidaId) {
    const r = await db().request().input('salida', sql.Int, salidaId).query(
      `SELECT d.id, ${PLACA_D} AS placa, (d.lectura_valida IS TRUE OR d.validado_manualmente IS TRUE) AS confirmado
       FROM DeteccionVehiculo d WHERE d.salida_deteccion_id = @salida`);
    return r.recordset[0] ?? null;
  },

  async reabrirIngreso(ingresoId) {
    await db().request().input('id', sql.Int, ingresoId).query(
      'UPDATE DeteccionVehiculo SET fecha_hora_salida = NULL, salida_deteccion_id = NULL WHERE id = @id');
  },

  async exportar(f) {
    const request = db().request();
    const w = aplicarFiltros(f, request);
    return (await request.query(`${SELECT_DETECCION} WHERE ${w.join(' AND ')} ORDER BY ${orden(f)}`)).recordset;
  },

  // Cursor en el servidor, en una transacción de solo lectura: foto consistente del historial sin traerlo entero
  async *exportarPorLotes(f) {
    const cliente = await db().connect();
    try {
      await cliente.query('BEGIN READ ONLY');
      const request = new PostgresRequest(cliente);
      const w = aplicarFiltros(f, request);
      await request.query(`DECLARE exportacion NO SCROLL CURSOR FOR ${SELECT_DETECCION} WHERE ${w.join(' AND ')} ORDER BY ${orden(f)}`);
      for (;;) {
        const { rows } = await cliente.query(`FETCH ${LOTE_EXPORTACION} FROM exportacion`);
        if (rows.length) yield rows;
        if (rows.length < LOTE_EXPORTACION) break;
      }
    } finally {
      // Cierra el cursor también si la descarga se canceló a mitad del recorrido
      await cliente.query('ROLLBACK').catch(() => undefined);
      cliente.release();
    }
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
          placa_reconocida = CASE WHEN CAST(@placa AS varchar(20)) IS NULL THEN NULL ELSE placa_reconocida END,
          validado_manualmente = 1, placa_validada = CAST(@placa AS varchar(20)), usuario_validador_id = @usuario, fecha_validacion = GETDATE(),
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
        VALUES (NULL, @placa, 'manual', @camara, 'procesado', @estado, @alerta, @autorizado, @restriccion, @tipo, TRUE, @usuario,
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
      ), reabiertos AS (
        -- Una salida eliminada no puede seguir cerrando un ingreso
        UPDATE DeteccionVehiculo SET fecha_hora_salida = NULL, salida_deteccion_id = NULL
        WHERE salida_deteccion_id IN (SELECT id FROM eliminadas)
      )
      SELECT id, ruta_imagen_ingreso, ruta_imagen_placa FROM eliminadas`);
    return r.recordset;
  },
};
