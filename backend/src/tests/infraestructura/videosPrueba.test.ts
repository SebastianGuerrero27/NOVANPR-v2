import fs from 'fs';
import os from 'os';
import path from 'path';
import { videosPrueba } from '../../infraestructura/servicios/videosPrueba';

/** Videos de prueba en disco: firma, tamaño máximo, nombres generados y sin archivos a medias. */

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom\0\0\x02\0', 'latin1')]);
async function* trozos(...partes: Buffer[]) { for (const p of partes) yield new Uint8Array(p); }

describe('Videos de prueba · almacenamiento', () => {
  const entorno = { ...process.env };
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'videos-prueba-'));
    process.env.VIDEOS_PRUEBA_DIR = dir;
    delete process.env.VIDEOS_PRUEBA_MAX_MB;
  });
  afterEach(() => {
    process.env = { ...entorno };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sin VIDEOS_PRUEBA_DIR la función está deshabilitada', () => {
    delete process.env.VIDEOS_PRUEBA_DIR;
    expect(videosPrueba.maximoBytes()).toBeNull();
    process.env.VIDEOS_PRUEBA_DIR = dir;
    process.env.VIDEOS_PRUEBA_MAX_MB = '500';
    expect(videosPrueba.maximoBytes()).toBe(500 * 1048576);
  });

  it('guarda el video con un nombre generado y la extensión de su firma (aunque llegue en trozos de 1 byte)', async () => {
    const cuerpo = Buffer.concat([MP4, Buffer.alloc(4096, 7)]);
    const r = await videosPrueba.guardar(trozos(...[...cuerpo].map(b => Buffer.from([b]))), 1048576);
    expect(r).toEqual({ ok: true, valor: { archivo: expect.stringMatching(/^[a-f0-9]{32}\.mp4$/), bytes: cuerpo.length } });
    if (!r.ok) return;
    expect(fs.readFileSync(path.join(dir, r.valor.archivo)).equals(cuerpo)).toBe(true);
    expect(fs.readdirSync(dir)).toEqual([r.valor.archivo]);
  });

  it('rechaza lo que no es video o supera el máximo sin dejar archivos', async () => {
    expect(await videosPrueba.guardar(trozos(Buffer.from('<html><body>no es video</body></html>')), 1048576))
      .toEqual({ ok: false, error: 'El archivo no es un video MP4, MKV o MOV.' });
    expect(await videosPrueba.guardar(trozos(MP4, Buffer.alloc(2048)), 1024))
      .toEqual({ ok: false, error: 'El video supera el máximo de 0 MB.' });
    expect(await videosPrueba.guardar(trozos(), 1024)).toMatchObject({ ok: false });
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('eliminar solo borra nombres generados por el sistema dentro de la carpeta', async () => {
    const fuera = path.join(dir, '..', `fuera-${path.basename(dir)}.txt`);
    fs.writeFileSync(fuera, 'x');
    await videosPrueba.eliminar(`../${path.basename(fuera)}`);
    expect(fs.existsSync(fuera)).toBe(true);
    fs.rmSync(fuera);
    const r = await videosPrueba.guardar(trozos(MP4), 1048576);
    if (!r.ok) throw new Error(r.error);
    await videosPrueba.eliminar(r.valor.archivo);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
