import type { CalendarioLocal } from '../../aplicacion/calendario';
import { ErrorAplicacion, type Actor } from '../../aplicacion/comun';
import { casosControlVehicular, type PuertoDocumentosControl, type RepositorioControlVehicular } from '../../aplicacion/controlVehicular';
import type { MovimientoControl } from '../../dominio/controlVehicular';

/** Reporte de control vehicular con dobles: sin base de datos ni archivos y con un reloj fijo (Ecuador, UTC-5). */

const AGENTE: Actor = { id: 7, email: 'agente@ecu911.gob.ec', nombre: 'Ana Pérez', rol: 'Guardia', ip: '10.0.0.7' };
/** Lunes 19 de octubre de 2026, 10:00 locales */
const AHORA = new Date('2026-10-19T15:00:00Z');
const calendario: CalendarioLocal = {
  ahora: () => AHORA,
  inicioDiaLocal: (fecha, dias = 0) => {
    const local = new Date(fecha.getTime() - 5 * 3_600_000);
    local.setUTCHours(0, 0, 0, 0);
    return new Date(local.getTime() + 5 * 3_600_000 + dias * 86_400_000);
  },
  desfaseMinutos: () => -300,
};

const INGRESO: MovimientoControl = {
  id: 1, tipo_movimiento: 'ingreso', fecha_hora_ingreso: new Date('2026-10-20T02:45:00Z'), placa: 'PBA1234',
  persona_ingreso: 'Luis Torres', motivo_ingreso: 'Recorrido de supervisión', tipo_vehiculo: 'Camioneta', vehiculo_tipo: null,
  vehiculo_marca: null, propietario: null, autorizado_tipo: null, autorizado_marca: null, estado_validacion: 'no_reconocido',
  alerta_motivo: null, evidencia_lectura: null,
};

function preparar() {
  const repositorio: jest.Mocked<RepositorioControlVehicular> = {
    movimientos: jest.fn().mockResolvedValue([INGRESO]),
    nombreCamara: jest.fn().mockResolvedValue('Garita'),
  };
  const documentos: jest.Mocked<PuertoDocumentosControl> = {
    pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF')),
    excel: jest.fn().mockResolvedValue(Buffer.from('PK')),
  };
  const auditoria = { operacion: jest.fn().mockResolvedValue(undefined) };
  const casos = casosControlVehicular({
    repositorio, documentos, tiempo: calendario, auditoria,
    institucion: () => ({ sede: 'ECU 911 - AMBATO', lugar: 'PARQUEADERO - GARITA', ciudad: 'Ambato' }),
  });
  return { casos, repositorio, documentos, auditoria };
}

const fallo = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return e as ErrorAplicacion; }
  throw new Error('se esperaba un error');
};

describe('Casos de uso · reporte de control vehicular', () => {
  it('turno nocturno en Excel: consulta hasta la mañana siguiente (y 24 h más para las salidas) y arma la hoja', async () => {
    const { casos, repositorio, documentos, auditoria } = preparar();
    const r = await casos.generar({ desde: '2026-10-19T05:00:00.000Z', hasta: '2026-10-20T04:59:59.999Z', turno: 'nocturno', formato: 'xlsx' }, AGENTE);
    expect(repositorio.movimientos).toHaveBeenCalledWith(
      new Date('2026-10-19T05:00:00Z'), new Date(new Date('2026-10-20T04:59:59.999Z').getTime() + 31 * 3_600_000), null);
    expect(documentos.pdf).not.toHaveBeenCalled();
    expect(documentos.excel).toHaveBeenCalledWith({
      sede: 'ECU 911 - AMBATO', titulo: 'REPORTE DE CONTROL VEHICULAR', lugar: 'PARQUEADERO - GARITA',
      lineaFecha: 'Ambato, lunes 19 de octubre de 2026', agente: 'Ana Pérez', turno: 'Nocturno', horario: '19:00 – 07:00',
      camara: null, generado: '19-10-2026 10:00',
      filas: [{ fecha: '19-10-2026', nombres: 'Luis Torres', tipo: 'Camioneta', marca: '', placa: 'PBA-1234', ingreso: '21:45', salida: '', observaciones: 'Recorrido de supervisión' }],
    });
    expect(r).toEqual({
      nombre: 'control_vehicular_2026-10-19_nocturno.xlsx', tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      contenido: Buffer.from('PK'), ingresos: 1,
    });
    expect(auditoria.operacion).toHaveBeenCalledWith(AGENTE, 'REPORTE_CONTROL_VEHICULAR', 'deteccion', null,
      'XLSX · 2026-10-19 · turno nocturno · 1 ingresos');
  });

  it('por omisión, el día de hoy completo en PDF; con cámara, su nombre va en el encabezado', async () => {
    const { casos, repositorio, documentos } = preparar();
    repositorio.movimientos.mockResolvedValue([]);
    const r = await casos.generar({ camara: '2' }, AGENTE);
    expect(repositorio.movimientos).toHaveBeenCalledWith(new Date('2026-10-19T05:00:00Z'), new Date(AHORA.getTime() + 24 * 3_600_000), 2);
    expect(documentos.pdf).toHaveBeenCalledWith(expect.objectContaining({ camara: 'Garita', turno: 'Día completo', filas: [] }));
    expect(r.nombre).toBe('control_vehicular_2026-10-19_completo.pdf');
  });

  it('turno, formato o período inválidos responden 400 sin consultar la base', async () => {
    const { casos, repositorio } = preparar();
    for (const consulta of [{ turno: 'tarde' }, { formato: 'docx' }, { desde: '2026-02-30' }]) {
      expect((await fallo(casos.generar(consulta, AGENTE))).tipo).toBe('validacion');
    }
    expect(repositorio.movimientos).not.toHaveBeenCalled();
  });
});
