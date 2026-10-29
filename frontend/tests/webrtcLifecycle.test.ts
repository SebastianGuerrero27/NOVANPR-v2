import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conectarWhep, ErrorWhep } from '../src/infraestructura/webrtc';

class Conexion extends EventTarget {
  static todas: Conexion[] = [];
  connectionState: RTCPeerConnectionState = 'connected';
  iceGatheringState = 'complete';
  localDescription: RTCSessionDescriptionInit | null = null;
  ontrack: ((e: RTCTrackEvent) => void) | null = null;
  addTransceiver = vi.fn();
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'oferta' }));
  setLocalDescription = vi.fn(async (d: RTCSessionDescriptionInit) => { this.localDescription = d; });
  setRemoteDescription = vi.fn(async () => undefined);
  close = vi.fn(() => { this.connectionState = 'closed'; });
  constructor() { super(); Conexion.todas.push(this); }
}

const respuesta = () => new Response('respuesta', { status: 201, headers: { Location: '/cam_2/whep/sesion' } });
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const url = 'http://video/cam_2/whep?ticket=prueba';
let video: HTMLVideoElement;
const fetchVideo = vi.fn<typeof fetch>();

beforeEach(() => {
  Conexion.todas = [];
  video = document.createElement('video');
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.stubGlobal('RTCPeerConnection', Conexion);
  vi.stubGlobal('fetch', fetchVideo);
  fetchVideo.mockReset().mockImplementation(async (_url, opciones) => opciones?.method === 'POST'
    ? respuesta() : new Response(null, { status: 204 }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Ciclo de vida WHEP', () => {
  it('libera la sesión HTTP antes de cerrar WebRTC y cerrar dos veces solo hace un DELETE', async () => {
    let completar!: (r: Response) => void;
    fetchVideo.mockImplementation(async (_url, opciones) => {
      if (opciones?.method === 'POST') return respuesta();
      // MediaMTX ya no encuentra una sesión cuyo PeerConnection fue cerrado primero.
      expect(Conexion.todas[0].connectionState).toBe('connected');
      return new Promise(resolve => { completar = resolve; });
    });
    const sesion = await conectarWhep(video, url);
    sesion.cerrar();
    sesion.cerrar();
    expect(fetchVideo.mock.calls.filter(([, o]) => o?.method === 'DELETE')).toHaveLength(1);
    expect(Conexion.todas[0].close).not.toHaveBeenCalled();
    completar(new Response(null, { status: 204 }));
    await tick();
    expect(Conexion.todas[0].close).toHaveBeenCalledTimes(1);
  });

  it.each(['failed', 'disconnected', 'closed'] as const)('no solicita borrar una sesión que WebRTC ya perdió (%s)', async estado => {
    const sesion = await conectarWhep(video, url);
    Conexion.todas[0].connectionState = estado;
    sesion.cerrar();
    expect(fetchVideo).toHaveBeenCalledTimes(1);
    expect(Conexion.todas[0].close).toHaveBeenCalledTimes(1);
  });

  it('la sesión antigua no borra el flujo nuevo y sus eventos tardíos no lo reemplazan', async () => {
    const sesion = await conectarWhep(video, url);
    const alRecibir = Conexion.todas[0].ontrack!;
    const anterior = {} as MediaStream, actual = {} as MediaStream;
    alRecibir({ receiver: {}, streams: [anterior] } as unknown as RTCTrackEvent);
    video.srcObject = actual;
    sesion.cerrar();
    alRecibir({ receiver: {}, streams: [anterior] } as unknown as RTCTrackEvent);
    await tick();
    expect(video.srcObject).toBe(actual);
  });

  it('cancelar una negociación aborta el POST y cierra la conexión sin promesa sin manejar', async () => {
    fetchVideo.mockImplementation((_url, opciones) => new Promise((_resolve, reject) => {
      opciones?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')));
    }));
    const cancelar = new AbortController();
    const pendiente = conectarWhep(video, url, cancelar.signal);
    await tick();
    expect(fetchVideo).toHaveBeenCalledTimes(1);
    cancelar.abort();
    await expect(pendiente).rejects.toBeInstanceOf(ErrorWhep);
    expect(Conexion.todas[0].close).toHaveBeenCalledTimes(1);
    expect(fetchVideo.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('un POST que no responde vence y permite que el reproductor reintente', async () => {
    vi.useFakeTimers();
    fetchVideo.mockImplementation((_url, opciones) => new Promise((_resolve, reject) => {
      opciones?.signal?.addEventListener('abort', () => reject(new DOMException('Agotado', 'AbortError')));
    }));
    const pendiente = conectarWhep(video, url);
    const comprobacion = expect(pendiente).rejects.toBeInstanceOf(ErrorWhep);
    await tick();
    await vi.advanceTimersByTimeAsync(10000);
    await comprobacion;
    expect(Conexion.todas[0].connectionState).toBe('closed');
  });

  it('conserva el diagnóstico de una cámara no disponible y cierra sin DELETE', async () => {
    fetchVideo.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(conectarWhep(video, url)).rejects.toMatchObject({ estado: 404 });
    expect(Conexion.todas[0].close).toHaveBeenCalledTimes(1);
    expect(fetchVideo).toHaveBeenCalledTimes(1);
  });
});
