import { archivoDeVideo, esUrlVideo, formatoPorFirma, leerVideoPrueba, presentarCamara, urlDeVideo } from '../../dominio/camaras';

/** Cámaras de prueba con un video cargado: firma del archivo, URL video:// y datos de la carga. */

const bytes = (texto: string, prefijo: number[] = []) => new Uint8Array([...prefijo, ...Buffer.from(texto, 'latin1')]);
const MP4 = bytes('ftypisom\0\0\x02\0', [0, 0, 0, 0x20]);
const MOV = bytes('ftypqt  \0\0\0\0', [0, 0, 0, 0x14]);
const MKV = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81]);
const MAX = 2048 * 1048576;

describe('Cámara de prueba con video', () => {
  it('reconoce MP4, MOV y MKV por su firma, no por la extensión', () => {
    expect(formatoPorFirma(MP4)).toBe('mp4');
    expect(formatoPorFirma(MOV)).toBe('mov');
    expect(formatoPorFirma(MKV)).toBe('mkv');
    expect(formatoPorFirma(bytes('\x89PNG\r\n\x1a\n\0\0\0\r'))).toBeNull();
    expect(formatoPorFirma(bytes('<!doctype html>'))).toBeNull();
    expect(formatoPorFirma(new Uint8Array([0, 0, 0]))).toBeNull();
  });

  it('URL video://: solo nombres generados por el sistema (sin rutas ni otras extensiones)', () => {
    const archivo = `${'c'.repeat(32)}.mp4`;
    expect(urlDeVideo(archivo)).toBe(`video://${archivo}`);
    expect(archivoDeVideo(`video://${archivo}`)).toBe(archivo);
    for (const url of ['video://../etc/passwd', `video://${'c'.repeat(32)}.exe`, `video:///videos/${archivo}`, 'rtsp://10.0.0.5/101']) {
      expect(esUrlVideo(url)).toBe(false);
    }
  });

  it('valida nombre, ubicación, dirección y tamaño declarado antes de leer el archivo', () => {
    const datos = { nombre: 'Garita video 19-10', ubicacion: 'Entrada ECU 911 Ambato' };
    expect(leerVideoPrueba(datos, 755766149, MAX)).toEqual({ ok: true, valor: { ...datos, direccion: 'ingreso' } });
    expect(leerVideoPrueba({ ...datos, direccion: 'salida' }, 1000, MAX)).toMatchObject({ ok: true, valor: { direccion: 'salida' } });
    expect(leerVideoPrueba(datos, MAX + 1, MAX)).toEqual({ ok: false, error: 'El video supera el máximo de 2048 MB.' });
    expect(leerVideoPrueba(datos, null, MAX).ok).toBe(false);
    expect(leerVideoPrueba(datos, 0, MAX).ok).toBe(false);
    expect(leerVideoPrueba({ ...datos, nombre: ['a', 'b'] }, 1000, MAX).ok).toBe(false);
    expect(leerVideoPrueba({ ...datos, direccion: 'norte' }, 1000, MAX).ok).toBe(false);
  });

  it('la API la presenta como video, sin credenciales', () => {
    const c = presentarCamara({
      id: 7, nombre: 'Garita video', ip: 'localhost', rtsp_url: `video://${'d'.repeat(32)}.mkv`, ubicacion: 'Entrada', activa: true,
      estado: 'EN_LINEA', ultimo_ping: null, tiempo_respuesta_ms: null, mensaje_ping: null, created_at: new Date(), roi: null,
    } as never);
    expect(c).toMatchObject({ es_video: true, tiene_credenciales: false });
    expect(presentarCamara({ ...c, rtsp_url: 'rtsp://admin:x@10.0.0.5/101' } as never).es_video).toBe(false);
  });
});
