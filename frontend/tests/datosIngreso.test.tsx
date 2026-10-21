/**
 * Quién ingresa y motivo de ingreso (reporte de control vehicular de la garita): al validar un
 * ingreso se propone el titular de la lista blanca, el motivo se elige con un toque y ambos se
 * envían; una salida no los pide.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Deteccion } from '../src/dominio/tipos';

const { api, notificar } = vi.hoisted(() => ({
  api: { post: vi.fn(), patch: vi.fn(), get: vi.fn().mockResolvedValue({ data: [] }) },
  notificar: vi.fn(),
}));
vi.mock('../src/infraestructura/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/infraestructura/api')>()),
  default: api,
}));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => notificar }));

import { ValidarModal } from '../src/interfaz/componentes/deteccion';

const paso = (cambios: Partial<Deteccion> = {}): Deteccion => ({
  id: 15, placa: 'PBA1234', placa_reconocida: 'PBA1234', placa_validada: null, estado_validacion: 'pendiente_revision',
  estado_procesamiento: 'procesado', confianza_deteccion: 0.9, confianza_ocr: 0.95, fecha_hora_ingreso: '2026-10-19T14:52:00Z',
  tipo_movimiento: 'ingreso', fecha_hora_procesamiento: null, fuente: 'rtsp', tracking_id: 4, imagen_vehiculo: null, imagen_placa: null,
  camara: null, tipo_vehiculo: null, vehiculo: { tipo: null, marca: null, modelo: null, color: null }, verificacion_vehiculo: null,
  verificacion_detalle: null, alerta: null, autorizado: { id: 2, propietario: 'Luis Torres', departamento: null }, validado_manualmente: false,
  validacion: null, ...cambios,
} as Deteccion);

describe('Quién ingresa y motivo de ingreso', () => {
  afterEach(() => vi.clearAllMocks());

  it('al validar un ingreso propone el titular, el motivo se elige con un toque y ambos se envían', async () => {
    api.post.mockResolvedValue({ data: { deteccion: paso({ estado_validacion: 'autorizado' }) } });
    render(<MemoryRouter><ValidarModal d={paso()} onCerrar={() => undefined} /></MemoryRouter>);
    expect(screen.getByLabelText('Nombres y apellidos de quien ingresa')).toHaveValue('Luis Torres');
    fireEvent.click(screen.getByRole('button', { name: 'Recorrido del ECU 911' }));
    expect(screen.getByLabelText('Motivo de ingreso')).toHaveValue('Recorrido del ECU 911');
    fireEvent.click(screen.getByRole('button', { name: /Confirmar placa/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/detecciones/validar/15', expect.objectContaining({
      placa_validada: 'PBA1234', persona_ingreso: 'Luis Torres', motivo_ingreso: 'Recorrido del ECU 911',
    })));
  });

  it('una salida no pide quién ingresa ni el motivo', () => {
    render(<MemoryRouter><ValidarModal d={paso({ tipo_movimiento: 'salida' })} onCerrar={() => undefined} /></MemoryRouter>);
    expect(screen.queryByLabelText('Nombres y apellidos de quien ingresa')).toBeNull();
    expect(screen.queryByLabelText('Motivo de ingreso')).toBeNull();
  });
});
