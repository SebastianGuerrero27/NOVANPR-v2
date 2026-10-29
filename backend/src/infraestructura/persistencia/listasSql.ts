import sql, { PostgresRequest } from '../postgres';
import { getDB } from '../db';
import { describirHorario, leerHorario } from '../../dominio/horario';
import { type DefinicionLista, LISTA_BLANCA, type RegistroLista, type TipoLista } from '../../dominio/listas';
import type { RegistroListaDTO, RepositorioListas } from '../../aplicacion/listas';
import { config } from '../servicios/configuracion';
import { hoyLocalSql } from '../servicios/tiempo';
import { urlMedia } from '../servicios/media';

/** Repositorio PostgreSQL de las listas de control (tablas ListaBlanca y ListaNegra). */

const TABLA: Record<TipoLista, 'ListaBlanca' | 'ListaNegra'> = { autorizados: 'ListaBlanca', alertas: 'ListaNegra' };
const MISMA_PLACA = "REPLACE(REPLACE(placa, '-', ''), ' ', '') = @placa";

const columnasDe = (def: DefinicionLista) => [...def.campos.map(c => c.nombre), ...(def.temporal ? ['fecha_inicio', 'horario'] : [])];
const valorDe = (c: string) => (c === 'fecha_inicio' ? '@inicio' : `@${c}`);

function parametros(request: PostgresRequest, def: DefinicionLista, r: RegistroLista) {
  for (const c of def.campos) request.input(c.nombre, sql.NVarChar(c.max), r.datos[c.nombre]);
  request.input('placa', sql.VarChar(10), r.placa || null).input('vence', sql.Date, r.vence);
  if (def.temporal) request.input('inicio', sql.Date, r.inicio).input('horario', sql.NVarChar(600), r.horario);
}

function selectLista(def: DefinicionLista): string {
  const hoy = hoyLocalSql();
  const tabla = TABLA[def.tipo];
  return `
    SELECT t.*, u.email AS registrado_por_email, u.nombre_completo AS registrado_por_nombre,
           CAST(CASE WHEN t.fecha_vencimiento IS NULL OR t.fecha_vencimiento >= ${hoy} THEN 1 ELSE 0 END AS BIT) AS vigente,
           CAST(CASE WHEN t.fecha_vencimiento >= ${hoy}
                      AND t.fecha_vencimiento <= DATEADD(DAY, ${config.entero('aviso_vencimiento_dias')}, ${hoy}) THEN 1 ELSE 0 END AS BIT) AS por_vencer,
           ${def.temporal ? `CAST(CASE WHEN t.fecha_inicio > ${hoy} THEN 1 ELSE 0 END AS BIT)` : 'CAST(0 AS BIT)'} AS pendiente_inicio,
           (SELECT COUNT(*) FROM DeteccionVehiculo d
             WHERE ${tabla === 'ListaNegra' ? 'd.alerta_id' : 'd.vehiculo_autorizado_id'} = t.id) AS ingresos
           ,t.ruta_evidencia_vehiculo AS imagen_vehiculo
           ,t.ruta_evidencia_placa AS imagen_placa
    FROM ${tabla} t LEFT JOIN Usuarios u ON u.id = t.registrado_por`;
}

/** El horario se entrega interpretado (franjas y texto legible). */
function mapear(def: DefinicionLista, r: any): RegistroListaDTO {
  const { ruta_evidencia_vehiculo: _vehiculo, ruta_evidencia_placa: _placa, ...publico } = r;
  const evidencia = {
    imagen_vehiculo: urlMedia(r.imagen_vehiculo),
    imagen_placa: urlMedia(r.imagen_placa),
    fecha_evidencia_vehiculo: r.fecha_evidencia_vehiculo ? new Date(r.fecha_evidencia_vehiculo).toISOString() : null,
    fecha_evidencia_placa: r.fecha_evidencia_placa ? new Date(r.fecha_evidencia_placa).toISOString() : null,
  };
  if (!def.temporal) return { ...publico, ...evidencia };
  return { ...publico, ...evidencia, horario: leerHorario(r.horario), horario_texto: describirHorario(r.horario) };
}

const db = () => getDB();

export const repositorioListasSql: RepositorioListas = {
  async asignarPlaca(id, placa) {
    const r = await db().request().input('id', sql.Int, id).input('placa', sql.VarChar(10), placa)
      .query(`UPDATE ListaBlanca SET placa = @placa, fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id = @id AND activo = 1 AND placa IS NULL RETURNING id`);
    return r.recordset.length > 0;
  },
  async listar(def, usuarioId) {
    const request = db().request();
    if (usuarioId !== undefined) request.input('propietarioId', sql.Int, usuarioId);
    const r = await request.query(`${selectLista(def)} WHERE t.activo = 1${usuarioId !== undefined ? ' AND t.registrado_por = @propietarioId' : ''} ORDER BY t.fecha_registro DESC`);
    return r.recordset.map(x => mapear(def, x));
  },

  async obtener(def, id) {
    const r = await db().request().input('id', sql.Int, id).query(`${selectLista(def)} WHERE t.id = @id`);
    return r.recordset[0] ? mapear(def, r.recordset[0]) : null;
  },

  async obtenerActivo(def, id) {
    const r = await db().request().input('id', sql.Int, id).query(`SELECT * FROM ${TABLA[def.tipo]} WHERE id = @id AND activo = 1`);
    return r.recordset[0] ?? null;
  },

  async buscarPorPlaca(def, placa) {
    const r = await db().request().input('placa', sql.VarChar(10), placa)
      .query(`SELECT id, activo, registrado_por FROM ${TABLA[def.tipo]} WHERE ${MISMA_PLACA}`);
    return r.recordset[0] ? { id: r.recordset[0].id, activo: Boolean(r.recordset[0].activo), registrado_por: r.recordset[0].registrado_por } : null;
  },

  async existeOtraConPlaca(def, placa, idExcluido) {
    const r = await db().request().input('placa', sql.VarChar(10), placa).input('id', sql.Int, idExcluido)
      .query(`SELECT TOP 1 id FROM ${TABLA[def.tipo]} WHERE ${MISMA_PLACA} AND id <> @id`);
    return r.recordset.length > 0;
  },

  async existeOtraConCedula(def, cedula, idExcluido) {
    if (def.tipo !== 'autorizados') return false;
    const request = db().request().input('cedula', sql.VarChar(10), cedula);
    const exclusion = idExcluido === undefined ? '' : ' AND id <> @id';
    if (idExcluido !== undefined) request.input('id', sql.Int, idExcluido);
    const r = await request.query(`SELECT TOP 1 id FROM ListaBlanca
      WHERE activo = 1 AND cedula = @cedula${exclusion}`);
    return r.recordset.length > 0;
  },

  async crear(def, r, usuarioId, solicitudId) {
    const columnas = columnasDe(def);
    const request = db().request().input('usuario', sql.Int, usuarioId);
    parametros(request, def, r);
    const conSolicitud = def.temporal && solicitudId;
    if (conSolicitud) request.input('solicitud', sql.Int, solicitudId);
    const ins = await request.query(`
      INSERT INTO ${TABLA[def.tipo]} (placa, fecha_vencimiento, registrado_por, activo, fecha_registro, ${columnas.join(', ')}${conSolicitud ? ', solicitud_id' : ''})
      OUTPUT INSERTED.id
      VALUES (@placa, @vence, @usuario, TRUE, GETDATE(), ${columnas.map(valorDe).join(', ')}${conSolicitud ? ', @solicitud' : ''})`);
    return ins.recordset[0].id;
  },

  async reactivar(def, id, r, usuarioId, solicitudId) {
    const request = db().request().input('usuario', sql.Int, usuarioId).input('id', sql.Int, id);
    parametros(request, def, r);
    const conSolicitud = def.temporal && solicitudId;
    if (conSolicitud) request.input('solicitud', sql.Int, solicitudId);
    await request.query(`
      UPDATE ${TABLA[def.tipo]} SET activo = 1, placa = @placa, fecha_vencimiento = @vence, registrado_por = COALESCE(registrado_por, @usuario),
        fecha_registro = GETDATE(), fecha_actualizacion = SYSDATETIME(),
        ${columnasDe(def).map(c => `${c} = ${valorDe(c)}`).join(', ')}${conSolicitud ? ', solicitud_id = @solicitud' : ''}
      WHERE id = @id`);
  },

  async actualizar(def, id, r) {
    const request = db().request().input('id', sql.Int, id);
    parametros(request, def, r);
    await request.query(`
      UPDATE ${TABLA[def.tipo]} SET
        ruta_evidencia_vehiculo = CASE WHEN UPPER(REPLACE(REPLACE(COALESCE(placa, ''), '-', ''), ' ', '')) IS DISTINCT FROM COALESCE(@placa, '') THEN NULL ELSE ruta_evidencia_vehiculo END,
        ruta_evidencia_placa = CASE WHEN UPPER(REPLACE(REPLACE(COALESCE(placa, ''), '-', ''), ' ', '')) IS DISTINCT FROM COALESCE(@placa, '') THEN NULL ELSE ruta_evidencia_placa END,
        fecha_evidencia_vehiculo = CASE WHEN UPPER(REPLACE(REPLACE(COALESCE(placa, ''), '-', ''), ' ', '')) IS DISTINCT FROM COALESCE(@placa, '') THEN NULL ELSE fecha_evidencia_vehiculo END,
        fecha_evidencia_placa = CASE WHEN UPPER(REPLACE(REPLACE(COALESCE(placa, ''), '-', ''), ' ', '')) IS DISTINCT FROM COALESCE(@placa, '') THEN NULL ELSE fecha_evidencia_placa END,
        placa = @placa, fecha_vencimiento = @vence, fecha_actualizacion = SYSDATETIME(),
        ${columnasDe(def).map(c => `${c} = ${valorDe(c)}`).join(', ')}
      WHERE id = @id`);
  },

  async retirar(def, id) {
    const r = await db().request().input('id', sql.Int, id)
      .query(`UPDATE ${TABLA[def.tipo]} SET activo = 0, fecha_actualizacion = SYSDATETIME() OUTPUT DELETED.placa${def.tipo === 'autorizados' ? ', DELETED.propietario' : ''} WHERE id = @id AND activo = 1`);
    return r.recordset[0] ? r.recordset[0].placa || r.recordset[0].propietario || 'Permiso sin placa' : null;
  },

  async registroPermisos(f) {
    const request = db().request();
    const w = [f.estado === 'activos' ? 't.activo = 1' : f.estado === 'retirados' ? 't.activo = 0' : '1 = 1'];
    if (f.usuarioId !== null) { request.input('usuario', sql.Int, f.usuarioId); w.push('t.registrado_por = @usuario'); }
    const r = await request.query(`${selectLista(LISTA_BLANCA)} WHERE ${w.join(' AND ')}
      ORDER BY t.activo DESC, t.fecha_registro DESC`);
    return r.recordset.map(x => ({ ...mapear(LISTA_BLANCA, x), activo: Boolean(x.activo) }));
  },

  async usuariosPadron() {
    // Quien puede otorgar permisos hoy (gestores) y cualquiera que haya registrado alguno
    const r = await db().request().query(`
      SELECT u.id, u.nombre_completo AS nombre, u.email, r.codigo AS rol, u.estado
      FROM Usuarios u JOIN Roles r ON r.id = u.rol_id
      WHERE r.codigo = 'GESTOR_PERMISOS' OR EXISTS (SELECT 1 FROM ListaBlanca v WHERE v.registrado_por = u.id)
      ORDER BY u.nombre_completo`);
    return r.recordset;
  },

  async eliminarDefinitivo(def, id) {
    const hoy = hoyLocalSql();
    const columnaPaso = def.tipo === 'alertas' ? 'alerta_id' : 'vehiculo_autorizado_id';
    // Mismas condiciones que el caso de uso, en la misma sentencia: retirado o vencido y sin pasos
    const r = await db().request().input('id', sql.Int, id).query(`
      ${def.tipo === 'autorizados' ? 'UPDATE SolicitudesAcceso SET vehiculo_autorizado_id = NULL WHERE vehiculo_autorizado_id = @id;' : ''}
      DELETE FROM ${TABLA[def.tipo]} t
      WHERE t.id = @id
        AND (t.activo = FALSE OR t.fecha_vencimiento < ${hoy})
        AND NOT EXISTS (SELECT 1 FROM DeteccionVehiculo d WHERE d.${columnaPaso} = t.id)
      RETURNING t.ruta_evidencia_vehiculo, t.ruta_evidencia_placa`);
    const fila = r.recordset[0];
    return fila ? { rutas: [fila.ruta_evidencia_vehiculo ?? null, fila.ruta_evidencia_placa ?? null] } : null;
  },

  async retirarVencidos(def) {
    // Vigente hasta el final del día de vencimiento (hora local de la institución)
    const r = await db().request().query(`
      UPDATE ${TABLA[def.tipo]} SET activo = FALSE, fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE activo = TRUE AND fecha_vencimiento < ${hoyLocalSql()}
      RETURNING id, COALESCE(placa, ${def.temporal && def.tipo === 'autorizados' ? 'propietario' : "'Permiso sin placa'"}) AS nombre, fecha_vencimiento AS vence`);
    return r.recordset.map(x => ({ id: Number(x.id), nombre: String(x.nombre), vence: x.vence }));
  },

  async restaurar(def, id) {
    const r = await db().request().input('id', sql.Int, id)
      .query(`UPDATE ${TABLA[def.tipo]} SET activo = 1, fecha_actualizacion = SYSDATETIME() WHERE id = @id AND activo = 0 RETURNING id`);
    return r.recordset.length > 0;
  },
};
