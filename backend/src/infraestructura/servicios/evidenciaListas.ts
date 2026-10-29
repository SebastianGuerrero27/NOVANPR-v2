import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Pool, PoolClient } from 'pg';
import { normalizarPlaca, validarPlaca } from '../../dominio/validacion';
import { archivoDe, DIRECTORIO_EVIDENCIA_LISTAS, DIRECTORIOS_MEDIA } from './media';

type Fila = Record<string, any>;
type Conexion = Pick<PoolClient, 'query' | 'release'>;
type Base = Pick<Pool, 'query'> & { connect(): Promise<Conexion> };
type Lista = 'autorizado' | 'lista_negra';
const LISTAS = [
  { tabla: 'listablanca', lista: 'autorizado' as Lista },
  { tabla: 'listanegra', lista: 'lista_negra' as Lista },
];
const PLACA_SQL = "UPPER(REPLACE(REPLACE(placa, '-', ''), ' ', ''))";

/** Copia propia de la lista: borrar el acceso nunca borra la evidencia conservada. */
async function copiar(ruta: unknown, nombre: string, directorios: string[], directorioDestino: string): Promise<string | null> {
  const archivo = typeof ruta === 'string' ? archivoDe(ruta) : null;
  if (!archivo) return null;
  await fs.promises.mkdir(directorioDestino, { recursive: true });
  const destino = path.join(directorioDestino, `${nombre}${path.extname(archivo).toLowerCase()}`);
  for (const directorio of [...new Set(directorios)]) {
    try {
      await fs.promises.copyFile(path.join(directorio, archivo), destino, fs.constants.COPYFILE_EXCL);
      return destino;
    } catch (error) {
      // Una foto ausente no se convierte en un estado de ingreso confirmado.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return null;
}

/** Primera evidencia por columna, con bloqueo de fila para dos lecturas concurrentes. */
export async function conservarEvidenciaListas(base: Base, fila: Fila, opciones: {
  directorios?: string[];
  directorioDestino?: string;
  alGuardar?: (lista: Lista) => void;
} = {}): Promise<void> {
  if (fila.tipo_movimiento === 'salida' || fila.estado_procesamiento !== 'procesado') return;
  if (!fila.validado_manualmente) {
    // La primera lectura puede ser retractada por el verificador. Solo su resultado final
    // puede dejar constancia permanente; desconocida no equivale a confirmada.
    if (fila.lectura_valida !== true) return;
    let evidencia: unknown = fila.evidencia_lectura;
    if (typeof evidencia === 'string') {
      try { evidencia = JSON.parse(evidencia); } catch { return; }
    }
    if (evidencia && typeof evidencia === 'object' && !Array.isArray(evidencia)
      && (evidencia as Fila).segundo_ocr_pendiente === true) return;
  }
  const placa = normalizarPlaca(fila.placa_validada || fila.placa_reconocida);
  if (!placa || !validarPlaca(placa).ok) return;
  const vehiculo = archivoDe(fila.ruta_imagen_ingreso);
  // El motor histórico usaba la foto entera como sustituto del recorte: no cuenta como placa.
  const placaFoto = archivoDe(fila.ruta_imagen_placa);
  const recorte = placaFoto && placaFoto !== vehiculo ? placaFoto : null;
  if (!vehiculo && !recorte) return;
  const fecha = new Date(fila.fecha_hora_ingreso);
  if (!Number.isFinite(fecha.getTime())) return;
  const directorios = opciones.directorios ?? DIRECTORIOS_MEDIA;
  const directorioDestino = opciones.directorioDestino ?? DIRECTORIO_EVIDENCIA_LISTAS;
  for (const { tabla, lista } of LISTAS) {
    const conexion = await base.connect();
    const copias: string[] = [];
    let cambio = false;
    try {
      await conexion.query('BEGIN');
      const registros = await conexion.query(`SELECT id, ruta_evidencia_vehiculo, ruta_evidencia_placa
        FROM ${tabla} WHERE activo = TRUE AND ${PLACA_SQL} = $1
        AND (ruta_evidencia_vehiculo IS NULL OR ruta_evidencia_placa IS NULL) FOR UPDATE`, [placa]);
      for (const registro of registros.rows) {
        const prefijo = `lista_${lista}_${registro.id}_${crypto.randomUUID()}`;
        const imagenVehiculo = !registro.ruta_evidencia_vehiculo && vehiculo
          ? await copiar(vehiculo, `${prefijo}_vehiculo`, directorios, directorioDestino) : null;
        if (imagenVehiculo) copias.push(imagenVehiculo);
        const imagenPlaca = !registro.ruta_evidencia_placa && recorte
          ? await copiar(recorte, `${prefijo}_placa`, directorios, directorioDestino) : null;
        if (imagenPlaca) copias.push(imagenPlaca);
        if (!imagenVehiculo && !imagenPlaca) continue;
        await conexion.query(`UPDATE ${tabla} SET
          ruta_evidencia_vehiculo = COALESCE(ruta_evidencia_vehiculo, $2),
          ruta_evidencia_placa = COALESCE(ruta_evidencia_placa, $3),
          fecha_evidencia_vehiculo = CASE WHEN ruta_evidencia_vehiculo IS NULL AND $2::varchar IS NOT NULL THEN $4 ELSE fecha_evidencia_vehiculo END,
          fecha_evidencia_placa = CASE WHEN ruta_evidencia_placa IS NULL AND $3::varchar IS NOT NULL THEN $4 ELSE fecha_evidencia_placa END
          WHERE id = $1`, [registro.id, imagenVehiculo, imagenPlaca, fecha]);
        cambio = true;
      }
      await conexion.query('COMMIT');
    } catch (error) {
      await conexion.query('ROLLBACK').catch(() => undefined);
      await Promise.all(copias.map(ruta => fs.promises.unlink(ruta).catch(() => undefined)));
      throw error;
    } finally { conexion.release(); }
    if (cambio) opciones.alGuardar?.(lista);
  }
}

/** Recupera las fotos existentes, en orden de ingreso, sin inventar evidencia ni llamar APIs. */
export async function recuperarEvidenciasListas(base: Base, alGuardar?: (lista: Lista) => void): Promise<void> {
  const r = await base.query(`SELECT d.* FROM deteccionvehiculo d
    WHERE d.tipo_movimiento = 'ingreso' AND d.estado_procesamiento = 'procesado'
      AND (d.lectura_valida = TRUE OR d.validado_manualmente = TRUE)
      AND (d.ruta_imagen_ingreso IS NOT NULL OR d.ruta_imagen_placa IS NOT NULL)
      AND (${LISTAS.map(({ tabla }) => `EXISTS (SELECT 1 FROM ${tabla} t
        WHERE t.activo = TRUE AND UPPER(REPLACE(REPLACE(t.placa, '-', ''), ' ', '')) =
          UPPER(REPLACE(REPLACE(COALESCE(d.placa_validada, d.placa_reconocida), '-', ''), ' ', ''))
          AND (t.ruta_evidencia_vehiculo IS NULL OR t.ruta_evidencia_placa IS NULL))`).join(' OR ')})
    ORDER BY d.fecha_hora_ingreso ASC, d.id ASC`);
  for (const fila of r.rows) await conservarEvidenciaListas(base, fila, { alGuardar });
}

/**
 * Borra las fotos conservadas de un registro de lista eliminado definitivamente. Solo toca las
 * copias propias de las listas (lista_<lista>_<id>_…) en su carpeta, nunca la evidencia del motor.
 */
export async function eliminarEvidenciaListas(rutas: (string | null | undefined)[]): Promise<number> {
  let borrados = 0;
  for (const archivo of new Set(rutas.map(archivoDe))) {
    if (!archivo?.startsWith('lista_')) continue;
    try {
      await fs.promises.unlink(path.join(DIRECTORIO_EVIDENCIA_LISTAS, archivo));
      borrados++;
    } catch { /* ya no estaba */ }
  }
  return borrados;
}
