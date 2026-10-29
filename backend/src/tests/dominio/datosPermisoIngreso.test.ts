import { leerDatosIngreso } from '../../dominio/detecciones';
it('normaliza los datos completos del formulario con las reglas de lista blanca', () => {
  const r = leerDatosIngreso({ datos_permiso: { propietario: 'ANA TORRES', cedula: '0123456789', institucion: 'ECU 911', cargo: 'Analista', departamento: 'Tecnologia', placa: 'ABC1234', marca: 'Mazda', modelo: 'CX-5', tipo_vehiculo: 'SUV', color: 'rojo', fecha_inicio: '2026-10-24', fecha_vencimiento: '2026-10-31', horario: null } });
  expect(r.ok).toBe(true);
  if (!r.ok) throw Error(r.error);
  expect(r.valor.datosPermiso).toMatchObject({ propietario: 'ANA TORRES', cedula: '0123456789', institucion: 'ECU 911', cargo: 'Analista', fecha_inicio: '2026-10-24', fecha_fin: '2026-10-31', horario: null });
});
it.each([{ cedula: '123' }, { propietario: '' }, { fecha_inicio: '2026-10-31', fecha_vencimiento: '2026-10-24' }, { horario: 'incorrecto' }])('rechaza datos que tampoco admite lista blanca: %j', cambios => {
  expect(leerDatosIngreso({ datos_permiso: { propietario: 'ANA TORRES', ...cambios } }).ok).toBe(false);
});
it('mantiene la compatibilidad con clientes que solo corrigen la placa', () => {
  expect(leerDatosIngreso({ placa_validada: 'ABC1234' })).toEqual({ ok: true, valor: {} });
});
it('acepta la cédula de una celda como texto y conserva sus ceros iniciales', () => {
  expect(leerDatosIngreso({ cedula: ' 0123456789 ' })).toEqual({ ok: true, valor: { cedula: '0123456789' } });
  expect(leerDatosIngreso({ cedula: '' })).toEqual({ ok: true, valor: { cedula: null } });
});
it.each(['123', '01234567890', 'ABCDEFGHIJ', '012 456789', ['0123456789'], { value: '0123456789' }])('rechaza la cédula inválida de una celda: %j', cedula => {
  expect(leerDatosIngreso({ cedula }).ok).toBe(false);
});
it('exige los datos del vehículo al confirmar un ingreso y permite las ediciones parciales de celdas', () => {
  expect(leerDatosIngreso({ placa_validada: 'ABC1234' }, true).ok).toBe(false);
  expect(leerDatosIngreso({ tipo_vehiculo: 'SUV', marca: 'Mazda', modelo: 'CX-5', color: 'rojo' }, true).ok).toBe(true);
  expect(leerDatosIngreso({ marca: 'Mazda' })).toEqual({ ok: true, valor: { marca: 'Mazda' } });
});
