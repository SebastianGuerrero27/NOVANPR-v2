const query = jest.fn().mockResolvedValue({ recordset: [{ n: 1 }] });
const request = { input: jest.fn().mockReturnThis(), query };
jest.mock('../../infraestructura/db', () => ({ getDB: () => ({ request: () => request }) }));
import { repositorioDeteccionesSql as repo } from '../../infraestructura/persistencia/deteccionesSql';
import { leerFiltros } from '../../dominio/detecciones';
import { DATOS_INGRESO_COMPLETOS_SQL, REGISTRO_COMPLETO_SQL } from '../../infraestructura/persistencia/registroCompletoSql';

describe('Registros cerrados y movimientos pendientes', () => {
  beforeEach(() => { query.mockClear(); request.input.mockClear(); });
  it('una salida por ID acepta matrícula null sin debilitar las demás condiciones de la ficha', async () => {
    await expect(repo.registrarSalida(15)).resolves.toBe(true);
    const consulta = String(query.mock.calls[0][0]);
    expect(consulta).toContain('d.id = @id');
    expect(consulta).toContain(DATOS_INGRESO_COMPLETOS_SQL);
    expect(DATOS_INGRESO_COMPLETOS_SQL).not.toContain('registro.placa_validada');
    expect(DATOS_INGRESO_COMPLETOS_SQL).not.toContain('registro.placa_reconocida');
    expect(consulta).toContain('d.fecha_hora_ingreso <= CURRENT_TIMESTAMP');
    expect(consulta).not.toContain('ruta_imagen_ingreso =');
    expect(consulta).not.toContain('evidencia_lectura =');
  });
  it.each(['', '  '])('no ejecuta un emparejamiento automático con matrícula vacía %j', async placa => {
    expect(await repo.cerrarIngresoConSalida(99, placa, 60)).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
  it.each(['ingreso', 'salida'])('validar una %s con null conserva OCR original y retira la candidata efectiva sin tocar evidencias', async tipo => {
    if (tipo === 'salida') await repo.validarSalida(15, { placa: null, usuarioId: 3 });
    else await repo.guardarValidacion(15, { placa: null, tipo: 'SUV', usuarioId: 3 }, { alerta: null, permiso: null, vigencia: null },
      { estado: 'no_reconocido', regla: 'R7', restriccion: null, motivos: [] });
    expect(request.input).toHaveBeenCalledWith('placa', expect.anything(), null);
    const consulta = String(query.mock.calls[0][0]);
    expect(consulta).toContain('placa_ocr_original = COALESCE(placa_ocr_original, placa_reconocida)');
    expect(consulta).toContain('placa_reconocida = CASE WHEN CAST(@placa AS varchar(20)) IS NULL THEN NULL ELSE placa_reconocida END');
    expect(consulta).not.toMatch(/ruta_imagen_(ingreso|placa)\s*=|evidencia_lectura\s*=/);
  });
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
  it('el monitoreo excluye el registro completo con salida antes de contar y paginar, conservando cierres incompletos', async () => {
    const pendientes = leerFiltros({ completos: 'no', unir_salidas: 'si' });
    const salidas = leerFiltros({ cerrados: 'si', completos: 'si' });
    if (!pendientes.ok) throw new Error(pendientes.error);
    if (!salidas.ok) throw new Error(salidas.error);
    await repo.contar(pendientes.valor);
    await repo.pagina(pendientes.valor, 30, 30);
    await repo.recientes(50, null);
    for (const [sentencia] of query.mock.calls) {
      // La misma regla se niega en el listado y en el feed: tener salida por sí solo no retira la fila.
      expect(sentencia).toContain(`AND NOT ${REGISTRO_COMPLETO_SQL}`);
      expect(sentencia).not.toContain('AND d.fecha_hora_salida IS NULL');
      expect(sentencia).not.toContain('d.estado_validacion IN');
    }
    const pagina = String(query.mock.calls[1][0]);
    expect(pagina.indexOf(`AND NOT ${REGISTRO_COMPLETO_SQL}`)).toBeLessThan(pagina.indexOf('ORDER BY'));
    expect(pagina).toContain('LIMIT @tamano OFFSET @offset');
    await repo.contar(salidas.valor);
    await repo.pagina(salidas.valor, 0, 25);
    for (const [sentencia] of query.mock.calls.slice(3)) {
      // Registro de Salidas usa la regla complementaria, sin depender del estado de autorización.
      expect(sentencia).toContain(`AND ${REGISTRO_COMPLETO_SQL}`);
      expect(sentencia).not.toContain(`AND NOT ${REGISTRO_COMPLETO_SQL}`);
    }
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
  it('una celda editada actualiza solo su columna, sin tocar el resto del formulario ni el permiso', async () => {
    await repo.guardarDatosIngreso(15, { cedula: '0123456789', persona: 'Ana Torres', marca: 'Mazda' });
    expect(request.input).toHaveBeenCalledWith('cedula_ingreso', expect.anything(), '0123456789');
    const sentencia = query.mock.calls[0][0];
    expect(sentencia).toContain('cedula_ingreso = @cedula_ingreso');
    expect(sentencia).toContain('persona_ingreso = @persona');
    expect(sentencia).toContain('vehiculo_marca = @marca');
    expect(sentencia).not.toContain('institucion_ingreso');
    expect(sentencia).not.toContain('ListaBlanca');
  });
  it('el formulario «Autorizar ingreso» guarda cada campo en su columna; un dato del permiso vaciado queda como texto vacío', async () => {
    await repo.guardarDatosIngreso(15, { cedula: null, ficha: { institucion: 'ECU 911', cargo: null, departamento: null, categoria: 'FUNCIONARIO',
      observaciones: null, vigenciaDesde: '2026-10-24', vigenciaHasta: null, horario: '[]' } });
    expect(request.input).toHaveBeenCalledWith('cedula_ingreso', expect.anything(), '');
    expect(request.input).toHaveBeenCalledWith('institucion_ingreso', expect.anything(), 'ECU 911');
    expect(request.input).toHaveBeenCalledWith('cargo_ingreso', expect.anything(), '');
    expect(request.input).toHaveBeenCalledWith('vigencia_desde', 'DATE', '2026-10-24');
    expect(request.input).toHaveBeenCalledWith('vigencia_hasta', 'DATE', null);
    expect(request.input).toHaveBeenCalledWith('horario_permiso', expect.anything(), '[]');
    expect(query.mock.calls[0][0]).toContain('categoria_permiso = @categoria_permiso');
    expect(query.mock.calls[0][0]).not.toContain('datos_permiso');
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

describe('Historial completo y reportes: búsqueda por palabras e informes analíticos', () => {
  beforeEach(() => { query.mockReset().mockResolvedValue({ recordset: [{ n: 1 }] }); request.input.mockClear(); });
  const filtros = (q: Record<string, string>) => {
    const f = leerFiltros(q);
    if (!f.ok) throw new Error(f.error);
    return f.valor;
  };

  it('nombres y apellidos en cualquier orden: cada palabra debe aparecer; la placa se compara con el texto completo', async () => {
    await repo.contar(filtros({ buscar: 'Pérez  María pérez' }));
    expect(request.input).toHaveBeenCalledWith('buscar', expect.anything(), '%Pérez María pérez%');
    expect(request.input).toHaveBeenCalledWith('buscar0', expect.anything(), '%Pérez%');
    expect(request.input).toHaveBeenCalledWith('buscar1', expect.anything(), '%María%');
    // Una palabra repetida (sin distinguir mayúsculas) no se busca dos veces
    expect(request.input.mock.calls.map(c => c[0])).not.toContain('buscar2');
    const sentencia = query.mock.calls[0][0];
    expect(sentencia).toContain("ILIKE REPLACE(@buscar, '-', '')");
    expect(sentencia).toContain("TRANSLATE(LOWER(COALESCE(d.persona_ingreso, '')), 'áéíóúüñ', 'aeiouun') LIKE TRANSLATE(LOWER(COALESCE(@buscar1, '')), 'áéíóúüñ', 'aeiouun')");
    expect(sentencia).toContain('permiso_busqueda.cedula LIKE @buscar1');
  });

  it('una sola palabra se busca como antes', async () => {
    await repo.contar(filtros({ buscar: 'Rosa' }));
    expect(request.input.mock.calls.map(c => c[0])).not.toContain('buscar0');
    expect(query.mock.calls[0][0]).toContain("LIKE TRANSLATE(LOWER(COALESCE(@buscar, '')), 'áéíóúüñ', 'aeiouun')");
  });

  it('el filtro de persona mira solo nombres, apellidos y cédula (de quien ingresó o del titular)', async () => {
    await repo.contar(filtros({ persona: 'vera rosa' }));
    expect(request.input).toHaveBeenCalledWith('persona0', expect.anything(), '%vera%');
    expect(request.input).toHaveBeenCalledWith('persona1', expect.anything(), '%rosa%');
    const sentencia = query.mock.calls[0][0];
    expect(sentencia).toContain('permiso_persona.propietario');
    expect(sentencia).toContain('d.cedula_ingreso LIKE @persona1');
    expect(sentencia).not.toContain('motivo_ingreso');
  });

  it('el informe de un vehículo pide su placa exacta, no una parte', async () => {
    await repo.contar(filtros({ placa: 'pba-123', exacta: 'si' }));
    expect(request.input).toHaveBeenCalledWith('placa', expect.anything(), 'PBA123');
    expect(query.mock.calls[0][0]).toContain("REPLACE(COALESCE(d.placa_validada, d.placa_reconocida, ''), '-', '') = @placa");
    await repo.contar(filtros({ placa: 'pba-123' }));
    expect(request.input).toHaveBeenLastCalledWith('placa', expect.anything(), '%PBA123%');
    expect(leerFiltros({ placa: 'PBA123', exacta: 'otro' }).ok).toBe(false);
    expect(leerFiltros({ persona: 'a'.repeat(101) }).ok).toBe(false);
  });

  it('el análisis cuenta solo ingresos, en hora de Ecuador, y arma los gráficos y los más frecuentes', async () => {
    query.mockImplementation(async (texto: string) => ({ recordset:
      texto.includes("'YYYY-MM-DD') AS dia") ? [{ dia: '2026-11-02', clase: 'autorizados', n: 2 }, { dia: '2026-11-02', clase: 'alertas', n: '1' }, { dia: '2026-11-03', clase: 'pendientes', n: 1 }]
        : texto.includes('ISODOW') ? [{ dia_semana: 1, hora: 7, n: 3 }, { dia_semana: 2, hora: 22, n: 1 }]
          : texto.includes('percentile_cont') ? [{ n: 2, media: 90.4, mediana: 80, p90: 120.6 }]
            : texto.includes('LIMIT 10') && texto.includes('AS placa, COUNT') ? [{ placa: 'PBA1234', ingresos: '3', ultimo: '2026-11-03T12:00:00Z', persona: 'Rosa Vera' }]
              : [{ nombre: 'Rosa Vera', ingresos: 3, placas: 1, ultimo: '2026-11-03T12:00:00Z' }] }));
    const a = await repo.analisisHistorial(filtros({ desde: '2026-11-01T05:00:00Z' }));
    for (const [sentencia] of query.mock.calls) {
      expect(sentencia).toContain("COALESCE(d.tipo_movimiento, 'ingreso') = 'ingreso'");
      expect(sentencia).toContain('d.fecha_hora_ingreso >= @desde');
    }
    expect(query.mock.calls.some(([s]) => s.includes("(d.fecha_hora_ingreso + (@desfase * INTERVAL '1 minute'))"))).toBe(true);
    expect(request.input).toHaveBeenCalledWith('desfase', expect.anything(), expect.any(Number));
    expect(a.por_dia).toEqual([
      { dia: '2026-11-02', ingresos: 3, autorizados: 2, no_registrados: 0, alertas: 1, pendientes: 0 },
      { dia: '2026-11-03', ingresos: 1, autorizados: 0, no_registrados: 0, alertas: 0, pendientes: 1 },
    ]);
    expect(a.por_dia_semana).toEqual([3, 1, 0, 0, 0, 0, 0]);
    expect(a.por_hora[7]).toBe(3);
    expect(a.por_hora[22]).toBe(1);
    expect(a.dia_hora[0][7]).toBe(3);
    expect(a.permanencia).toEqual({ n: 2, media_min: 90, mediana_min: 80, p90_min: 121 });
    expect(a.frecuentes).toEqual([{ placa: 'PBA1234', ingresos: 3, ultimo: '2026-11-03T12:00:00Z', persona: 'Rosa Vera' }]);
    expect(a.personas[0]).toMatchObject({ nombre: 'Rosa Vera', ingresos: 3, placas: 1 });
  });

  it('sin salidas registradas no hay permanencia', async () => {
    query.mockImplementation(async (texto: string) => ({ recordset: texto.includes('percentile_cont') ? [{ n: 0, media: null, mediana: null, p90: null }] : [] }));
    const a = await repo.analisisHistorial(filtros({}));
    expect(a.permanencia).toBeNull();
    expect(a.por_dia_semana).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});
