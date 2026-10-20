/**
 * Cámaras de prueba con un video cargado: la misma regla de la firma que aplica el backend
 * (backend/src/dominio/camaras.ts), para avisar antes de subir un archivo que no es video.
 */

export type FormatoVideo = 'mp4' | 'mkv' | 'mov';

/** Formato por la firma (ISO BMFF "ftyp" en el byte 4, marca "qt  " = QuickTime; o Matroska 1A 45 DF A3); null si no es video. */
export function formatoPorFirma(cabecera: Uint8Array): FormatoVideo | null {
  if (cabecera.length >= 4 && cabecera[0] === 0x1a && cabecera[1] === 0x45 && cabecera[2] === 0xdf && cabecera[3] === 0xa3) return 'mkv';
  if (cabecera.length >= 12 && String.fromCharCode(...cabecera.slice(4, 8)) === 'ftyp') {
    return String.fromCharCode(...cabecera.slice(8, 12)) === 'qt  ' ? 'mov' : 'mp4';
  }
  return null;
}

export const TIPO_CONTENIDO: Record<FormatoVideo, string> = { mp4: 'video/mp4', mkv: 'video/x-matroska', mov: 'video/quicktime' };

/** Nombre propuesto para la cámara a partir del archivo: "ENTRADA_ECU_001_2026-10-19-07-40-44…mp4" → "ENTRADA ECU 001 2026-10-19". */
export function nombreDesdeArchivo(archivo: string): string {
  const base = archivo.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const fecha = base.match(/^(.*?\d{4}-\d{2}-\d{2})/);
  const nombre = (fecha ? fecha[1] : base).replace(/[^\p{L}\p{N} .\-/]/gu, '').slice(0, 100).trim();
  return nombre.length >= 3 ? nombre : 'Video de prueba';
}
