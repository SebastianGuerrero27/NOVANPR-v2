import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Camara } from '../src/dominio/tipos';

vi.mock('../src/infraestructura/api', () => ({
  default: { post: vi.fn() },
}));
vi.mock('../src/interfaz/componentes/envivo', async () => {
  const React = await import('react');
  return {
    VisorEnVivo: ({ camaraId }: { camaraId: number }) => React.createElement('div', { 'data-testid': `video-${camaraId}` }),
    ReproductorWebRTC: () => null,
  };
});

import { VistaCuadricula } from '../src/interfaz/componentes/VistaCuadricula';

const camaras: Camara[] = [1, 2, 3, 4].map(id => ({
  id, nombre: `Cámara ${id}`, ip: `192.0.2.${id}`, ubicacion: 'Acceso', direccion: 'ingreso',
  rtsp_url: 'rtsp://camera/stream', rtsp_url_vista: null, tiene_credenciales: false,
  activa: true, estado: 'EN_LINEA', ultimo_ping: null, tiempo_respuesta_ms: null,
  mensaje_ping: null, created_at: '2026-10-17T00:00:00Z', roi: null,
}));

describe('Vista cuadrícula de Monitoreo', () => {
  beforeEach(() => {
    localStorage.setItem('anpr_nvr_slots_v1', JSON.stringify([1, 2, 3, 4]));
    localStorage.removeItem('anpr_cuadricula_cantidad_v1');
  });

  afterEach(() => localStorage.clear());

  it('permite ver 1, 2 o 4 cámaras dentro de la vista cuadrícula y persiste la selección', () => {
    const { container } = render(<VistaCuadricula camaras={camaras} motorId={1} />);
    const celdas = () => container.querySelectorAll('.nvr-celda');
    expect(celdas()).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar 2 cámaras' }));
    expect(celdas()).toHaveLength(2);
    expect(localStorage.getItem('anpr_cuadricula_cantidad_v1')).toBe('2');

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar 1 cámara' }));
    expect(celdas()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar 4 cámaras' }));
    expect(celdas()).toHaveLength(4);
    expect(screen.getByLabelText('Vista cuadrícula de 4 cámaras')).toBeInTheDocument();
  });

  it('muestra el video y la dirección de cada cámara asignada', () => {
    const { container } = render(<VistaCuadricula camaras={camaras} motorId={1} />);
    expect(screen.getByTestId('video-1')).toBeInTheDocument();
    expect(within(container.querySelector('[aria-label="Cámara 1: Cámara 1"]')!).getByText('INGRESO')).toBeInTheDocument();
    expect(container.querySelector('[aria-label="Cámara 2: Cámara 2"]')).not.toBeNull();
  });

  it('una cámara sin conexión muestra el motivo en lugar de un reproductor que no abre', () => {
    // La cámara física de la garita vista desde otra red: no responde al ping ni al puerto RTSP
    const sinRed = camaras.map(c => c.id === 2 ? { ...c, estado: 'SIN_CONEXION' as const, mensaje_ping: 'Sin respuesta (tiempo de espera agotado)' } : c);
    const { container } = render(<VistaCuadricula camaras={sinRed} motorId={1} />);
    const celda = within(container.querySelector('[aria-label="Cámara 2: Cámara 2"]') as HTMLElement);
    expect(celda.getByText('Sin conexión con la cámara')).toBeInTheDocument();
    expect(celda.getByText(/192\.0\.2\.2 · Sin respuesta \(tiempo de espera agotado\)/)).toBeInTheDocument();
    expect(screen.getByTestId('video-1')).toBeInTheDocument();
  });
});
