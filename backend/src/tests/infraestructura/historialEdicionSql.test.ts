const query = jest.fn().mockResolvedValue({ rowsAffected: [1], recordset: [] });
const request = { input: jest.fn().mockReturnThis(), query };
jest.mock('../../infraestructura/db', () => ({ getDB: () => ({ request: () => request }) }));
import { repositorioDeteccionesSql as repo } from '../../infraestructura/persistencia/deteccionesSql';

describe('Corrección administrativa del historial · persistencia', () => {
  beforeEach(() => {
    query.mockClear().mockResolvedValue({ rowsAffected: [1], recordset: [] });
    request.input.mockClear();
  });

  it('una edición de ficha actualiza solo sus campos y conserva OCR, estado, listas y horas', async () => {
    expect(await repo.guardarEdicionRegistro(15, { datos: { persona: 'Ana Pérez', cedula: null, modelo: 'Yaris' }, usuarioId: 1 })).toBe(true);
    const sentencia = String(query.mock.calls[0][0]);
    expect(sentencia).toContain('persona_ingreso = @persona');
    expect(sentencia).toContain('cedula_ingreso = @cedula');
    expect(sentencia).toContain('vehiculo_modelo = @modelo');
    expect(sentencia).not.toMatch(/placa_|estado_|fecha_|validado_|usuario_validador|ListaBlanca|ListaNegra|autorizado_id|alerta_id/);
    expect(request.input).toHaveBeenCalledWith('cedula', expect.anything(), '');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('una matrícula corregida conserva el OCR original y retira vínculos anteriores sin autorizar ni cambiar fechas', async () => {
    await repo.guardarEdicionRegistro(15, { datos: { marca: 'Toyota' }, placa: 'PBC5678', placaAnterior: 'PBA1234', usuarioId: 1 });
    const sentencia = String(query.mock.calls[0][0]);
    expect(sentencia).toContain('placa_ocr_original = COALESCE(placa_ocr_original, placa_reconocida)');
    expect(sentencia).toContain('decision_automatica = COALESCE(decision_automatica, estado_validacion)');
    expect(sentencia).toContain('placa_validada = CAST(@placa AS varchar(20))');
    expect(sentencia).toContain("CASE WHEN tipo_movimiento = 'salida' THEN 'salida_registrada' ELSE 'pendiente_revision' END");
    expect(sentencia).toContain('vehiculo_autorizado_id = NULL');
    expect(sentencia).toContain('alerta_id = NULL');
    expect(sentencia).toContain('restriccion_acceso = NULL');
    expect(sentencia).not.toMatch(/estado_validacion = 'autorizado'|INSERT INTO|UPDATE Lista|fecha_hora_ingreso =|fecha_hora_salida =/);
    expect(sentencia).toContain('registro.salida_deteccion_id IS NULL');
    expect(sentencia).toContain("COALESCE(registro.tipo_movimiento, 'ingreso') = 'ingreso'");
    expect(sentencia).toContain('vinculado.salida_deteccion_id = registro.id');
    expect(sentencia).toContain('= @anterior');
    expect(request.input).toHaveBeenCalledWith('anterior', expect.anything(), 'PBA1234');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('dejar sin matrícula limpia la lectura actual conservando la original y no elimina fotos', async () => {
    await repo.guardarEdicionRegistro(15, { datos: {}, placa: null, placaAnterior: 'PBA1234', usuarioId: 1 });
    const sentencia = String(query.mock.calls[0][0]);
    expect(sentencia).toContain('placa_reconocida = CASE WHEN CAST(@placa AS varchar(20)) IS NULL THEN NULL ELSE placa_reconocida END');
    expect(request.input).toHaveBeenCalledWith('placa', expect.anything(), null);
    expect(sentencia).not.toContain('ruta_imagen');
    expect(sentencia).not.toContain('confianza_ocr');
  });

  it('devuelve false si el registro o su vínculo cambiaron antes de la escritura atómica', async () => {
    query.mockResolvedValueOnce({ rowsAffected: [0], recordset: [] });
    expect(await repo.guardarEdicionRegistro(15, { datos: { marca: 'Toyota' }, placa: 'PBC5678', placaAnterior: 'PBA1234', usuarioId: 1 })).toBe(false);
  });
});
