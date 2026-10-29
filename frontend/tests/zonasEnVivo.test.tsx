/**
 * Zonas sobre el video en vivo:
 *  - el monitoreo dibuja el área de detección y las exclusiones que el motor está aplicando (llegan
 *    en cada mensaje de /ws/pistas), en lugar de descartarlas;
 *  - la capa del editor cubre el cuadro completo para cualquier proporción del flujo y se recalcula
 *    cuando la cámara cambia de resolución después del primer cuadro.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

vi.mock('../src/infraestructura/api', () => ({
  default: {},
  mensajeError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('../src/infraestructura/webrtc', () => ({
  conectarWhep: vi.fn(async () => ({ pc: { addEventListener: () => undefined, connectionState: 'connected' }, cerrar: () => undefined })),
  crearMedidor: () => async () => null,
}));

import { proporcionReproductor, ReproductorWebRTC, zonasDelMotor } from '../src/interfaz/componentes/envivo';

class WebSocketFalso {
  static ultimo: WebSocketFalso | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() { WebSocketFalso.ultimo = this; }
  close() { /* sin red */ }
}

let cuadro: FrameRequestCallback | null = null;
let tamanoVideo = { ancho: 1920, alto: 1080 };
const trazos: [string, number, number][] = [];

beforeEach(() => {
  WebSocketFalso.ultimo = null;
  tamanoVideo = { ancho: 1920, alto: 1080 };
  trazos.length = 0;
  vi.stubGlobal('WebSocket', WebSocketFalso);
  vi.stubGlobal('ResizeObserver', class { observe() { /* jsdom */ } disconnect() { /* jsdom */ } });
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { cuadro = f; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => tamanoVideo.ancho });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => tamanoVideo.alto });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    { left: 0, top: 0, width: 1280, height: 720, x: 0, y: 0, right: 1280, bottom: 720, toJSON: () => ({}) } as DOMRect);
  const ctx = new Proxy({}, {
    get: (_t, k) => (typeof k === 'string' && ['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'globalAlpha', 'shadowColor', 'shadowBlur'].includes(k)
      ? undefined
      : (x: number, y: number) => { trazos.push([String(k), x, y]); return { width: 10 }; }),
    set: () => true,
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const obtener = async () => ({ whep: 'http://video/cam_1/whep', pistasWs: 'ws://motor/ws/pistas' });

describe('Zonas del motor en el monitoreo en vivo', () => {
  it('acepta solo polígonos válidos del mensaje del motor', () => {
    expect(zonasDelMotor({ roi: [[0.1, 0.2], [0.9, 0.2], [0.9, 0.8]], exclusiones: [[[0, 0], [0.1, 0], [0.1, 0.1]], [[0, 0], [1, 1]], 'x'] }))
      .toEqual({ roi: [[0.1, 0.2], [0.9, 0.2], [0.9, 0.8]], exclusiones: [[[0, 0], [0.1, 0], [0.1, 0.1]]] });
    expect(zonasDelMotor({ roi: null })).toEqual({ roi: null, exclusiones: [] });
    expect(zonasDelMotor({ roi: [[0, 0], [1, 'a'], [1, 1]] }).roi).toBeNull();
  });

  it('el HUD dibuja el área de detección que envía el motor sobre la imagen', async () => {
    render(<ReproductorWebRTC obtener={obtener} mostrarHud />);
    await waitFor(() => expect(WebSocketFalso.ultimo).not.toBeNull());
    act(() => {
      WebSocketFalso.ultimo!.onmessage!({ data: JSON.stringify({
        pistas: [], movimiento: null, aspecto: 1.7778,
        roi: [[0.1, 0.2], [0.9, 0.2], [0.9, 0.8]], exclusiones: [[[0.4, 0.4], [0.5, 0.4], [0.5, 0.5]]],
      }) });
    });
    trazos.length = 0;
    (cuadro as unknown as (t: number) => void)(0);
    const vertices = trazos.filter(t => t[0] === 'moveTo' || t[0] === 'lineTo').map(t => [t[1], t[2]]);
    // Video 16:9 en un reproductor 1280×720: (0.1, 0.2) → (128, 144); exclusión (0.4, 0.4) → (512, 288)
    expect(vertices).toContainEqual([128, 144]);
    expect(vertices).toContainEqual([1152, 576]);
    expect(vertices).toContainEqual([512, 288]);
  });
});

describe('Capa de dibujo del editor de zonas', () => {
  it('en el editor la capa ocupa todo el reproductor sin conservar medidas anteriores', async () => {
    const { container } = render(<ReproductorWebRTC obtener={obtener} adaptarProporcion capa={<div data-testid="capa-adaptada" />} />);
    const video = container.querySelector('video')!;
    await waitFor(() => expect(video.onloadeddata).toBeTruthy());
    act(() => { (video.onloadeddata as () => void)(); });
    const envoltura = screen.getByTestId('capa-adaptada').parentElement!;
    expect(envoltura.style.inset).toBe('0');
    expect(envoltura.style.width).toBe('');
    tamanoVideo = { ancho: 720, alto: 1280 };
    act(() => { video.dispatchEvent(new Event('resize')); });
    expect(envoltura.style.inset).toBe('0');
    expect(envoltura.style.height).toBe('');
  });
  it('la proporción del reproductor sigue al flujo en el editor y queda 16:9 en el monitoreo', () => {
    expect(proporcionReproductor(null, 9 / 16, true)).toBeCloseTo(0.5625);
    expect(proporcionReproductor(null, 4 / 3, true)).toBeCloseTo(4 / 3);
    expect(proporcionReproductor(null, 9 / 16, false)).toBeCloseTo(16 / 9);
    expect(proporcionReproductor(16 / 9, 4 / 3, true)).toBeCloseTo(16 / 9);
  });

  it('si la cámara cambia de proporción después del primer cuadro, la capa vuelve a cubrir toda la imagen', async () => {
    const { container } = render(<ReproductorWebRTC obtener={obtener} capa={<div data-testid="capa" />} />);
    const video = container.querySelector('video')!;
    await waitFor(() => expect(video.onloadeddata).toBeTruthy());
    act(() => { (video.onloadeddata as () => void)(); });
    const envoltura = () => screen.getByTestId('capa').parentElement!;
    expect(envoltura().style.left).toBe('0px');
    expect(envoltura().style.width).toBe('1280px');

    // Flujo vertical 720×1280 dentro del mismo reproductor: la imagen ocupa una franja central
    tamanoVideo = { ancho: 720, alto: 1280 };
    act(() => { video.dispatchEvent(new Event('resize')); });
    expect(envoltura().style.left).toBe('437.5px');
    expect(envoltura().style.width).toBe('405px');
    expect(envoltura().style.height).toBe('720px');
  });
});
