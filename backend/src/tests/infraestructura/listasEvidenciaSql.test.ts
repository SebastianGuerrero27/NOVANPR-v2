const query = jest.fn().mockResolvedValue({ recordset: [] });
const request = { input: jest.fn().mockReturnThis(), query };
jest.mock('../../infraestructura/db', () => ({ getDB: () => ({ request: () => request }) }));
import { repositorioListasSql } from '../../infraestructura/persistencia/listasSql';
import { leerRegistroLista, LISTA_BLANCA, LISTA_NEGRA } from '../../dominio/listas';

beforeEach(() => query.mockReset().mockResolvedValue({ recordset: [] }));

it.each([LISTA_BLANCA, LISTA_NEGRA])('lista $tipo muestra fotos conservadas independientes del historial, sin exponer rutas del servidor', async definicion => {
  query.mockResolvedValue({ recordset: [{ id: 1, placa: 'PBA1234', horario: null,
    imagen_vehiculo: '/app/media/lista_autorizado_1_vehiculo.jpg', imagen_placa: null,
    ruta_evidencia_vehiculo: '/app/media/lista_autorizado_1_vehiculo.jpg', ruta_evidencia_placa: null,
    fecha_evidencia_vehiculo: new Date('2026-10-28T12:00:00Z'), fecha_evidencia_placa: null }] });
  const [fila] = await repositorioListasSql.listar(definicion);
  expect(fila).toMatchObject({ imagen_vehiculo: expect.stringContaining('/media/lista_autorizado_1_vehiculo.jpg?'),
    imagen_placa: null, fecha_evidencia_vehiculo: '2026-10-28T12:00:00.000Z', fecha_evidencia_placa: null });
  expect(fila.ruta_evidencia_vehiculo).toBeUndefined();
  const sql = query.mock.calls[0][0];
  expect(sql).toContain('t.ruta_evidencia_vehiculo AS imagen_vehiculo');
  expect(sql).toContain('t.ruta_evidencia_placa AS imagen_placa');
  expect(sql).not.toContain('COALESCE(d.ruta_imagen_placa, d.ruta_imagen_ingreso)');
});

it('editar otra matrícula reinicia sus estados para no mostrar fotos de otro vehículo', async () => {
  const registro = leerRegistroLista(LISTA_BLANCA, { placa: 'PBA1234', propietario: 'Ana Pérez' });
  if (!registro.ok) throw new Error(registro.error);
  await repositorioListasSql.actualizar(LISTA_BLANCA, 1, registro.valor);
  const sql = query.mock.calls[0][0];
  for (const columna of ['ruta_evidencia_vehiculo', 'ruta_evidencia_placa', 'fecha_evidencia_vehiculo', 'fecha_evidencia_placa']) {
    expect(sql).toContain(`${columna} = CASE WHEN`);
    expect(sql).toContain(`THEN NULL ELSE ${columna} END`);
  }
  expect(sql).toContain("IS DISTINCT FROM COALESCE(@placa, '')");
});
