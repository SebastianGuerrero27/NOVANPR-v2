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
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 100, x: 0, y: 0, right: 200, bottom: 100, toJSON: () => ({}) } as DOMRect);
    put.mockResolvedValue({ data: { camera: CAMARA } });
  });
  afterEach(() => { vi.restoreAllMocks(); put.mockReset(); });

  it('validación previa: área de 3+ vértices o vacía; zonas completas (las vacías se ignoran)', () => {
    expect(errorZonas([], [])).toBeNull();
    expect(errorZonas([[0, 0], [1, 0]], [])).toMatch(/área de detección necesita al menos 3 vértices/);
    expect(errorZonas([], [[[0, 0], [1, 0], [1, 1]], [], [[0, 0]]])).toBe('Complete la zona de exclusión 3 (mínimo 3 vértices) o bórrela.');
  });

  it('el área de detección se puede borrar para usar el cuadro completo', async () => {
    render(<EditorRoi camara={{ ...CAMARA, roi: [[0, 0], [1, 0], [1, 1]] }} onCerrar={() => undefined} onGuardada={() => undefined} />);
    expect(screen.getByText(/3 vértices/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Borrar área/ }));
    expect(screen.getByText('Sin área: se analiza el cuadro completo.')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Guardar zonas/ })); });
    expect(put).toHaveBeenCalledWith('/camaras/3/roi', { roi: null, exclusiones: [] });
  });

  it('no permite guardar zonas incompletas', async () => {
    render(<EditorRoi camara={CAMARA} onCerrar={() => undefined} onGuardada={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Zonas de exclusión/ }));
    fireEvent.click(screen.getByRole('button', { name: /Nuevo polígono/ }));
    // Simular dibujo incompleto (el componente interno maneja los eventos)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Guardar zonas/ })); });
    // Debería mostrar error de validación (zona incompleta)
    expect(put).not.toHaveBeenCalled();
  });
});
