const query = jest.fn().mockResolvedValue({ recordset: [{}] });
const request = { input: jest.fn().mockReturnThis(), query };
jest.mock('../../infraestructura/db', () => ({ getDB: () => ({ request: () => request }) }));
import { repositorioPanelSql } from '../../infraestructura/persistencia/panelSql';
import { REGISTRO_COMPLETO_SQL } from '../../infraestructura/persistencia/registroCompletoSql';
import { repositorioDeteccionesSql } from '../../infraestructura/persistencia/deteccionesSql';
import { leerFiltros } from '../../dominio/detecciones';

beforeEach(() => {
  query.mockReset().mockResolvedValue({ recordset: [{}] });
  request.input.mockClear();
});

it('el balance de guardia reparte los ingresos de hoy (cualquier estado) entre entradas sin salida y salidas', async () => {
  const hoy = new Date('2026-10-22T05:00:00Z');
  await repositorioPanelSql.operacion({ hoy, ayer: hoy, hace7: hoy, mismaHoraAyer: hoy, desfase: -300, diasAviso: 7 });
  const sql = query.mock.calls.map(([consulta]) => String(consulta)).find(consulta => consulta.includes('AS dentro'))!;
  // ingresos = entradas + salidas: los tres se cuentan sobre los ingresos de hoy, sin filtrar el estado
  expect(sql).toContain('WHEN fecha_hora_ingreso >= @hoy THEN 1 ELSE 0 END), 0) AS ingresos');
  expect(sql).toContain('WHEN fecha_hora_ingreso >= @hoy AND fecha_hora_salida IS NULL THEN 1 ELSE 0 END), 0) AS entradas');
  expect(sql).toContain('WHEN fecha_hora_ingreso >= @hoy AND fecha_hora_salida IS NOT NULL THEN 1 ELSE 0 END), 0) AS salidas');
  // «dentro» conserva el criterio de Monitoreo: autorizados sin salida, de cualquier día
  expect(sql).toContain("estado_validacion = 'autorizado' AND fecha_hora_salida IS NULL THEN 1 ELSE 0 END), 0) AS dentro");
  expect(sql).toContain(`CASE WHEN ${REGISTRO_COMPLETO_SQL} THEN 1 ELSE 0 END`);
  expect(sql).toContain("COALESCE(tipo_movimiento, 'ingreso') = 'ingreso'");
  expect(sql.slice(sql.lastIndexOf('FROM DeteccionVehiculo d WHERE'))).not.toContain('fecha_hora_ingreso >= @hoy');
});

it('el total de accesos usa el mismo alcance histórico que el historial sin filtros y conserva el balance separado', async () => {
  const balance = { entradas: 2, salidas: 1, dentro: 4, registros_completos: 8 };
  query.mockImplementation(async (consulta: string) => ({ recordset: [
    consulta.includes('AS registros_acceso') ? { registros_acceso: 27 }
      : consulta.includes('AS dentro') ? balance : { n: 27 },
  ] }));
  const filtros = leerFiltros({ pagina: '2', tamano: '5' });
  if (!filtros.ok) throw new Error(filtros.error);
  const totalHistorial = await repositorioDeteccionesSql.contar(filtros.valor);
  const hoy = new Date('2026-10-22T05:00:00Z');
  const panel = await repositorioPanelSql.operacion({ hoy, ayer: hoy, hace7: hoy, mismaHoraAyer: hoy, desfase: -300, diasAviso: 7 });

  const sqlHistorial = String(query.mock.calls[0][0]);
  const sqlPanel = String(query.mock.calls.find(([consulta]) => String(consulta).includes('AS registros_acceso'))![0]);
  const predicado = (consulta: string) => consulta.split(/\bWHERE\b/i).at(-1)!.replace(/\bd\./g, '').trim();
  expect(sqlPanel).toMatch(/^SELECT COUNT\(\*\) AS registros_acceso FROM DeteccionVehiculo WHERE /);
  expect(predicado(sqlPanel)).toBe(predicado(sqlHistorial));
  expect(sqlPanel).not.toMatch(/estado_validacion|tipo_movimiento|fecha_hora|LIMIT|OFFSET/);
  expect(panel.movimientos).toEqual({ ...balance, registros_acceso: totalHistorial });
});
