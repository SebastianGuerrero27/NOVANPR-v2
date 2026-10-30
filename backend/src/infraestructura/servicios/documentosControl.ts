import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { COLUMNAS_CONTROL, type FilaControl, type HojaControl } from '../../dominio/controlVehicular';
import type { PuertoDocumentosControl } from '../../aplicacion/controlVehicular';

/**
 * Archivos del reporte de control vehicular: PDF (pdfkit) y Excel (exceljs) con el logo del
 * ECU 911, el encabezado de la hoja de la garita, la línea del turno, la tabla y la firma del
 * agente entrante.
 */

const RUTAS_LOGO = [
  path.resolve(__dirname, '../../../assets/ECU911.svg.png'),
  path.resolve(process.cwd(), 'assets/ECU911.svg.png'),
  '/app/assets/ECU911.svg.png',
];

let logo: Buffer | null | undefined;
/** Logo del ECU 911 (backend/assets; en la imagen de producción, /app/assets); null si no está. */
export function leerLogo(): Buffer | null {
  if (logo === undefined) {
    const ruta = RUTAS_LOGO.find(r => fs.existsSync(r));
    logo = ruta ? fs.readFileSync(ruta) : null;
  }
  return logo;
}

const SIN_INGRESOS = 'Sin ingresos registrados en el período y turno seleccionados.';
const lineaTurno = (h: HojaControl) =>
  [h.lineaFecha, `Agente entrante: ${h.agente}`, `Turno: ${h.turno}`, `Hora: ${h.horario}`, h.camara ? `Cámara: ${h.camara}` : null]
    .filter(Boolean).join('   ·   ');
const valores = (f: FilaControl) => COLUMNAS_CONTROL.map(c => f[c.clave]);

// ─── PDF ─────────────────────────────────────────────────────────────────────

const MARGEN = 28;
/** Anchos de las columnas en puntos (A4 horizontal); observaciones toma el resto */
const ANCHOS = [62, 150, 80, 72, 84, 56, 56];
const BORDE = '#94a3b8';
const TINTA = '#0f172a';

export function pdfControl(h: HojaControl, soloRegistros = false): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', layout: 'landscape', margin: MARGEN, bufferPages: true,
      info: { Title: `${h.titulo} · ${h.lugar}`, Author: 'Sistema ANPR ECU 911', Subject: h.lineaFecha },
    });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    const ancho = doc.page.width - 2 * MARGEN;
    const anchos = [...ANCHOS, ancho - ANCHOS.reduce((a, b) => a + b, 0)];
    const limite = () => doc.page.height - MARGEN - 18;

    // Encabezado: logo a la izquierda y las tres líneas de la hoja al centro
    const imagen = leerLogo();
    if (imagen) doc.image(imagen, MARGEN, MARGEN - 6, { height: 62 });
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(14).text(h.sede, MARGEN, MARGEN + 2, { width: ancho, align: 'center' });
    doc.fontSize(12).text(h.titulo, { width: ancho, align: 'center' });
    doc.fontSize(10.5).text(h.lugar, { width: ancho, align: 'center' });
    doc.font('Helvetica').fontSize(9.5).text(soloRegistros ? `Registros con salida registrada · ${h.filas.length} registros · Generado: ${h.generado}` : lineaTurno(h), MARGEN, MARGEN + 66, { width: ancho });
    let y = doc.y + 8;

    const fila = (celdas: string[], negrita: boolean) => {
      doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(negrita ? 7.5 : 8);
      const alto = Math.max(negrita ? 22 : 16, ...celdas.map((v, i) => doc.heightOfString(v || ' ', { width: anchos[i] - 8 }) + 8));
      if (y + alto > limite()) {
        doc.addPage();
        y = MARGEN;
        if (!negrita) fila(COLUMNAS_CONTROL.map(c => c.titulo), true);
        doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(negrita ? 7.5 : 8);
      }
      let x = MARGEN;
      celdas.forEach((v, i) => {
        doc.lineWidth(0.6).rect(x, y, anchos[i], alto);
        if (negrita) doc.fillAndStroke('#e8edf5', BORDE); else doc.strokeColor(BORDE).stroke();
        doc.fillColor(TINTA).text(v || '', x + 4, y + 4, { width: anchos[i] - 8, align: negrita ? 'center' : 'left' });
        x += anchos[i];
      });
      y += alto;
    };

    fila(COLUMNAS_CONTROL.map(c => c.titulo), true);
    if (h.filas.length === 0) {
      doc.lineWidth(0.6).rect(MARGEN, y, ancho, 22).strokeColor(BORDE).stroke();
      doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#475569').text(soloRegistros ? 'Sin registros con salida para los filtros seleccionados.' : SIN_INGRESOS, MARGEN, y + 7, { width: ancho, align: 'center' });
      y += 22;
    }
    for (const f of h.filas) fila(valores(f), false);

    // Firma del agente entrante
    if (!soloRegistros) {
    if (y + 74 > limite()) { doc.addPage(); y = MARGEN; }
    const xFirma = MARGEN + ancho - 260;
    doc.lineWidth(0.8).strokeColor(TINTA).moveTo(xFirma, y + 50).lineTo(xFirma + 220, y + 50).stroke();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(TINTA).text('Firma del agente entrante', xFirma, y + 54, { width: 220, align: 'center' });
    doc.font('Helvetica').fontSize(8.5).text(h.agente, xFirma, doc.y + 1, { width: 220, align: 'center' });
    }

    // Pie de cada página (sin margen inferior para que el texto no abra otra página)
    const paginas = doc.bufferedPageRange();
    for (let i = 0; i < paginas.count; i++) {
      doc.switchToPage(paginas.start + i);
      const margenInferior = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7.5).fillColor('#64748b')
        .text(`Generado por el Sistema ANPR ECU 911 · ${h.generado} · Página ${i + 1} de ${paginas.count}`,
          MARGEN, doc.page.height - MARGEN - 8, { width: ancho, align: 'center', lineBreak: false });
      doc.page.margins.bottom = margenInferior;
    }
    doc.end();
  });
}

// ─── Excel ───────────────────────────────────────────────────────────────────

const FILA_TITULOS = 7;
const DELGADO: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF94A3B8' } };
const BORDES: Partial<ExcelJS.Borders> = { top: DELGADO, left: DELGADO, bottom: DELGADO, right: DELGADO };

export async function excelControl(h: HojaControl): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Sistema ANPR ECU 911';
  libro.created = new Date();
  const hoja = libro.addWorksheet('Control vehicular', {
    pageSetup: {
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      printTitlesRow: `${FILA_TITULOS}:${FILA_TITULOS}`,
    },
    headerFooter: { oddFooter: `&L${h.lineaFecha}&RGenerado por el Sistema ANPR ECU 911 · ${h.generado} · Página &P de &N` },
    views: [{ state: 'frozen', ySplit: FILA_TITULOS }],
  });
  hoja.columns = [12, 32, 18, 16, 18, 11, 11, 46].map(width => ({ width }));

  const imagen = leerLogo();
  if (imagen) {
    // exceljs declara su propio tipo Buffer; el de Node es el mismo en tiempo de ejecución
    const id = libro.addImage({ buffer: imagen as unknown as ExcelJS.Buffer, extension: 'png' });
    hoja.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 96, height: 96 } });
  }
  [[h.sede, 14], [h.titulo, 12], [h.lugar, 11]].forEach(([texto, tamano], i) => {
    hoja.mergeCells(i + 1, 2, i + 1, 8);
    const celda = hoja.getCell(i + 1, 2);
    celda.value = texto as string;
    celda.font = { bold: true, size: tamano as number };
    celda.alignment = { horizontal: 'center', vertical: 'middle' };
    hoja.getRow(i + 1).height = 22;
  });
  hoja.mergeCells(5, 1, 5, 8);
  hoja.getCell(5, 1).value = lineaTurno(h);
  hoja.getCell(5, 1).font = { size: 10 };

  const titulos = hoja.getRow(FILA_TITULOS);
  titulos.values = COLUMNAS_CONTROL.map(c => c.titulo);
  titulos.height = 30;
  titulos.eachCell(c => {
    c.font = { bold: true, size: 9 };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF5' } };
    c.border = BORDES;
  });

  let n = FILA_TITULOS + 1;
  if (h.filas.length === 0) {
    hoja.mergeCells(n, 1, n, 8);
    hoja.getCell(n, 1).value = SIN_INGRESOS;
    hoja.getCell(n, 1).font = { italic: true, color: { argb: 'FF475569' } };
    hoja.getCell(n, 1).alignment = { horizontal: 'center' };
    n++;
  }
  for (const f of h.filas) {
    const r = hoja.getRow(n++);
    r.values = valores(f);
    r.eachCell({ includeEmpty: true }, (c, col) => {
      if (col > COLUMNAS_CONTROL.length) return;
      c.border = BORDES;
      c.alignment = { vertical: 'top', wrapText: true, horizontal: col === 1 || col >= 5 && col <= 7 ? 'center' : 'left' };
    });
  }

  n += 2;
  hoja.mergeCells(n, 6, n, 8);
  hoja.getCell(n, 6).value = '______________________________';
  hoja.getCell(n, 6).alignment = { horizontal: 'center' };
  hoja.mergeCells(n + 1, 6, n + 1, 8);
  hoja.getCell(n + 1, 6).value = 'Firma del agente entrante';
  hoja.getCell(n + 1, 6).font = { bold: true };
  hoja.getCell(n + 1, 6).alignment = { horizontal: 'center' };
  hoja.mergeCells(n + 2, 6, n + 2, 8);
  hoja.getCell(n + 2, 6).value = h.agente;
  hoja.getCell(n + 2, 6).alignment = { horizontal: 'center' };

  return Buffer.from(await libro.xlsx.writeBuffer());
}

export const documentosControl: PuertoDocumentosControl = { pdf: pdfControl, excel: excelControl };
