import PDFDocument from 'pdfkit';
import type { Fila, InfoReporteSalidas } from '../../aplicacion/detecciones';
import { placaHoja } from '../../dominio/controlVehicular';
import { datosReporteSalida } from '../../dominio/registroCompleto';
import { config } from './configuracion';
import { leerLogo } from './documentosControl';

/**
 * Reporte PDF de Registro de Salidas (A4 horizontal): encabezado institucional con el logo del
 * ECU 911, como los informes de Reportes; los datos de la consulta; una fila por registro
 * completo con salida, y las firmas de quien elabora y revisa.
 */

const MARGEN = 28;
const TINTA = '#0f172a';
const GRIS = '#475569';
const BORDE = '#cbd5e1';

/** Columnas (anchos en puntos; el motivo toma el resto de los 786 útiles). */
export const COLUMNAS_SALIDAS: readonly { titulo: string; ancho: number; centrado?: boolean }[] = [
  { titulo: 'N.º', ancho: 24, centrado: true },
  { titulo: 'Cédula', ancho: 62, centrado: true },
  { titulo: 'Titular', ancho: 118 },
  { titulo: 'Placa', ancho: 58, centrado: true },
  { titulo: 'Motivo', ancho: 0 },
  { titulo: 'Fecha', ancho: 56, centrado: true },
  { titulo: 'Hora de entrada', ancho: 50, centrado: true },
  { titulo: 'Hora de salida', ancho: 58, centrado: true },
  { titulo: 'Vehículo', ancho: 68 },
  { titulo: 'Marca', ancho: 64 },
  { titulo: 'Modelo', ancho: 70 },
];

const formatos = (zona: string) => {
  const dia = new Intl.DateTimeFormat('es-EC', { timeZone: zona, day: '2-digit', month: '2-digit', year: 'numeric' });
  const hora = new Intl.DateTimeFormat('es-EC', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return { fecha: (v: Date | string) => dia.format(new Date(v)), hora: (v: Date | string) => hora.format(new Date(v)) };
};

/** Celdas de cada fila, en el orden de COLUMNAS_SALIDAS. La salida de otro día lleva su fecha. */
export function celdasSalidas(filas: Fila[], zona: string): string[][] {
  const { fecha, hora } = formatos(zona);
  return filas.map((d, i) => {
    const r = datosReporteSalida(d);
    const salida = d.fecha_hora_salida
      ? (fecha(d.fecha_hora_salida) === fecha(d.fecha_hora_ingreso) ? hora(d.fecha_hora_salida) : `${fecha(d.fecha_hora_salida)} ${hora(d.fecha_hora_salida)}`)
      : '—';
    return [
      String(i + 1), r.cedula ?? '—', r.nombre ?? '—', placaHoja(r.placa), r.motivo ?? '—',
      fecha(d.fecha_hora_ingreso), hora(d.fecha_hora_ingreso), salida, r.tipo ?? '—', r.marca ?? '—', r.modelo ?? '—',
    ];
  });
}

/** Período de la consulta en palabras. */
export function describirPeriodo(info: Pick<InfoReporteSalidas, 'desde' | 'hasta' | 'zona'>): string {
  const { fecha } = formatos(info.zona);
  if (info.desde && info.hasta) {
    const a = fecha(info.desde);
    const b = fecha(info.hasta);
    return a === b ? a : `${a} al ${b}`;
  }
  if (info.desde) return `Desde ${fecha(info.desde)}`;
  if (info.hasta) return `Hasta ${fecha(info.hasta)}`;
  return 'Todos los registros';
}

export function pdfRegistros(filas: Fila[], info: InfoReporteSalidas): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', layout: 'landscape', margin: MARGEN, bufferPages: true,
      info: { Title: 'Registro de salidas', Author: 'Sistema ANPR ECU 911', Subject: describirPeriodo(info) },
    });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    const { fecha, hora } = formatos(info.zona);
    const generado = `${fecha(info.generado)} ${hora(info.generado)}`;
    const ancho = doc.page.width - 2 * MARGEN;
    const fijos = COLUMNAS_SALIDAS.reduce((s, c) => s + c.ancho, 0);
    const anchos = COLUMNAS_SALIDAS.map(c => c.ancho || ancho - fijos);
    const limite = () => doc.page.height - MARGEN - 18;

    // Encabezado: logo e institución, título y unidad (como los informes de Reportes)
    const imagen = leerLogo();
    const xTexto = imagen ? MARGEN + 64 : MARGEN;
    if (imagen) doc.image(imagen, MARGEN, MARGEN, { fit: [52, 52] });
    doc.font('Helvetica').fontSize(8).fillColor(GRIS)
      .text('SERVICIO INTEGRADO DE SEGURIDAD ECU 911 · CONTROL DE ACCESO VEHICULAR', xTexto, MARGEN + 4, { characterSpacing: 0.6 });
    doc.font('Helvetica-Bold').fontSize(17).fillColor(TINTA).text('Registro de salidas', xTexto, doc.y + 3);
    doc.font('Helvetica').fontSize(9).fillColor(GRIS).text(config.texto('unidad_institucional'), xTexto, doc.y + 1);
    let y = MARGEN + 62;
    doc.lineWidth(1).strokeColor(TINTA).moveTo(MARGEN, y).lineTo(MARGEN + ancho, y).stroke();

    // Datos de la consulta
    y += 8;
    const datos: [string, string][] = [
      ['Período', describirPeriodo(info)], ['Registros con salida', String(filas.length)],
      ...(info.buscar ? [['Búsqueda', `«${info.buscar}»`] as [string, string]] : []),
      ['Generado', `${generado} · ${info.elaboradoPor}`],
    ];
    const anchoDato = ancho / datos.length;
    datos.forEach(([etiqueta, valor], i) => {
      const x = MARGEN + i * anchoDato;
      doc.font('Helvetica').fontSize(7).fillColor(GRIS).text(etiqueta.toUpperCase(), x, y, { width: anchoDato - 10, characterSpacing: 0.4 });
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TINTA).text(valor, x, y + 10, { width: anchoDato - 10 });
    });
    y += 34;

    let par = false;
    const fila = (celdas: string[], titulo: boolean) => {
      doc.font(titulo ? 'Helvetica-Bold' : 'Helvetica').fontSize(titulo ? 7.5 : 7.8);
      const alto = Math.max(titulo ? 24 : 16, ...celdas.map((v, i) => doc.heightOfString(v || ' ', { width: anchos[i] - 8 }) + 8));
      if (y + alto > limite()) {
        doc.addPage();
        y = MARGEN;
        if (!titulo) fila(COLUMNAS_SALIDAS.map(c => c.titulo), true);
        doc.font(titulo ? 'Helvetica-Bold' : 'Helvetica').fontSize(titulo ? 7.5 : 7.8);
      }
      let x = MARGEN;
      if (titulo) doc.rect(MARGEN, y, ancho, alto).fill('#e2e8f0');
      else if (par) doc.rect(MARGEN, y, ancho, alto).fill('#f8fafc');
      celdas.forEach((v, i) => {
        doc.lineWidth(0.5).rect(x, y, anchos[i], alto).strokeColor(BORDE).stroke();
        const desplazamiento = titulo ? Math.max(4, (alto - doc.heightOfString(v, { width: anchos[i] - 8 })) / 2) : 4;
        doc.fillColor(TINTA).text(v || '', x + 4, y + desplazamiento, {
          width: anchos[i] - 8, align: titulo || COLUMNAS_SALIDAS[i].centrado ? 'center' : 'left',
        });
        x += anchos[i];
      });
      y += alto;
      if (!titulo) par = !par;
    };

    fila(COLUMNAS_SALIDAS.map(c => c.titulo), true);
    if (filas.length === 0) {
      doc.lineWidth(0.5).rect(MARGEN, y, ancho, 24).strokeColor(BORDE).stroke();
      doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(GRIS)
        .text('Sin registros con salida para los filtros seleccionados.', MARGEN, y + 8, { width: ancho, align: 'center' });
      y += 24;
    }
    for (const celdas of celdasSalidas(filas, info.zona)) fila(celdas, false);

    // Firmas de quien elabora y quien revisa
    if (y + 70 > limite()) { doc.addPage(); y = MARGEN; }
    const anchoFirma = 220;
    [['Elaborado por', info.elaboradoPor], ['Revisado por', '']].forEach(([rotulo, nombre], i) => {
      const x = MARGEN + (i === 0 ? 40 : ancho - anchoFirma - 40);
      doc.lineWidth(0.8).strokeColor(TINTA).moveTo(x, y + 48).lineTo(x + anchoFirma, y + 48).stroke();
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(TINTA).text(rotulo, x, y + 52, { width: anchoFirma, align: 'center' });
      if (nombre) doc.font('Helvetica').fontSize(8.5).text(nombre, x, doc.y + 1, { width: anchoFirma, align: 'center' });
    });

    // Pie de cada página (sin margen inferior para que el texto no abra otra página)
    const paginas = doc.bufferedPageRange();
    for (let i = 0; i < paginas.count; i++) {
      doc.switchToPage(paginas.start + i);
      const margenInferior = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7.5).fillColor('#64748b')
        .text(`Registro de salidas · Sistema ANPR ECU 911 · ${generado} · Página ${i + 1} de ${paginas.count}`,
          MARGEN, doc.page.height - MARGEN - 8, { width: ancho, align: 'center', lineBreak: false });
      doc.page.margins.bottom = margenInferior;
    }
    doc.end();
  });
}
