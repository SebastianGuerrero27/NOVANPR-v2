import { celdasHistorial, COLUMNAS_HISTORIAL, pdfHistorial } from '../../infraestructura/servicios/documentosRegistros';

const ZONA = 'America/Guayaquil';
const paso = (c: Record<string, unknown> = {}) => ({ id: 1, placa_reconocida: 'PZX1010', persona_ingreso: 'Persona de prueba',
  cedula_ingreso: '0000000000', motivo_ingreso: 'Jornada laboral', tipo_vehiculo: 'SUV', vehiculo_marca: 'Kia', vehiculo_modelo: 'Rio',
  estado_validacion: 'autorizado', tipo_movimiento: 'ingreso', camara_nombre: 'Garita de prueba', fecha_hora_ingreso: '2026-11-04T13:05:00Z',
  fecha_hora_salida: '2026-11-05T14:00:00Z', ...c });

describe('PDF del listado filtrado completo', () => {
  it('incluye datos de identificación, vehículo, motivo, estado y cámara sin exigir la ficha completa', () => {
    const celdas = celdasHistorial([paso(), paso({ id: 2, placa_reconocida: null, persona_ingreso: null, estado_validacion: 'pendiente_revision', fecha_hora_salida: null })], ZONA);
    expect(celdas).toHaveLength(2);
    expect(celdas[0]).toEqual(['1', 'PZX-1010', 'Persona de prueba', '0000000000', '04/11/2026\nIngreso', '08:05', '05/11/2026 09:00',
      'SUV · Kia · Rio', 'Jornada laboral', 'Autorizado', 'Garita de prueba']);
    expect(celdas[1][1]).toBe('Sin lectura'); expect(celdas[1][2]).toBe('—'); expect(celdas[1][6]).toBe('—');
    expect(celdas[1]).toHaveLength(COLUMNAS_HISTORIAL.length);
  });

  it('una salida independiente tiene hora de salida y no una entrada inventada', () => {
    const [fila] = celdasHistorial([paso({ tipo_movimiento: 'salida', estado_validacion: 'salida_registrada', fecha_hora_salida: null, camara_nombre: null, fuente: 'manual' })], ZONA);
    expect(fila[4]).toBe('04/11/2026\nSalida'); expect(fila[5]).toBe('—'); expect(fila[6]).toBe('08:05');
    expect(fila[9]).toBe('Salida registrada'); expect(fila[10]).toBe('Registro manual');
  });

  it('genera el documento general con logo, filtros y paginación sin alterar el formato de Salidas', async () => {
    const pdf = await pdfHistorial(Array.from({ length: 70 }, (_, id) => paso({ id })), {
      generado: new Date('2026-11-04T15:00:00Z'), zona: ZONA, desde: null, hasta: null, buscar: 'Persona', elaboradoPor: 'Administrador de prueba',
      filtros: [['Estado', 'Autorizado'], ['Cámara', 'N.º 4']],
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1').includes('(Reporte de movimientos vehiculares)')).toBe(true);
    expect(pdf.toString('latin1')).toMatch(/\/Subtype \/Image/);
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });

  it('un registro antiguo sin fecha conserva su fila y representa los datos ausentes sin romper la generación', () => {
    const [fila] = celdasHistorial([paso({ fecha_hora_ingreso: null, fecha_hora_salida: null })], ZONA);
    expect(fila[4]).toBe('—\nIngreso'); expect(fila[5]).toBe('—'); expect(fila[6]).toBe('—');
  });
});
