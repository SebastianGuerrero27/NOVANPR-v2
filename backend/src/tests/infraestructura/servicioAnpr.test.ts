/**
 * Cliente de los motores ANPR: el estado que ve el monitoreo (incluida la latencia de cada cámara), el
 * motor que atiende cada cámara y el envío de sus cámaras.
 */
import {
  cpuMotorAnpr, enviarCamarasAnpr, estadoServicioAnpr, guardarCuadroAnpr, historialAnpr, urlPublicaAnpr,
} from '../../infraestructura/servicios/servicioAnpr';

const LATENCIA = {
  edad_cuadro: { p50_ms: 140, p95_ms: 320, max_ms: 410, muestras: 300 },
  lectura_en_vivo: { p50_ms: 780, p95_ms: 1350, max_ms: 1600, muestras: 42 },
  registro: { p50_ms: 1900, p95_ms: 2600, max_ms: 2700, muestras: 9 },
  cuadros_descartados_pct: 86.4,
};

const camara = (id: number, extra: object = {}) => ({
  id, conectada: true, capture_fps: 25, tracker_fps: 3.1, latencia: LATENCIA, enlace_video: { codec: 'h264' }, ...extra,
});

const MOTOR_A = 'http://motor-a:8000';
const MOTOR_B = 'http://motor-b:8000';

describe('Cliente de los motores ANPR', () => {
  const fetchOriginal = global.fetch;
  const entorno = { ...process.env };
  let llamadas: { url: string; init?: RequestInit }[];
  let estados: Record<string, object | null>;

  beforeEach(() => {
    process.env.ANPR_SERVICE_URL = `${MOTOR_A}, ${MOTOR_B}/`;
    process.env.ANPR_PUBLIC_URL = 'https://a.ecu911.local,https://b.ecu911.local';
    llamadas = [];
    estados = {
      [MOTOR_A]: { max_camaras: 4, detector: 'license_plate_detector.pt', ocr_engine: 'fastalpr', ocr_verifier: null, camaras: [camara(3)], cpu: { uso_pct: 20 } },
      [MOTOR_B]: { max_camaras: 2, detector: 'license_plate_detector.pt', ocr_engine: 'fastalpr', ocr_verifier: null, camaras: [camara(9, { conectada: false, capture_fps: 0 })], cpu: { uso_pct: 10 } },
    };
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const ruta = String(url);
      llamadas.push({ url: ruta, init });
      const motor = ruta.startsWith(MOTOR_A) ? MOTOR_A : MOTOR_B;
      if (ruta.endsWith('/status')) {
        const estado = estados[motor];
        if (!estado) throw new Error('fetch failed');
        return { ok: true, status: 200, json: async () => estado } as Response;
      }
      return { ok: true, status: 200, json: async () => (ruta.includes('/api/historial/guardar') ? { ruta: '/media/manual.jpg' } : { cuadros: [], success: true }) } as Response;
    }) as typeof fetch;
  });
  afterAll(() => { global.fetch = fetchOriginal; process.env = entorno; });

  it('reúne el estado de todos los motores: cada cámara con su motor y su latencia', async () => {
    const e = await estadoServicioAnpr();
    expect(e).toMatchObject({ en_linea: true, detector: 'license_plate_detector.pt', ocr: 'fastalpr', capacidad: 6 });
    expect(e.camaras).toEqual([
      { id: 3, motor: 0, conectada: true, fps_captura: 25, fps_procesamiento: 3.1, latencia: LATENCIA, enlace: { codec: 'h264' } },
      { id: 9, motor: 1, conectada: false, fps_captura: 0, fps_procesamiento: 3.1, latencia: LATENCIA, enlace: { codec: 'h264' } },
    ]);
    expect(e.motores).toEqual([
      { indice: 0, en_linea: true, max_camaras: 4, camaras: [3], cpu_pct: 20 },
      { indice: 1, en_linea: true, max_camaras: 2, camaras: [9], cpu_pct: 10 },
    ]);
  });

  it('el promedio de cuadros por segundo solo cuenta las cámaras con señal', async () => {
    expect((await estadoServicioAnpr()).fps_captura).toBe(25);
  });

  it('un motor caído no tumba el estado; sin ninguno, fuera de línea', async () => {
    estados[MOTOR_B] = null;
    const e = await estadoServicioAnpr();
    expect(e.en_linea).toBe(true);
    expect(e.motores?.[1]).toEqual({ indice: 1, en_linea: false, max_camaras: 0, camaras: [], cpu_pct: null });
    expect(e.camaras?.map(c => c.id)).toEqual([3]);
    estados[MOTOR_A] = null;
    expect(await estadoServicioAnpr()).toEqual({ en_linea: false, error: 'Servicio no disponible' });
  });

  it('la CPU es el promedio de los motores en línea', async () => {
    expect(await cpuMotorAnpr()).toBe(15);
    estados[MOTOR_B] = null;
    expect(await cpuMotorAnpr()).toBe(20);
    estados[MOTOR_A] = null;
    expect(await cpuMotorAnpr()).toBeNull();
  });

  it('el navegador recibe la URL del motor que atiende la cámara', async () => {
    await estadoServicioAnpr();
    expect(urlPublicaAnpr(9)).toBe('https://b.ecu911.local');
    expect(urlPublicaAnpr(3)).toBe('https://a.ecu911.local');
    expect(urlPublicaAnpr(77)).toBe('https://a.ecu911.local');
    expect(urlPublicaAnpr()).toBe('https://a.ecu911.local');
  });

  it('el historial se pide al motor de la cámara; sin motor que la analice, null', async () => {
    await estadoServicioAnpr();
    await historialAnpr(9);
    expect(llamadas.at(-1)?.url).toBe(`${MOTOR_B}/api/historial?camara_id=9`);
    expect(await historialAnpr(77)).toBeNull();
    expect(await guardarCuadroAnpr(77, 1)).toBeNull();
    expect(await guardarCuadroAnpr(3, 12.5)).toBe('/media/manual.jpg');
    const envio = llamadas.find(l => l.url === `${MOTOR_A}/api/historial/guardar`);
    expect(JSON.parse(String(envio?.init?.body))).toEqual({ camara_id: 3, t: 12.5 });
  });

  it('envía al motor su lista completa de cámaras con sus zonas', async () => {
    const camaras = [{ id: 5, nombre: 'Salida', rtsp_url: 'rtsp://anpr:x@mediamtx:8554/cam_5', roi: null, exclusiones: [[[0.7, 0], [1, 0], [1, 0.2]]] as [number, number][][] }];
    await enviarCamarasAnpr(1, camaras as never);
    const envio = llamadas.at(-1);
    expect(envio?.url).toBe(`${MOTOR_B}/api/camaras`);
    expect(envio?.init?.method).toBe('PUT');
    expect(JSON.parse(String(envio?.init?.body))).toEqual({ camaras });
    // Ya se sabe a qué motor conectar su video, sin esperar a la próxima consulta
    expect(urlPublicaAnpr(5)).toBe('https://b.ecu911.local');
  });
});
