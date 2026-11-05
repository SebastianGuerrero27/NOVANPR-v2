import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Conservación de las fotos con la base simulada y una carpeta real: por antigüedad, por capacidad y
 * huérfanas. Se borra la foto y se conserva el registro; las alertas no se borran solas.
 */
interface Paso { id: number; ruta_imagen_ingreso: string | null; ruta_imagen_placa: string | null; estado_validacion: string; dias: number }

let mockPasos: Paso[] = [];
const mockAuditoria = jest.fn();
const mockNotificar = jest.fn();
const mockConfig: Record<string, number> = { evidencia_retencion_dias: 90, evidencia_disco_maximo_gb: 15 };
let mockDirectorio = '';

jest.mock('../../infraestructura/db', () => ({
  getDB: () => ({
    request: () => {
      const entradas: Record<string, unknown> = {};
      const r: any = {
        input: (nombre: string, _tipo: unknown, valor: unknown) => { entradas[nombre] = valor; return r; },
        query: async (texto: string) => {
          if (texto.startsWith('UPDATE')) {
            const ids = (texto.match(/IN \(([\d,]+)\)/)?.[1] ?? '').split(',').map(Number);
            for (const p of mockPasos) if (ids.includes(p.id)) { p.ruta_imagen_ingreso = null; p.ruta_imagen_placa = null; }
            return { recordset: [] };
          }
          if (texto.includes('regexp_replace')) {
            const nombres = Object.values(entradas) as string[];
            return { recordset: mockPasos.filter(p => nombres.includes(path.basename(p.ruta_imagen_ingreso ?? '')) || nombres.includes(path.basename(p.ruta_imagen_placa ?? ''))) };
          }
          const candidatas = mockPasos.filter(p => (p.ruta_imagen_ingreso || p.ruta_imagen_placa) && p.estado_validacion !== 'alerta'
            && (entradas.dias === undefined || p.dias > (entradas.dias as number)));
          return { recordset: candidatas.sort((a, b) => b.dias - a.dias).slice(0, entradas.lote as number) };
        },
      };
      return r;
    },
  }),
}));
jest.mock('../../infraestructura/adaptadores', () => ({ auditoriaSql: { operacion: (...a: unknown[]) => mockAuditoria(...a) } }));
jest.mock('../../infraestructura/servicios/notificaciones', () => ({ notificar: (...a: unknown[]) => mockNotificar(...a) }));
jest.mock('../../infraestructura/servicios/configuracion', () => ({ config: { entero: (clave: string) => mockConfig[clave] } }));
jest.mock('../../infraestructura/servicios/media', () => {
  const real = jest.requireActual('../../infraestructura/servicios/media');
  const fsReal = jest.requireActual('fs');
  const pathReal = jest.requireActual('path');
  return {
    ...real,
    eliminarEvidencia: async (rutas: (string | null)[]) => {
      let n = 0;
      for (const a of new Set(rutas.map(real.archivoDe).filter(Boolean)) as Set<string>) {
        try { fsReal.unlinkSync(pathReal.join(mockDirectorio, a)); n++; } catch { /* no estaba */ }
      }
      return n;
    },
  };
});

import { depurarEvidencia } from '../../infraestructura/servicios/conservacionEvidencia';

function foto(nombre: string, bytes = 1000, diasAtras = 0): string {
  const ruta = path.join(mockDirectorio, nombre);
  fs.writeFileSync(ruta, Buffer.alloc(bytes));
  if (diasAtras) { const t = new Date(Date.now() - diasAtras * 86_400_000); fs.utimesSync(ruta, t, t); }
  return `/media/${nombre}`;
}
const paso = (id: number, dias: number, estado = 'autorizado', bytes = 1000): Paso => ({
  id, dias, estado_validacion: estado,
  ruta_imagen_ingreso: foto(`ingreso_${id}.jpg`, bytes, dias), ruta_imagen_placa: foto(`placa_${id}.jpg`, bytes, dias),
});
const existe = (nombre: string) => fs.existsSync(path.join(mockDirectorio, nombre));

beforeEach(() => {
  mockDirectorio = fs.mkdtempSync(path.join(os.tmpdir(), 'evidencia-'));
  mockPasos = [];
  mockAuditoria.mockClear();
  mockNotificar.mockClear();
  mockConfig.evidencia_retencion_dias = 90;
  mockConfig.evidencia_disco_maximo_gb = 15;
});
afterEach(() => fs.rmSync(mockDirectorio, { recursive: true, force: true }));

describe('Conservación de las fotos de los pasos', () => {
  it('borra la foto vencida, conserva el registro y lo deja en la auditoría', async () => {
    mockPasos = [paso(1, 120), paso(2, 10)];
    const r = await depurarEvidencia(mockDirectorio);
    expect(r.porAntiguedad).toBe(2);
    expect(existe('ingreso_1.jpg') || existe('placa_1.jpg')).toBe(false);
    expect(existe('ingreso_2.jpg') && existe('placa_2.jpg')).toBe(true);
    expect(mockPasos[0]).toMatchObject({ id: 1, ruta_imagen_ingreso: null, ruta_imagen_placa: null });
    expect(mockPasos[1].ruta_imagen_ingreso).not.toBeNull();
    expect(mockAuditoria).toHaveBeenCalledTimes(1);
    expect(mockAuditoria.mock.calls[0][1]).toBe('EVIDENCIA_DEPURADA');
    expect(mockAuditoria.mock.calls[0][4]).toContain('2 fotos');
  });

  it('una pasada sin nada que borrar no deja rastro en la auditoría', async () => {
    mockPasos = [paso(1, 10)];
    expect(await depurarEvidencia(mockDirectorio)).toMatchObject({ porAntiguedad: 0, porCapacidad: 0, huerfanas: 0 });
    expect(mockAuditoria).not.toHaveBeenCalled();
    expect(mockNotificar).not.toHaveBeenCalled();
  });

  it('las fotos de una alerta no se borran por antigüedad', async () => {
    mockPasos = [paso(1, 400, 'alerta')];
    await depurarEvidencia(mockDirectorio);
    expect(existe('ingreso_1.jpg')).toBe(true);
    expect(mockPasos[0].ruta_imagen_ingreso).not.toBeNull();
  });

  it('una foto sin registro se borra solo si es más vieja que la retención', async () => {
    foto('huerfana_vieja.jpg', 100, 120);
    foto('huerfana_nueva.jpg', 100, 5);
    foto('lista_blanca_1.jpg', 100, 120);
    fs.writeFileSync(path.join(mockDirectorio, 'notas.txt'), 'no es una foto');
    const r = await depurarEvidencia(mockDirectorio);
    expect(r.huerfanas).toBe(1);
    expect(existe('huerfana_vieja.jpg')).toBe(false);
    expect(existe('huerfana_nueva.jpg') && existe('lista_blanca_1.jpg') && existe('notas.txt')).toBe(true);
  });

  it('una foto vieja que un registro usa no se trata como huérfana', async () => {
    mockPasos = [paso(1, 400, 'alerta')];
    expect((await depurarEvidencia(mockDirectorio)).huerfanas).toBe(0);
    expect(existe('placa_1.jpg')).toBe(true);
  });

  it('al superar el máximo borra primero las más viejas y baja del 90 %', async () => {
    mockConfig.evidencia_disco_maximo_gb = 0.000004; // ~4,3 KB
    mockPasos = [paso(1, 30), paso(2, 20), paso(3, 10)]; // 6 KB en 6 fotos
    const r = await depurarEvidencia(mockDirectorio);
    expect(r.porCapacidad).toBeGreaterThan(0);
    expect(existe('ingreso_1.jpg')).toBe(false);
    expect(existe('ingreso_3.jpg')).toBe(true);
    expect(r.bytes).toBeLessThanOrEqual(0.9 * 0.000004 * 1024 ** 3);
    expect(r.faltaEspacio).toBe(false);
  });

  it('si solo quedan alertas y falta espacio, avisa y no las borra', async () => {
    mockConfig.evidencia_disco_maximo_gb = 0.000001; // ~1 KB
    mockPasos = [paso(1, 400, 'alerta', 2000)];
    const r = await depurarEvidencia(mockDirectorio);
    expect(r.faltaEspacio).toBe(true);
    expect(existe('ingreso_1.jpg')).toBe(true);
    expect(mockNotificar).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'sistema.almacenamiento', claveDedup: 'sistema.almacenamiento' }));
  });

  it('sin carpeta de fotos no hace nada', async () => {
    mockPasos = [{ id: 1, dias: 400, estado_validacion: 'autorizado', ruta_imagen_ingreso: '/media/x.jpg', ruta_imagen_placa: null }];
    expect(await depurarEvidencia('')).toMatchObject({ porAntiguedad: 0 });
    expect(mockPasos[0].ruta_imagen_ingreso).toBe('/media/x.jpg');
  });
});
