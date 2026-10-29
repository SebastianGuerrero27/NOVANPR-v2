import type { CalendarioLocal } from '../../aplicacion/calendario';
import { ErrorAplicacion, type Actor } from '../../aplicacion/comun';
import { casosPanel, type RepositorioPanel } from '../../aplicacion/panel';

/** Panel, reporte consolidado y evaluación con dobles de prueba: sin base de datos y con un reloj fijo. */

const GESTOR: Actor = { id: 4, email: 'gestor@ecu911.gob.ec', nombre: 'Gestor', rol: 'GestorPermisos', ip: '10.0.0.4' };

/** Ecuador (UTC-5): el día local empieza a las 05:00 UTC. Ahora: lunes 5 de octubre de 2026, 10:00 locales. */
const AHORA = new Date('2026-10-05T15:00:00Z');
const calendario: CalendarioLocal = {
  ahora: () => AHORA,
  inicioDiaLocal: (fecha, dias = 0) => {
    const local = new Date(fecha.getTime() - 5 * 3_600_000);
    local.setUTCHours(0, 0, 0, 0);
    return new Date(local.getTime() + 5 * 3_600_000 + dias * 86_400_000);
  },
  desfaseMinutos: () => -300,
};

const fallo = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return e as ErrorAplicacion; }
  throw new Error('se esperaba un error');
};

describe('Casos de uso · panel de inicio', () => {
  const repositorio: jest.Mocked<RepositorioPanel> = {
    operacion: jest.fn().mockResolvedValue({
      hoy: { total: 3, autorizados: 2, alertas: 1, no_registrados: null, pendientes: 0, validados: 1 },
      ayer: { total: 5 },
      porHora: [{ hora: 9, total: 3, autorizados: 2, alertas: 1, no_registrados: 0, pendientes: 0 }],
      tendencia: [{ fecha: '2026-10-05', total: 3, autorizados: 2, alertas: 1, no_registrados: 0, pendientes: 0 }],
      camaras: [{ id: 1, nombre: 'Garita', activa: 1 }],
      cola: { n: 2 },
      alertas: [{ id: 9 }],
      listas: { autorizados_vigentes: 10, autorizados_por_vencer: null },
    }),
    accesos: jest.fn().mockResolvedValue({
      solicitudes: [{ id: 1, placa: 'PBA1234', total: 3 }, { id: 2, placa: 'GSD4321', total: 3 }],
      padron: { vigentes: 8, vencidos: null },
      categorias: [{ categoria: 'VISITANTE', n: 2 }],
      denegados: { sin_permiso: 1, restringidos: null },
      reincidentes: [{ placa: 'XYZ9999', intentos: '3', ultimo: '2026-10-05T14:00:00Z' }],
      recientes: [{ id: 21 }],
    }),
    administracion: jest.fn().mockResolvedValue({
      usuarios: [
        { codigo: 'ADMIN', estado: 'activo', bloqueado: false, bloqueo_temporal: 0, n: 1 },
        { codigo: 'GUARDIA', estado: 'activo', bloqueado: true, bloqueo_temporal: 0, n: 1 },
        { codigo: 'GUARDIA', estado: 'pendiente', bloqueado: false, bloqueo_temporal: 0, n: 2 },
        { codigo: 'GESTOR_PERMISOS', estado: 'inactivo', bloqueado: false, bloqueo_temporal: 1, n: 1 },
      ],
    }),
  };
  const casos = casosPanel({
    repositorio, tiempo: calendario, diasAviso: () => 7, mapearDeteccion: f => ({ mapeada: f.id }),
    servicios: { anpr: async () => ({ en_linea: true }), correoConfigurado: () => false },
  });

  it('resumen: series completas (24 horas y 7 días locales) y conteos nulos en cero', async () => {
    const r = await casos.resumen();
    expect(repositorio.operacion).toHaveBeenCalledWith(expect.objectContaining({
      hoy: new Date('2026-10-05T05:00:00Z'), hace7: new Date('2026-09-29T05:00:00Z'), desfase: -300, diasAviso: 7,
    }));
    expect(r.por_hora).toHaveLength(24);
    expect(r.por_hora[9]).toEqual({ hora: 9, total: 3, autorizados: 2, alertas: 1, no_registrados: 0, pendientes: 0 });
    expect(r.por_hora[10].total).toBe(0);
    expect(r.tendencia.map(d => d.fecha)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
    expect(r.tendencia[6].total).toBe(3);
    expect(r.hoy.no_registrados).toBe(0);
    expect(r.movimientos.registros_acceso).toBe(0);
    expect(r).toMatchObject({
      ayer_misma_hora: 5, cola_revision: 2, ultimas_alertas: [{ mapeada: 9 }], camaras: [{ id: 1, activa: true }],
      listas: { autorizados_vigentes: 10, autorizados_por_vencer: 0, dias_aviso: 7 },
    });
  });

  it.each([
    { ingresos: 3, entradas: 2, salidas: 1, dentro: 4, registros_completos: 8 },
    { ingresos: 4, entradas: 2, salidas: 2, dentro: 3, registros_completos: 9 },
  ])('resumen: conserva el total histórico de accesos independiente del balance de salidas (%j)', async balance => {
    repositorio.operacion.mockResolvedValueOnce({
      movimientos: { ...balance, registros_acceso: 27 },
      hoy: { total: 3 }, porHora: [], tendencia: [], camaras: [], alertas: [],
    });
    const r = await casos.resumen();
    expect(r.movimientos).toEqual({ ...balance, registros_acceso: 27 });
    expect(r.hoy.total).toBe(3);
  });

  it.each([
    { recibido: 27, esperado: 27 },
    { recibido: '27', esperado: 27 },
    { recibido: null, esperado: 0 },
    { recibido: undefined, esperado: 0 },
  ])('resumen: normaliza el conteo de accesos de la base ($recibido → $esperado)', async ({ recibido, esperado }) => {
    repositorio.operacion.mockResolvedValueOnce({
      movimientos: { entradas: 2, salidas: 1, dentro: 4, registros_acceso: recibido },
      porHora: [], tendencia: [], camaras: [], alertas: [],
    });
    const r = await casos.resumen();
    expect(r.movimientos.registros_acceso).toBe(esperado);
    expect(r.movimientos).toMatchObject({ entradas: 2, salidas: 1, dentro: 4 });
  });

  it('accesos: las solicitudes propias no cuentan (SoD) y el total no se repite en cada fila', async () => {
    const r = await casos.accesos(GESTOR);
    expect(repositorio.accesos).toHaveBeenCalledWith(expect.objectContaining({ usuarioId: GESTOR.id, diasAviso: 7 }));
    expect(r.solicitudes).toEqual({ pendientes: 3, ultimas: [{ id: 1, placa: 'PBA1234' }, { id: 2, placa: 'GSD4321' }] });
    expect(r).toMatchObject({
      padron: { vigentes: 8, vencidos: 0, dias_aviso: 7 }, categorias: { VISITANTE: 2 }, hoy: { sin_permiso: 1, restringidos: 0 },
      reincidentes: [{ placa: 'XYZ9999', intentos: 3 }], denegados_recientes: [{ mapeada: 21 }],
    });
  });

  it('administración: un bloqueo prevalece sobre el estado y se cuentan los 3 roles', async () => {
    const r = await casos.administracion();
    expect(r.usuarios).toEqual({
      total: 5, activos: 1, pendientes: 2, inactivos: 0, bloqueados: 2, por_rol: { Admin: 1, Guardia: 3, GestorPermisos: 1 },
    });
    expect(r.servicios).toEqual({ base_datos: { en_linea: true }, anpr: { en_linea: true }, correo: { configurado: false } });
  });
});
