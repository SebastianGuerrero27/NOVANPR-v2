import fs from 'fs';
import path from 'path';
import { ACTOR_SISTEMA } from '../../aplicacion/comun';
import { auditoriaSql } from '../adaptadores';
import { getDB } from '../db';
import sql from '../postgres';
import { config } from './configuracion';
import { archivoDe, eliminarEvidencia } from './media';
import { notificar } from './notificaciones';

/**
 * Conservación de las fotos de los pasos (RNF06). Un equipo de 40 GB se llena en meses si las fotos no
 * se borran (~1 MB por paso), y con el disco lleno también se detiene la base de datos. En cada pasada:
 *
 *   1. Por antigüedad: se borran las fotos de los pasos más viejos que `evidencia_retencion_dias`.
 *   2. Por capacidad: si la carpeta supera `evidencia_disco_maximo_gb` o queda poco disco libre, se
 *      borran las más viejas hasta bajar al 90 % del máximo.
 *   3. Huérfanas: fotos sin registro y más viejas que la retención (pasos consolidados, cortes).
 *
 * Solo se borra la foto: el registro del paso se conserva. Las fotos de una alerta de la lista negra no
 * se borran solas, porque pueden ser evidencia de un incidente; si solo quedan esas y falta espacio se
 * avisa a quien administra el sistema. Las copias de las listas (lista_*) tienen su propia carpeta.
 */

const LOTE = 500;
const MAX_HUERFANAS_POR_PASADA = 500;
const BYTES_GB = 1024 ** 3;
const MINIMO_LIBRE_BYTES = 2 * BYTES_GB;
const RE_FOTO = /^(?!lista_)[\w.-]+\.(jpe?g|png|webp)$/i;

interface FilaFotos { id: number; ruta_imagen_ingreso: string | null; ruta_imagen_placa: string | null }
export interface ResultadoConservacion { porAntiguedad: number; porCapacidad: number; huerfanas: number; bytes: number; libres: number | null; faltaEspacio: boolean }

/** Carpeta de fotos del motor: la misma que sirve /media. */
export function directorioFotos(): string {
  const candidatos = [process.env.MEDIA_DIR, '/app/media', path.resolve(process.cwd(), '../services/anpr/media')];
  return candidatos.find((d): d is string => Boolean(d) && fs.existsSync(d as string)) ?? '';
}

function fotosDe(directorio: string): { nombre: string; bytes: number; modificada: number }[] {
  const fotos = [];
  for (const nombre of fs.readdirSync(directorio)) {
    if (!RE_FOTO.test(nombre)) continue;
    try {
      const s = fs.statSync(path.join(directorio, nombre));
      if (s.isFile()) fotos.push({ nombre, bytes: s.size, modificada: s.mtimeMs });
    } catch { /* borrada mientras se recorría */ }
  }
  return fotos;
}

function bytesLibres(directorio: string): number | null {
  try {
    const s = fs.statfsSync(directorio);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

/** Los pasos más antiguos del lote que alcanzan para liberar estos bytes. */
function lasNecesarias(lote: FilaFotos[], directorio: string, bytes: number): FilaFotos[] {
  let liberados = 0;
  const elegidas: FilaFotos[] = [];
  for (const fila of lote) {
    elegidas.push(fila);
    for (const ruta of [fila.ruta_imagen_ingreso, fila.ruta_imagen_placa]) {
      const archivo = archivoDe(ruta);
      try {
        if (archivo) liberados += fs.statSync(path.join(directorio, archivo)).size;
      } catch { /* la foto ya no está */ }
    }
    if (liberados >= bytes) break;
  }
  return elegidas;
}

/** Borra las fotos de estos pasos y las quita de su registro. Devuelve cuántos archivos eliminó. */
async function borrarFotos(filas: FilaFotos[]): Promise<number> {
  const borrados = await eliminarEvidencia(filas.flatMap(f => [f.ruta_imagen_ingreso, f.ruta_imagen_placa]));
  const ids = filas.map(f => Number(f.id)).filter(Number.isInteger);
  await getDB().request().query(`UPDATE DeteccionVehiculo SET ruta_imagen_ingreso = NULL, ruta_imagen_placa = NULL WHERE id IN (${ids.join(',')})`);
  return borrados;
}

const CONDICION_FOTOS = `(ruta_imagen_ingreso IS NOT NULL OR ruta_imagen_placa IS NOT NULL) AND COALESCE(estado_validacion, '') <> 'alerta'`;

async function vencidas(dias: number): Promise<FilaFotos[]> {
  const r = await getDB().request().input('dias', sql.Int, dias).input('lote', sql.Int, LOTE)
    .query(`SELECT id, ruta_imagen_ingreso, ruta_imagen_placa FROM DeteccionVehiculo
            WHERE ${CONDICION_FOTOS} AND fecha_hora_ingreso < CURRENT_TIMESTAMP - (@dias * INTERVAL '1 day')
            ORDER BY fecha_hora_ingreso ASC, id ASC LIMIT @lote`);
  return r.recordset;
}

async function masAntiguas(): Promise<FilaFotos[]> {
  const r = await getDB().request().input('lote', sql.Int, LOTE)
    .query(`SELECT id, ruta_imagen_ingreso, ruta_imagen_placa FROM DeteccionVehiculo
            WHERE ${CONDICION_FOTOS} ORDER BY fecha_hora_ingreso ASC, id ASC LIMIT @lote`);
  return r.recordset;
}

/** De estas fotos, las que usa algún registro de paso. */
async function enUso(nombres: string[]): Promise<Set<string>> {
  const request = getDB().request();
  const parametros = nombres.map((nombre, i) => {
    request.input(`n${i}`, sql.VarChar(300), nombre);
    return `@n${i}`;
  });
  const r = await request.query(`SELECT ruta_imagen_ingreso, ruta_imagen_placa FROM DeteccionVehiculo
    WHERE regexp_replace(COALESCE(ruta_imagen_ingreso, ''), '^.*/', '') IN (${parametros.join(',')})
       OR regexp_replace(COALESCE(ruta_imagen_placa, ''), '^.*/', '') IN (${parametros.join(',')})`);
  return new Set(r.recordset.flatMap((f: FilaFotos) => [archivoDe(f.ruta_imagen_ingreso), archivoDe(f.ruta_imagen_placa)]).filter(Boolean) as string[]);
}

async function borrarHuerfanas(directorio: string, dias: number): Promise<number> {
  const limite = Date.now() - dias * 86_400_000;
  const viejas = fotosDe(directorio).filter(f => f.modificada < limite).slice(0, MAX_HUERFANAS_POR_PASADA);
  let borradas = 0;
  for (let i = 0; i < viejas.length; i += 100) {
    const nombres = viejas.slice(i, i + 100).map(f => f.nombre);
    const usadas = await enUso(nombres);
    borradas += await eliminarEvidencia(nombres.filter(n => !usadas.has(n)));
  }
  return borradas;
}

export async function depurarEvidencia(directorio: string = directorioFotos()): Promise<ResultadoConservacion> {
  const dias = config.entero('evidencia_retencion_dias');
  const maximo = config.entero('evidencia_disco_maximo_gb') * BYTES_GB;
  const resultado: ResultadoConservacion = { porAntiguedad: 0, porCapacidad: 0, huerfanas: 0, bytes: 0, libres: null, faltaEspacio: false };
  if (!directorio) return resultado;

  for (let lote = await vencidas(dias); lote.length; lote = await vencidas(dias)) {
    resultado.porAntiguedad += await borrarFotos(lote);
    if (lote.length < LOTE) break;
  }
  resultado.huerfanas = await borrarHuerfanas(directorio, dias);

  const medir = () => {
    resultado.bytes = fotosDe(directorio).reduce((suma, f) => suma + f.bytes, 0);
    resultado.libres = bytesLibres(directorio);
  };
  const discoBajo = () => resultado.libres !== null && resultado.libres < MINIMO_LIBRE_BYTES;
  medir();
  if (resultado.bytes > maximo || discoBajo()) {
    // Baja al 90 % del máximo para no repetir el borrado en cada pasada
    const porLiberar = () => Math.max(resultado.bytes - maximo * 0.9, discoBajo() ? MINIMO_LIBRE_BYTES - (resultado.libres as number) : 0);
    while (porLiberar() > 0) {
      const lote = await masAntiguas();
      if (!lote.length) break;
      resultado.porCapacidad += await borrarFotos(lasNecesarias(lote, directorio, porLiberar()));
      medir();
    }
    resultado.faltaEspacio = resultado.bytes > maximo || discoBajo();
  }

  const total = resultado.porAntiguedad + resultado.porCapacidad + resultado.huerfanas;
  if (total) {
    await auditoriaSql.operacion(ACTOR_SISTEMA, 'EVIDENCIA_DEPURADA', 'deteccion', null,
      `${total} fotos: ${resultado.porAntiguedad} con más de ${dias} días, ${resultado.porCapacidad} por capacidad, ${resultado.huerfanas} sin registro`);
  }
  if (resultado.faltaEspacio) {
    await notificar({
      tipo: 'sistema.almacenamiento',
      titulo: 'Poco espacio para las fotos de los ingresos',
      mensaje: `Las fotos ocupan ${(resultado.bytes / BYTES_GB).toFixed(1)} GB y ya solo quedan las de alertas de la lista negra, que no se borran solas. Libere disco o amplíe el máximo en Configuración.`,
      enlace: '/configuracion',
      claveDedup: 'sistema.almacenamiento',
    });
  }
  return resultado;
}
