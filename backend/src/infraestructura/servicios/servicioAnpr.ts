/**
 * Comunicación con el microservicio ANPR (FastAPI). El navegador ya no llama a sus
 * endpoints de control: el backend lo hace con el token de servicio y entrega al cliente
 * solo un ticket de corta duración para abrir el WebSocket de video.
 *
 * Puede haber varios motores: ANPR_SERVICE_URL y ANPR_PUBLIC_URL admiten listas separadas por coma, en
 * el mismo orden. El reparto de las cámaras lo decide infraestructura/servicios/camaraMotor.ts.
 */
import type { EnlaceVideo } from '../../aplicacion/camaras';

const lista = (valor: string | undefined) => (valor || 'http://localhost:8000').split(',').map(u => u.trim().replace(/\/$/, '')).filter(Boolean);
const urlsInternas = () => lista(process.env.ANPR_SERVICE_URL);
const urlsPublicas = () => lista(process.env.ANPR_PUBLIC_URL);

const token = () => process.env.ANPR_SERVICE_TOKEN || '';

async function llamar(indice: number, ruta: string, init: RequestInit = {}, timeoutMs = 3000): Promise<any> {
  const r = await fetch(`${urlsInternas()[indice]}${ruta}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Servicio-Token': token(), ...(init.headers || {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const cuerpo: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(cuerpo?.error || cuerpo?.detail || `HTTP ${r.status}`);
  return cuerpo;
}

/** Percentiles de una latencia del motor (ms), sobre sus últimas mediciones */
export interface PercentilesLatencia { p50_ms: number; p95_ms: number; max_ms: number; muestras: number }

/** Latencia de tiempo real desde la captura de cada cuadro (motor ANPR) */
export interface LatenciaMotor {
  /** Captura → inicio del análisis */
  edad_cuadro: PercentilesLatencia | null;
  /** Captura del cuadro leído → lectura en el HUD */
  lectura_en_vivo: PercentilesLatencia | null;
  /** Captura del mejor cuadro → lectura confirmada por el backend */
  registro: PercentilesLatencia | null;
  /** Cuadros de la cámara descartados porque llegó uno más nuevo (%) */
  cuadros_descartados_pct: number | null;
}

/** Una cámara en análisis y el motor que la atiende. */
export interface CamaraEnAnalisis {
  id: number;
  /** Posición del motor en ANPR_SERVICE_URL */
  motor: number;
  conectada: boolean;
  fps_captura: number;
  fps_procesamiento: number;
  latencia: LatenciaMotor | null;
  enlace: EnlaceVideo | null;
}

/** Un motor: su capacidad y las cámaras que analiza ahora. */
export interface InstanciaMotor {
  indice: number;
  en_linea: boolean;
  max_camaras: number;
  camaras: number[];
  cpu_pct: number | null;
}

export interface EstadoAnpr {
  en_linea: boolean;
  /** Promedio de las cámaras que reciben video */
  fps_captura?: number;
  fps_procesamiento?: number;
  detector?: string | null;
  ocr?: string | null;
  verificador?: string | null;
  camaras?: CamaraEnAnalisis[];
  motores?: InstanciaMotor[];
  /** Cámaras que caben en total en los motores en línea */
  capacidad?: number;
  error?: string;
}

/** Motor que atiende cada cámara según la última consulta (a qué motor conectar su video). */
const motorDeCamara = new Map<number, number>();

async function consultarMotores() {
  const respuestas = await Promise.allSettled(urlsInternas().map((_, i) => llamar(i, '/status', {}, 2500)));
  motorDeCamara.clear();
  for (const [indice, r] of respuestas.entries()) {
    if (r.status === 'fulfilled') for (const c of r.value.camaras ?? []) motorDeCamara.set(c.id, indice);
  }
  return respuestas;
}

export async function estadoServicioAnpr(): Promise<EstadoAnpr> {
  const respuestas = await consultarMotores();
  const motores: InstanciaMotor[] = respuestas.map((r, indice) => (r.status === 'fulfilled'
    ? {
      indice, en_linea: true, max_camaras: Number(r.value.max_camaras) || 0,
      camaras: (r.value.camaras ?? []).map((c: any) => c.id),
      cpu_pct: typeof r.value.cpu?.uso_pct === 'number' ? r.value.cpu.uso_pct : null,
    }
    : { indice, en_linea: false, max_camaras: 0, camaras: [], cpu_pct: null }));
  const enLinea = respuestas.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []));
  if (!enLinea.length) {
    const fallo = respuestas.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
    return { en_linea: false, error: fallo?.reason?.name === 'TimeoutError' ? 'Sin respuesta' : 'Servicio no disponible' };
  }
  const camaras: CamaraEnAnalisis[] = respuestas.flatMap((r, indice) => (r.status === 'fulfilled' ? (r.value.camaras ?? []) : []).map((c: any) => ({
    id: c.id, motor: indice, conectada: Boolean(c.conectada), fps_captura: c.capture_fps, fps_procesamiento: c.tracker_fps,
    latencia: c.latencia ?? null, enlace: c.enlace_video ?? null, captura: c.calidad_captura ?? null,
  })));
  const conVideo = camaras.filter(c => c.conectada);
  const promedio = (campo: 'fps_captura' | 'fps_procesamiento') => (conVideo.length
    ? Math.round(conVideo.reduce((suma, c) => suma + (c[campo] ?? 0), 0) / conVideo.length * 10) / 10 : 0);
  return {
    en_linea: true, fps_captura: promedio('fps_captura'), fps_procesamiento: promedio('fps_procesamiento'),
    detector: enLinea[0].detector, ocr: enLinea[0].ocr_engine, verificador: enLinea[0].ocr_verifier,
    camaras, motores, capacidad: motores.reduce((suma, m) => suma + m.max_camaras, 0),
  };
}

/** CPU del motor ANPR en % de la capacidad de su equipo, promedio de los motores en línea (null si ninguno responde). */
export async function cpuMotorAnpr(): Promise<number | null> {
  const estado = await estadoServicioAnpr();
  const valores = (estado.motores ?? []).flatMap(m => (m.cpu_pct !== null && Number.isFinite(m.cpu_pct) ? [m.cpu_pct] : []));
  return valores.length ? valores.reduce((suma, v) => suma + v, 0) / valores.length : null;
}

/** Motor de la cámara; si no se conoce, se pregunta a los motores (null si ninguno la analiza). */
async function indiceDeCamara(camaraId: number): Promise<number | null> {
  if (!motorDeCamara.has(camaraId)) await consultarMotores();
  return motorDeCamara.get(camaraId) ?? null;
}

/** Miniaturas de los últimos 30 s de una cámara (foto del registro manual); null si ningún motor la analiza. */
export async function historialAnpr(camaraId: number): Promise<{ camara_id: number; cuadros: { t: number; miniatura: string }[] } | null> {
  const indice = await indiceDeCamara(camaraId);
  return indice === null ? null : llamar(indice, `/api/historial?camara_id=${camaraId}`, {}, 5000);
}

/** Guarda como foto de evidencia el cuadro del historial de una cámara a la hora `t`: su ruta /media/…, o null. */
export async function guardarCuadroAnpr(camaraId: number, t: number): Promise<string | null> {
  try {
    const indice = await indiceDeCamara(camaraId);
    if (indice === null) return null;
    return (await llamar(indice, '/api/historial/guardar', { method: 'POST', body: JSON.stringify({ camara_id: camaraId, t }) }, 5000)).ruta ?? null;
  } catch {
    return null;
  }
}

/** URL vista desde el navegador del motor que atiende la cámara (para sus WebSocket de video y pistas). */
export function urlPublicaAnpr(camaraId?: number): string {
  const urls = urlsPublicas();
  const indice = camaraId === undefined ? 0 : motorDeCamara.get(camaraId) ?? 0;
  return urls[indice] ?? urls[0];
}

export type Punto = [number, number];

export interface CamaraParaMotor {
  id: number;
  nombre: string;
  rtsp_url: string;
  roi: Punto[] | null;
  exclusiones: Punto[][];
}

/** Lista completa de cámaras de un motor: arranca las nuevas, detiene las retiradas y corrige lo que cambió. */
export function enviarCamarasAnpr(indice: number, camaras: CamaraParaMotor[]) {
  for (const c of camaras) motorDeCamara.set(c.id, indice);
  return llamar(indice, '/api/camaras', { method: 'PUT', body: JSON.stringify({ camaras }) }, 8000);
}
