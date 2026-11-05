import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { get }, mensajeError: String }));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ user: { nombre: 'Ana Guardia', rol: 'Guardia' }, puede: (p: string) => p === 'operacion:monitorear' }) }));
vi.mock('../src/aplicacion/tiempoReal', () => ({ useEvento: () => undefined, useReconexion: () => undefined }));
import Inicio from '../src/interfaz/paginas/Inicio';

describe('Dashboard del guardia', () => {
  beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
  afterEach(() => vi.unstubAllGlobals());
  it('conserva el control del turno y su balance sin las cuatro tarjetas retiradas', async () => {
    get.mockImplementation(async (ruta: string) => ({ data: ruta === '/panel/resumen' ? {
      hoy: { total: 2, autorizados: 2, alertas: 0, no_registrados: 0, pendientes: 0, validados: 2 },
      movimientos: { ingresos: 3, entradas: 2, salidas: 1, dentro: 4, registros_completos: 12, registros_acceso: 27 }, por_hora: [], tendencia: [], camaras: [],
      cola_revision: 0, ultimas_alertas: [], listas: { alertas_vigentes: 0 },
    } : { items: [], total: 0 } }));
    render(<MemoryRouter><Inicio /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('img', { name: /Entradas de hoy: 2/ })).toBeInTheDocument());
    expect(screen.getByRole('img', { name: /Salidas de hoy: 1/ })).toBeInTheDocument();
    // Ingresos de hoy = entradas (aún sin salida) + salidas; el total histórico queda como referencia
    const contador = screen.getByText('Ingresos de hoy', { selector: 'span' }).parentElement!;
    expect(contador.querySelector('strong')).toHaveTextContent(/^3$/);
    expect(contador).toHaveTextContent('total histórico de «Todos los accesos»: 27');
    expect(screen.getByText(/= 2 entradas \+ 1 salidas/)).toBeInTheDocument();
    expect(screen.queryByText('Ingresos autorizados sin salida')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Registro de Salidas: 12/ })).toHaveAttribute('href', '/detecciones');
    expect(screen.getByRole('link', { name: /Historial completo/ })).toHaveAttribute('href', '/historial');
    for (const titulo of ['Pendientes de autorización', 'Últimas alertas', 'Detecciones por hora', 'Cámaras']) {
      expect(screen.queryByText(titulo, { exact: true })).not.toBeInTheDocument();
    }
    expect(get).not.toHaveBeenCalledWith('/detecciones', expect.anything());
    expect(screen.getByRole('button', { name: 'Registrar entrada' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Registrar salida' })).toHaveAttribute('href', '/monitoreo');
  });
});
