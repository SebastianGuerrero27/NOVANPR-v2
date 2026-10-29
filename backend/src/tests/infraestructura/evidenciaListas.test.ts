import fs from 'fs';
import os from 'os';
import path from 'path';
import { conservarEvidenciaListas, recuperarEvidenciasListas } from '../../infraestructura/servicios/evidenciaListas';
import { eliminarEvidencia, DIRECTORIO_EVIDENCIA_LISTAS, DIRECTORIOS_MEDIA } from '../../infraestructura/servicios/media';
import { casosDetecciones, type DependenciasDetecciones } from '../../aplicacion/detecciones';

type Registro = { id: number; placa: string; ruta_evidencia_vehiculo: string | null; ruta_evidencia_placa: string | null;
  fecha_evidencia_vehiculo?: Date; fecha_evidencia_placa?: Date };
let directorio: string;
const fila = (extra: Record<string, unknown> = {}) => ({ id: 10, placa_reconocida: 'pba-1234',
  tipo_movimiento: 'ingreso', estado_procesamiento: 'procesado', lectura_valida: true,
  fecha_hora_ingreso: '2026-10-28T12:00:00Z', ruta_imagen_ingreso: 'vehiculo.jpg', ruta_imagen_placa: 'placa.jpg', ...extra });

function base(placa = 'PBA1234') {
  const listas: Record<string, Registro[]> = {
    vehiculosautorizados: [{ id: 7, placa, ruta_evidencia_vehiculo: null, ruta_evidencia_placa: null }],
    listanegra: [{ id: 8, placa, ruta_evidencia_vehiculo: null, ruta_evidencia_placa: null }],
  };
  const query = jest.fn(async (sql: string, args: any[] = []) => {
    const tabla = sql.includes('vehiculosautorizados') ? 'vehiculosautorizados' : 'listanegra';
    if (sql.includes('SELECT id,')) return { rows: listas[tabla].filter(r => r.placa === args[0]
      && (!r.ruta_evidencia_vehiculo || !r.ruta_evidencia_placa)) };
    if (sql.includes('UPDATE ')) {
      const registro = listas[tabla].find(r => r.id === args[0])!;
      if (args[1] && !registro.ruta_evidencia_vehiculo) {
        registro.ruta_evidencia_vehiculo = args[1]; registro.fecha_evidencia_vehiculo = args[3];
      }
      if (args[2] && !registro.ruta_evidencia_placa) {
        registro.ruta_evidencia_placa = args[2]; registro.fecha_evidencia_placa = args[3];
      }
    }
    return { rows: [] };
  });
  const release = jest.fn();
  return { listas, query, release, connect: jest.fn(async () => ({ query, release })) };
}

beforeEach(async () => {
  directorio = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'anpr-listas-'));
  await fs.promises.writeFile(path.join(directorio, 'vehiculo.jpg'), 'foto de vehículo');
  await fs.promises.writeFile(path.join(directorio, 'placa.jpg'), 'recorte real');
});
afterEach(async () => { await fs.promises.rm(directorio, { recursive: true, force: true }); });

it('conserva copias independientes para ambas listas y la fecha del paso, sin sustituir la primera foto', async () => {
  const db = base(); const avisar = jest.fn();
  await conservarEvidenciaListas(db as any, fila(), { directorios: [directorio], directorioDestino: directorio, alGuardar: avisar });
  const primera = { ...db.listas.vehiculosautorizados[0] };
  for (const r of Object.values(db.listas).flat()) {
    expect(r.ruta_evidencia_vehiculo).toContain('lista_');
    expect(r.ruta_evidencia_placa).not.toBe(r.ruta_evidencia_vehiculo);
    expect(await fs.promises.readFile(r.ruta_evidencia_placa!, 'utf8')).toBe('recorte real');
    expect(r.fecha_evidencia_vehiculo?.toISOString()).toBe('2026-10-28T12:00:00.000Z');
  }
  await fs.promises.writeFile(path.join(directorio, 'vehiculo.jpg'), 'otro paso');
  await conservarEvidenciaListas(db as any, fila({ fecha_hora_ingreso: '2026-10-29T12:00:00Z' }), { directorios: [directorio], directorioDestino: directorio, alGuardar: avisar });
  expect(db.listas.vehiculosautorizados[0]).toEqual(primera);
  expect(await fs.promises.readFile(primera.ruta_evidencia_vehiculo!, 'utf8')).toBe('foto de vehículo');
  expect(avisar.mock.calls).toEqual([['autorizado'], ['lista_negra']]);
  expect(db.query.mock.calls.find(([sql]) => sql.includes('SELECT id,'))?.[0]).toContain('FOR UPDATE');
});

it('borrar la detección y sus archivos originales conserva las fotos propias de las listas', async () => {
  const db = base();
  await conservarEvidenciaListas(db as any, fila(), { directorios: [directorio], directorioDestino: directorio });
  DIRECTORIOS_MEDIA.unshift(directorio);
  try { expect(await eliminarEvidencia(['vehiculo.jpg', 'placa.jpg'])).toBe(2); }
  finally { DIRECTORIOS_MEDIA.shift(); }
  for (const r of Object.values(db.listas).flat()) {
    expect(fs.existsSync(r.ruta_evidencia_vehiculo!)).toBe(true);
    expect(fs.existsSync(r.ruta_evidencia_placa!)).toBe(true);
  }
});

it('una foto entera no cuenta como recorte; completa solo la columna pendiente cuando llega la placa', async () => {
  const db = base();
  await conservarEvidenciaListas(db as any, fila({ ruta_imagen_placa: 'vehiculo.jpg' }), { directorios: [directorio], directorioDestino: directorio });
  const primera = db.listas.vehiculosautorizados[0].ruta_evidencia_vehiculo;
  expect(db.listas.vehiculosautorizados[0].ruta_evidencia_placa).toBeNull();
  await conservarEvidenciaListas(db as any, fila(), { directorios: [directorio], directorioDestino: directorio });
  expect(db.listas.vehiculosautorizados[0].ruta_evidencia_vehiculo).toBe(primera);
  expect(db.listas.vehiculosautorizados[0].ruta_evidencia_placa).toEqual(expect.any(String));
});

it('no guarda un archivo ausente ni asocia una alerta aproximada a otra matrícula', async () => {
  const db = base('PBA1235');
  await conservarEvidenciaListas(db as any, fila({ alerta_id: 8 }), { directorios: [directorio], directorioDestino: directorio });
  expect(db.listas.listanegra[0].ruta_evidencia_vehiculo).toBeNull();
  const exacta = base();
  await conservarEvidenciaListas(exacta as any, fila({ ruta_imagen_ingreso: 'ausente.jpg', ruta_imagen_placa: null }), { directorios: [directorio], directorioDestino: directorio });
  expect(exacta.listas.vehiculosautorizados[0].ruta_evidencia_vehiculo).toBeNull();
  const seleccion = db.query.mock.calls.find(([sql]) => sql.includes('SELECT id,'));
  expect(seleccion?.[0]).toContain("UPPER(REPLACE(REPLACE(placa, '-', ''), ' ', '')) = $1");
  expect(seleccion?.[1]).toEqual(['PBA1234']);
});

it.each([{ tipo_movimiento: 'salida' }, { lectura_valida: false }, { lectura_valida: null }, { estado_procesamiento: 'pendiente_ocr' },
  { estado_procesamiento: 'no_legible' }, { placa_reconocida: 'HAVAL' }, { placa_reconocida: null }])('no confirma evidencia de un paso no utilizable: %j', async cambio => {
  const db = base();
  await conservarEvidenciaListas(db as any, fila(cambio), { directorios: [directorio], directorioDestino: directorio });
  expect(db.connect).not.toHaveBeenCalled();
});

it.each([{ segundo_ocr_pendiente: true }, JSON.stringify({ segundo_ocr_pendiente: true })])('espera el segundo OCR antes de dejar constancia: %j', async evidencia => {
  const db = base();
  await conservarEvidenciaListas(db as any, fila({ evidencia_lectura: evidencia }), { directorios: [directorio], directorioDestino: directorio });
  expect(db.connect).not.toHaveBeenCalled();
  await conservarEvidenciaListas(db as any, fila({ evidencia_lectura: { formato: true, lecturas: 3 } }), { directorios: [directorio], directorioDestino: directorio });
  expect(db.listas.vehiculosautorizados[0].ruta_evidencia_vehiculo).toEqual(expect.any(String));
});

it('la confirmación manual permite conservar fotos aunque el veredicto automático esté pendiente', async () => {
  const db = base();
  await conservarEvidenciaListas(db as any, fila({ validado_manualmente: true, lectura_valida: null,
    evidencia_lectura: { segundo_ocr_pendiente: true } }), { directorios: [directorio], directorioDestino: directorio });
  expect(db.listas.vehiculosautorizados[0].ruta_evidencia_vehiculo).toEqual(expect.any(String));
});

it('si falla la escritura SQL revierte y borra las copias incompletas', async () => {
  const db = base();
  const query = db.query;
  db.connect.mockImplementation(async () => ({ release: db.release,
    query: jest.fn(async (sql: string, args?: any[]) => {
      if (sql.startsWith('UPDATE ')) throw new Error('disco SQL no disponible');
      return query(sql, args);
    }) }));
  await expect(conservarEvidenciaListas(db as any, fila(), { directorios: [directorio], directorioDestino: directorio })).rejects.toThrow('disco SQL');
  expect(await fs.promises.readdir(directorio)).toEqual(['placa.jpg', 'vehiculo.jpg']);
  expect(query).toHaveBeenCalledWith('ROLLBACK', undefined);
});

it('la recuperación usa pasos exactos en orden cronológico y no cambia sus decisiones', async () => {
  const db = base();
  db.query.mockResolvedValueOnce({ rows: [] });
  await recuperarEvidenciasListas(db as any);
  const sql = db.query.mock.calls[0][0];
  expect(sql).toContain('ORDER BY d.fecha_hora_ingreso ASC, d.id ASC');
  expect(sql).toContain("d.tipo_movimiento = 'ingreso'");
  expect(sql).not.toContain('UPDATE deteccionvehiculo');
});

it('la reevaluación final de una alerta conserva fotos con la evidencia nueva sin cambiar la alerta', async () => {
  const actual = fila({ estado_validacion: 'alerta', evidencia_lectura: JSON.stringify({ segundo_ocr_pendiente: true }) });
  const conservar = jest.fn().mockResolvedValue(undefined);
  const guardarVeredicto = jest.fn();
  const deps = {
    repositorio: { obtener: jest.fn().mockResolvedValue(actual), guardarVeredicto },
    evidenciaListas: { conservar }, presentar: (f: any) => f,
    eventos: { emitir: jest.fn() },
  } as unknown as DependenciasDetecciones;
  const nueva = { valido: true, formato: true, lecturas: 3 };
  const r = await casosDetecciones(deps).reevaluar({ ingreso_id: 10, placa_reconocida: 'PBA1234',
    lectura_valida: true, evidencia_lectura: nueva });
  expect(conservar).toHaveBeenCalledWith(expect.objectContaining({ estado_validacion: 'alerta', lectura_valida: true,
    ruta_imagen_placa: 'placa.jpg', evidencia_lectura: nueva }));
  expect(r.deteccion?.estado_validacion).toBe('alerta');
  expect(guardarVeredicto).not.toHaveBeenCalled();
});

it('lee las imágenes del motor sin escribir en su carpeta y guarda en un destino independiente', async () => {
  const db = base();
  const origen = path.join(directorio, 'motor-solo-lectura');
  const destino = path.join(directorio, 'evidencia-listas');
  await fs.promises.mkdir(origen);
  await fs.promises.writeFile(path.join(origen, 'vehiculo.jpg'), 'vehículo original');
  await fs.promises.writeFile(path.join(origen, 'placa.jpg'), 'placa original');
  await fs.promises.chmod(origen, 0o555);
  try {
    await conservarEvidenciaListas(db as any, fila(), { directorios: [origen], directorioDestino: destino });
    expect(await fs.promises.readdir(origen)).toEqual(['placa.jpg', 'vehiculo.jpg']);
    for (const r of Object.values(db.listas).flat()) {
      expect(path.dirname(r.ruta_evidencia_vehiculo!)).toBe(destino);
      expect(path.dirname(r.ruta_evidencia_placa!)).toBe(destino);
      expect(await fs.promises.readFile(r.ruta_evidencia_placa!, 'utf8')).toBe('placa original');
    }
    expect(DIRECTORIOS_MEDIA).toContain(DIRECTORIO_EVIDENCIA_LISTAS);
  } finally { await fs.promises.chmod(origen, 0o755); }
});
