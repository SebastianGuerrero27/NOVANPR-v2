import dotenv from 'dotenv';
dotenv.config();

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { cargarConfiguracion } from './servicios/configuracion';
import { PostgresPool } from './postgres';

const isDocker = process.env.DOCKER_CONTAINER === 'true';
const dbName = process.env.DB_NAME || 'ANPR_ECU911';
let pool: PostgresPool;

/** Archivos históricos conservados para compatibilidad con instalaciones SQL Server anteriores. */
export const MIGRACIONES = [
  'migration_deteccion_vehiculo.sql', 'migration_camaras_ping.sql', 'migration_deteccion_tipo_vehiculo.sql',
  'migration_placa_varchar20.sql', 'migration_fuente_varchar255.sql', 'migration_auditoria_descartes.sql',
  'migration_evaluacion.sql', 'migration_vehiculo_atributos.sql', 'migration_auditoria_propietario.sql',
  'migration_v2_seguridad.sql', 'migration_v3_operacion.sql', 'migration_v4_lectura_valida.sql',
  'migration_v5_accesos_notificaciones.sql', 'migration_v6_tres_roles.sql', 'migration_v7_auditoria_retencion.sql',
  'migration_v8_solicitudes_version.sql', 'migration_v9_camaras_vista_cifrado.sql', 'migration_v10_fuente_rtsp.sql',
  'migration_v11_zonas_exclusion.sql', 'migration_v12_eliminar_notificaciones.sql', 'migration_v13_direccion_camara.sql',
];

export function lotesSql(script: string): string[] {
  return script.split(/^\s*GO\s*;?\s*$/gim).map(lote => lote.trim()).filter(Boolean);
}

export async function connectDB(): Promise<PostgresPool> {
  const maxRetries = Number(process.env.DB_CONNECT_RETRIES || 10);
  const delay = Number(process.env.DB_CONNECT_DELAY_MS || 5000);
  let ultimoError: unknown;
  for (let intento = 1; intento <= maxRetries; intento++) {
    try {
      pool = new PostgresPool({
        host: process.env.DB_SERVER || (isDocker ? 'db' : '127.0.0.1'),
        port: Number(process.env.DB_PORT || (isDocker ? 5432 : 5432)),
        user: process.env.DB_USER || 'anpr',
        password: process.env.DB_PASSWORD,
        database: dbName,
        max: Number(process.env.DB_POOL_MAX || 10),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        statement_timeout: 30000,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined,
      });
      // pg emite este evento si cae una conexión inactiva; sin manejador termina todo Node.
      pool.on('error', error => console.warn('[DB] Conexión inactiva interrumpida; el pool la renovará:', error.message));
      console.log(`[DB] Conectando a PostgreSQL (intento ${intento}/${maxRetries})...`);
      await pool.query('SELECT 1');
      await initDatabaseSchema();
      await verificarConfiguracionInicial();
      await cargarConfiguracion(pool);
      console.log(`[DB] Conectado a PostgreSQL: ${dbName}`);
      return pool;
    } catch (error) {
      ultimoError = error;
      await pool?.end().catch(() => undefined);
      console.error(`[DB] Error conectando a PostgreSQL: ${(error as Error).message}`);
      if (intento < maxRetries) await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error(`[DB] No se pudo conectar a PostgreSQL: ${(ultimoError as Error)?.message ?? 'error desconocido'}`);
}

function rutaEsquema(): string {
  const candidatos = [path.join(__dirname, '../../../db/postgresql/esquema.sql'), path.join(__dirname, '../../db/postgresql/esquema.sql')];
  const ruta = candidatos.find(fs.existsSync);
  if (!ruta) throw new Error('No se encontró db/postgresql/esquema.sql');
  return ruta;
}

/**
 * Desde el 2026-10-28 los pasos de una cámara de prueba (video cargado, `video://…`) se guardan
 * con fuente 'video' para separarlos del flujo real en el historial. Los registrados antes se
 * reclasificaron así una sola vez; los demás datos del paso no cambian.
 */
const ORIGEN_VIDEO_PRUEBA_SQL = `UPDATE deteccionvehiculo d SET fuente = 'video'
  FROM camaras c WHERE c.id = d.camara_id AND c.rtsp_url LIKE 'video://%' AND COALESCE(d.fuente, 'rtsp') = 'rtsp'`;

/**
 * Cambio de datos que debe ejecutarse una sola vez: queda anotado en SchemaMigraciones (con la
 * suma SHA-256 del SQL) en la misma sentencia, así dos instancias del backend no lo repiten.
 */
async function aplicarUnaVez(nombre: string, sentencia: string): Promise<void> {
  const suma = createHash('sha256').update(sentencia).digest('hex');
  const r = await pool.query(`WITH registro AS (
      INSERT INTO schemamigraciones (nombre, suma_sha256) VALUES ('${nombre}', '${suma}')
      ON CONFLICT (nombre) DO NOTHING RETURNING nombre)
    SELECT COUNT(*) AS nueva FROM registro`);
  if (Number(r.rows[0]?.nueva ?? 0) === 0) return;
  await pool.query(sentencia);
  console.log(`[DB] Migración de datos aplicada: ${nombre}`);
}

async function initDatabaseSchema(): Promise<void> {
  const ddl = fs.readFileSync(rutaEsquema(), 'utf8');
  await pool.query(ddl);
  await pool.query(fs.readFileSync(path.join(path.dirname(rutaEsquema()), 'migracion_campos_permisos.sql'), 'utf8'));
  await pool.query(fs.readFileSync(path.join(path.dirname(rutaEsquema()), 'migracion_evidencias_listas.sql'), 'utf8'));
  await pool.query('ALTER TABLE vehiculosautorizados ALTER COLUMN placa DROP NOT NULL');
  // Motivo de ingreso del permiso: los pasos del vehículo lo toman si el guardia no escribe otro
  await pool.query('ALTER TABLE vehiculosautorizados ADD COLUMN IF NOT EXISTS motivo_ingreso VARCHAR(300)');
  await pool.query(`ALTER TABLE vehiculosautorizados
    ADD COLUMN IF NOT EXISTS cedula VARCHAR(10),
    ADD COLUMN IF NOT EXISTS institucion VARCHAR(150),
    ADD COLUMN IF NOT EXISTS cargo VARCHAR(150)`);
  await pool.query(`ALTER TABLE listanegra
    ADD COLUMN IF NOT EXISTS fecha_inicio DATE,
    ADD COLUMN IF NOT EXISTS horario VARCHAR(600)`);
  await pool.query('ALTER TABLE deteccionvehiculo ADD COLUMN IF NOT EXISTS fecha_hora_salida TIMESTAMP NULL');
  await aplicarUnaVez('pg_2026_10_28_origen_video_prueba', ORIGEN_VIDEO_PRUEBA_SQL);
  // Mantiene el historial de notificaciones, pero desvincula la detección al eliminarla.
  // CREATE TABLE IF NOT EXISTS no actualiza restricciones en bases ya inicializadas.
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'notificaciones_deteccion_id_fkey'
          AND conrelid = 'notificaciones'::regclass
          AND confdeltype = 'n'
      ) THEN
        ALTER TABLE notificaciones DROP CONSTRAINT IF EXISTS notificaciones_deteccion_id_fkey;
        ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_deteccion_id_fkey
          FOREIGN KEY (deteccion_id) REFERENCES deteccionvehiculo(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);
  console.log('[DB] Esquema PostgreSQL inicializado.');
}

async function verificarConfiguracionInicial(): Promise<void> {
  const r = await pool.query(`SELECT COUNT(*) AS n FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE r.codigo = 'ADMIN'`);
  if (Number(r.rows[0]?.n ?? 0) === 0) {
    console.log('[DB] No hay administradores: abra el sistema y cree el primero desde la pantalla inicial.');
  }
}

export async function comprobarBaseDatos(): Promise<{ ok: boolean; ms: number | null }> {
  if (!pool) return { ok: false, ms: null };
  const inicio = Date.now();
  try { await pool.query('SELECT 1 AS ok'); return { ok: true, ms: Date.now() - inicio }; }
  catch { return { ok: false, ms: null }; }
}

export function getDB(): PostgresPool {
  if (!pool) throw new Error('[DB] Pool de PostgreSQL no inicializado.');
  return pool;
}
