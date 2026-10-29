/** Reporte PDF de Registro de Salidas: columnas pedidas por la garita, período y logo (datos ficticios). */
import { celdasSalidas, COLUMNAS_SALIDAS, describirPeriodo, pdfRegistros } from '../../infraestructura/servicios/documentosRegistros';
import { leerLogo } from '../../infraestructura/servicios/documentosControl';

const ZONA = 'America/Guayaquil';
const paso = (c: Record<string, unknown> = {}) => ({
  id: 1, placa_validada: 'PZX1010', placa_reconocida: 'PZX1010', persona_ingreso: 'Rosa Vera', cedula_ingreso: '0912345678',
  motivo_ingreso: 'Reunión de coordinación', tipo_vehiculo: 'SUV', vehiculo_marca: 'Kia', vehiculo_modelo: 'Sportage',
  // 08:05 y 17:30 en Ecuador (UTC-5)
  fecha_hora_ingreso: '2026-10-28T13:05:00Z', fecha_hora_salida: '2026-10-28T22:30:00Z', ...c,
});

describe('Reporte de Registro de Salidas', () => {
  it('columnas: Cédula, Titular, Placa, Motivo, Fecha, horas de entrada y salida, Vehículo, Marca y Modelo', () => {
    expect(COLUMNAS_SALIDAS.map(c => c.titulo)).toEqual([
      'N.º', 'Cédula', 'Titular', 'Placa', 'Motivo', 'Fecha', 'Hora de entrada', 'Hora de salida', 'Vehículo', 'Marca', 'Modelo',
    ]);
    expect(celdasSalidas([paso()], ZONA)).toEqual([[
      '1', '0912345678', 'Rosa Vera', 'PZX-1010', 'Reunión de coordinación', '28/10/2026', '08:05', '17:30', 'SUV', 'Kia', 'Sportage',
    ]]);
  });

  it('datos del permiso cuando el paso no los tiene; una cédula vaciada a propósito no se repone', () => {
    const [sinDatos, vaciada] = celdasSalidas([
      paso({ cedula_ingreso: null, autorizado_cedula: '0102030405', vehiculo_modelo: null, autorizado_modelo: 'Rio', persona_ingreso: null, propietario: 'Luis Mora' }),
      paso({ cedula_ingreso: '', autorizado_cedula: '0102030405' }),
    ], ZONA);
    expect(sinDatos[1]).toBe('0102030405');
    expect(sinDatos[2]).toBe('Luis Mora');
    expect(sinDatos[10]).toBe('Rio');
    expect(vaciada[0]).toBe('2');
    expect(vaciada[1]).toBe('—');
  });

  it('una salida de otro día lleva su fecha', () => {
    const [f] = celdasSalidas([paso({ fecha_hora_salida: '2026-10-29T14:00:00Z' })], ZONA);
    expect(f[7]).toBe('29/10/2026 09:00');
  });

  it('período en palabras', () => {
    const d = (iso: string) => new Date(iso);
    expect(describirPeriodo({ zona: ZONA, desde: d('2026-10-28T05:00:00Z'), hasta: d('2026-10-29T04:59:59Z') })).toBe('28/10/2026');
    expect(describirPeriodo({ zona: ZONA, desde: d('2026-10-01T05:00:00Z'), hasta: d('2026-10-29T04:59:59Z') })).toBe('01/10/2026 al 28/10/2026');
    expect(describirPeriodo({ zona: ZONA, desde: null, hasta: null })).toBe('Todos los registros');
  });

  it('genera el PDF con el logo del ECU 911, en varias páginas si hace falta', async () => {
    expect(leerLogo()).not.toBeNull();
    const info = { generado: new Date('2026-10-29T15:00:00Z'), zona: ZONA, desde: null, hasta: null, buscar: 'Vera', elaboradoPor: 'Ana Supervisora' };
    const pdf = await pdfRegistros(Array.from({ length: 60 }, (_, i) => paso({ id: i + 1 })), info);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
    expect(pdf.toString('latin1')).toMatch(/\/Subtype \/Image/);
    const vacio = await pdfRegistros([], info);
    expect((vacio.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
  });
});
