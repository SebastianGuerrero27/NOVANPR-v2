import ExcelJS from 'exceljs';
import { excelControl, pdfControl } from '../../infraestructura/servicios/documentosControl';
import type { FilaControl, HojaControl } from '../../dominio/controlVehicular';

/** PDF y Excel del reporte de control vehicular: se generan de verdad (sin dobles) con datos ficticios. */

const fila = (i: number): FilaControl => ({
  fecha: '19-10-2026', nombres: `Persona de prueba ${i}`, tipo: 'Camioneta', marca: 'Marca', placa: 'PBA-1234',
  ingreso: '09:52', salida: '11:06', observaciones: i % 3 === 0 ? 'Reunión de coordinación con un texto largo que ocupa dos líneas en la columna' : 'Recorrido',
});

const hoja = (filas: FilaControl[]): HojaControl => ({
  sede: 'ECU 911 - AMBATO', titulo: 'REPORTE DE CONTROL VEHICULAR', lugar: 'PARQUEADERO - GARITA',
  lineaFecha: 'Ambato, lunes 19 de octubre de 2026', agente: 'Ana Pérez', turno: 'Nocturno', horario: '19:00 – 07:00',
  camara: 'Garita', generado: '19-10-2026 10:00', filas,
});

describe('Reporte de control vehicular · archivos', () => {
  it('PDF: un documento válido, que continúa en otra página cuando las filas no caben en una', async () => {
    const corto = await pdfControl(hoja([fila(1)]));
    expect(corto.subarray(0, 5).toString()).toBe('%PDF-');
    const paginas = (b: Buffer) => (b.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(paginas(corto)).toBe(1);
    expect(paginas(await pdfControl(hoja(Array.from({ length: 60 }, (_, i) => fila(i)))))).toBeGreaterThan(1);
    expect((await pdfControl(hoja([]))).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('Excel: encabezado, títulos de la hoja, una fila por ingreso, el logo y la firma', async () => {
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(await excelControl(hoja([fila(1), fila(2)])) as unknown as ExcelJS.Buffer);
    const h = libro.getWorksheet('Control vehicular')!;
    expect([h.getCell('B1').value, h.getCell('B2').value, h.getCell('B3').value]).toEqual(['ECU 911 - AMBATO', 'REPORTE DE CONTROL VEHICULAR', 'PARQUEADERO - GARITA']);
    expect(String(h.getCell('A5').value)).toContain('Agente entrante: Ana Pérez');
    expect((h.getRow(7).values as unknown[]).slice(1)).toEqual([
      'FECHA', 'NOMBRES Y APELLIDOS', 'TIPO DE VEHÍCULO', 'MARCA', 'PLACA DE IDENTIFICACIÓN', 'HORA DE INGRESO', 'HORA DE SALIDA', 'OBSERVACIONES',
    ]);
    expect((h.getRow(8).values as unknown[]).slice(1)).toEqual(['19-10-2026', 'Persona de prueba 1', 'Camioneta', 'Marca', 'PBA-1234', '09:52', '11:06', 'Recorrido']);
    expect(h.getImages()).toHaveLength(1);
    // Dos filas (8 y 9), una línea en blanco y la raya de la firma en la 12
    expect(h.getCell('F13').value).toBe('Firma del agente entrante');
    expect(h.getCell('F14').value).toBe('Ana Pérez');
  });
});
