import { leerFilasImportacion, MAX_FILAS_IMPORTACION, normalizarCedula, normalizarEncabezado } from '../../dominio/importacionPermisos';

/** Importación de permisos desde la hoja de la garita (datos ficticios). */

const CABECERA = ['id', 'nombres', 'cedula', 'institucion', 'cargo', 'placa', 'marca', 'modelo', 'tipo', 'color'];

describe('Importación de permisos · lectura de la hoja', () => {
  it('reconoce el formato de la garita: el id identifica la fila y no se guarda', () => {
    const r = leerFilasImportacion([CABECERA, ['1', 'ANA MARÍA TORRES PAZ', '0912345678', 'ECU 911', 'ANALISTA', 'PDX-525', 'CHEVROLET', 'FORZA', 'COUPE', 'GRIS']]);
    expect(r).toEqual({ ok: true, valor: [{ fila: 2, id: '1', entrada: {
      propietario: 'ANA MARÍA TORRES PAZ', cedula: '0912345678', institucion: 'ECU 911', cargo: 'ANALISTA', placa: 'PDX-525',
      marca: 'CHEVROLET', modelo: 'FORZA', tipo_vehiculo: 'COUPE', color: 'GRIS',
    } }] });
  });

  it('acepta encabezados con mayúsculas y tildes (también los de la exportación) y omite filas vacías', () => {
    const r = leerFilasImportacion([[], ['ID', 'Nombres', 'Cédula', 'Institución', 'Placa', 'Vigente hasta', 'Registrado por'],
      ['', '', '', '', '', '', ''], ['7', 'Luis Mora', '912345678', 'ECU 911', 'PBX1234', '31/12/2026', 'otro@ecu911.gob.ec']]);
    expect(r.ok && r.valor).toEqual([{ fila: 4, id: '7', entrada: {
      propietario: 'Luis Mora', cedula: '0912345678', institucion: 'ECU 911', placa: 'PBX1234', fecha_vencimiento: '2026-12-31',
    } }]);
  });

  it('sin encabezados usa el orden de la garita, con el id en la primera columna', () => {
    const r = leerFilasImportacion([['3', 'Rosa Vera', '0912345678', 'ECU 911', 'Chofer', 'PCX-101', 'KIA', 'RIO', 'SEDAN', 'ROJO']]);
    expect(r.ok && r.valor[0]).toMatchObject({ fila: 1, id: '3', entrada: { propietario: 'Rosa Vera', placa: 'PCX-101', color: 'ROJO' } });
  });

  it('rechaza un archivo vacío, sin nombres o con demasiadas filas', () => {
    expect(leerFilasImportacion([]).ok).toBe(false);
    expect(leerFilasImportacion([CABECERA]).ok).toBe(false);
    expect(leerFilasImportacion([['id', 'placa', 'marca'], ['1', 'PBX1234', 'KIA']]).ok).toBe(false);
    const muchas = Array.from({ length: MAX_FILAS_IMPORTACION + 1 }, (_, i) => [String(i + 1), 'Ana Paz']);
    expect(leerFilasImportacion([['id', 'nombres'], ...muchas]).ok).toBe(false);
  });

  it('normaliza encabezados y recupera el cero inicial de la cédula que Excel guardó como número', () => {
    expect(normalizarEncabezado(' Cédula ')).toBe('cedula');
    expect(normalizarEncabezado('N.º')).toBe('n');
    expect(normalizarCedula('912345678')).toBe('0912345678');
    expect(normalizarCedula('0912345678')).toBe('0912345678');
  });
});
