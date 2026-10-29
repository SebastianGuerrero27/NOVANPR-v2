import fs from 'fs';
import path from 'path';
import { LISTA_BLANCA } from '../../dominio/listas';
import { datosAprobacion, leerSolicitud } from '../../dominio/solicitudesAcceso';
const query = jest.fn().mockResolvedValue({ recordset: [{ id: 7 }], rowsAffected: [1] });
const request = { input: jest.fn().mockReturnThis(), query };
jest.mock('../../infraestructura/db', () => ({ getDB: () => ({ request: () => request }) }));
import { repositorioSolicitudesSql } from '../../infraestructura/persistencia/solicitudesAccesoSql';
const entrada = { placa: 'ABC1234', propietario: 'Ana Pérez', cedula: '0102030405', institucion: 'ECU 911', cargo: 'Analista', departamento: 'Soporte', motivo: 'Reunión de trabajo', observaciones: 'Visita programada', tipo_vehiculo: 'Camioneta' };
it('las longitudes del permiso coinciden con las columnas PostgreSQL', () => {
  const esquema = fs.readFileSync(path.resolve(__dirname, '../../../../db/postgresql/esquema.sql'), 'utf8');
  const tabla = esquema.split('CREATE TABLE IF NOT EXISTS "vehiculosautorizados" (')[1].split('\n);')[0];
  for (const campo of LISTA_BLANCA.campos) expect(tabla).toMatch(new RegExp(`\\b${campo.nombre} varchar\\(${campo.max}\\)`));
});
it('alta y edición de solicitudes conservan cédula, institución, cargo y observaciones', async () => {
  const r = leerSolicitud(entrada); if (!r.ok) throw new Error(r.error);
  await repositorioSolicitudesSql.crear(r.valor, 1);
  await repositorioSolicitudesSql.actualizar(7, r.valor, 1);
  for (const campo of ['cedula', 'institucion', 'cargo', 'observaciones'] as const) {
    expect(request.input).toHaveBeenCalledWith(campo, expect.anything(), entrada[campo]);
    expect(query.mock.calls.every(([sql]) => sql.includes(`@${campo}`))).toBe(true);
  }
});
it('la aprobación conserva los datos de persona y permite corregirlos antes de crear el permiso', () => {
  const r = datosAprobacion({ ...entrada, id: 7, categoria: 'VISITANTE', vehiculo: { tipo: 'Camioneta', marca: null, modelo: null, color: null }, fecha_inicio: null, fecha_fin: null, horario: null }, { cargo: 'Coordinadora' });
  expect(r).toMatchObject({ ok: true, valor: { cedula: '0102030405', institucion: 'ECU 911', cargo: 'Coordinadora', observaciones: 'Visita programada' } });
});
it('la solicitud requiere placa aunque el permiso directo admita solo el nombre', () => {
  expect(leerSolicitud({ ...entrada, placa: '' }).ok).toBe(false);
});
