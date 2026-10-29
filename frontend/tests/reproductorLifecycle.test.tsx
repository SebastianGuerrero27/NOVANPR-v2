import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { conectar, medir } = vi.hoisted(() => ({ conectar: vi.fn(), medir: vi.fn(async () => null) }));
vi.mock('../src/infraestructura/api', () => ({ default: {}, mensajeError: (e: Error) => e.message }));
vi.mock('../src/infraestructura/webrtc', () => ({
  conectarWhep: conectar, crearMedidor: () => medir, ErrorWhep: class extends Error {},
}));
vi.mock('../src/interfaz/componentes/hud', () => ({
  areaVideo: () => ({ x: 0, y: 0, w: 640, h: 360 }),
  crearHud: () => ({ fijarRetardoVideo() {}, detener() {}, limpiar() {}, actualizar() {} }),
}));
import { ReproductorWebRTC } from '../src/interfaz/componentes/envivo';

class Peer extends EventTarget {
  connectionState = 'connected';
  cambiar(estado: string) { this.connectionState = estado; this.dispatchEvent(new Event('connectionstatechange')); }
}
const cargar = async () => ({ whep: 'http://video/cam_2/whep' });
const ciclos = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

beforeEach(() => {
  vi.useFakeTimers();
  conectar.mockReset();
  medir.mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(640);
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(360);
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(0);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Recuperación del reproductor', () => {
  it('muestra el primer cuadro aunque llegue antes de finalizar la negociación', async () => {
    conectar.mockImplementation(async (video: HTMLVideoElement) => {
      video.dispatchEvent(new Event('loadeddata'));
      return { pc: new Peer(), cerrar: vi.fn() };
    });
    render(<ReproductorWebRTC obtener={cargar} />);
    await ciclos();
    expect(screen.getByText('EN VIVO')).toBeInTheDocument();
    expect(screen.queryByText('Conectando con la cámara…')).not.toBeInTheDocument();
  });

  it('una pérdida disconnected+failed produce un solo reintento y no consume dos fallos', async () => {
    const sesiones: { pc: Peer; cerrar: ReturnType<typeof vi.fn> }[] = [];
    conectar.mockImplementation(async () => {
      const sesion = { pc: new Peer(), cerrar: vi.fn() };
      sesiones.push(sesion);
      return sesion;
    });
    const fallo = vi.fn();
    render(<ReproductorWebRTC obtener={cargar} onFallo={fallo} />);
    await ciclos();
    act(() => { sesiones[0].pc.cambiar('disconnected'); sesiones[0].pc.cambiar('failed'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await ciclos();
    expect(conectar).toHaveBeenCalledTimes(2);
    expect(fallo).not.toHaveBeenCalled();
  });

  it('cambiar de cámara y desmontar cancelan las negociaciones pendientes', async () => {
    const senales: AbortSignal[] = [];
    conectar.mockImplementation((_video, _url, signal: AbortSignal) => {
      senales.push(signal);
      return new Promise(() => undefined);
    });
    const vista = render(<ReproductorWebRTC obtener={cargar} claveReinicio={1} />);
    await ciclos();
    expect(senales[0].aborted).toBe(false);
    vista.rerender(<ReproductorWebRTC obtener={cargar} claveReinicio={2} />);
    await ciclos();
    expect(senales[0].aborted).toBe(true);
    expect(senales[1].aborted).toBe(false);
    vista.unmount();
    expect(senales[1].aborted).toBe(true);
  });
});
