const query = jest.fn().mockResolvedValue({ recordset: [{ n: 1 }] });
const request = { input: jest.fn().mockReturnThis(), query };
jest.mock('../../infraestructura/db', () => ({ getDB: () => ({ request: () => request }) }));
import { repositorioDeteccionesSql as repo } from '../../infraestructura/persistencia/deteccionesSql';
import { leerFiltros } from '../../dominio/detecciones';

describe('Registros cerrados y movimientos pendientes', () => {
  beforeEach(() => { query.mockClear(); request.input.mockClear(); });
  it('aplica la salida en la base antes de contar, paginar, exportar o eliminar filtrados', async () => {
    const f = leerFiltros({ cerrados: 'si', completos: 'si' });
    if (!f.ok) throw new Error(f.error);
    await repo.contar(f.valor);
    await repo.pagina(f.valor, 0, 25);
    await repo.exportar(f.valor);
    for (const [sql] of query.mock.calls) {
      expect(sql).toContain('d.fecha_hora_salida IS NOT NULL');
      expect(sql).toContain("COALESCE(d.tipo_movimiento, 'ingreso') = 'ingreso'");
      expect(sql).toContain('registro.tipo_vehiculo');
      expect(sql).toContain('registro.vehiculo_marca');
      expect(sql).toContain('registro.motivo_ingreso');
      expect(sql).toContain('registro.persona_ingreso');
      expect(sql).toContain('d.fecha_hora_salida >= d.fecha_hora_ingreso');
    }
  });
  it('busca los pendientes antes del límite para conservar ingresos antiguos sin salida', async () => {
    await repo.recientes(50, null);
    expect(query.mock.calls[0][0]).toContain('AND NOT (');
    expect(query.mock.calls[0][0]).toContain('registro.motivo_ingreso');
  });
  it('rechaza valores desconocidos del filtro', () => {
    expect(leerFiltros({ cerrados: 'otro' }).ok).toBe(false);
    expect(leerFiltros({ completos: 'otro' }).ok).toBe(false);
  });
  it('consulta todos los accesos sin filtrar completos y permite reproducir el balance del guardia', async () => {
    const todos = leerFiltros({ buscar: 'Juan', pagina: '2' });
    if (!todos.ok) throw new Error(todos.error);
    await repo.contar(todos.valor);
    await repo.pagina(todos.valor, 30, 30);
    // El titular se busca sin distinguir tildes ni mayúsculas («maria» encuentra a «María»)
    expect(query.mock.calls[0][0]).toContain("TRANSLATE(LOWER(COALESCE(d.persona_ingreso, '')), 'áéíóúüñ', 'aeiouun') LIKE");
    expect(query.mock.calls[0][0]).not.toContain('d.fecha_hora_salida IS NOT NULL');
    expect(query.mock.calls[1][0]).toContain('LIMIT @tamano OFFSET @offset');
    const dentro = leerFiltros({ estado: 'autorizado', cerrados: 'no' });
    if (!dentro.ok) throw new Error(dentro.error);
    await repo.contar(dentro.valor);
    expect(query.mock.calls[2][0]).toContain('d.fecha_hora_salida IS NULL');
    expect(query.mock.calls[2][0]).toContain('d.estado_validacion IN (@est0)');
    expect(leerFiltros({ buscar: 'a'.repeat(101) }).ok).toBe(false);
  });
  it('fusiona la cédula y los campos editados con la ficha existente sin reemplazar sus otros datos', async () => {
    await repo.guardarDatosIngreso(15, { cedula: '0123456789', persona: 'Ana Torres', marca: 'Mazda' });
    expect(request.input).toHaveBeenCalledWith('datosPermiso', expect.anything(), JSON.stringify({ cedula: '0123456789', propietario: 'Ana Torres', marca: 'Mazda' }));
    expect(query.mock.calls[0][0]).toContain("COALESCE(datos_permiso, '{}'::jsonb) || CAST(@datosPermiso AS jsonb)");
    expect(query.mock.calls[0][0]).toContain('vehiculo_marca = @marca');
    expect(query.mock.calls[0][0]).not.toContain('VehiculosAutorizados');
  });
});


it('una matrícula retractada elimina vínculos de listas y conserva el recorte y datos del personal', async () => {
  query.mockClear(); request.input.mockClear();
  await repo.marcarNoLegible(15, '/media/rotulo.jpg');
  const consulta = String(query.mock.calls[0][0]);
  expect(consulta).toContain('placa_reconocida = NULL');
  expect(consulta).toContain('alerta_id = NULL, vehiculo_autorizado_id = NULL, restriccion_acceso = NULL');
  expect(consulta).toContain('verificacion_vehiculo = NULL, verificacion_detalle = NULL');
  expect(consulta).toContain('COALESCE(@ruta, ruta_imagen_placa, ruta_imagen_ingreso)');
  expect(consulta).not.toMatch(/persona_ingreso\s*=|motivo_ingreso\s*=|placa_validada\s*=/);
  expect(request.input).toHaveBeenCalledWith('ruta', expect.anything(), '/media/rotulo.jpg');
});
