import fs from 'fs';
import path from 'path';

const mockQuery = jest.fn().mockResolvedValue({ rows: [{ n: 1 }] });
const mockOn = jest.fn();
const mockEnd = jest.fn().mockResolvedValue(undefined);
jest.mock('../../infraestructura/postgres', () => ({
  PostgresPool: jest.fn().mockImplementation(() => ({ query: mockQuery, on: mockOn, end: mockEnd })),
}));
jest.mock('../../infraestructura/servicios/configuracion', () => ({ cargarConfiguracion: jest.fn() }));

import { connectDB } from '../../infraestructura/db';

const carpeta = path.resolve(__dirname, '../../../../db/postgresql');
const migracion = fs.readFileSync(path.join(carpeta, 'migracion_renombrar_lista_blanca.sql'), 'utf8');
const esquema = fs.readFileSync(path.join(carpeta, 'esquema.sql'), 'utf8');

beforeEach(() => { mockQuery.mockClear(); mockOn.mockClear(); mockEnd.mockClear(); });

it('renombra el padrón antes de inicializar el esquema o aplicar ampliaciones', async () => {
  await connectDB();
  const consultas = mockQuery.mock.calls.map(([texto]) => String(texto));
  const renombrar = consultas.indexOf(migracion);
  const crear = consultas.indexOf(esquema);
  expect(renombrar).toBeGreaterThan(0);
  expect(renombrar).toBeLessThan(crear);
  const ampliar = fs.readFileSync(path.join(carpeta, 'migracion_campos_permisos.sql'), 'utf8');
  expect(consultas.indexOf(ampliar)).toBeGreaterThan(crear);
  expect(consultas.filter(q => /ALTER TABLE vehiculosautorizados/i.test(q))).toEqual([]);
});

it('la migración conserva la entidad y rechaza conflictos sin copiar ni eliminar datos', () => {
  expect(migracion).toContain('ALTER TABLE %I.vehiculosautorizados RENAME TO listablanca');
  expect(migracion).toContain('tabla_anterior IS NOT NULL AND tabla_nueva IS NOT NULL');
  expect(migracion).toContain("clase_anterior NOT IN ('r', 'p')");
  expect(migracion).toContain("clase_nueva NOT IN ('r', 'p')");
  expect(migracion).not.toMatch(/\b(?:INSERT\s+INTO|DELETE\s+FROM|DROP\s+TABLE|CREATE\s+TABLE)\b/i);
});

it('el esquema nuevo conserva los enlaces y no crea una segunda tabla para el mismo padrón', () => {
  expect(esquema).toContain('CREATE TABLE IF NOT EXISTS "listablanca" (');
  expect(esquema).not.toContain('CREATE TABLE IF NOT EXISTS "vehiculosautorizados" (');
  expect(esquema.match(/REFERENCES "listablanca"\(id\)/g)).toHaveLength(2);
  expect(esquema.indexOf('$lista_blanca_guard$')).toBeLessThan(esquema.indexOf('CREATE TABLE'));
  expect(esquema).toContain('no se creará una lista blanca paralela');
});
