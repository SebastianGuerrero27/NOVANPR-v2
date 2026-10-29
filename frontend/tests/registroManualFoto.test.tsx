/**
 * Foto de evidencia del registro manual: el vehículo que el motor no registró ya pasó cuando el
 * guardia lo registra a mano; elige la foto de los últimos 30 s de la cámara en que se ve.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { api, notificar } = vi.hoisted(() => ({
  api: { post: vi.fn(), get: vi.fn() },
  notificar: vi.fn(),
}));
vi.mock('../src/infraestructura/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/infraestructura/api')>()),
  default: api,
}));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => notificar }));

import { RegistroManualModal } from '../src/interfaz/componentes/deteccion';

/** Las horas de las fotos se calculan al consultarlas, como las entrega el motor */
function respuestas(cuadros: (ahora: number) => unknown) {
  api.get.mockImplementation((url: string) => Promise.resolve({
    data: url === '/camaras'
      ? [{ id: 2, nombre: 'Garita', direccion: 'ingreso', ubicacion: 'Entrada' }]
      : cuadros(Date.now() / 1000),
  }));
}

const abrir = async () => {
  render(<MemoryRouter><RegistroManualModal onCerrar={() => undefined} /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Placa*'), { target: { value: 'PBA1234' } });
  fireEvent.change(screen.getByLabelText('Motivo del registro manual*'), { target: { value: 'Pasó muy rápido' } });
  await screen.findByRole('option', { name: /Garita/ });
  fireEvent.change(screen.getByLabelText('Cámara asociada'), { target: { value: '2' } });
};

describe('Foto de evidencia del registro manual', () => {
  afterEach(() => vi.clearAllMocks());

  it('muestra los últimos 30 s de la cámara y envía la hora de la foto elegida', async () => {
    let elegida = 0;
    respuestas(ahora => {
      elegida = ahora - 9;
      return { disponible: true, cuadros: [{ t: ahora - 2, miniatura: 'AAAA' }, { t: elegida, miniatura: 'BBBB' }] };
    });
    api.post.mockResolvedValue({ data: { deteccion: { id: 40, placa: 'PBA1234', estado_validacion: 'no_reconocido', tipo_movimiento: 'ingreso' } } });
    await abrir();
    const foto = await screen.findByRole('button', { name: /Cuadro de hace 9 s/ });
    expect(api.get).toHaveBeenCalledWith('/detecciones/registro-manual/cuadros', { params: { camara_id: 2 } });
    fireEvent.click(foto);
    expect(foto).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Registrar ingreso/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/detecciones/registro-manual', expect.objectContaining({
      placa: 'PBA1234', camara_id: 2, cuadro_t: elegida,
    })));
  });

  it('sin foto elegida no envía cuadro_t y explica cuando la cámara no tiene historial', async () => {
    respuestas(() => ({ disponible: false, motivo: 'Solo hay fotos de los últimos 30 s de la cámara que procesa el motor ANPR.', cuadros: [] }));
    api.post.mockResolvedValue({ data: { deteccion: { id: 41, placa: 'PBA1234', estado_validacion: 'no_reconocido', tipo_movimiento: 'ingreso' } } });
    await abrir();
    expect(await screen.findByText(/Solo hay fotos de los últimos 30 s/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Registrar ingreso/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('cuadro_t');
  });
});
