import { asignarCamaras, cambiosCamara, leerCamara } from '../../dominio/camaras';

/** Reparto de las cámaras entre los motores ANPR: estable, sin pasar de la capacidad de cada uno. */

const motor = (indice: number, capacidad: number, camaras: number[] = []) => ({ indice, capacidad, camaras });
const reparto = (r: ReturnType<typeof asignarCamaras>) => Object.fromEntries(r.porMotor);

describe('asignarCamaras', () => {
  it('un solo motor con lugar: todas las cámaras a él', () => {
    const r = asignarCamaras([3, 1, 2], [motor(0, 4)]);
    expect(reparto(r)).toEqual({ 0: [1, 2, 3] });
    expect(r.sinCapacidad).toEqual([]);
  });

  it('las que no caben quedan sin capacidad, nunca se pasa del tope', () => {
    const r = asignarCamaras([1, 2, 3, 4, 5], [motor(0, 2), motor(1, 1)]);
    expect(r.porMotor.get(0)).toHaveLength(2);
    expect(r.porMotor.get(1)).toHaveLength(1);
    expect(r.sinCapacidad).toEqual([4, 5]);
  });

  it('una cámara se queda en su motor: cambiarla interrumpiría su seguimiento', () => {
    const r = asignarCamaras([1, 2, 3], [motor(0, 4, [2]), motor(1, 4, [1, 3])]);
    expect(reparto(r)).toEqual({ 0: [2], 1: [1, 3] });
  });

  it('una cámara nueva va al motor con más lugar libre', () => {
    const r = asignarCamaras([1, 2, 3], [motor(0, 4, [1, 2]), motor(1, 2)]);
    expect(reparto(r)).toEqual({ 0: [1, 2], 1: [3] });
    expect(reparto(asignarCamaras([1, 2, 3, 4], [motor(0, 4, [1, 2, 3]), motor(1, 2)]))).toEqual({ 0: [1, 2, 3], 1: [4] });
  });

  it('reparte parejo entre motores iguales', () => {
    const r = asignarCamaras([1, 2, 3, 4], [motor(0, 4), motor(1, 4)]);
    expect(r.porMotor.get(0)).toHaveLength(2);
    expect(r.porMotor.get(1)).toHaveLength(2);
  });

  it('las cámaras de un motor caído pasan a otro (el caído ya no está en la lista)', () => {
    const r = asignarCamaras([1, 2, 3], [motor(1, 4, [3])]);
    expect(reparto(r)).toEqual({ 1: [3, 1, 2] });
    expect(r.sinCapacidad).toEqual([]);
  });

  it('una cámara deshabilitada sale de la lista de su motor', () => {
    expect(reparto(asignarCamaras([2], [motor(0, 4, [1, 2])]))).toEqual({ 0: [2] });
  });

  it('si la capacidad baja, conserva las primeras y reasigna el resto', () => {
    const r = asignarCamaras([1, 2, 3], [motor(0, 2, [1, 2, 3]), motor(1, 2)]);
    expect(reparto(r)).toEqual({ 0: [1, 2], 1: [3] });
  });

  it('sin motores, ninguna cabe', () => {
    expect(asignarCamaras([1], []).sinCapacidad).toEqual([1]);
  });

  it('el mismo estado da siempre el mismo reparto', () => {
    const motores = [motor(0, 3, [1]), motor(1, 3, [2])];
    expect(reparto(asignarCamaras([4, 3, 2, 1], motores))).toEqual(reparto(asignarCamaras([1, 2, 3, 4], motores)));
  });
});

describe('leerCamara · análisis ANPR', () => {
  const entrada = { nombre: 'Garita norte', ubicacion: 'Acceso norte', rtsp_url: 'rtsp://10.0.0.5:554/101' };

  it('por omisión la cámara se analiza; se puede dejar solo para ver video', () => {
    expect(leerCamara(entrada)).toMatchObject({ ok: true, valor: { analisis: true } });
    expect(leerCamara({ ...entrada, analisis_anpr: false })).toMatchObject({ ok: true, valor: { analisis: false } });
  });

  it.each(['si', 1, null])('analisis_anpr %p no es válido', valor => {
    expect(leerCamara({ ...entrada, analisis_anpr: valor })).toEqual({ ok: false, error: 'El análisis ANPR de la cámara debe ser verdadero o falso.' });
  });

  it('el cambio queda en la auditoría', () => {
    const datos = { nombre: 'Garita norte', ubicacion: 'Acceso norte', rtsp: 'rtsp://a', rtspVista: null, ip: '10.0.0.5', direccion: 'ingreso' as const, analisis: false };
    const actual = { nombre: 'Garita norte', ubicacion: 'Acceso norte', rtsp_url: 'rtsp://a', rtsp_url_vista: null, ip: '10.0.0.5', direccion: 'ingreso' as const };
    expect(cambiosCamara({ ...actual, analisis_anpr: true }, datos)).toEqual(['análisis ANPR desactivado']);
    expect(cambiosCamara({ ...actual, analisis_anpr: false }, { ...datos, analisis: true })).toEqual(['análisis ANPR activado']);
    expect(cambiosCamara({ ...actual, analisis_anpr: false }, datos)).toEqual([]);
  });
});
