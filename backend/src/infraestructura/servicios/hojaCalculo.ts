import ExcelJS from 'exceljs';
import { errorValidacion } from '../../aplicacion/comun';

/**
 * Lectura de una hoja de cálculo cargada por el personal (importación de permisos): la primera
 * hoja de un .xlsx o un .csv (separado por coma, punto y coma o tabulador), como texto por celda.
 * El formato se reconoce por la firma del archivo, no por su nombre.
 */

const FIRMA_ZIP = [0x50, 0x4b, 0x03, 0x04];
const FIRMA_XLS = [0xd0, 0xcf, 0x11, 0xe0];
const empieza = (b: Buffer, firma: number[]) => firma.every((v, i) => b[i] === v);

/** Texto de una celda de ExcelJS: fechas como AAAA-MM-DD, fórmulas por su resultado, texto enriquecido unido. */
function textoCelda(valor: ExcelJS.CellValue): string {
  if (valor === null || valor === undefined) return '';
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor !== 'object') return String(valor);
  if ('richText' in valor) return valor.richText.map(t => t.text).join('');
  if ('text' in valor && typeof valor.text === 'string') return valor.text;
  if ('result' in valor) return textoCelda(valor.result as ExcelJS.CellValue);
  return '';
}

async function leerXlsx(contenido: Buffer): Promise<string[][]> {
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(contenido as unknown as ArrayBuffer);
  } catch {
    throw errorValidacion('No se pudo leer el archivo de Excel. Guárdelo de nuevo como .xlsx e inténtelo otra vez.');
  }
  const hoja = libro.worksheets[0];
  if (!hoja) throw errorValidacion('El archivo de Excel no tiene hojas.');
  const filas: string[][] = [];
  hoja.eachRow({ includeEmpty: true }, (fila, n) => {
    const celdas: string[] = [];
    for (let c = 1; c <= hoja.columnCount; c++) celdas.push(textoCelda(fila.getCell(c).value).trim());
    filas[n - 1] = celdas;
  });
  return Array.from(filas, f => f ?? []);
}

/** CSV con comillas dobles ("" escapa una comilla) y el separador más frecuente de la primera línea. */
export function leerCsv(texto: string): string[][] {
  const limpio = texto.replace(/^﻿/, '');
  const primera = limpio.split(/\r?\n/, 1)[0] ?? '';
  const separador = [';', '\t', ','].reduce((mejor, s) => (primera.split(s).length > primera.split(mejor).length ? s : mejor), ',');
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const ch = limpio[i];
    if (comillas) {
      if (ch === '"' && limpio[i + 1] === '"') { celda += '"'; i++; }
      else if (ch === '"') comillas = false;
      else celda += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === separador) { fila.push(celda.trim()); celda = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && limpio[i + 1] === '\n') i++;
      fila.push(celda.trim()); filas.push(fila); fila = []; celda = '';
    } else celda += ch;
  }
  if (celda || fila.length) { fila.push(celda.trim()); filas.push(fila); }
  return filas;
}

export async function leerHojaCalculo(contenido: Buffer): Promise<string[][]> {
  if (empieza(contenido, FIRMA_ZIP)) return leerXlsx(contenido);
  if (empieza(contenido, FIRMA_XLS)) throw errorValidacion('El formato .xls (Excel 97-2003) no se admite: guarde el archivo como .xlsx o .csv.');
  const texto = contenido.toString('utf8');
  if (texto.includes('\u0000')) throw errorValidacion('El archivo no es una hoja de cálculo: use .xlsx o .csv.');
  return leerCsv(texto);
}
