/**
 * Editor de zonas de la cámara: área de detección y zonas de exclusión dibujadas sobre el video,
 * con la misma validación que la API y lo que se envía al guardar.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Camara } from '../src/dominio/tipos';

const { put } = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put, delete: vi.fn() },
  mensajeError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
// Sin WebRTC en jsdom: la capa de dibujo se monta directamente
vi.mock('../src/interfaz/componentes/envivo', () => ({
  ReproductorWebRTC: ({ capa }: { capa: React.ReactNode }) => <div style={{ position: 'relative' }}>{capa}</div>,
}));

import { EditorRoi, errorZonas } from '../src/interfaz/componentes/EditorRoi';

const CAMARA: Camara = {
  id: 3, nombre: 'Garita norte', ubicacion: 'Acceso vehicular norte', ip: '192.0.2.10',
  direccion: 'ingreso',
  rtsp_url: 'rtsp://admin:******@192.0.2.10:554/Streaming/Channels/101', rtsp_url_vista: null, tiene_credenciales: true,
  activa: true, estado: 'EN_LINEA', ultimo_ping: null, tiempo_respuesta_ms: null, mensaje_ping: null, created_at: '2026-10-09T10:00:00Z',
  roi: null, exclusiones: [],
};

describe('Editor de zonas', () => {
  it('al guardar la región elimina exclusiones antiguas y sombrea su exterior', async () => {
    const roi: [number, number][] = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];
    render(<EditorRoi camara={{ ...CAMARA, roi, exclusiones: [roi] }} onCerrar={() => undefined} onGuardada={() => undefined} />);
    expect(screen.getByTestId('exterior-excluido')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /exclusión/i })).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Guardar zona/ })); });
    expect(put).toHaveBeenCalledWith('/camaras/3/roi', { roi, exclusiones: [] });
  });
  it('permite dibujar un polígono hasta los bordes y muestra la mano al cerrarlo', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    try {
      render(<EditorRoi camara={CAMARA} onCerrar={() => undefined} onGuardada={() => undefined} />);
      expect(screen.queryByRole('button', { name: /Zonas de exclusión/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Seleccionar \/ mover|Rectángulo/ })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Polígono/ }));
      const superficie = screen.getByTestId('superficie-zonas');
      fireEvent.pointerDown(superficie, { clientX: 0, clientY: 0, button: 0 });
      fireEvent.pointerDown(superficie, { clientX: 200, clientY: 0, button: 0 });
      fireEvent.pointerDown(superficie, { clientX: 200, clientY: 100, button: 0 });
      fireEvent.pointerDown(superficie, { clientX: 0, clientY: 100, button: 0 });
      fireEvent.click(screen.getByRole('button', { name: /Cerrar polígono/ }));
      expect(screen.getByRole('button', { name: 'Mover área' })).toBeInTheDocument();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Guardar zona/ })); });
      expect(put).toHaveBeenCalledWith('/camaras/3/roi', { roi: [[0, 0], [1, 0], [1, 1], [0, 1]], exclusiones: [] });
    } finally { vi.unstubAllGlobals(); }
  });
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 100, x: 0, y: 0, right: 200, bottom: 100, toJSON: () => ({}) } as DOMRect);
    put.mockResolvedValue({ data: { camera: CAMARA } });
  });
  afterEach(() => { vi.restoreAllMocks(); put.mockReset(); });

  it('valida la región vacía, incompleta y con cruces', () => {
    expect(errorZonas([])).toBeNull();
    expect(errorZonas([[0, 0], [1, 0]])).toMatch(/zona de interés necesita al menos 3 vértices/);
    expect(errorZonas([[0, 0], [1, 1], [1, 0], [0, 1]])).toMatch(/se cruza/);
  });

  it('el área de detección se puede borrar para usar el cuadro completo', async () => {
    render(<EditorRoi camara={{ ...CAMARA, roi: [[0, 0], [1, 0], [1, 1]] }} onCerrar={() => undefined} onGuardada={() => undefined} />);
    expect(screen.getByText(/3 vértices/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Borrar área/ }));
    expect(screen.getByText('Sin área: se analiza el cuadro completo.')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Guardar zona/ })); });
    expect(put).toHaveBeenCalledWith('/camaras/3/roi', { roi: null, exclusiones: [] });
  });

  it('no permite guardar zonas incompletas', async () => {
    render(<EditorRoi camara={CAMARA} onCerrar={() => undefined} onGuardada={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /Polígono/ }));
    // Simular dibujo incompleto (el componente interno maneja los eventos)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Guardar zona/ })); });
    // Debería mostrar error de validación (zona incompleta)
    expect(put).not.toHaveBeenCalled();
  });
});
