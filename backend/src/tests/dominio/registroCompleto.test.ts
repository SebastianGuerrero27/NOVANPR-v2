import { datosRegistro, faltantesIngreso, faltantesRegistro } from '../../dominio/registroCompleto';
const completo = { persona_ingreso: 'Ana', placa_reconocida: 'ABC123', tipo_vehiculo: 'SUV', vehiculo_marca: 'Toyota', motivo_ingreso: 'Trabajo', fecha_hora_ingreso: '2026-10-23T12:00:00Z', fecha_hora_salida: '2026-10-23T13:00:00Z' };
it('admite únicamente los campos del reporte completos y con salida válida', () => {
  expect(faltantesRegistro(completo)).toEqual([]);
  expect(faltantesRegistro({ ...completo, fecha_hora_salida: null })).toEqual(['Salida']);
  expect(faltantesRegistro({ ...completo, fecha_hora_salida: '2026-10-22T12:00:00Z' })).toEqual(['Salida posterior al ingreso']);
});
it.each(['', '  ', null, 'Desconocido', 'Sin clasificar', '—'])('no admite un tipo ausente: %s', tipo => {
  expect(faltantesRegistro({ ...completo, tipo_vehiculo: tipo })).toContain('Tipo de vehículo');
});
it.each(['persona_ingreso', 'placa_reconocida', 'vehiculo_marca', 'motivo_ingreso'])('no admite %s vacío', campo => {
  expect(faltantesRegistro({ ...completo, [campo]: ' ' })).toHaveLength(1);
});
it('aprovecha datos reales del padrón cuando faltan en el movimiento', () => {
  const d = { ...completo, persona_ingreso: ' ', propietario: 'Ana', tipo_vehiculo: 'Desconocido', autorizado_tipo: 'Camioneta', vehiculo_marca: null, autorizado_marca: 'Toyota' };
  expect(faltantesRegistro(d)).toEqual([]);
  expect(datosRegistro(d)).toMatchObject({ nombre: 'Ana', tipo: 'Camioneta', marca: 'Toyota' });
});

describe('Registro completo · motivo del permiso', () => {
  it('el paso toma el motivo de ingreso del permiso de la lista blanca si el suyo está vacío', () => {
    const paso = { persona_ingreso: 'Ana Torres', placa_reconocida: 'PBA1234', tipo_vehiculo: 'SUV', vehiculo_marca: 'Mazda',
      fecha_hora_ingreso: '2026-10-28T13:00:00Z', motivo_ingreso: null, autorizado_motivo: 'Trabajo en el centro zonal' };
    expect(datosRegistro(paso).motivo).toBe('Trabajo en el centro zonal');
    expect(faltantesIngreso(paso)).toEqual([]);
    // El motivo escrito para ese día manda sobre el del permiso
    expect(datosRegistro({ ...paso, motivo_ingreso: 'Reunión' }).motivo).toBe('Reunión');
    expect(faltantesIngreso({ ...paso, autorizado_motivo: null })).toEqual(['Motivo']);
  });
});
