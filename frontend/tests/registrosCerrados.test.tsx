import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const { get, descargar } = vi.hoisted(() => ({ get: vi.fn(), descargar: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { get }, mensajeError: String, mensajeErrorDescarga: async () => 'Error' }));
vi.mock('../src/infraestructura/descargas', () => ({ descargarBlob: descargar }));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ puede: () => false }) }));
vi.mock('../src/aplicacion/tiempoReal', () => ({ useEvento: () => undefined, useReconexion: () => undefined }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
import Detecciones from '../src/interfaz/paginas/Detecciones';

describe('Registros con salida', () => {
  it('consulta visitas cerradas y descarga el PDF con los mismos filtros sin paginación', async () => {
    get.mockImplementation(async (ruta: string) => {
      if (ruta === '/camaras') return { data: [] };
      if (ruta === '/detecciones/registros.pdf') return { data: new Blob(['pdf']), headers: {} };
      return { data: { items: [], total: 30, pagina: 1, tamano: 25 } };
    });
    render(<MemoryRouter initialEntries={['/detecciones?placa=PBA']}><Detecciones /></MemoryRouter>);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/detecciones', expect.objectContaining({ params: expect.objectContaining({ cerrados: 'si', placa: 'PBA', pagina: 1 }) })));
    const boton = await screen.findByRole('button', { name: 'Descargar PDF' });
    await waitFor(() => expect(boton).toBeEnabled());
    fireEvent.click(boton);
    await waitFor(() => expect(descargar).toHaveBeenCalled());
    const params = get.mock.calls.find(([ruta]) => ruta === '/detecciones/registros.pdf')![1].params;
    expect(params).toMatchObject({ cerrados: 'si', completos: 'si', placa: 'PBA' });
    expect(params).not.toHaveProperty('pagina');
  });
});
