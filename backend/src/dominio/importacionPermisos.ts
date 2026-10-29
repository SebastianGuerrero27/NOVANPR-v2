import type { Validado } from './validacion';

/**
 * Importación de permisos de la lista blanca desde una hoja de cálculo (dominio puro).
 *
 * Formato de la garita (primera fila con encabezados):
 *
 *   id | nombres | cedula | institucion | cargo | placa | marca | modelo | tipo | color
 *
 * La columna `id` es solo el número de fila de la hoja: sirve para reconocer el formato, pero no se
 * guarda (el sistema asigna su propio identificador). Los encabezados se reconocen sin importar
 * mayúsculas, tildes ni espacios, y también los de la exportación de la lista blanca (Vigente
 * desde/hasta, Departamento, Observaciones), así una lista exportada se puede volver a importar.
 * Sin encabezados reconocibles se asume el orden de la garita, con el id en la primera columna.
 */

/** Campo del permiso (entrada de leerRegistroLista) por encabezado normalizado. */
const ENCABEZADOS: Record<string, string> = {
  nombres: 'propietario', nombre: 'propietario', 'nombres y apellidos': 'propietario', propietario: 'propietario', titular: 'propietario',
  cedula: 'cedula', 'cedula de identidad': 'cedula', identificacion: 'cedula',
  institucion: 'institucion', cargo: 'cargo', departamento: 'departamento',
  placa: 'placa',
  marca: 'marca', modelo: 'modelo', tipo: 'tipo_vehiculo', 'tipo de vehiculo': 'tipo_vehiculo', vehiculo: 'tipo_vehiculo', color: 'color',
  categoria: 'categoria', observaciones: 'observaciones',
  motivo: 'motivo_ingreso', 'motivo de ingreso': 'motivo_ingreso',
  'vigente desde': 'fecha_inicio', desde: 'fecha_inicio', 'fecha de inicio': 'fecha_inicio',
  'vigente hasta': 'fecha_vencimiento', hasta: 'fecha_vencimiento', 'fecha de vencimiento': 'fecha_vencimiento', vence: 'fecha_vencimiento',
};

/** Encabezados de la columna de numeración (no se guarda). */
const ENCABEZADOS_ID = new Set(['id', 'n', 'no', 'nro', 'numero', '#', 'item']);

/** Orden de la hoja de la garita, para un archivo sin encabezados (la primera columna es el id). */
export const COLUMNAS_GARITA = ['id', 'propietario', 'cedula', 'institucion', 'cargo', 'placa', 'marca', 'modelo', 'tipo_vehiculo', 'color'] as const;

/** Tope de filas por archivo: una importación más grande se divide en varias. */
export const MAX_FILAS_IMPORTACION = 500;

export interface FilaImportacion {
  /** Número de fila en la hoja (1 = encabezados), para señalar los errores */
  fila: number;
  /** Valor de la columna id de la hoja (solo referencia; no se guarda) */
  id: string | null;
  entrada: Record<string, string>;
}

/** "Cédula", " N.º " → "cedula", "n" (minúsculas, sin tildes ni signos). */
export function normalizarEncabezado(valor: unknown): string {
  return String(valor ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[º°.:_]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Excel guarda la cédula como número y pierde el cero inicial (0703799247 → 703799247). */
export function normalizarCedula(valor: string): string {
  const digitos = valor.replace(/\D/g, '');
  if (!digitos) return valor.trim();
  return digitos.length === 9 ? `0${digitos}` : digitos;
}

/** Fecha escrita a mano en la hoja (27/10/2026 o 27-10-2026) en el formato de la API (AAAA-MM-DD). */
export function normalizarFechaHoja(valor: string): string {
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(valor.trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : valor.trim();
}

const NORMALIZAR: Record<string, (v: string) => string> = {
  cedula: normalizarCedula, fecha_inicio: normalizarFechaHoja, fecha_vencimiento: normalizarFechaHoja,
};

const vacia = (fila: string[]) => fila.every(c => !String(c ?? '').trim());

/**
 * Filas de la hoja como entradas de un permiso. Falla si no hay datos, si falta la columna de
 * nombres o si el archivo supera el tope de filas.
 */
export function leerFilasImportacion(tabla: string[][]): Validado<FilaImportacion[]> {
  const inicio = tabla.findIndex(f => !vacia(f));
  if (inicio < 0) return { ok: false, error: 'El archivo no tiene datos.' };
  const cabecera = tabla[inicio].map(normalizarEncabezado);
  const reconocidas = cabecera.filter(c => ENCABEZADOS[c] || ENCABEZADOS_ID.has(c)).length;
  const conEncabezados = reconocidas >= 2;
  const columnas: (string | null)[] = conEncabezados
    ? cabecera.map(c => (ENCABEZADOS_ID.has(c) ? 'id' : ENCABEZADOS[c] ?? null))
    : [...COLUMNAS_GARITA];
  if (!columnas.includes('propietario')) {
    return { ok: false, error: 'Falta la columna «nombres». Use los encabezados: id, nombres, cedula, institucion, cargo, placa, marca, modelo, tipo, color.' };
  }
  const datos = tabla.slice(conEncabezados ? inicio + 1 : inicio);
  const filas: FilaImportacion[] = [];
  datos.forEach((celdas, i) => {
    if (vacia(celdas)) return;
    const entrada: Record<string, string> = {};
    let id: string | null = null;
    columnas.forEach((campo, j) => {
      const valor = String(celdas[j] ?? '').trim();
      if (!campo || !valor) return;
      if (campo === 'id') id = valor;
      // Si dos columnas dan el mismo campo, vale la primera con dato
      else if (!(campo in entrada)) entrada[campo] = NORMALIZAR[campo]?.(valor) ?? valor;
    });
    filas.push({ fila: inicio + (conEncabezados ? 2 : 1) + i, id, entrada });
  });
  if (!filas.length) return { ok: false, error: 'El archivo solo tiene encabezados: agregue al menos un permiso.' };
  if (filas.length > MAX_FILAS_IMPORTACION) {
    return { ok: false, error: `El archivo tiene ${filas.length} permisos; importe como máximo ${MAX_FILAS_IMPORTACION} por archivo.` };
  }
  return { ok: true, valor: filas };
}
