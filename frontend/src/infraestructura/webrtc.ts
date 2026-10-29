/**
 * Cliente WHEP (WebRTC-HTTP Egress Protocol) para reproducir rutas de MediaMTX.
 *
 * WebRTC entrega el H.264 de la cámara tal cual (sin transcodificar) sobre UDP/RTP y el
 * navegador lo decodifica por hardware: la latencia típica en red local es de 0,1–0,4 s,
 * frente a 2–6 s de HLS o al costo de re-comprimir cada cuadro en JPEG.
 */

export class ErrorWhep extends Error {
  constructor(message: string, public estado?: number) { super(message); }
}

export interface SesionWhep {
  pc: RTCPeerConnection;
  cerrar: () => void;
}

function esperarIce(pc: RTCPeerConnection, ms: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const t = window.setTimeout(listo, ms);
    function listo() { window.clearTimeout(t); pc.removeEventListener('icegatheringstatechange', cambio); resolve(); }
    function cambio() { if (pc.iceGatheringState === 'complete') listo(); }
    pc.addEventListener('icegatheringstatechange', cambio);
  });
}

/** Conecta un <video> a una URL WHEP. Rechaza si el servidor no acepta la sesión. */
export async function conectarWhep(video: HTMLVideoElement, url: string, signal?: AbortSignal): Promise<SesionWhep> {
  const pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
  const peticion = new AbortController();
  let ubicacion: string | null = null;
  let flujo: MediaStream | null = null;
  let cerrada = false;
  const cerrar = () => {
    if (cerrada) return;
    cerrada = true;
    signal?.removeEventListener('abort', cerrar);
    peticion.abort();
    pc.ontrack = null;
    // Una sesión antigua no debe borrar el video de la cámara que la reemplazó.
    if (flujo && video.srcObject === flujo) video.srcObject = null;
    const cerrarConexion = () => pc.close();
    if (ubicacion && !['closed', 'failed', 'disconnected'].includes(pc.connectionState)) {
      // MediaMTX elimina la sesión al cerrar WebRTC. Primero se libera por WHEP para
      // evitar pedir DELETE a una sesión que el servidor ya eliminó (404).
      void fetch(new URL(ubicacion, url).toString(), { method: 'DELETE', signal: AbortSignal.timeout(2000) })
        .catch(() => undefined).finally(cerrarConexion);
    } else cerrarConexion();
  };
  signal?.addEventListener('abort', cerrar, { once: true });
  if (signal?.aborted) {
    cerrar();
    throw new ErrorWhep('La conexión de video se canceló.');
  }
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.ontrack = e => {
    if (cerrada) return;
    // Búfer de reproducción mínimo: prioriza latencia sobre suavidad
    const receptor = e.receiver as RTCRtpReceiver & { jitterBufferTarget?: number; playoutDelayHint?: number };
    try { if ('jitterBufferTarget' in receptor) receptor.jitterBufferTarget = 0; } catch { /* no soportado */ }
    try { if ('playoutDelayHint' in receptor) receptor.playoutDelayHint = 0; } catch { /* no soportado */ }
    flujo = e.streams[0] ?? new MediaStream([e.track]);
    video.srcObject = flujo;
    video.play().catch(() => undefined);
  };

  let timeout: number | undefined;
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await esperarIce(pc, 1500);
    timeout = window.setTimeout(() => peticion.abort(), 10000);
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription!.sdp,
      signal: peticion.signal });
    if (r.status !== 201) {
      throw new ErrorWhep(
        r.status === 401 ? 'Acceso al video no autorizado (ticket vencido).'
          : r.status === 404 ? 'La cámara no está disponible en el servidor de video.'
            : r.status === 400 ? 'El servidor de video no pudo abrir el flujo (¿cámara sin señal o códec no compatible?).'
              : `El servidor de video respondió ${r.status}.`, r.status);
    }
    ubicacion = r.headers.get('Location');
    await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
  } catch (e) {
    cerrar();
    if (e instanceof ErrorWhep) throw e;
    throw new ErrorWhep('No se pudo contactar con el servidor de video.');
  } finally { window.clearTimeout(timeout); }

  return {
    pc,
    cerrar,
  };
}

export interface EstadisticasVideo {
  fps: number;
  kbps: number;
  ancho: number;
  alto: number;
  /** Retardo estimado de red + búfer del navegador (ms) */
  latencia_ms: number | null;
  perdidos: number;
  codec: string | null;
}

/** Campos de getStats() que se usan (subconjunto de inbound-rtp, candidate-pair y codec). */
interface Estadistica {
  type: string;
  id: string;
  timestamp: number;
  kind?: string;
  mimeType?: string;
  nominated?: boolean;
  state?: string;
  bytesReceived?: number;
  jitterBufferDelay?: number;
  jitterBufferEmittedCount?: number;
  framesPerSecond?: number;
  frameWidth?: number;
  frameHeight?: number;
  packetsLost?: number;
  codecId?: string;
  currentRoundTripTime?: number;
}

/** Estadísticas de la recepción de video, calculadas entre dos muestras de getStats(). */
export function crearMedidor(pc: RTCPeerConnection) {
  let anterior: { t: number; bytes: number; jbDelay: number; jbCount: number } | null = null;
  return async (): Promise<EstadisticasVideo | null> => {
    const informe = await pc.getStats();
    let entrada: Estadistica | undefined;
    let par: Estadistica | undefined;
    const codecs = new Map<string, string>();
    for (const s of informe.values() as IterableIterator<Estadistica>) {
      if (s.type === 'inbound-rtp' && s.kind === 'video') entrada = s;
      if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') par = s;
      if (s.type === 'codec') codecs.set(s.id, String(s.mimeType ?? '').replace('video/', ''));
    }
    if (!entrada) return null;
    const ahora = entrada.timestamp;
    let kbps = 0;
    let buffer: number | null = null;
    if (anterior) {
      const dt = (ahora - anterior.t) / 1000;
      kbps = dt > 0 ? Math.round((((entrada.bytesReceived ?? 0) - anterior.bytes) * 8) / dt / 1000) : 0;
      const dCount = (entrada.jitterBufferEmittedCount ?? 0) - anterior.jbCount;
      if (dCount > 0) buffer = (((entrada.jitterBufferDelay ?? 0) - anterior.jbDelay) / dCount) * 1000;
    }
    anterior = { t: ahora, bytes: entrada.bytesReceived ?? 0, jbDelay: entrada.jitterBufferDelay ?? 0, jbCount: entrada.jitterBufferEmittedCount ?? 0 };
    const rtt = par?.currentRoundTripTime;
    return {
      fps: Math.round(entrada.framesPerSecond ?? 0),
      kbps,
      ancho: entrada.frameWidth ?? 0,
      alto: entrada.frameHeight ?? 0,
      latencia_ms: buffer !== null ? Math.round(buffer + (typeof rtt === 'number' ? (rtt * 1000) / 2 : 0)) : null,
      perdidos: entrada.packetsLost ?? 0,
      codec: codecs.get(entrada.codecId ?? '') ?? null,
    };
  };
}
