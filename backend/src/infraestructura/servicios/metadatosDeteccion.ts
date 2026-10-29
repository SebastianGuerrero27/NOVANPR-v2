import sql, { PostgresPool } from '../postgres';

/**
 * Metadatos operativos de los pasos vehiculares, necesarios para el detalle y la trazabilidad
 * de las detecciones, sin acoplarlos a la presentación ni al cálculo de informes.
 */

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

export interface MetadatosCaptura {
  luminancia_media?: number;
  distancia_estimada_m?: number;
  ancho_placa_px?: number;
  nitidez?: number;
  velocidad_px_s?: number;
  modelo_detector?: string;
  modelo_ocr?: string;
  vehiculo?: {
    tipo?: string | null; color?: string | null; marca?: string | null; modelo?: string | null;
    [k: string]: unknown;
  } | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 100): string | null => (typeof v === 'string' && v ? v.substring(0, max) : null);

/** Guarda los metadatos de la captura. No interrumpe el registro si falla (p. ej. migración pendiente). */
export async function guardarMetadatosCaptura(db: PostgresPool, id: number, meta?: MetadatosCaptura): Promise<void> {
  if (!meta || typeof meta !== 'object') return;
  try {
    await db.request()
      .input('id', sql.Int, id)
      .input('lum', sql.Float, num(meta.luminancia_media))
      .input('dist', sql.Float, num(meta.distancia_estimada_m))
      .input('ancho', sql.Int, num(meta.ancho_placa_px) !== null ? Math.round(meta.ancho_placa_px as number) : null)
      .input('nit', sql.Float, num(meta.nitidez))
      .input('vel', sql.Float, num(meta.velocidad_px_s))
      .input('mdet', sql.VarChar(100), str(meta.modelo_detector))
      .input('mocr', sql.VarChar(100), str(meta.modelo_ocr))
      .input('vtipo', sql.VarChar(30), str(meta.vehiculo?.tipo, 30))
      .input('vcolor', sql.VarChar(30), str(meta.vehiculo?.color, 30))
      .input('vmarca', sql.VarChar(50), str(meta.vehiculo?.marca, 50))
      .input('vmodelo', sql.VarChar(50), str(meta.vehiculo?.modelo, 50))
      .input('vjson', sql.NVarChar(500), meta.vehiculo ? JSON.stringify(meta.vehiculo).substring(0, 500) : null)
      .query(`
        UPDATE DeteccionVehiculo SET
          luminancia_media = @lum, distancia_estimada_m = @dist, ancho_placa_px = @ancho,
          nitidez = @nit, velocidad_px_s = @vel, modelo_detector = @mdet, modelo_ocr = @mocr,
          vehiculo_tipo = @vtipo, vehiculo_color = @vcolor, vehiculo_marca = @vmarca,
          vehiculo_modelo = @vmodelo, vehiculo_atributos_json = @vjson
        WHERE id = @id
      `);
  } catch (error: any) {
    console.warn(`[DETECCION] No se guardaron metadatos del ingreso #${id}: ${error.message}`);
  }
}

/** Atributos del vehículo que llegan después del registro del paso (reevaluación). */
export async function guardarAtributosVehiculo(db: PostgresPool, id: number, vehiculo: MetadatosCaptura['vehiculo']): Promise<void> {
  if (!vehiculo || typeof vehiculo !== 'object') return;
  await db.request()
    .input('id', sql.Int, id)
    .input('vtipo', sql.VarChar(30), str(vehiculo.tipo, 30))
    .input('vcolor', sql.VarChar(30), str(vehiculo.color, 30))
    .input('vmarca', sql.VarChar(50), str(vehiculo.marca, 50))
    .input('vmodelo', sql.VarChar(50), str(vehiculo.modelo, 50))
    .input('vjson', sql.NVarChar(500), JSON.stringify(vehiculo).substring(0, 500))
    .query(`
      UPDATE DeteccionVehiculo SET
        vehiculo_tipo = @vtipo, vehiculo_color = @vcolor, vehiculo_marca = @vmarca,
        vehiculo_modelo = @vmodelo, vehiculo_atributos_json = @vjson
      WHERE id = @id
    `);
}

export interface LecturaAutomatica {
  placaOriginal: string;
  confianza: number | null;
  decision: string;
  lecturaVerificador?: string | null;
  latenciaMs?: number | null;
}

/** Conserva la lectura y la decisión automáticas antes de cualquier corrección manual. */
export async function registrarLecturaAutomatica(db: PostgresPool, id: number, l: LecturaAutomatica): Promise<void> {
  try {
    await db.request()
      .input('id', sql.Int, id)
      .input('placa', sql.VarChar(20), l.placaOriginal.substring(0, 20))
      .input('conf', sql.Float, num(l.confianza))
      .input('decision', sql.VarChar(30), l.decision)
      .input('verif', sql.VarChar(20), str(l.lecturaVerificador, 20))
      .input('lat', sql.Int, num(l.latenciaMs) !== null ? Math.round(l.latenciaMs as number) : null)
      .query(`
        UPDATE DeteccionVehiculo SET
          placa_ocr_original = @placa, confianza_ocr_original = @conf, decision_automatica = @decision,
          lectura_verificador = @verif, latencia_ms = @lat
        WHERE id = @id
      `);
  } catch (error: any) {
    console.warn(`[DETECCION] No se guardó la lectura automática del ingreso #${id}: ${error.message}`);
  }
}
