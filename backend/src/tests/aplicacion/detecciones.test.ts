import { casosDetecciones, type DependenciasDetecciones, type Fila, type RepositorioDetecciones } from '../../aplicacion/detecciones';
import { ErrorAplicacion, type Actor } from '../../aplicacion/comun';
import type { PoliticaAutorizacion } from '../../dominio/decisionAcceso';
import { csvDetecciones, fechaHoraLocal, type FilaExportacion, MAX_REGISTROS_PDF } from '../../dominio/detecciones';

/** Detecciones con dobles de prueba: sin base de datos, sin disco, sin Socket.IO ni notificaciones. */

const ADMIN: Actor = { id: 1, email: 'admin@ecu911.gob.ec', nombre: 'Administrador', rol: 'Admin', ip: '10.0.0.1' };
const GUARDIA: Actor = { id: 3, email: 'guardia@ecu911.gob.ec', nombre: 'Guardia', rol: 'Guardia', ip: '10.0.0.3' };

const POLITICA: PoliticaAutorizacion = { criterio: 'validez_y_confianza', confianzaMinima: 0.8, fuenteConfianza: 'ocr', verificarVehiculo: true };
const AHORA = new Date('2026-10-05T15:00:00Z');
const PERMISO_VIGENTE: Fila = { id: 77, placa: 'PBA-1234', tipo_vehiculo: 'Automóvil', fecha_inicio: null, fecha_vencimiento: null, horario: null, color: 'Blanco' };
const VEHICULO_VALIDACION = { tipo_vehiculo: 'Automóvil', marca: 'Toyota', modelo: 'Yaris', color: 'Blanco' };

const fila = (cambios: Fila = {}): Fila => ({
  id: 15, placa_reconocida: 'PBA1234', placa_validada: null, estado_validacion: 'pendiente_revision', estado_procesamiento: 'procesado',
  fecha_hora_ingreso: new Date('2026-10-05T14:59:00Z'), ruta_imagen_ingreso: 'capturas/15.jpg', ruta_imagen_placa: 'capturas/15_placa.jpg',
  ...cambios,
});

function preparar(opciones: { alerta?: Fila | null; permiso?: Fila | null; existente?: Fila | null; salidaAutomatica?: boolean; salidaManual?: boolean } = {}) {
  const repositorio: jest.Mocked<RepositorioDetecciones> = {
    obtener: jest.fn().mockResolvedValue(opciones.existente === undefined ? fila() : opciones.existente),
    mismoPaso: jest.fn().mockResolvedValue(null),
    existeCamara: jest.fn().mockResolvedValue(true),
    direccionCamara: jest.fn().mockResolvedValue('ingreso'),
    crearIngreso: jest.fn().mockResolvedValue({ id: 15, fecha_hora_ingreso: AHORA }),
    guardarSalida: jest.fn().mockResolvedValue(undefined),
    validarSalida: jest.fn().mockResolvedValue(undefined),
    guardarMetadatos: jest.fn().mockResolvedValue(undefined),
    guardarVehiculo: jest.fn().mockResolvedValue(undefined),
    registrarLecturaAutomatica: jest.fn().mockResolvedValue(undefined),
    marcarNoLegible: jest.fn().mockResolvedValue(undefined),
    pasoProcesadoConPlaca: jest.fn().mockResolvedValue(null),
    eliminarPendiente: jest.fn().mockResolvedValue(undefined),
    guardarVeredicto: jest.fn().mockResolvedValue(undefined),
    observacion: jest.fn().mockResolvedValue({ confianza_deteccion: 0.9, fecha_hora_ingreso: '2026-10-05T14:59:00Z', marca: null, color: 'Blanco', tipo: null }),
    guardarVerificacion: jest.fn().mockResolvedValue(undefined),
    guardarDecisionAutomatica: jest.fn().mockResolvedValue(undefined),
    registrarDescarte: jest.fn().mockResolvedValue(undefined),
    contar: jest.fn().mockResolvedValue(1),
    pagina: jest.fn().mockResolvedValue([fila()]),
    resumenHistorial: jest.fn().mockResolvedValue({
      total: 1, ingresos: 1, salidas: 0, con_salida: 0, autorizados: 1, alertas: 0, no_registrados: 0, pendientes: 0,
      sin_lectura: 0, placas: 1, camara: 1, manuales: 0, primero: AHORA, ultimo: AHORA,
    }),
    analisisHistorial: jest.fn().mockResolvedValue({
      por_dia: [], por_dia_semana: Array(7).fill(0), por_hora: Array(24).fill(0), dia_hora: [], permanencia: null, frecuentes: [], personas: [],
    }),
    recientes: jest.fn().mockResolvedValue([fila()]),
    registrarSalida: jest.fn().mockResolvedValue(true),
    cerrarIngresoConSalida: jest.fn().mockResolvedValue(null),
    ingresoCerradoPor: jest.fn().mockResolvedValue(null),
    reabrirIngreso: jest.fn().mockResolvedValue(undefined),
    exportar: jest.fn().mockResolvedValue([fila()]),
    exportarPorLotes: jest.fn().mockImplementation(async function* () { yield [fila()]; }),
    historialPlaca: jest.fn().mockResolvedValue([]),
    auditoriaDe: jest.fn().mockResolvedValue([]),
    guardarValidacion: jest.fn().mockResolvedValue(undefined),
    crearManual: jest.fn().mockResolvedValue(30),
    crearSalidaManual: jest.fn().mockResolvedValue(31),
    guardarDatosIngreso: jest.fn().mockResolvedValue(undefined),
    guardarEdicionRegistro: jest.fn().mockResolvedValue(true),
    eliminar: jest.fn().mockResolvedValue(undefined),
    eliminarFiltradas: jest.fn().mockResolvedValue([{ id: 1, ruta_imagen_ingreso: 'a.jpg', ruta_imagen_placa: null }]),
  };
  const deps = {
    pdfRegistros: jest.fn().mockResolvedValue(Buffer.from('%PDF-prueba')),
    pdfHistorial: jest.fn().mockResolvedValue(Buffer.from('%PDF-historial')),
    repositorio,
    listas: {
      alerta: jest.fn().mockResolvedValue(opciones.alerta ? { row: opciones.alerta, coincidencia: 'exacta' } : null),
      permiso: jest.fn().mockResolvedValue(opciones.permiso ?? null),
    },
    presentar: jest.fn((f: Fila) => ({ id: f.id, placa: f.placa_validada || f.placa_reconocida || null, estado_validacion: f.estado_validacion })),
    politica: () => POLITICA,
    salidaAutomatica: () => ({ activa: Boolean(opciones.salidaAutomatica), minimoSegundos: 60 }),
    salidaManual: () => opciones.salidaManual !== false,
    compararVehiculo: jest.fn().mockReturnValue({ resultado: 'coincide', detalle: 'color coincide' }),
    avisos: { decision: jest.fn(), resolverPorDeteccion: jest.fn().mockResolvedValue(undefined) },
    evidencia: { eliminar: jest.fn().mockResolvedValue(2) },
    evidenciaManual: {
      cuadros: jest.fn().mockResolvedValue({ disponible: true, cuadros: [{ t: 1792634400.5, miniatura: 'AAAA' }] }),
      guardar: jest.fn().mockResolvedValue('/media/manual_20261021_184000_500_2.jpg'),
    },
    eventos: { emitir: jest.fn() },
    auditoria: { operacion: jest.fn().mockResolvedValue(undefined) },
    tiempo: { ahora: () => AHORA, zona: 'America/Guayaquil' },
  } satisfies DependenciasDetecciones;
  return { casos: casosDetecciones(deps), ...deps };
}

const fallo = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return e as ErrorAplicacion; }
  throw new Error('se esperaba un error');
};

describe('Observación de un rótulo en otro track del mismo acceso', () => {
  it('el autocompletado entrega horario como lista y conserva la señal de un dato dañado', async () => {
    const franjas = [{ dias: [1, 2, 3], desde: '08:00', hasta: '17:00' }];
    for (const guardado of [JSON.stringify(franjas), franjas]) {
      const { casos } = preparar({ permiso: { ...PERMISO_VIGENTE, horario: guardado } });
      const respuesta = await casos.buscarPlaca('PBA1234');
      expect(respuesta.autorizado?.horario).toEqual(franjas);
      expect(respuesta.autorizado?.horario_error).toBeUndefined();
    }
    const { casos } = preparar({ permiso: { ...PERMISO_VIGENTE, horario: '{malformado' } });
    expect((await casos.buscarPlaca('PBA1234')).autorizado).toMatchObject({ horario: null, horario_error: expect.any(String) });
  });

  it.each([
    { validado_manualmente: true, estado_validacion: 'autorizado', lectura_valida: true },
    { validado_manualmente: false, estado_validacion: 'alerta', lectura_valida: false },
    { validado_manualmente: false, estado_validacion: 'no_reconocido', lectura_valida: null },
  ])('añade el texto sin sustituir la matrícula ni su decisión (%j)', async estado => {
    const previa = { formato: true, lecturas: 3 };
    const { casos, repositorio, listas, avisos } = preparar({ existente: fila({ ...estado,
      placa_reconocida: 'PBA1234', evidencia_lectura: JSON.stringify(previa) }) });
    expect(await casos.reevaluar({ ingreso_id: 15, observacion_ocr: { texto: 'HAVAL / ambacar', confianza: 0.987 } }))
      .toMatchObject({ reevaluado: true, cambio: false });
    expect(repositorio.guardarVeredicto).toHaveBeenCalledWith(15, estado.lectura_valida,
      JSON.stringify({ ...previa, observacion_ocr: 'HAVAL / ambacar', confianza_texto_ocr: 0.987 }));
    expect(repositorio.marcarNoLegible).not.toHaveBeenCalled();
    expect(repositorio.guardarDecisionAutomatica).not.toHaveBeenCalled();
    expect(listas.permiso).not.toHaveBeenCalled();
    expect(avisos.decision).not.toHaveBeenCalled();
  });

  it('rechaza observaciones vacías sin modificar el acceso', async () => {
    const { casos, repositorio } = preparar();
    expect((await fallo(casos.reevaluar({ ingreso_id: 15, observacion_ocr: { texto: '', confianza: 0.99 } }))).tipo).toBe('validacion');
    expect(repositorio.guardarVeredicto).not.toHaveBeenCalled();
  });
});

describe('Detecciones · servicio ANPR', () => {
  it('fase 1: exige la imagen; reutiliza el mismo paso físico; si no, crea el ingreso pendiente de OCR y lo difunde', async () => {
    const sinImagen = preparar();
    expect((await fallo(sinImagen.casos.ingreso({ tracking_id: 4 }))).tipo).toBe('validacion');

    const repetido = preparar();
    repetido.repositorio.mismoPaso.mockResolvedValue({ id: 9, fecha_hora_ingreso: AHORA });
    expect(await repetido.casos.ingreso({ tracking_id: 4, ruta_imagen_ingreso: 'x.jpg', confianza_deteccion: 0.23 }))
      .toEqual({ nuevo: false, respuesta: expect.objectContaining({ ingreso_id: 9, deduplicado: true }) });
    expect(repetido.repositorio.crearIngreso).not.toHaveBeenCalled();

    const { casos, repositorio, eventos } = preparar();
    const r = await casos.ingreso({ tracking_id: 4, ruta_imagen_ingreso: 'x.jpg', placa: 'pba-12', camara_id: '2', confianza_deteccion: 0.91, metadatos: { luz: 1 } });
    expect(r).toEqual({ nuevo: true, respuesta: { message: 'Ingreso registrado (pendiente de OCR).', ingreso_id: 15, fecha_hora_ingreso: AHORA } });
    expect(repositorio.mismoPaso).toHaveBeenCalledWith(4, 'PBA12', 2, 'ingreso');
    expect(repositorio.crearIngreso).toHaveBeenCalledWith({ trackingId: 4, pista: 'PBA12', ruta: 'x.jpg', confianza: 0.91, fuente: 'rtsp', camaraId: 2, tipoMovimiento: 'ingreso' });
    expect(repositorio.guardarMetadatos).toHaveBeenCalledWith(15, { luz: 1 });
    expect(eventos.emitir).toHaveBeenCalledWith('deteccion:nueva', expect.objectContaining({ id: 15 }));
  });

  it('fase 1: descarta y audita detecciones inferiores al 23 % sin crear un ingreso', async () => {
    const { casos, repositorio } = preparar();
    const resultado = await casos.ingreso({
      tracking_id: 23,
      ruta_imagen_ingreso: 'falso-positivo.jpg',
      placa: 'PBA1234',
      confianza_deteccion: 0.229,
      fuente: 'rtsp',
      camara_id: 2,
    });

    expect(resultado).toEqual({
      nuevo: false,
      respuesta: {
        message: 'Paso descartado: confianza de detección inferior al 23 %.',
        descartado: true,
      },
    });
    expect(repositorio.registrarDescarte).toHaveBeenCalledWith({
      trackingId: 23,
      motivo: 'confianza_deteccion_baja',
      texto: 'PBA1234',
      confianza: 0.229,
      fuente: 'rtsp',
      camaraId: 2,
    });
    expect(repositorio.mismoPaso).not.toHaveBeenCalled();
    expect(repositorio.crearIngreso).not.toHaveBeenCalled();
  });

  it('fase 1: acepta el umbral de 23 % y rechaza confianzas fuera de rango', async () => {
    const minimo = preparar();
    const resultado = await minimo.casos.ingreso({
      tracking_id: 24,
      ruta_imagen_ingreso: 'umbral.jpg',
      confianza_deteccion: 0.23,
    });
    expect(resultado.nuevo).toBe(true);
    expect(minimo.repositorio.crearIngreso).toHaveBeenCalledWith(
      expect.objectContaining({ confianza: 0.23 }),
    );

    const invalida = preparar();
    expect((await fallo(invalida.casos.ingreso({
      tracking_id: 25,
      ruta_imagen_ingreso: 'confianza-invalida.jpg',
      confianza_deteccion: 1.1,
    }))).tipo).toBe('validacion');
    expect(invalida.repositorio.crearIngreso).not.toHaveBeenCalled();

    const sinConfianza = preparar();
    expect((await fallo(sinConfianza.casos.ingreso({
      tracking_id: 26,
      ruta_imagen_ingreso: 'sin-confianza.jpg',
    }))).tipo).toBe('validacion');
    expect(sinConfianza.repositorio.crearIngreso).not.toHaveBeenCalled();
  });

  it('fase 1: el mismo paso se busca en la cámara que lo vio; una cámara inexistente no se usa', async () => {
    const { casos, repositorio } = preparar();
    repositorio.existeCamara.mockResolvedValue(false);
    await casos.ingreso({
      tracking_id: 7, ruta_imagen_ingreso: 'x.jpg', placa: 'PBA1234', camara_id: 99, confianza_deteccion: 0.23,
    });
    expect(repositorio.mismoPaso).toHaveBeenCalledWith(7, 'PBA1234', null, 'ingreso');
    expect(repositorio.crearIngreso).toHaveBeenCalledWith(expect.objectContaining({ camaraId: null, tipoMovimiento: 'ingreso' }));
  });

  it('fase 1: conserva como salida la dirección configurada en la cámara', async () => {
    const { casos, repositorio } = preparar();
    repositorio.direccionCamara.mockResolvedValue('salida');
    const r = await casos.ingreso({
      tracking_id: 12, ruta_imagen_ingreso: 'salida.jpg', camara_id: 2, confianza_deteccion: 0.23,
    });
    expect(repositorio.crearIngreso).toHaveBeenCalledWith(expect.objectContaining({ tipoMovimiento: 'salida' }));
    expect(r.respuesta.message).toBe('Salida registrada (pendiente de OCR).');
  });

  it('fase 2 sin lectura utilizable: queda para el personal y no se elimina la evidencia', async () => {
    const { casos, repositorio } = preparar();
    expect((await fallo(casos.completarOcr({ ingreso_id: 'x' }))).message).toBe('El ID de ingreso es obligatorio.');
    await casos.completarOcr({ ingreso_id: 15, placa_reconocida: 'SIN RECONOCER', ruta_imagen_placa: 'p.jpg' });
    expect(repositorio.marcarNoLegible).toHaveBeenCalledWith(15, 'p.jpg');
    expect(repositorio.registrarLecturaAutomatica).toHaveBeenCalledWith(15, expect.objectContaining({ decision: 'pendiente_revision' }));
    expect(repositorio.guardarDecisionAutomatica).not.toHaveBeenCalled();
    expect(repositorio.guardarVeredicto).not.toHaveBeenCalled();
  });

  it('fase 2 de un vehículo sin placa: queda para el personal con la evidencia que explica el motivo', async () => {
    const { casos, repositorio } = preparar();
    await casos.completarOcr({
      ingreso_id: 16, placa_reconocida: null, ruta_imagen_placa: 'vehiculo.jpg', estado_procesamiento: 'no_legible', lectura_valida: false,
      evidencia_lectura: { motivo: 'vehiculo_sin_placa', tipo_vehiculo: 'automóvil', confianza_vehiculo: 0.91 },
    });
    expect(repositorio.marcarNoLegible).toHaveBeenCalledWith(16, 'vehiculo.jpg');
    expect(repositorio.guardarVeredicto).toHaveBeenCalledWith(16, false,
      '{"motivo":"vehiculo_sin_placa","tipo_vehiculo":"automóvil","confianza_vehiculo":0.91}');
    expect(repositorio.guardarDecisionAutomatica).not.toHaveBeenCalled();
  });

  it('fase 2 del mismo paso ya procesado: se consolida con el registro previo', async () => {
    const { casos, repositorio, eventos } = preparar();
    repositorio.pasoProcesadoConPlaca.mockResolvedValue(9);
    expect(await casos.completarOcr({ ingreso_id: 15, placa_reconocida: 'PBA1234' }))
      .toEqual({ message: 'Detección consolidada con el paso previo.', deduplicado: true, ingreso_id: 9 });
    expect(repositorio.eliminarPendiente).toHaveBeenCalledWith(15);
    expect(eventos.emitir).toHaveBeenCalledWith('deteccion:eliminada', { id: 15, consolidado_en: 9 });
  });

  it('fase 2 con permiso vigente y lectura confiable: autoriza, verifica el vehículo y avisa', async () => {
    const { casos, repositorio, avisos, compararVehiculo } = preparar({ permiso: PERMISO_VIGENTE, existente: fila({ estado_validacion: 'autorizado' }) });
    await casos.completarOcr({ ingreso_id: 15, placa_reconocida: 'pba1234', confianza_ocr: 0.95, lectura_valida: true, evidencia_lectura: { valido: true } });
    expect(repositorio.guardarVeredicto).toHaveBeenCalledWith(15, true, '{"valido":true}');
    expect(compararVehiculo).toHaveBeenCalledWith(PERMISO_VIGENTE, expect.objectContaining({ color: 'Blanco' }));
    expect(repositorio.guardarDecisionAutomatica).toHaveBeenCalledWith(15,
      { placa: 'PBA1234', confianza: 0.95, rutaPlaca: null, tipo: 'Automóvil' },
      expect.objectContaining({ permiso: PERMISO_VIGENTE, vigencia: 'vigente' }),
      expect.objectContaining({ estado: 'autorizado', regla: 'R5' }));
    expect(avisos.decision).toHaveBeenCalledWith(expect.objectContaining({ id: 15 }), expect.objectContaining({ estado: 'autorizado' }), PERMISO_VIGENTE);
  });

  it('fase 2 de salida: registra el egreso sin cruzarlo con listas de acceso', async () => {
    const { casos, repositorio, listas, avisos } = preparar({ existente: fila({ tipo_movimiento: 'salida' }) });
    const r = await casos.completarOcr({ ingreso_id: 15, placa_reconocida: 'PBA1234', confianza_ocr: 0.93 });
    expect(repositorio.guardarSalida).toHaveBeenCalledWith(15, expect.objectContaining({ placa: 'PBA1234', confianza: 0.93 }));
    expect(repositorio.guardarDecisionAutomatica).not.toHaveBeenCalled();
    expect(listas.alerta).not.toHaveBeenCalled();
    expect(listas.permiso).not.toHaveBeenCalled();
    expect(avisos.decision).not.toHaveBeenCalled();
    expect(r.message).toBe('Salida registrada.');
  });

  it('fase 2 con la placa en la lista negra: alerta (nunca se rebaja) y evento deteccion:alerta', async () => {
    const { casos, repositorio, eventos } = preparar({ alerta: { id: 5, placa: 'PBA1234' }, existente: fila({ estado_validacion: 'alerta' }) });
    await casos.completarOcr({ ingreso_id: 15, placa_reconocida: 'PBA1234', confianza_ocr: 0.2, lectura_valida: false });
    expect(repositorio.guardarDecisionAutomatica).toHaveBeenCalledWith(15, expect.anything(), expect.anything(),
      expect.objectContaining({ estado: 'alerta', regla: 'R1' }));
    expect(eventos.emitir).toHaveBeenCalledWith('deteccion:alerta', expect.objectContaining({ id: 15 }));
  });

  it('descarte: valores tolerantes del motor', async () => {
    const { casos, repositorio } = preparar();
    expect(await casos.descarte({ tracking_id: 'x', texto_candidato: 'A'.repeat(80) })).toEqual({ success: true });
    expect(repositorio.registrarDescarte).toHaveBeenCalledWith({
      trackingId: -1, motivo: 'falso_positivo_ocr', texto: 'A'.repeat(50), confianza: null, fuente: 'rtsp', camaraId: null,
    });
    // La URL de lectura del motor (con su token) nunca llega a la base
    await casos.descarte({ tracking_id: 3, fuente: 'rtsp://anpr:token-de-servicio@mediamtx:8554/cam_1' });
    expect(repositorio.registrarDescarte).toHaveBeenLastCalledWith(expect.objectContaining({ fuente: 'rtsp' }));
  });
});

describe('Detecciones · reevaluación tras el registro rápido', () => {
  it('el segundo OCR que llega después confirma la lectura: de por confirmar pasa a autorizado y se avisa', async () => {
    const { casos, repositorio, avisos } = preparar({
      permiso: PERMISO_VIGENTE, existente: fila({ estado_validacion: 'pendiente_revision', lectura_valida: false, confianza_ocr: 0.95 }),
    });
    const r = await casos.reevaluar({
      ingreso_id: 15, placa_reconocida: 'PBA-1234', confianza_ocr: 0.97, lectura_verificador: 'PBA-1234', lectura_valida: true, evidencia_lectura: { valido: true },
    });
    expect(r).toMatchObject({ reevaluado: true, cambio: true });
    expect(repositorio.guardarVeredicto).toHaveBeenCalledWith(15, true, '{"valido":true}');
    expect(repositorio.guardarDecisionAutomatica).toHaveBeenCalledWith(15, expect.objectContaining({ placa: 'PBA1234', rutaPlaca: null }),
      expect.anything(), expect.objectContaining({ estado: 'autorizado', regla: 'R5' }));
    expect(avisos.decision).toHaveBeenCalledTimes(1);
  });

  it('otra pista del mismo vehículo que leyó mejor corrige la placa y su foto', async () => {
    const { casos, repositorio } = preparar({ existente: fila({ estado_validacion: 'pendiente_revision', lectura_valida: false }) });
    await casos.reevaluar({ ingreso_id: 15, placa_reconocida: 'PFR-6147', confianza_ocr: 1, lectura_valida: true, ruta_imagen_placa: '/media/placa_846.jpg' });
    expect(repositorio.guardarDecisionAutomatica).toHaveBeenCalledWith(15,
      expect.objectContaining({ placa: 'PFR6147', rutaPlaca: '/media/placa_846.jpg' }), expect.anything(), expect.anything());
  });

  it('los atributos del vehículo que llegan después aplican el segundo factor: un vehículo distinto deja de estar autorizado', async () => {
    const { casos, repositorio, avisos, compararVehiculo } = preparar({
      permiso: PERMISO_VIGENTE, existente: fila({ estado_validacion: 'autorizado', lectura_valida: true, confianza_ocr: 0.95 }),
    });
    compararVehiculo.mockReturnValue({ resultado: 'no_coincide', detalle: 'color: observado rojo, registrado blanco' });
    await casos.reevaluar({ ingreso_id: 15, vehiculo: { tipo: 'auto', color: 'rojo' } });
    expect(repositorio.guardarVehiculo).toHaveBeenCalledWith(15, { tipo: 'auto', color: 'rojo' });
    expect(repositorio.guardarVeredicto).not.toHaveBeenCalled();   // sin veredicto nuevo se conserva el del registro
    expect(repositorio.guardarDecisionAutomatica).toHaveBeenCalledWith(15, expect.anything(), expect.anything(),
      expect.objectContaining({ estado: 'pendiente_revision', regla: 'R4' }));
    expect(avisos.decision).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ estado: 'pendiente_revision' }), PERMISO_VIGENTE);
  });

  it('sin cambio de estado no se repite el aviso; lo validado por el personal y las alertas se conservan', async () => {
    const igual = preparar({ permiso: PERMISO_VIGENTE, existente: fila({ estado_validacion: 'autorizado', lectura_valida: true, confianza_ocr: 0.95 }) });
    expect(await igual.casos.reevaluar({ ingreso_id: 15, vehiculo: { color: 'blanco' } })).toMatchObject({ reevaluado: true, cambio: false });
    expect(igual.avisos.decision).not.toHaveBeenCalled();

    const validado = preparar({ existente: fila({ estado_validacion: 'autorizado', validado_manualmente: true }) });
    expect(await validado.casos.reevaluar({ ingreso_id: 15, lectura_valida: false, vehiculo: { color: 'rojo' } })).toMatchObject({ reevaluado: false });
    expect(validado.repositorio.guardarVehiculo).toHaveBeenCalled();   // la evidencia del vehículo sí se guarda
    expect(validado.repositorio.guardarDecisionAutomatica).not.toHaveBeenCalled();

    const alerta = preparar({ existente: fila({ estado_validacion: 'alerta' }) });
    expect(await alerta.casos.reevaluar({ ingreso_id: 15, placa_reconocida: 'XYZ999', lectura_valida: true })).toMatchObject({ reevaluado: false });
    expect(alerta.repositorio.guardarDecisionAutomatica).not.toHaveBeenCalled();

    expect((await fallo(preparar().casos.reevaluar({ ingreso_id: 'x' }))).tipo).toBe('validacion');
  });

  it('si el segundo OCR lee otra placa, esa se cruza con las listas: en la lista de alertas, el paso pasa a alerta', async () => {
    const { casos, repositorio, avisos } = preparar({
      alerta: { id: 5, placa: 'PBA1284' }, existente: fila({ estado_validacion: 'no_reconocido', placa_reconocida: 'PBA1234' }),
    });
    await casos.reevaluar({ ingreso_id: 15, placa_reconocida: 'PBA1284', lectura_valida: false });
    expect(repositorio.guardarDecisionAutomatica).toHaveBeenCalledWith(15, expect.objectContaining({ placa: 'PBA1284' }), expect.anything(),
      expect.objectContaining({ estado: 'alerta', regla: 'R1' }));
    expect(avisos.decision).toHaveBeenCalledTimes(1);
  });
});

describe('Detecciones · consultas del personal', () => {
  it('busca registros por texto y rechaza términos demasiado largos', async () => {
    const { casos, repositorio } = preparar();
    await casos.recientes('20', '  María Pérez  ');
    expect(repositorio.recientes).toHaveBeenCalledWith(20, 'María Pérez');
    expect((await fallo(casos.recientes(20, 'x'.repeat(101)))).tipo).toBe('validacion');
  });

  it('historial: filtros validados (400) y paginación ajustada', async () => {
    const { casos, repositorio } = preparar();
    expect((await fallo(casos.listar({ camara: 'abc' }))).tipo).toBe('validacion');
    expect((await fallo(casos.listar({ desde: '2026-02-30' }))).tipo).toBe('validacion');
    expect(repositorio.contar).not.toHaveBeenCalled();
    const r = await casos.listar({ placa: 'pba-12', estado: 'alerta,otro', tamano: '500', pagina: '2' });
    expect(repositorio.pagina).toHaveBeenCalledWith(expect.objectContaining({ placa: 'PBA12', estados: ['alerta'] }), 100, 100);
    expect(r).toMatchObject({ total: 1, pagina: 2, tamano: 100 });
  });

  it('situación de una placa: al menos 3 caracteres; un permiso fuera de su vigencia se informa como restringido', async () => {
    const corto = preparar();
    expect((await fallo(corto.casos.buscarPlaca('PB'))).message).toBe('Ingrese al menos 3 caracteres de la placa.');
    const { casos } = preparar({ permiso: { ...PERMISO_VIGENTE, fecha_vencimiento: '2026-01-31' } });
    expect(await casos.buscarPlaca('pba-1234')).toMatchObject({
      placa: 'PBA1234', estado: 'restringido', restriccion: 'vencida', motivo: 'El permiso está vencido',
    });
  });

  it('exportación: queda auditada y el archivo lleva la fecha', async () => {
    const { casos, auditoria } = preparar();
    const abrir = jest.fn();
    const trozos: string[] = [];
    const r = await casos.exportar({ estado: 'alerta' }, GUARDIA, { abrir, escribir: async t => { trozos.push(t); return true; } });
    expect(abrir).toHaveBeenCalledWith('ingresos_anpr_2026-10-05.csv');
    expect(r).toEqual({ registros: 1, completa: true });
    expect(trozos.join('')).toBe(csvDetecciones([fila() as unknown as FilaExportacion]));
    expect(auditoria.operacion).toHaveBeenCalledWith(GUARDIA, 'EXPORTACION', 'deteccion', null, '1 registros · {"estado":"alerta"}');
  });

  it('exportación: los lotes salen en orden y una descarga cancelada deja de leer y queda auditada', async () => {
    const { casos, repositorio, auditoria } = preparar();
    let leidos = 0;
    repositorio.exportarPorLotes.mockImplementation(async function* () {
      for (let i = 0; i < 5; i++) { leidos++; yield [fila()]; }
    });
    // El cliente se va al recibir el segundo lote (la cabecera es la primera escritura)
    let escrituras = 0;
    const r = await casos.exportar({}, GUARDIA, { abrir: jest.fn(), escribir: async () => ++escrituras < 3 });
    expect(r).toEqual({ registros: 1, completa: false });
    expect(leidos).toBe(2);
    expect(auditoria.operacion).toHaveBeenCalledWith(GUARDIA, 'EXPORTACION', 'deteccion', null, '1 registros (descarga cancelada) · {}');
  });

  it('exportación: si la base falla a mitad, el error sube para cortar la descarga y queda auditado', async () => {
    const { casos, repositorio, auditoria } = preparar();
    repositorio.exportarPorLotes.mockImplementation(async function* () { yield [fila()]; throw new Error('base caída'); });
    await expect(casos.exportar({}, GUARDIA, { abrir: jest.fn(), escribir: async () => true })).rejects.toThrow('base caída');
    expect(auditoria.operacion).toHaveBeenCalledTimes(1);
  });

  it('la fecha local no cambia con el formateador reutilizado', () => {
    for (const f of ['2026-01-05T17:03:09Z', '2026-12-31T23:59:59Z', '2026-07-01T04:59:59Z', '2026-10-05T00:00:00Z']) {
      expect(fechaHoraLocal(f)).toBe(new Date(f).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' }));
    }
  });

  it('PDF: por encima del tope pide acotar el período sin cargar las filas', async () => {
    const { casos, repositorio, pdfRegistros } = preparar();
    repositorio.contar.mockResolvedValue(MAX_REGISTROS_PDF + 1);
    await expect(casos.exportarPdf({}, GUARDIA)).rejects.toThrow('Acote el período o exporte a CSV');
    expect(repositorio.exportar).not.toHaveBeenCalled();
    expect(pdfRegistros).not.toHaveBeenCalled();
  });

  it('PDF de registros: fuerza visitas cerradas y exporta todos los filtros sin paginación', async () => {
    const { casos, repositorio, pdfRegistros, auditoria } = preparar();
    await casos.exportarPdf({ cerrados: 'no', completos: 'no', placa: 'PBA', pagina: 2, buscar: 'Rosa', desde: '2026-10-01', hasta: '2026-10-28' }, GUARDIA);
    expect(repositorio.exportar).toHaveBeenCalledWith(expect.objectContaining({ cerrados: true, completos: true, placa: 'PBA' }));
    // El encabezado del reporte lleva el período, la búsqueda y quién lo elabora
    expect(pdfRegistros).toHaveBeenCalledWith([fila()], {
      generado: AHORA, zona: 'America/Guayaquil', desde: new Date('2026-10-01T00:00:00Z'), hasta: new Date('2026-10-28T00:00:00Z'),
      buscar: 'Rosa', elaboradoPor: 'Guardia',
    });
    expect(auditoria.operacion).toHaveBeenCalledWith(GUARDIA, 'EXPORTACION', 'deteccion', null, expect.stringContaining('PDF · 1 registros con salida'));
  });

  it('PDF del listado: incluye fichas incompletas y salidas, sin imponer filtros ni paginación', async () => {
    const { casos, repositorio, pdfHistorial, auditoria } = preparar();
    const filas = [fila({ placa_reconocida: null, estado_procesamiento: 'pendiente_ocr' }),
      fila({ id: 16, tipo_movimiento: 'salida', estado_validacion: 'salida_registrada', fecha_hora_salida: null })];
    repositorio.exportar.mockResolvedValue(filas);
    const r = await casos.exportarHistorialPdf({ pagina: 7, tamano: 1, unir_salidas: 'si', orden: 'reciente' }, GUARDIA);
    const f = repositorio.exportar.mock.calls[0][0];
    expect(f).toMatchObject({ unirSalidas: true, orden: 'reciente', placa: null, estados: [], desde: null, hasta: null });
    expect(f.completos).toBeUndefined(); expect(f.cerrados).toBeUndefined(); expect(f.movimiento).toBeUndefined();
    expect(f).not.toHaveProperty('pagina'); expect(f).not.toHaveProperty('tamano');
    expect(pdfHistorial).toHaveBeenCalledWith(filas, expect.objectContaining({ elaboradoPor: GUARDIA.nombre }));
    expect(r.nombre).toBe('historial_filtrado_2026-10-05.pdf');
    expect(auditoria.operacion).toHaveBeenCalledWith(GUARDIA, 'EXPORTACION', 'deteccion', null, expect.stringContaining('PDF historial · 2 registros'));
  });

  it('PDF y lista interpretan exactamente los mismos filtros combinados; la página no recorta el reporte', async () => {
    const { casos, repositorio, pdfHistorial } = preparar();
    const consulta = { placa: 'PBA-1234', exacta: 'si', persona: 'Ana Pérez', buscar: 'Kia', estado: 'no_reconocido,alerta', camara: '4',
      movimiento: 'salida', origen: 'manual', desde: '2026-10-01', hasta: '2026-10-04', unir_salidas: 'si', hora_desde: '07:00', hora_hasta: '19:00',
      orden: 'reciente', pagina: 9, tamano: 1 };
    await casos.listar(consulta);
    const filtrosLista = repositorio.pagina.mock.calls[0][0];
    await casos.exportarHistorialPdf(consulta, GUARDIA);
    expect(repositorio.exportar).toHaveBeenCalledWith(filtrosLista);
    expect(repositorio.contar).toHaveBeenLastCalledWith(filtrosLista);
    expect(pdfHistorial).toHaveBeenCalledWith([fila()], expect.objectContaining({ filtros: expect.arrayContaining([
      ['Placa exacta', 'PBA1234'], ['Persona o cédula', 'Ana Pérez'], ['Cámara', 'N.º 4'], ['Movimiento', 'Salida'],
      ['Origen', 'Registro manual'], ['Desde la hora', '07:00'], ['Hasta la hora', '19:00'],
    ]) }));
    expect(repositorio.pagina).toHaveBeenCalledTimes(1);
  });

  it('PDF del listado: el límite pide acotar o usar CSV y nunca exporta una parte silenciosa', async () => {
    const { casos, repositorio, pdfHistorial } = preparar();
    repositorio.contar.mockResolvedValue(MAX_REGISTROS_PDF + 1);
    await expect(casos.exportarHistorialPdf({}, GUARDIA)).rejects.toThrow('descargue CSV para incluir toda la lista');
    expect(repositorio.exportar).not.toHaveBeenCalled(); expect(pdfHistorial).not.toHaveBeenCalled();
    repositorio.contar.mockResolvedValue(MAX_REGISTROS_PDF);
    repositorio.exportar.mockResolvedValue(Array.from({ length: MAX_REGISTROS_PDF + 1 }, (_, i) => fila({ id: i })));
    await expect(casos.exportarHistorialPdf({}, GUARDIA)).rejects.toThrow('descargue CSV para incluir toda la lista');
    expect(pdfHistorial).not.toHaveBeenCalled();
  });

  it('PDF del listado valida los filtros antes de leer registros', async () => {
    const { casos, repositorio } = preparar();
    await expect(casos.exportarHistorialPdf({ movimiento: 'invalido' }, GUARDIA)).rejects.toMatchObject({ tipo: 'validacion' });
    expect(repositorio.contar).not.toHaveBeenCalled(); expect(repositorio.exportar).not.toHaveBeenCalled();
  });

  it('CSV del historial: BOM, celdas entre comillas y fórmulas neutralizadas', () => {
    const csv = csvDetecciones([{ ...fila(), propietario: '=HYPERLINK("http://malicioso")', confianza_ocr: 0.953 } as unknown as FilaExportacion]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"\'=HYPERLINK(""http://malicioso"")"');
    expect(csv).toContain('"95.3"');
  });
});

describe('Detecciones · acciones del personal', () => {
  describe('registro manual de la salida, según Configuración', () => {
    it('desactivado: no se registra la salida de un ingreso y no cambia nada', async () => {
      const { casos, repositorio, auditoria } = preparar({ salidaManual: false });
      await expect(casos.registrarSalida(7, GUARDIA)).rejects.toMatchObject({ tipo: 'prohibido' });
      expect(repositorio.registrarSalida).not.toHaveBeenCalled();
      expect(auditoria.operacion).not.toHaveBeenCalled();
    });

    it('desactivado: tampoco por el registro manual con una cámara de salida', async () => {
      const { casos, repositorio } = preparar({ salidaManual: false });
      repositorio.direccionCamara.mockResolvedValue('salida');
      await expect(casos.registroManual({ placa: 'ZZA-1001', motivo: 'Cámara fuera de servicio', camara_id: 2 }, GUARDIA)).rejects.toMatchObject({ tipo: 'prohibido' });
      expect(repositorio.crearSalidaManual).not.toHaveBeenCalled();
    });

    it('desactivado: el ingreso manual sigue permitido', async () => {
      const { casos, repositorio } = preparar({ salidaManual: false, existente: fila() });
      repositorio.crearManual.mockResolvedValue(7);
      await casos.registroManual({ placa: 'ZZA-1001', motivo: 'Cámara fuera de servicio', persona_ingreso: 'Ana Pérez', motivo_ingreso: 'Visita', tipo_vehiculo: 'Automóvil', marca: 'Kia' }, GUARDIA);
      expect(repositorio.crearManual).toHaveBeenCalled();
    });
  });

  describe('salida automática por la cámara de salida', () => {
    const salida = (cambios: Fila = {}) => fila({ id: 40, tipo_movimiento: 'salida', lectura_valida: true, placa_reconocida: 'PBA1234', ...cambios });
    const lectura = { ingreso_id: 40, placa_reconocida: 'PBA-1234', confianza_ocr: 0.95, lectura_valida: true };

    it('la lectura confirmada cierra el ingreso de esa placa, lo audita a nombre del sistema y lo difunde', async () => {
      const { casos, repositorio, auditoria, eventos } = preparar({ existente: salida(), salidaAutomatica: true });
      repositorio.cerrarIngresoConSalida.mockResolvedValue(15);
      await casos.completarOcr(lectura);
      expect(repositorio.cerrarIngresoConSalida).toHaveBeenCalledWith(40, 'PBA1234', 60, false);
      expect(auditoria.operacion).toHaveBeenCalledWith(expect.objectContaining({ id: null }), 'SALIDA_AUTOMATICA', 'deteccion', 15, expect.stringContaining('PBA1234'));
      expect(eventos.emitir).toHaveBeenCalledWith('deteccion:actualizada', expect.anything());
    });

    it('desactivada: la salida queda como movimiento aparte y no cierra nada', async () => {
      const { casos, repositorio } = preparar({ existente: salida() });
      await casos.completarOcr(lectura);
      expect(repositorio.guardarSalida).toHaveBeenCalled();
      expect(repositorio.cerrarIngresoConSalida).not.toHaveBeenCalled();
    });

    it.each([['sin confirmar', false], ['sin veredicto', null]])('una lectura %s solo cierra un ingreso cuya lectura sí se confirmó', async (_caso, valida) => {
      const { casos, repositorio, auditoria } = preparar({ existente: salida({ lectura_valida: valida }), salidaAutomatica: true });
      repositorio.cerrarIngresoConSalida.mockResolvedValue(15);
      await casos.completarOcr({ ...lectura, lectura_valida: valida });
      expect(repositorio.cerrarIngresoConSalida).toHaveBeenCalledWith(40, 'PBA1234', 60, true);
      expect(auditoria.operacion).toHaveBeenCalledWith(expect.anything(), 'SALIDA_AUTOMATICA', 'deteccion', 15, expect.stringContaining('sin confirmar'));
    });

    it('un paso sin ingreso abierto de esa placa no audita ni difunde un cierre', async () => {
      const { casos, repositorio, auditoria } = preparar({ existente: salida(), salidaAutomatica: true });
      await casos.completarOcr(lectura);
      expect(repositorio.cerrarIngresoConSalida).toHaveBeenCalled();
      expect(auditoria.operacion).not.toHaveBeenCalledWith(expect.anything(), 'SALIDA_AUTOMATICA', expect.anything(), expect.anything(), expect.anything());
    });

    it('la confirmación tardía del segundo OCR cierra el ingreso', async () => {
      const { casos, repositorio } = preparar({ existente: salida({ lectura_valida: true }), salidaAutomatica: true });
      await casos.reevaluar({ ingreso_id: 40, lectura_valida: true, placa_reconocida: 'PBA1234' });
      expect(repositorio.cerrarIngresoConSalida).toHaveBeenCalledWith(40, 'PBA1234', 60, false);
    });

    it('si la lectura se corrige a otra placa, reabre el ingreso equivocado y cierra el correcto', async () => {
      const { casos, repositorio, auditoria } = preparar({ existente: salida({ placa_validada: 'PBB5678', validado_manualmente: true }), salidaAutomatica: true });
      repositorio.ingresoCerradoPor.mockResolvedValue({ id: 15, placa: 'PBA1234' });
      repositorio.cerrarIngresoConSalida.mockResolvedValue(16);
      await casos.validar(40, { placa_validada: 'PBB-5678' }, GUARDIA);
      expect(repositorio.reabrirIngreso).toHaveBeenCalledWith(15);
      expect(auditoria.operacion).toHaveBeenCalledWith(expect.objectContaining({ id: null }), 'SALIDA_AUTOMATICA_REVERTIDA', 'deteccion', 15, expect.any(String));
      expect(repositorio.cerrarIngresoConSalida).toHaveBeenCalledWith(40, 'PBB5678', 60, false);
    });

    it('la misma placa otra vez no reabre ni cierra de nuevo', async () => {
      const { casos, repositorio } = preparar({ existente: salida(), salidaAutomatica: true });
      repositorio.ingresoCerradoPor.mockResolvedValue({ id: 15, placa: 'PBA1234' });
      await casos.reevaluar({ ingreso_id: 40, lectura_valida: true, placa_reconocida: 'PBA1234' });
      expect(repositorio.reabrirIngreso).not.toHaveBeenCalled();
      expect(repositorio.cerrarIngresoConSalida).not.toHaveBeenCalled();
    });

    it('si el segundo OCR desmiente la lectura, reabre el ingreso aunque el parámetro ya esté desactivado', async () => {
      const { casos, repositorio } = preparar({ existente: salida({ lectura_valida: false }) });
      repositorio.ingresoCerradoPor.mockResolvedValue({ id: 15, placa: 'PBA1234', confirmado: false });
      await casos.reevaluar({ ingreso_id: 40, lectura_valida: false, placa_reconocida: 'PBA1234' });
      expect(repositorio.reabrirIngreso).toHaveBeenCalledWith(15);
      expect(repositorio.cerrarIngresoConSalida).not.toHaveBeenCalled();
    });

    it('si el segundo OCR desmiente la lectura pero el ingreso cerrado estaba confirmado, el cierre se mantiene', async () => {
      const { casos, repositorio } = preparar({ existente: salida({ lectura_valida: false }), salidaAutomatica: true });
      repositorio.ingresoCerradoPor.mockResolvedValue({ id: 15, placa: 'PBA1234', confirmado: true });
      await casos.reevaluar({ ingreso_id: 40, lectura_valida: false, placa_reconocida: 'PBA1234' });
      expect(repositorio.reabrirIngreso).not.toHaveBeenCalled();
      expect(repositorio.cerrarIngresoConSalida).not.toHaveBeenCalled();
    });

    it('eliminar la salida reabre el ingreso que cerró; eliminar un ingreso no toca nada', async () => {
      const conSalida = preparar({ existente: salida(), salidaAutomatica: true });
      conSalida.repositorio.ingresoCerradoPor.mockResolvedValue({ id: 15, placa: 'PBA1234' });
      await conSalida.casos.eliminar(40, 'Lectura de otro vehículo', ADMIN);
      expect(conSalida.repositorio.reabrirIngreso).toHaveBeenCalledWith(15);
      expect(conSalida.repositorio.eliminar).toHaveBeenCalledWith(40);
      const ingreso = preparar({ salidaAutomatica: true });
      await ingreso.casos.eliminar(15, 'Registro de prueba', ADMIN);
      expect(ingreso.repositorio.ingresoCerradoPor).not.toHaveBeenCalled();
    });

    it('la salida manual confirmada por el guardia también cierra el ingreso', async () => {
      const { casos, repositorio } = preparar({ existente: salida({ placa_validada: 'PBA1234', validado_manualmente: true, lectura_valida: null }), salidaAutomatica: true });
      repositorio.direccionCamara.mockResolvedValue('salida');
      repositorio.crearSalidaManual.mockResolvedValue(40);
      await casos.registroManual({ placa: 'PBA-1234', motivo: 'Cámara de salida sin lectura', camara_id: 2 }, GUARDIA);
      expect(repositorio.cerrarIngresoConSalida).toHaveBeenCalledWith(40, 'PBA1234', 60, false);
    });

    it('un fallo al cerrar no interrumpe el registro del paso', async () => {
      const { casos, repositorio } = preparar({ existente: salida(), salidaAutomatica: true });
      repositorio.cerrarIngresoConSalida.mockRejectedValue(new Error('base ocupada'));
      await expect(casos.completarOcr(lectura)).resolves.toMatchObject({ message: 'Salida registrada.' });
    });

    it('un ingreso nunca dispara el cierre', async () => {
      const { casos, repositorio } = preparar({ existente: fila({ lectura_valida: true }), salidaAutomatica: true });
      await casos.completarOcr({ ...lectura, ingreso_id: 15 });
      expect(repositorio.cerrarIngresoConSalida).not.toHaveBeenCalled();
    });
  });

  it('registra una sola hora de salida en el ingreso y la difunde', async () => {
    const { casos, repositorio, auditoria, eventos } = preparar({
      existente: fila({ tipo_movimiento: 'ingreso', placa_reconocida: 'PBA1234', persona_ingreso: 'Ana Torres', tipo_vehiculo: 'SUV', vehiculo_marca: 'Mazda', motivo_ingreso: 'Reunión' }),
    });
    const respuesta = await casos.registrarSalida(15, GUARDIA);
    expect(repositorio.registrarSalida).toHaveBeenCalledWith(15);
    expect(auditoria.operacion).toHaveBeenCalledWith(GUARDIA, 'REGISTRO_SALIDA', 'deteccion', 15, expect.stringContaining('PBA1234'));
    expect(eventos.emitir).toHaveBeenCalledWith('deteccion:actualizada', expect.objectContaining({ id: 15 }));
    expect(respuesta.message).toBe('Hora de salida registrada.');
  });

  it('rechaza registrar salida en movimientos de salida, ingresos cerrados o inexistentes', async () => {
    const salida = preparar({ existente: fila({ tipo_movimiento: 'salida' }) });
    expect((await fallo(salida.casos.registrarSalida(15, GUARDIA))).tipo).toBe('validacion');
    const cerrado = preparar({ existente: fila({ fecha_hora_salida: AHORA }) });
    expect((await fallo(cerrado.casos.registrarSalida(15, GUARDIA))).tipo).toBe('validacion');
    const inexistente = preparar({ existente: null });
    expect((await fallo(inexistente.casos.registrarSalida(15, GUARDIA))).tipo).toBe('no_encontrado');
  });
  it.each(['persona_ingreso', 'tipo_vehiculo', 'vehiculo_marca', 'motivo_ingreso', 'fecha_hora_ingreso'])('bloquea la salida si falta %s, sin escribir ni auditar una salida', async campo => {
    const completa = fila({ tipo_movimiento: 'ingreso', placa_reconocida: 'PBA1234', persona_ingreso: 'Ana Torres', tipo_vehiculo: 'SUV', vehiculo_marca: 'Mazda', motivo_ingreso: 'Reunión' });
    const { casos, repositorio, auditoria } = preparar({ existente: { ...completa, [campo]: null } });
    const error = await fallo(casos.registrarSalida(15, GUARDIA));
    expect(error.tipo).toBe('validacion');
    expect(error.message).toContain('Complete los datos');
    expect(repositorio.registrarSalida).not.toHaveBeenCalled();
    expect(auditoria.operacion).not.toHaveBeenCalled();
  });
  it('acepta los datos conocidos de la lista blanca, sin exigir modelo ni color opcionales', async () => {
    const { casos, repositorio } = preparar({ existente: fila({ propietario: 'Ana Torres', autorizado_tipo: 'SUV', autorizado_marca: 'Mazda', motivo_ingreso: 'Reunión' }) });
    await casos.registrarSalida(15, GUARDIA);
    expect(repositorio.registrarSalida).toHaveBeenCalledWith(15);
  });

  it('corrige una salida sin consultar listas ni exigir datos de autorización', async () => {
    const { casos, repositorio, listas } = preparar({ existente: fila({ tipo_movimiento: 'salida' }) });
    const r = await casos.validar(15, { placa_validada: 'PBA1234' }, GUARDIA);
    expect(repositorio.validarSalida).toHaveBeenCalledWith(15, { placa: 'PBA1234', usuarioId: GUARDIA.id });
    expect(listas.alerta).not.toHaveBeenCalled();
    expect(listas.permiso).not.toHaveBeenCalled();
    expect(r.message).toBe('Lectura de salida corregida.');
  });

  it('registra una salida manual al seleccionar una cámara de egreso', async () => {
    const { casos, repositorio } = preparar();
    repositorio.direccionCamara.mockResolvedValue('salida');
    const r = await casos.registroManual({ placa: 'PBA1234', motivo: 'Cámara no registró el egreso', camara_id: 2 }, GUARDIA);
    expect(repositorio.crearSalidaManual).toHaveBeenCalledWith({ placa: 'PBA1234', camaraId: 2, usuarioId: GUARDIA.id });
    expect(repositorio.crearManual).not.toHaveBeenCalled();
    expect(r.message).toBe('Salida registrada manualmente.');
  });

  describe('autorizar con la ficha completa agrega la placa a la lista blanca', () => {
    const FICHA = { propietario: 'Ana Torres', cedula: '0912345678', placa: 'PBA1234', tipo_vehiculo: 'SUV', marca: 'Mazda', modelo: 'CX5', color: 'Gris' };
    const CUERPO = { placa_validada: 'PBA1234', persona_ingreso: 'Ana Torres', motivo_ingreso: 'Reunión', tipo_vehiculo: 'SUV', marca: 'Mazda', modelo: 'CX5', color: 'Gris', datos_permiso: FICHA };
    const conPadron = (opciones: Parameters<typeof preparar>[0] = {}, registrar = jest.fn().mockResolvedValue({ accion: 'creado' })) => {
      const p = preparar(opciones);
      const padron = { registrar };
      return { ...p, padron, casos: casosDetecciones({ ...p, padron } as DependenciasDetecciones) };
    };

    it('sin permiso ni alerta: crea el permiso y el paso queda autorizado con él', async () => {
      const { casos, padron, listas, auditoria } = conPadron();
      listas.permiso.mockResolvedValueOnce(null).mockResolvedValueOnce(PERMISO_VIGENTE);
      const r = await casos.validar(15, CUERPO, GUARDIA);
      expect(padron.registrar).toHaveBeenCalledWith(expect.objectContaining({ propietario: 'Ana Torres', placa: 'PBA1234' }), GUARDIA);
      expect(r).toMatchObject({ lista_blanca: 'creado', message: 'Autorización registrada; la placa se agregó en la lista blanca.' });
      expect(auditoria.operacion).toHaveBeenCalledWith(GUARDIA, 'VALIDACION', 'deteccion', 15, expect.stringContaining('Autorizado'));
      expect(auditoria.operacion).toHaveBeenCalledWith(GUARDIA, 'VALIDACION', 'deteccion', 15, expect.stringContaining('agregado en la lista blanca'));
    });

    it('nunca agrega una placa de la lista negra ni duplica un permiso existente', async () => {
      const alerta = conPadron({ alerta: { id: 9, placa: 'PBA1234', motivo: 'Robo', nivel_alerta: 'ALTA' } });
      await alerta.casos.validar(15, CUERPO, GUARDIA);
      expect(alerta.padron.registrar).not.toHaveBeenCalled();
      const existente = conPadron({ permiso: PERMISO_VIGENTE });
      expect(await existente.casos.validar(15, CUERPO, GUARDIA)).toMatchObject({ lista_blanca: null });
      expect(existente.padron.registrar).not.toHaveBeenCalled();
    });

    it('si el alta falla (p. ej. la cédula ya tiene otro permiso) la placa se confirma igual y se avisa', async () => {
      const { casos } = conPadron({}, jest.fn().mockRejectedValue(new Error('La cédula 0912345678 ya tiene un permiso activo en la lista blanca.')));
      const r = await casos.validar(15, CUERPO, GUARDIA);
      expect(r).toMatchObject({ lista_blanca: null, aviso: 'La placa se confirmó, pero no se agregó a la lista blanca: La cédula 0912345678 ya tiene un permiso activo en la lista blanca.' });
    });
  });

  it('validar: placa con formato ANT, excepción solo con accesos:excepcion y con motivo', async () => {
    const { casos, repositorio } = preparar();
    expect((await fallo(casos.validar(15, { placa_validada: 'PBA12' }, ADMIN))).tipo).toBe('validacion');
    expect((await fallo(casos.validar(15, { placa_validada: 'PBA1234', excepcion: true, observacion: 'Reunión urgente' }, GUARDIA))).tipo).toBe('prohibido');
    expect((await fallo(casos.validar(15, { placa_validada: 'PBA1234', excepcion: true }, ADMIN))).message).toBe('El campo «Motivo de la excepción» es obligatorio.');
    expect(repositorio.obtener).not.toHaveBeenCalled();
    expect((await fallo(preparar({ existente: null }).casos.validar(15, { placa_validada: 'PBA1234' }, GUARDIA))).tipo).toBe('no_encontrado');
  });

  it('validar: guarda la corrección, audita, resuelve las alarmas del paso y avisa si cambia a autorizado', async () => {
    const { casos, repositorio, auditoria, avisos } = preparar({ permiso: PERMISO_VIGENTE });
    const r = await casos.validar(15, { placa_validada: 'pba-1234', observacion: 'Placa sucia', ...VEHICULO_VALIDACION }, GUARDIA);
    expect(repositorio.guardarValidacion).toHaveBeenCalledWith(15, { placa: 'PBA1234', tipo: 'Automóvil', usuarioId: GUARDIA.id },
      expect.anything(), expect.objectContaining({ estado: 'autorizado' }));
    expect(auditoria.operacion).toHaveBeenCalledWith(GUARDIA, 'VALIDACION', 'deteccion', 15, expect.stringContaining('PBA1234 → PBA1234 (Autorizado) · Placa sucia'));
    expect(avisos.resolverPorDeteccion).toHaveBeenCalledWith(15);
    expect(avisos.decision).toHaveBeenCalled();
    expect(r.message).toBe('Autorización registrada.');
  });

  it('validar con excepción fuera de horario: autoriza y queda auditado como EXCEPCION_ACCESO', async () => {
    const { casos, auditoria, repositorio } = preparar({ permiso: { ...PERMISO_VIGENTE, fecha_vencimiento: '2026-01-31' } });
    await casos.validar(15, { placa_validada: 'PBA1234', excepcion: true, observacion: 'Reunión urgente', motivo_ingreso: 'Otro motivo anterior', ...VEHICULO_VALIDACION }, ADMIN);
    expect(repositorio.guardarDatosIngreso).toHaveBeenCalledWith(15, expect.objectContaining({ motivo: 'Reunión urgente' }));
    expect(auditoria.operacion).toHaveBeenCalledWith(ADMIN, 'EXCEPCION_ACCESO', 'deteccion', 15, expect.stringContaining('Reunión urgente'));
    const detalle = auditoria.operacion.mock.calls.find((c: unknown[]) => c[1] === 'EXCEPCION_ACCESO')![4];
    expect(detalle.split('Reunión urgente')).toHaveLength(2);
    expect(detalle).not.toContain('Otro motivo anterior');
  });

  it('registro manual: valida (placa ANT, motivo), cruza con las listas y no modifica la lista blanca', async () => {
    const { casos, repositorio, auditoria } = preparar();
    expect((await fallo(casos.registroManual({ placa: 'ABC12', motivo: 'Cámara caída' }, GUARDIA))).tipo).toBe('validacion');
    expect((await fallo(casos.registroManual({ placa: 'ABC1234', motivo: 'no' }, GUARDIA))).tipo).toBe('validacion');
    await casos.registroManual({ placa: 'ab-123c', motivo: 'Cámara fuera de servicio', tipo_vehiculo: 'Camioneta', marca: 'Toyota' }, GUARDIA);
    expect(repositorio.crearManual).toHaveBeenCalledWith({ placa: 'AB123C', camaraId: null, tipo: 'Camioneta', marca: 'Toyota', usuarioId: GUARDIA.id },
      expect.anything(), expect.objectContaining({ estado: 'no_reconocido' }));
    expect(auditoria.operacion).toHaveBeenCalledWith(GUARDIA, 'REGISTRO_MANUAL', 'deteccion', 30,
      'AB123C (No registrado) · Cámara fuera de servicio · tipo de vehículo: Camioneta · marca: Toyota');
  });

  it('registro manual con foto: guarda el cuadro elegido de los últimos 30 s como evidencia del paso', async () => {
    const { casos, repositorio, auditoria, evidenciaManual } = preparar();
    await casos.registroManual({ placa: 'PBA1234', motivo: 'Pasó muy rápido', camara_id: 2, cuadro_t: 1792634400.5 }, GUARDIA);
    expect(evidenciaManual.guardar).toHaveBeenCalledWith(2, 1792634400.5);
    expect(repositorio.crearManual).toHaveBeenCalledWith(expect.objectContaining({ rutaImagen: '/media/manual_20261021_184000_500_2.jpg' }),
      expect.anything(), expect.anything());
    expect(auditoria.operacion).toHaveBeenCalledWith(GUARDIA, 'REGISTRO_MANUAL', 'deteccion', 30, expect.stringContaining('con foto de evidencia'));
  });

  it('registro manual con foto: sin cámara o con la foto vencida no se registra', async () => {
    const { casos, repositorio, evidenciaManual } = preparar();
    expect((await fallo(casos.registroManual({ placa: 'PBA1234', motivo: 'Pasó muy rápido', cuadro_t: 1792634400.5 }, GUARDIA))).tipo).toBe('validacion');
    expect((await fallo(casos.registroManual({ placa: 'PBA1234', motivo: 'Pasó muy rápido', camara_id: 2, cuadro_t: 'ayer' }, GUARDIA))).tipo).toBe('validacion');
    evidenciaManual.guardar.mockResolvedValueOnce(null);
    expect((await fallo(casos.registroManual({ placa: 'PBA1234', motivo: 'Pasó muy rápido', camara_id: 2, cuadro_t: 1792634400.5 }, GUARDIA))).tipo).toBe('validacion');
    expect(repositorio.crearManual).not.toHaveBeenCalled();
  });

  it('fotos del registro manual: exige la cámara y entrega las miniaturas de sus últimos 30 s', async () => {
    const { casos, evidenciaManual } = preparar();
    expect((await fallo(casos.cuadrosRegistroManual(undefined))).tipo).toBe('validacion');
    expect(await casos.cuadrosRegistroManual('2')).toEqual({ disponible: true, cuadros: [{ t: 1792634400.5, miniatura: 'AAAA' }] });
    expect(evidenciaManual.cuadros).toHaveBeenCalledWith(2);
  });

  it.each([ADMIN, GUARDIA])('eliminar con $rol: motivo obligatorio, evidencia y auditoría del actor', async actor => {
    const { casos, repositorio, evidencia, eventos, auditoria } = preparar();
    expect((await fallo(casos.eliminar(15, 'no', actor))).tipo).toBe('validacion');
    expect(repositorio.obtener).not.toHaveBeenCalled();
    expect(await casos.eliminar(15, 'Prueba de cámara', actor)).toEqual({ message: 'Detección eliminada.', id: 15 });
    expect(evidencia.eliminar).toHaveBeenCalledWith(['capturas/15.jpg', 'capturas/15_placa.jpg']);
    expect(eventos.emitir).toHaveBeenCalledWith('deteccion:eliminada', { id: 15 });
    expect(auditoria.operacion).toHaveBeenCalledWith(actor, 'DETECCION_ELIMINADA', 'deteccion', 15, expect.stringContaining('Prueba de cámara'));
  });

  it('eliminación masiva: exige ELIMINAR y motivo; sin filtros alcanza a todas', async () => {
    const { casos, repositorio, auditoria } = preparar();
    expect((await fallo(casos.eliminarMasivo({}, { motivo: 'Limpieza de pruebas' }, ADMIN))).message).toBe('Escriba ELIMINAR para confirmar.');
    expect((await fallo(casos.eliminarMasivo({}, { confirmacion: 'ELIMINAR', motivo: 'x' }, ADMIN))).tipo).toBe('validacion');
    expect(await casos.eliminarMasivo({}, { confirmacion: 'ELIMINAR', motivo: 'Limpieza de pruebas' }, ADMIN))
      .toEqual({ message: '1 registro eliminado.', total: 1 });
    expect(repositorio.eliminarFiltradas).toHaveBeenCalledWith(null);
    expect(auditoria.operacion).toHaveBeenCalledWith(ADMIN, 'DETECCIONES_ELIMINADAS', 'deteccion', null,
      '1 registros y 2 imágenes · todas las detecciones · Limpieza de pruebas');
    await casos.eliminarMasivo({ estado: 'alerta' }, { confirmacion: 'ELIMINAR', motivo: 'Limpieza de pruebas' }, ADMIN);
    expect(repositorio.eliminarFiltradas).toHaveBeenLastCalledWith(expect.objectContaining({ estados: ['alerta'] }));
  });
});

describe('Detecciones · quién ingresa y motivo de ingreso (reporte de control vehicular)', () => {
  it('validar y registrar a mano guardan los nombres y el motivo, y los anotan en la auditoría', async () => {
    const { casos, repositorio, auditoria } = preparar();
    await casos.validar(15, { placa_validada: 'PBA1234', persona_ingreso: '  Ana   Pérez ', motivo_ingreso: 'Reunión de coordinación', ...VEHICULO_VALIDACION }, GUARDIA);
    expect(repositorio.guardarDatosIngreso).toHaveBeenCalledWith(15, expect.objectContaining({ persona: 'Ana Pérez', motivo: 'Reunión de coordinación' }));
    expect(auditoria.operacion).toHaveBeenLastCalledWith(GUARDIA, 'VALIDACION', 'deteccion', 15,
      expect.stringContaining(' · ingresa: Ana Pérez · motivo de ingreso: Reunión de coordinación'));

    await casos.registroManual({ placa: 'PBA1234', motivo: 'Cámara fuera de servicio', motivo_ingreso: 'Entrega de botellones' }, GUARDIA);
    expect(repositorio.guardarDatosIngreso).toHaveBeenLastCalledWith(30, { motivo: 'Entrega de botellones' });
  });

  it('sin datos personales conserva lo guardado; un nombre con caracteres no permitidos se rechaza', async () => {
    const { casos, repositorio } = preparar();
    await casos.validar(15, { placa_validada: 'PBA1234', ...VEHICULO_VALIDACION }, GUARDIA);
    expect(repositorio.guardarDatosIngreso).toHaveBeenCalledWith(15, { tipo: 'Automóvil', marca: 'Toyota', modelo: 'Yaris', color: 'Blanco' });
    expect((await fallo(casos.validar(15, { placa_validada: 'PBA1234', persona_ingreso: 'Ana <b>' }, GUARDIA))).tipo).toBe('validacion');
    expect(repositorio.guardarValidacion).toHaveBeenCalledTimes(1);   // solo la primera validación: la rechazada no guarda nada
  });

  it.each(['tipo_vehiculo', 'marca', 'modelo', 'color'] as const)('exige %s antes de validar un ingreso, sin escribir cambios parciales', async campo => {
    const { casos, repositorio, auditoria, listas } = preparar();
    const entrada = { placa_validada: 'PBA1234', ...VEHICULO_VALIDACION, [campo]: '' };
    expect((await fallo(casos.validar(15, entrada, GUARDIA))).tipo).toBe('validacion');
    expect(repositorio.guardarValidacion).not.toHaveBeenCalled();
    expect(repositorio.guardarDatosIngreso).not.toHaveBeenCalled();
    expect(listas.permiso).not.toHaveBeenCalled();
    expect(auditoria.operacion).not.toHaveBeenCalled();
  });

  it('edita una cédula sin reemplazar los datos del permiso ni cruzar o modificar listas', async () => {
    const { casos, repositorio, listas, auditoria } = preparar({ existente: fila({ institucion_ingreso: 'ECU 911', cargo_ingreso: 'Analista' }) });
    await casos.editarIngreso(15, { cedula: '0123456789' }, GUARDIA);
    expect(repositorio.guardarDatosIngreso).toHaveBeenCalledWith(15, { cedula: '0123456789' });
    expect(listas.permiso).not.toHaveBeenCalled();
    expect(listas.alerta).not.toHaveBeenCalled();
    expect(auditoria.operacion).toHaveBeenCalledWith(GUARDIA, 'INGRESO_DATOS', 'deteccion', 15, expect.stringContaining('cédula: 0123456789'));
  });

  it('editar después: solo en ingresos, con algo que guardar; vacío borra el campo', async () => {
    const { casos, repositorio, eventos } = preparar();
    const r = await casos.editarIngreso(15, {
      persona_ingreso: '', motivo_ingreso: 'Recorrido de supervisión',
      tipo_vehiculo: 'Camioneta', marca: 'Toyota', modelo: 'Hilux', color: 'Blanco',
    }, GUARDIA);
    expect(repositorio.guardarDatosIngreso).toHaveBeenCalledWith(15, {
      persona: null, motivo: 'Recorrido de supervisión',
      tipo: 'Camioneta', marca: 'Toyota', modelo: 'Hilux', color: 'Blanco',
    });
    expect(eventos.emitir).toHaveBeenCalledWith('deteccion:actualizada', expect.objectContaining({ id: 15 }));
    expect(r.message).toBe('Datos del ingreso guardados.');

    expect((await fallo(casos.editarIngreso(15, {}, GUARDIA))).message).toBe('Indique el titular o algún dato del vehículo.');
    const salida = preparar({ existente: fila({ tipo_movimiento: 'salida' }) });
    expect((await fallo(salida.casos.editarIngreso(15, { motivo_ingreso: 'Visita' }, GUARDIA))).tipo).toBe('validacion');
    expect(salida.repositorio.guardarDatosIngreso).not.toHaveBeenCalled();
  });
});


describe('Detecciones · corrección administrativa del historial', () => {
  const motivo_correccion = 'Corrección de datos anotados en la garita';

  it.each(['ingreso', 'salida'])('edita la ficha de un %s sin autorizar ni cambiar las listas', async tipo_movimiento => {
    const { casos, repositorio, listas, auditoria, eventos } = preparar({ existente: fila({
      tipo_movimiento, persona_ingreso: 'Ana Torres', cedula_ingreso: '0123456789', estado_validacion: 'autorizado',
    }) });
    const r = await casos.editarRegistro(15, { persona_ingreso: 'Ana Pérez', cedula: '', marca: 'Mazda', motivo_correccion }, ADMIN);
    expect(repositorio.guardarEdicionRegistro).toHaveBeenCalledWith(15, {
      datos: { persona: 'Ana Pérez', cedula: null, marca: 'Mazda' }, usuarioId: ADMIN.id,
    });
    expect(repositorio.guardarValidacion).not.toHaveBeenCalled();
    expect(repositorio.guardarDatosIngreso).not.toHaveBeenCalled();
    expect(listas.alerta).not.toHaveBeenCalled();
    expect(listas.permiso).not.toHaveBeenCalled();
    expect(auditoria.operacion).toHaveBeenCalledWith(ADMIN, 'REGISTRO_CORREGIDO', 'deteccion', 15, motivo_correccion);
    expect(auditoria.operacion).toHaveBeenCalledWith(ADMIN, 'REGISTRO_CAMPO_CORREGIDO', 'deteccion', 15, 'persona: Ana Torres → Ana Pérez');
    expect(auditoria.operacion).toHaveBeenCalledWith(ADMIN, 'REGISTRO_CAMPO_CORREGIDO', 'deteccion', 15, 'cedula: 0123456789 → (vacío)');
    expect(eventos.emitir).toHaveBeenCalledWith('deteccion:actualizada', expect.objectContaining({ id: 15 }));
    expect(r.message).toBe('Registro corregido.');
  });

  it.each(['PBC5678', '', null])('corrige la placa a %p sin consultar permisos ni conceder accesos', async placa => {
    const { casos, repositorio, listas, auditoria } = preparar({ existente: fila({ estado_validacion: 'autorizado', vehiculo_autorizado_id: 77 }) });
    const r = await casos.editarRegistro(15, { placa, motivo_correccion }, ADMIN);
    expect(repositorio.guardarEdicionRegistro).toHaveBeenCalledWith(15, expect.objectContaining({
      placa: placa || null, placaAnterior: 'PBA1234', usuarioId: ADMIN.id,
    }));
    expect(listas.permiso).not.toHaveBeenCalled();
    expect(listas.alerta).not.toHaveBeenCalled();
    expect(repositorio.guardarValidacion).not.toHaveBeenCalled();
    expect(auditoria.operacion).toHaveBeenCalledWith(ADMIN, 'REGISTRO_CAMPO_CORREGIDO', 'deteccion', 15,
      expect.stringContaining('pendiente de revisión; asociaciones anteriores retiradas'));
    expect(r.message).toContain('pendiente de revisión');
  });

  it('una corrección de placa conserva en el paso la ficha que antes se mostraba desde el permiso', async () => {
    const { casos, repositorio } = preparar({ existente: fila({
      propietario: 'Ana Torres', autorizado_cedula: '0123456789', autorizado_marca: 'Toyota',
      autorizado_tipo: 'Automóvil', autorizado_modelo: 'Yaris', autorizado_motivo: 'Jornada laboral',
    }) });
    await casos.editarRegistro(15, { placa: 'PBC5678', color: 'Gris', motivo_correccion }, ADMIN);
    expect(repositorio.guardarEdicionRegistro).toHaveBeenCalledWith(15, {
      datos: { persona: 'Ana Torres', cedula: '0123456789', motivo: 'Jornada laboral', tipo: 'Automóvil', marca: 'Toyota', modelo: 'Yaris', color: 'Gris' },
      placa: 'PBC5678', placaAnterior: 'PBA1234', usuarioId: ADMIN.id,
    });
  });

  it('la misma placa se normaliza y permite corregir otros datos de un ingreso cerrado sin tocar el cierre', async () => {
    const { casos, repositorio } = preparar({ existente: fila({ salida_deteccion_id: 40, fecha_hora_salida: AHORA }) });
    await casos.editarRegistro(15, { placa: 'pba-1234', modelo: 'Yaris', motivo_correccion }, ADMIN);
    expect(repositorio.guardarEdicionRegistro).toHaveBeenCalledWith(15, { datos: { modelo: 'Yaris' }, usuarioId: ADMIN.id });
    expect(repositorio.reabrirIngreso).not.toHaveBeenCalled();
    expect(repositorio.cerrarIngresoConSalida).not.toHaveBeenCalled();
  });

  it('rechaza corregir una placa vinculada antes de cualquier escritura', async () => {
    const entrada = preparar({ existente: fila({ salida_deteccion_id: 40 }) });
    const salida = preparar({ existente: fila({ tipo_movimiento: 'salida' }) });
    salida.repositorio.ingresoCerradoPor.mockResolvedValue({ id: 12, placa: 'PBA1234' });
    for (const p of [entrada, salida]) {
      expect((await fallo(p.casos.editarRegistro(15, { placa: 'PBC5678', marca: 'Toyota', motivo_correccion }, ADMIN))).tipo).toBe('conflicto');
      expect(p.repositorio.guardarEdicionRegistro).not.toHaveBeenCalled();
      expect(p.repositorio.reabrirIngreso).not.toHaveBeenCalled();
      expect(p.auditoria.operacion).not.toHaveBeenCalled();
    }
  });

  it('la matrícula de una salida se corrige siempre por su validación, incluso si todavía no cerró un ingreso', async () => {
    const { casos, repositorio } = preparar({ existente: fila({ tipo_movimiento: 'salida' }) });
    expect((await fallo(casos.editarRegistro(15, { placa: 'PBC5678', motivo_correccion }, ADMIN))).tipo).toBe('conflicto');
    expect(repositorio.guardarEdicionRegistro).not.toHaveBeenCalled();
  });

  it.each([
    ['persona_ingreso', { propietario: 'Ana Torres' }], ['motivo_ingreso', { autorizado_motivo: 'Jornada laboral' }],
    ['tipo_vehiculo', { autorizado_tipo: 'Automóvil' }], ['marca', { autorizado_marca: 'Toyota' }], ['modelo', { autorizado_modelo: 'Yaris' }],
  ] as const)('no informa un vaciado exitoso si %s se repondría desde el permiso', async (campo, heredado) => {
    const { casos, repositorio } = preparar({ existente: fila({ vehiculo_autorizado_id: 77, ...heredado }) });
    const error = await fallo(casos.editarRegistro(15, { [campo]: '', motivo_correccion }, ADMIN));
    expect(error.tipo).toBe('validacion');
    expect(error.message).toContain('No se puede dejar vacío');
    expect(repositorio.guardarEdicionRegistro).not.toHaveBeenCalled();
  });

  it.each(['Guardia', 'GestorPermisos'])('%s no corrige el historial ni llamando al caso de uso', async rol => {
    const { casos, repositorio } = preparar();
    expect((await fallo(casos.editarRegistro(15, { marca: 'Toyota', motivo_correccion }, { ...GUARDIA, rol }))).tipo).toBe('prohibido');
    expect(repositorio.obtener).not.toHaveBeenCalled();
    expect(repositorio.guardarEdicionRegistro).not.toHaveBeenCalled();
  });

  it.each([
    { marca: 'Toyota', motivo_correccion: 'no' },
    { placa: 'texto', motivo_correccion },
    { cedula: '123', motivo_correccion },
    { fecha_hora_ingreso: AHORA, marca: 'Toyota', motivo_correccion },
    { datos_permiso: {}, marca: 'Toyota', motivo_correccion },
    { estado_validacion: 'autorizado', motivo_correccion },
    { motivo_correccion },
  ])('valida toda la corrección %j antes de guardar', async cuerpo => {
    const { casos, repositorio } = preparar();
    expect((await fallo(casos.editarRegistro(15, cuerpo, ADMIN))).tipo).toBe('validacion');
    expect(repositorio.guardarEdicionRegistro).not.toHaveBeenCalled();
  });

  it('un registro eliminado o modificado mientras se corrige devuelve conflicto sin auditar un cambio inexistente', async () => {
    const { casos, repositorio, auditoria } = preparar();
    repositorio.guardarEdicionRegistro.mockResolvedValue(false);
    expect((await fallo(casos.editarRegistro(15, { placa: 'PBC5678', motivo_correccion }, ADMIN))).tipo).toBe('conflicto');
    expect(auditoria.operacion).not.toHaveBeenCalled();
  });

  it('audita los dos valores completos de un motivo largo sin truncarlos a 500 caracteres', async () => {
    const antes = 'A'.repeat(300), despues = 'B'.repeat(300);
    const { casos, auditoria } = preparar({ existente: fila({ motivo_ingreso: antes }) });
    await casos.editarRegistro(15, { motivo_ingreso: despues, motivo_correccion }, ADMIN);
    expect(auditoria.operacion).toHaveBeenCalledWith(ADMIN, 'REGISTRO_CAMPO_ANTES', 'deteccion', 15, `motivo: ${antes}`);
    expect(auditoria.operacion).toHaveBeenCalledWith(ADMIN, 'REGISTRO_CAMPO_DESPUES', 'deteccion', 15, `motivo: ${despues}`);
    expect(auditoria.operacion.mock.calls.every(llamada => (llamada[4]?.length ?? 0) <= 500)).toBe(true);
  });

  it.each([
    { placa_reconocida: 'PBA1234', estado_procesamiento: 'procesado' },
    { placa_reconocida: null, estado_procesamiento: 'no_legible' },
  ])('la fase 2 tardía %j conserva la corrección manual pendiente de revisión', async lectura => {
    const { casos, repositorio, listas, avisos } = preparar({ existente: fila({
      placa_validada: 'PBC5678', validado_manualmente: true, estado_validacion: 'pendiente_revision',
    }) });
    const r = await casos.completarOcr({ ingreso_id: 15, confianza_ocr: 0.99, ...lectura });
    expect(r.message).toBe('Se conserva la corrección manual del registro.');
    expect(repositorio.guardarDecisionAutomatica).not.toHaveBeenCalled();
    expect(repositorio.guardarSalida).not.toHaveBeenCalled();
    expect(repositorio.marcarNoLegible).not.toHaveBeenCalled();
    expect(repositorio.eliminarPendiente).not.toHaveBeenCalled();
    expect(listas.permiso).not.toHaveBeenCalled();
    expect(avisos.decision).not.toHaveBeenCalled();
  });
});

describe('Detecciones · texto general sin matrícula', () => {
  const evidencia = { observacion_ocr: 'HAVAL / ambacar', confianza_texto_ocr: 0.996,
    motivo: 'texto_no_matricula', candidata_descartada: 'QIH-6060' };
  const entrada = { ingreso_id: 15, placa_reconocida: null, confianza_ocr: 0,
    estado_procesamiento: 'no_legible', lectura_valida: false, evidencia_lectura: evidencia };

  it.each(['procesado', 'no_legible'])('la abstención tardía elimina la candidata anterior en estado %s y conserva el recorte', async estado => {
    const actual = fila({ placa_reconocida: 'QIH6060', estado_procesamiento: estado, estado_validacion: 'autorizado',
      motivo_ingreso: 'Jornada laboral', latencia_ms: 250 });
    const { casos, repositorio, listas, avisos, eventos } = preparar({ existente: actual });
    repositorio.marcarNoLegible.mockImplementation(async () => {
      repositorio.obtener.mockResolvedValue({ ...actual, placa_reconocida: null, estado_procesamiento: 'no_legible', estado_validacion: 'pendiente_revision' });
    });
    const resultado = await casos.reevaluar(entrada);
    expect(resultado).toMatchObject({ reevaluado: true, cambio: true, deteccion: { placa: null, estado_validacion: 'pendiente_revision' } });
    expect(repositorio.marcarNoLegible).toHaveBeenCalledWith(15, 'capturas/15_placa.jpg');
    expect(repositorio.guardarVeredicto).toHaveBeenCalledWith(15, false, JSON.stringify(evidencia));
    expect(repositorio.registrarLecturaAutomatica).toHaveBeenCalledWith(15, {
      placaOriginal: '', confianza: 0, decision: 'pendiente_revision', lecturaVerificador: null, latenciaMs: 250,
    });
    expect(listas.alerta).not.toHaveBeenCalled();
    expect(listas.permiso).not.toHaveBeenCalled();
    expect(repositorio.guardarDecisionAutomatica).not.toHaveBeenCalled();
    expect(repositorio.guardarDatosIngreso).not.toHaveBeenCalled();
    expect(actual.motivo_ingreso).toBe('Jornada laboral');
    expect(avisos.decision).not.toHaveBeenCalled();
    expect(eventos.emitir).toHaveBeenCalledWith('deteccion:actualizada', expect.objectContaining({ placa: null }));
  });

  it('la fase 2 conserva observación y foto sin guardar el texto general como placa', async () => {
    const { casos, repositorio } = preparar({ existente: fila({ estado_procesamiento: 'pendiente_ocr' }) });
    await casos.completarOcr({ ...entrada, ruta_imagen_placa: '/media/rotulo.jpg' });
    expect(repositorio.marcarNoLegible).toHaveBeenCalledWith(15, '/media/rotulo.jpg');
    expect(repositorio.guardarVeredicto).toHaveBeenCalledWith(15, false, JSON.stringify(evidencia));
    expect(repositorio.registrarLecturaAutomatica).toHaveBeenCalledWith(15, expect.objectContaining({ placaOriginal: '', confianza: 0 }));
  });

  it.each([
    { validado_manualmente: true, estado_validacion: 'autorizado' },
    { validado_manualmente: false, estado_validacion: 'alerta' },
  ])('conserva decisiones protegidas tanto en fase 2 como en reevaluación (%j)', async protegida => {
    const { casos, repositorio, avisos } = preparar({ existente: fila(protegida) });
    expect(await casos.reevaluar(entrada)).toMatchObject({ reevaluado: false });
    expect(await casos.completarOcr(entrada)).toMatchObject({ reevaluado: false });
    expect(repositorio.marcarNoLegible).not.toHaveBeenCalled();
    expect(repositorio.guardarVeredicto).not.toHaveBeenCalled();
    expect(repositorio.guardarDecisionAutomatica).not.toHaveBeenCalled();
    expect(repositorio.registrarLecturaAutomatica).not.toHaveBeenCalled();
    expect(avisos.decision).not.toHaveBeenCalled();
  });

  it.each([
    { ...entrada, lectura_valida: true },
    { ...entrada, evidencia_lectura: { ...evidencia, observacion_ocr: ' ' } },
    { ...entrada, evidencia_lectura: { ...evidencia, observacion_ocr: 'a'.repeat(241) } },
    { ...entrada, evidencia_lectura: { ...evidencia, confianza_texto_ocr: 1.01 } },
    { ...entrada, evidencia_lectura: { ...evidencia, confianza_texto_ocr: '0.9' } },
  ])('rechaza abstenciones mal formadas antes de alterar la detección', async invalida => {
    const { casos, repositorio } = preparar();
    expect((await fallo(casos.reevaluar(invalida))).tipo).toBe('validacion');
    expect(repositorio.marcarNoLegible).not.toHaveBeenCalled();
    expect(repositorio.guardarVeredicto).not.toHaveBeenCalled();
  });

  it('una reevaluación normal de matrícula sigue cruzando la lectura recibida con las listas', async () => {
    const { casos, repositorio, listas } = preparar({ existente: fila({ placa_reconocida: 'QIH6060' }) });
    await casos.reevaluar({ ingreso_id: 15, placa_reconocida: 'PBA1234', confianza_ocr: 0.95, lectura_valida: true });
    expect(listas.alerta).toHaveBeenCalledWith('PBA1234');
    expect(repositorio.guardarDecisionAutomatica).toHaveBeenCalledWith(15, expect.objectContaining({ placa: 'PBA1234' }), expect.anything(), expect.anything());
    expect(repositorio.marcarNoLegible).not.toHaveBeenCalled();
  });
});


describe('Detecciones · salida de ingreso sin matrícula legible', () => {
  const sinPlaca = () => fila({ tipo_movimiento: 'ingreso', placa_reconocida: null, placa_validada: null,
    persona_ingreso: 'Ana Torres', tipo_vehiculo: 'SUV', vehiculo_marca: 'Mazda', motivo_ingreso: 'Jornada laboral',
    evidencia_lectura: JSON.stringify({ observacion_ocr: 'HAVAL / ambacar', motivo: 'texto_no_matricula' }) });

  it.each([true, false])('cierra el ingreso por ID con placa null y salidaManual=%s, preservando foto y observación', async salidaManual => {
    const actual = sinPlaca();
    const { casos, repositorio, auditoria, evidencia, listas } = preparar({ existente: actual, salidaManual, salidaAutomatica: true });
    const respuesta = await casos.registrarSalida(15, GUARDIA);
    expect(respuesta.deteccion).toMatchObject({ id: 15, placa: null });
    expect(repositorio.registrarSalida).toHaveBeenCalledWith(15);
    expect(repositorio.cerrarIngresoConSalida).not.toHaveBeenCalled();
    expect(listas.permiso).not.toHaveBeenCalled();
    expect(evidencia.eliminar).not.toHaveBeenCalled();
    expect(actual.ruta_imagen_ingreso).toBe('capturas/15.jpg');
    expect(JSON.parse(actual.evidencia_lectura).observacion_ocr).toBe('HAVAL / ambacar');
    expect(auditoria.operacion).toHaveBeenCalledWith(GUARDIA, 'REGISTRO_SALIDA', 'deteccion', 15,
      expect.stringContaining('sin placa legible · cierre del registro #15'));
  });

  it('aunque no tenga placa, mantiene obligatorios los demás datos y la fecha de ingreso', async () => {
    const { casos, repositorio } = preparar({ existente: { ...sinPlaca(), persona_ingreso: null }, salidaManual: false });
    await expect(casos.registrarSalida(15, GUARDIA)).rejects.toMatchObject({ tipo: 'validacion', message: expect.stringContaining('Nombre') });
    expect(repositorio.registrarSalida).not.toHaveBeenCalled();
  });

  it.each([null, '', '  '])('la validación con %j descarta la candidata automática y no consulta listas', async placa_validada => {
    const actual = fila({ placa_reconocida: 'QIH6060' });
    const { casos, repositorio, listas } = preparar({ existente: actual });
    repositorio.guardarValidacion.mockImplementation(async () => {
      repositorio.obtener.mockResolvedValue({ ...actual, placa_reconocida: null, placa_validada: null, placa_ocr_original: 'QIH6060', validado_manualmente: true });
    });
    const r = await casos.validar(15, { placa_validada, ...VEHICULO_VALIDACION, persona_ingreso: 'Ana Torres', motivo_ingreso: 'Jornada laboral' }, GUARDIA);
    expect(repositorio.guardarValidacion).toHaveBeenCalledWith(15, expect.objectContaining({ placa: null }), expect.anything(), expect.anything());
    expect(r.deteccion).toMatchObject({ placa: null });
    expect(listas.alerta).not.toHaveBeenCalled();
    expect(listas.permiso).not.toHaveBeenCalled();
  });

  it('un alta manual sin matrícula guarda null y su foto sin cruzar listas', async () => {
    const { casos, repositorio, listas } = preparar({ existente: sinPlaca() });
    await casos.registroManual({ placa: null, motivo: 'Placa ilegible', camara_id: 2, cuadro_t: 1792634400.5,
      persona_ingreso: 'Ana Torres', motivo_ingreso: 'Jornada laboral' }, GUARDIA);
    expect(repositorio.crearManual).toHaveBeenCalledWith(expect.objectContaining({ placa: null, rutaImagen: '/media/manual_20261021_184000_500_2.jpg' }),
      expect.anything(), expect.anything());
    expect(listas.alerta).not.toHaveBeenCalled(); expect(listas.permiso).not.toHaveBeenCalled();
  });

  it('una salida independiente sin matrícula no cierra otros ingresos por coincidencia de null', async () => {
    const { casos, repositorio } = preparar({ existente: fila({ tipo_movimiento: 'salida', placa_validada: null, placa_reconocida: null }), salidaAutomatica: true });
    repositorio.direccionCamara.mockResolvedValue('salida');
    await casos.registroManual({ placa: null, motivo: 'Placa ilegible', camara_id: 2 }, GUARDIA);
    expect(repositorio.crearSalidaManual).toHaveBeenCalledWith(expect.objectContaining({ placa: null }),);
    expect(repositorio.cerrarIngresoConSalida).not.toHaveBeenCalled();
  });

  it('el modo automático continúa bloqueando altas de salida independientes, también con placa null', async () => {
    const { casos, repositorio } = preparar({ salidaManual: false });
    repositorio.direccionCamara.mockResolvedValue('salida');
    await expect(casos.registroManual({ placa: null, motivo: 'Placa ilegible', camara_id: 2 }, GUARDIA)).rejects.toMatchObject({ tipo: 'prohibido' });
    expect(repositorio.crearSalidaManual).not.toHaveBeenCalled();
  });
});
