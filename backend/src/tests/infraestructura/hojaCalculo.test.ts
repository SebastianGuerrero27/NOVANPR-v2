import ExcelJS from 'exceljs';
import { leerCsv, leerHojaCalculo } from '../../infraestructura/servicios/hojaCalculo';

/** Lectura de la hoja de importación de permisos (datos ficticios). */
describe('Hoja de cálculo · importación de permisos', () => {
  it('lee la primera hoja de un .xlsx: números como texto y fechas como AAAA-MM-DD', async () => {
    const libro = new ExcelJS.Workbook();
    const hoja = libro.addWorksheet('Permisos');
    hoja.addRow(['id', 'nombres', 'cedula', 'placa', 'vigente hasta']);
    hoja.addRow([1, 'ANA TORRES PAZ', 912345678, 'PDX-525', new Date(Date.UTC(2026, 11, 31))]);
    const contenido = Buffer.from(await libro.xlsx.writeBuffer());
    expect(await leerHojaCalculo(contenido)).toEqual([
      ['id', 'nombres', 'cedula', 'placa', 'vigente hasta'],
      ['1', 'ANA TORRES PAZ', '912345678', 'PDX-525', '2026-12-31'],
    ]);
  });

  it('lee CSV con BOM, comillas y el separador de la primera línea (coma o punto y coma)', () => {
    expect(leerCsv('﻿id;nombres;cargo\r\n1;"PAZ; ANA";"Jefe ""zonal"""\r\n')).toEqual([['id', 'nombres', 'cargo'], ['1', 'PAZ; ANA', 'Jefe "zonal"']]);
    expect(leerCsv('id,nombres\n2,Luis Mora')).toEqual([['id', 'nombres'], ['2', 'Luis Mora']]);
  });

  it('rechaza el formato .xls antiguo y los archivos que no son hojas de cálculo', async () => {
    await expect(leerHojaCalculo(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).rejects.toThrow(/\.xls/);
    await expect(leerHojaCalculo(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]))).rejects.toThrow(/no es una hoja/);
  });
});
