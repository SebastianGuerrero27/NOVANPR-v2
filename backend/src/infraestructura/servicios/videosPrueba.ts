import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { PuertoVideosPrueba } from '../../aplicacion/camaras';
import { formatoPorFirma } from '../../dominio/camaras';

/**
 * Videos de las cámaras de prueba en disco (VIDEOS_PRUEBA_DIR). La misma carpeta está montada en
 * el servidor de medios (/videos, solo lectura), que publica cada archivo con FFmpeg. Sin la
 * variable la función queda deshabilitada (producción, salvo que se habilite a propósito).
 *
 * El nombre del archivo lo genera el sistema (32 hex + extensión por la firma): lo que envía el
 * navegador nunca llega a una ruta del disco.
 */
const carpeta = () => process.env.VIDEOS_PRUEBA_DIR || '';
const MB_POR_OMISION = 2048;
const RE_ARCHIVO = /^[a-f0-9]{32}\.(mp4|mkv|mov)$/;

function maximoBytes(): number | null {
  if (!carpeta()) return null;
  const mb = Number(process.env.VIDEOS_PRUEBA_MAX_MB || MB_POR_OMISION);
  return (Number.isFinite(mb) && mb > 0 ? mb : MB_POR_OMISION) * 1048576;
}

async function guardar(contenido: AsyncIterable<Uint8Array>, maximo: number) {
  const dir = carpeta();
  await fs.promises.mkdir(dir, { recursive: true });
  const base = crypto.randomBytes(16).toString('hex');
  const parcial = path.join(dir, `${base}.parcial`);
  const salida = fs.createWriteStream(parcial, { flags: 'wx' });
  let bytes = 0;
  let cabecera = Buffer.alloc(0);
  let error: string | null = null;
  try {
    for await (const trozo of contenido) {
      bytes += trozo.length;
      // Más bytes que el máximo (y que el Content-Length ya validado): se corta la conexión
      if (bytes > maximo) { error = `El video supera el máximo de ${Math.floor(maximo / 1048576)} MB.`; break; }
      // Firma inválida: el resto se descarta sin escribir, para que la respuesta llegue al navegador
      if (error) continue;
      if (cabecera.length < 12) {
        cabecera = Buffer.concat([cabecera, Buffer.from(trozo)]).subarray(0, 12);
        if (cabecera.length >= 12 && !formatoPorFirma(cabecera)) { error = 'El archivo no es un video MP4, MKV o MOV.'; continue; }
      }
      if (!salida.write(trozo)) await new Promise<void>(r => salida.once('drain', () => r()));
    }
  } catch {
    error = 'La carga del video se interrumpió.';
  }
  await new Promise<void>(r => salida.end(() => r()));
  const formato = formatoPorFirma(cabecera);
  if (!error && (!formato || bytes === 0)) error = 'El archivo no es un video MP4, MKV o MOV.';
  if (error) {
    await fs.promises.rm(parcial, { force: true });
    return { ok: false as const, error };
  }
  const archivo = `${base}.${formato}`;
  await fs.promises.rename(parcial, path.join(dir, archivo));
  return { ok: true as const, valor: { archivo, bytes } };
}

async function eliminar(archivo: string): Promise<void> {
  if (!carpeta() || !RE_ARCHIVO.test(archivo)) return;
  await fs.promises.rm(path.join(carpeta(), archivo), { force: true });
}

export const videosPrueba: PuertoVideosPrueba = { maximoBytes, guardar, eliminar };
