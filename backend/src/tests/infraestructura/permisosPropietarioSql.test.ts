const query = jest.fn().mockResolvedValue({ recordset: [] });
const request = { input: jest.fn().mockReturnThis(), query };
jest.mock('../../infraestructura/db', () => ({ getDB: () => ({ request: () => request }) }));
import { repositorioListasSql as listas } from '../../infraestructura/persistencia/listasSql';
import { repositorioPanelSql as panel } from '../../infraestructura/persistencia/panelSql';
import { leerRegistroLista, LISTA_BLANCA } from '../../dominio/listas';

beforeEach(() => { query.mockClear(); request.input.mockClear(); });

it('filtra en la base por propietario tanto permisos con placa como pendientes', async () => {
  await listas.listar(LISTA_BLANCA, 18);
  expect(request.input).toHaveBeenCalledWith('propietarioId', expect.anything(), 18);
  expect(query.mock.calls[0][0]).toContain('t.registrado_por = @propietarioId');
  expect(query.mock.calls[0][0]).not.toContain('placa IS NOT NULL');
});

it('reactivar conserva al usuario original del permiso', async () => {
  const r = leerRegistroLista(LISTA_BLANCA, { placa: 'PBA1234', propietario: 'Ana Pérez' });
  if (!r.ok) throw new Error(r.error);
  await listas.reactivar(LISTA_BLANCA, 7, r.valor, 18);
  expect(query.mock.calls[0][0]).toContain('registrado_por = COALESCE(registrado_por, @usuario)');
});

it('los indicadores del gestor se calculan solo con los permisos de su usuario', async () => {
  const hoy = new Date('2026-10-22T05:00:00Z');
  await panel.accesos({ hoy, hace7: hoy, diasAviso: 7, usuarioId: 18 });
  const sql = query.mock.calls.map(([q]) => String(q)).filter(q => q.includes('FROM ListaBlanca'));
  expect(sql).toHaveLength(2);
  for (const q of sql) expect(q).toContain('registrado_por = @uid');
});
