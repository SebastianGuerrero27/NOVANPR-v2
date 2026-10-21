import {
  diaDelTurno, filasControlVehicular, lineaFecha, leerFormato, leerTurno, placaHoja, type MovimientoControl,
} from '../../dominio/controlVehicular';

/** Reporte de control vehicular de la garita: turnos, salida de cada ingreso y filas de la hoja. Ecuador: UTC-5. */

const DESFASE = -300;
/** Instante UTC de una hora local de Ecuador («2026-10-19 09:52»). */
const local = (fechaHora: string) => new Date(`${fechaHora.replace(' ', 'T')}:00-05:00`);

const mov = (cambios: Partial<MovimientoControl> & { fecha: string }): MovimientoControl => ({
  id: Math.floor(Math.random() * 1e9), tipo_movimiento: 'ingreso', fecha_hora_ingreso: local(cambios.fecha), placa: 'PBA1234',
  persona_ingreso: null, motivo_ingreso: null, tipo_vehiculo: null, vehiculo_tipo: null, vehiculo_marca: null,
  propietario: null, autorizado_tipo: null, autorizado_marca: null, estado_validacion: 'no_reconocido', alerta_motivo: null,
  evidencia_lectura: null, ...cambios,
});

const DIA = { desfase: DESFASE, primerDia: '2026-10-19', ultimoDia: '2026-10-19' };

describe('Reporte de control vehicular · turnos', () => {
  it('un ingreso de madrugada pertenece al turno nocturno que empezó el día anterior', () => {
    expect(diaDelTurno(local('2026-10-19 09:52'), 'diurno', DESFASE)).toBe('2026-10-19');
    expect(diaDelTurno(local('2026-10-19 19:30'), 'diurno', DESFASE)).toBeNull();
    expect(diaDelTurno(local('2026-10-19 21:45'), 'nocturno', DESFASE)).toBe('2026-10-19');
    expect(diaDelTurno(local('2026-10-20 01:16'), 'nocturno', DESFASE)).toBe('2026-10-19');
    expect(diaDelTurno(local('2026-10-20 10:00'), 'nocturno', DESFASE)).toBeNull();
    expect(diaDelTurno(local('2026-10-20 01:16'), 'completo', DESFASE)).toBe('2026-10-20');
  });

  it('turno y formato: por omisión el día completo en PDF; otro valor es un error', () => {
    expect(leerTurno(undefined)).toEqual({ ok: true, valor: 'completo' });
    expect(leerTurno('nocturno')).toEqual({ ok: true, valor: 'nocturno' });
    expect(leerTurno('tarde').ok).toBe(false);
    expect(leerFormato(undefined)).toEqual({ ok: true, valor: 'pdf' });
    expect(leerFormato('xlsx')).toEqual({ ok: true, valor: 'xlsx' });
    expect(leerFormato('docx').ok).toBe(false);
  });
});

describe('Reporte de control vehicular · filas', () => {
  it('cada ingreso lleva la primera salida de su placa; quien vuelve a entrar sin salida no toma la del ingreso siguiente', () => {
    const filas = filasControlVehicular([
      mov({ fecha: '2026-10-19 09:52', persona_ingreso: 'Ana Pérez', tipo_vehiculo: 'camioneta', motivo_ingreso: 'Reunión de coordinación' }),
      mov({ fecha: '2026-10-19 11:06', tipo_movimiento: 'salida' }),
      mov({ fecha: '2026-10-19 12:00', placa: 'GSB0456' }),
      mov({ fecha: '2026-10-19 13:00', placa: 'GSB0456' }),
      mov({ fecha: '2026-10-19 13:30', placa: 'GSB0456', tipo_movimiento: 'salida' }),
    ], { turno: 'completo', ...DIA });
    expect(filas.map(f => [f.placa, f.ingreso, f.salida])).toEqual([
      ['PBA-1234', '09:52', '11:06'], ['GSB-0456', '12:00', ''], ['GSB-0456', '13:00', '13:30'],
    ]);
    expect(filas[0]).toEqual({
      fecha: '19-10-2026', nombres: 'Ana Pérez', tipo: 'Camioneta', marca: '', placa: 'PBA-1234',
      ingreso: '09:52', salida: '11:06', observaciones: 'Reunión de coordinación',
    });
  });

  it('sin nombre registrado usa el titular del padrón; la marca del padrón antes que la observada por la cámara', () => {
    const [fila] = filasControlVehicular([
      mov({ fecha: '2026-10-19 10:01', propietario: 'Luis Torres', autorizado_marca: 'suzuki', vehiculo_marca: 'Chevrolet', vehiculo_tipo: 'auto' }),
    ], { turno: 'completo', ...DIA });
    expect([fila.nombres, fila.marca, fila.tipo]).toEqual(['Luis Torres', 'Suzuki', 'Auto']);
  });

  it('un paso sin placa va como S/P con el tipo que vio el motor; una alerta se anota junto al motivo', () => {
    const filas = filasControlVehicular([
      mov({ fecha: '2026-10-19 14:45', placa: null, evidencia_lectura: JSON.stringify({ motivo: 'vehiculo_sin_placa', tipo_vehiculo: 'motocicleta' }) }),
      mov({ fecha: '2026-10-19 15:01', estado_validacion: 'alerta', alerta_motivo: 'Reporte de robo', motivo_ingreso: 'Visita' }),
    ], { turno: 'completo', ...DIA });
    expect(filas.map(f => [f.placa, f.tipo, f.observaciones])).toEqual([
      ['S/P', 'Motocicleta', 'Sin placa visible'], ['PBA-1234', '', 'Visita · Lista negra: Reporte de robo'],
    ]);
  });

  it('el turno filtra los ingresos: el nocturno del 19 incluye la madrugada del 20 y no la del 19', () => {
    const movimientos = [
      mov({ fecha: '2026-10-19 02:00', placa: 'GAA1111' }),
      mov({ fecha: '2026-10-19 09:00', placa: 'GAA2222' }),
      mov({ fecha: '2026-10-19 21:45', placa: 'GAA3333' }),
      mov({ fecha: '2026-10-20 01:16', placa: 'GAA4444' }),
      mov({ fecha: '2026-10-20 09:00', placa: 'GAA5555' }),
    ];
    const placas = (turno: 'diurno' | 'nocturno' | 'completo') => filasControlVehicular(movimientos, { turno, ...DIA }).map(f => f.placa);
    expect(placas('diurno')).toEqual(['GAA-2222']);
    expect(placas('nocturno')).toEqual(['GAA-3333', 'GAA-4444']);
    expect(placas('completo')).toEqual(['GAA-1111', 'GAA-2222', 'GAA-3333']);
  });
});

describe('Reporte de control vehicular · textos', () => {
  it('placa como en la hoja y línea de la fecha en español', () => {
    expect([placaHoja('pba1234'), placaHoja('PDO418'), placaHoja('AB123C'), placaHoja(null)]).toEqual(['PBA-1234', 'PDO-418', 'AB-123C', 'S/P']);
    expect(lineaFecha('Ambato', '2026-10-19', '2026-10-19')).toBe('Ambato, lunes 19 de octubre de 2026');
    expect(lineaFecha('Ambato', '2026-10-19', '2026-10-20')).toBe('Ambato, del lunes 19 de octubre de 2026 al martes 20 de octubre de 2026');
  });
});
