import fs from 'fs';
import path from 'path';

/**
 * PostgreSQL no convierte 0 o 1 a booleano en un INSERT, y el traductor de SQL solo corrige las
 * comparaciones y los SET. Un `VALUES (..., 1, ...)` en una columna booleana compila, pasa las pruebas
 * con base simulada y falla en producción: así estuvo roto el registro manual de ingresos.
 */
const RAIZ = path.resolve(__dirname, '../..');

const esquema = fs.readFileSync(path.resolve(RAIZ, '../../db/postgresql/esquema.sql'), 'utf8');
const BOOLEANAS = new Set([...esquema.matchAll(/\b(\w+)\s+boolean\b/gi)].map(m => m[1].toLowerCase()));

function archivos(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'tests' ? [] : archivos(ruta);
    return e.name.endsWith('.ts') ? [ruta] : [];
  });
}

/** Parte por comas de primer nivel: las funciones como COALESCE(a, b) cuentan como un solo valor. */
function partir(lista: string): string[] {
  const partes: string[] = [];
  let actual = '', nivel = 0, comilla = false;
  for (const c of lista) {
    if (c === "'") comilla = !comilla;
    if (!comilla && c === '(') nivel++;
    if (!comilla && c === ')') nivel--;
    if (!comilla && nivel === 0 && c === ',') { partes.push(actual.trim()); actual = ''; } else actual += c;
  }
  partes.push(actual.trim());
  return partes;
}

function cierre(texto: string, abre: number): number {
  let nivel = 0, comilla = false;
  for (let i = abre; i < texto.length; i++) {
    if (texto[i] === "'") comilla = !comilla;
    if (comilla) continue;
    if (texto[i] === '(') nivel++;
    if (texto[i] === ')' && --nivel === 0) return i;
  }
  return -1;
}

function violaciones(texto: string): string[] {
  const halladas: string[] = [];
  for (const m of texto.matchAll(/INSERT\s+INTO\s+"?(\w+)"?\s*\(/gi)) {
    const abre = (m.index ?? 0) + m[0].length - 1;
    const finColumnas = cierre(texto, abre);
    if (finColumnas < 0) continue;
    const resto = texto.slice(finColumnas + 1);
    const valores = resto.match(/^\s*(?:OUTPUT\s+[^\n]*?\s+)?VALUES\s*\(/i);
    if (!valores) continue;
    const abreValores = finColumnas + 1 + valores[0].length - 1;
    const finValores = cierre(texto, abreValores);
    if (finValores < 0) continue;
    const columnas = partir(texto.slice(abre + 1, finColumnas));
    const datos = partir(texto.slice(abreValores + 1, finValores));
    columnas.forEach((columna, i) => {
      if (BOOLEANAS.has(columna.toLowerCase()) && /^[01]$/.test(datos[i] ?? '')) halladas.push(`${m[1]}.${columna} = ${datos[i]}`);
    });
  }
  return halladas;
}

describe('SQL · booleanos en los INSERT (PostgreSQL)', () => {
  it('el esquema define las columnas booleanas que se revisan', () => {
    expect(BOOLEANAS.has('validado_manualmente')).toBe(true);
    expect(BOOLEANAS.has('activo')).toBe(true);
  });

  it('la revisión detecta el defecto', () => {
    expect(violaciones("INSERT INTO t (a, validado_manualmente, b)\n OUTPUT INSERTED.id\n VALUES (COALESCE(@a, 1), 1, 'x, y')")).toEqual(['t.validado_manualmente = 1']);
    expect(violaciones('INSERT INTO t (a, validado_manualmente) VALUES (1, TRUE)')).toEqual([]);
  });

  it('ningún INSERT del backend pasa 0 o 1 a una columna booleana', () => {
    const halladas = archivos(RAIZ).flatMap(a => violaciones(fs.readFileSync(a, 'utf8').replace(/\r\n/g, '\n')).map(v => `${path.relative(RAIZ, a)}: ${v}`));
    expect(halladas).toEqual([]);
  });
});
