import { esSinPlaca, evidenciaDe, leerFiltros, leerHoraDelDia, MAX_EVIDENCIA, motivoRevision, normalizarFuente, origenDe, serializarEvidencia } from '../../dominio/detecciones';

describe('Detecciones · fuente de la detección', () => {
  it('una URL RTSP (con o sin credenciales) se guarda como «rtsp»: nunca la URL', () => {
    expect(normalizarFuente('rtsp://anpr:token-de-servicio@mediamtx:8554/cam_1')).toBe('rtsp');
    expect(normalizarFuente('RTSPS://u:p@camara:322/ruta')).toBe('rtsp');
    expect(normalizarFuente('http://x/y')).toBe('rtsp');
  });

  it('identificadores cortos se conservan; ausente o inválido → «rtsp»', () => {
    expect(normalizarFuente('rtsp')).toBe('rtsp');
    expect(normalizarFuente('manual')).toBe('manual');
    for (const malo of [undefined, null, '', '   ', 5, {}, 'con espacios', 'x'.repeat(21), '<script>']) {
      expect(normalizarFuente(malo)).toBe('rtsp');
    }
  });
});

describe('Detecciones · evidencia de la lectura', () => {
  const base = { valido: false, formato: true, motivos: ['caracteres inferidos por el formato, sin lectura directa: 5 (posición 4)'],
    caracteres_inferidos: [[3, '5']], lectura_ocr_cruda: 'PSYS89', lectura_verificador_cruda: 'PSYS89' };

  it('se guarda tal cual cuando cabe en la columna', () => {
    expect(evidenciaDe({ evidencia_lectura: serializarEvidencia(base) })).toEqual(base);
  });

  it('si no cabe se omiten primero los tiempos por etapa: nunca queda un JSON cortado e ilegible', () => {
    const etapas_ms = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`etapa_${i}`, 1234.5]));
    const json = serializarEvidencia({ ...base, etapas_ms });
    expect(json!.length).toBeLessThanOrEqual(MAX_EVIDENCIA);
    expect(evidenciaDe({ evidencia_lectura: json })).toEqual(base);
  });

  it('una evidencia que no es un objeto o que ni recortada cabe no se guarda', () => {
    for (const mala of [null, 'texto', 5, [1, 2]]) expect(serializarEvidencia(mala)).toBeNull();
    expect(serializarEvidencia({ lectura_ocr: 'X'.repeat(MAX_EVIDENCIA) })).toBeNull();
  });
});

describe('Detecciones · vehículo sin placa visible', () => {
  const politica = { confianzaMinima: 0.9 } as never;
  const paso = (evidencia: object | null, extra: object = {}) => ({
    estado_validacion: 'pendiente_revision', estado_procesamiento: 'no_legible', validado_manualmente: false,
    evidencia_lectura: evidencia ? serializarEvidencia(evidencia) : null, ...extra,
  });

  it('el motivo dice que no tiene placa y pide verificar con la foto', () => {
    const p = paso({ motivo: 'vehiculo_sin_placa', tipo_vehiculo: 'motocicleta' });
    expect(esSinPlaca(p)).toBe(true);
    expect(motivoRevision(p, politica)).toMatch(/^Vehículo sin placa visible/);
  });

  it('una placa ilegible (con o sin evidencia) tiene su propio motivo; validado por el personal ya no', () => {
    expect(esSinPlaca(paso(null))).toBe(false);
    expect(motivoRevision(paso(null), politica)).toMatch(/^La placa no se pudo leer/);
    expect(motivoRevision(paso({ motivo: 'vehiculo_sin_placa' }, { validado_manualmente: true }), politica)).toBeNull();
  });
});

describe('Detecciones · filtros del historial completo', () => {
  it('franja horaria HH:MM en minutos; un formato o una hora inválidos se rechazan', () => {
    expect(leerHoraDelDia('08:30', 'Hora inicial')).toEqual({ ok: true, valor: 510 });
    expect(leerHoraDelDia('', 'Hora inicial')).toEqual({ ok: true, valor: null });
    expect(leerHoraDelDia('24:00', 'Hora inicial').ok).toBe(false);
    expect(leerHoraDelDia('8h30', 'Hora inicial').ok).toBe(false);
  });

  it('lee movimiento, origen, franja, placa aproximada y orden; rechaza valores fuera de las listas', () => {
    const f = leerFiltros({ placa: 'pba-12', aproximada: 'si', movimiento: 'salida', origen: 'manual', hora_desde: '22:00', hora_hasta: '06:00', orden: 'antiguo' });
    expect(f).toMatchObject({ ok: true, valor: { placa: 'PBA12', aproximada: true, movimiento: 'salida', origen: 'manual', horaDesde: 1320, horaHasta: 360, orden: 'antiguo' } });
    // Sin placa, "aproximada" no es un filtro
    expect(leerFiltros({ aproximada: 'si' })).toMatchObject({ ok: true, valor: { placa: null } });
    expect((leerFiltros({ aproximada: 'si' }) as { valor: object }).valor).not.toHaveProperty('aproximada');
    expect(leerFiltros({ movimiento: 'entrada' }).ok).toBe(false);
    expect(leerFiltros({ origen: 'webcam' }).ok).toBe(false);
    // El sistema solo procesa el flujo RTSP: ya no hay pasos de un video de prueba
    expect(leerFiltros({ origen: 'video' }).ok).toBe(false);
    expect(leerFiltros({ orden: 'placa' }).ok).toBe(false);
    expect(leerFiltros({ hora_hasta: '25:00' }).ok).toBe(false);
  });

  it('origen del paso según su fuente: cámara en vivo por omisión y registro manual', () => {
    expect(origenDe('rtsp')).toBe('camara');
    expect(origenDe(null)).toBe('camara');
    expect(origenDe('manual')).toBe('manual');
  });
});
