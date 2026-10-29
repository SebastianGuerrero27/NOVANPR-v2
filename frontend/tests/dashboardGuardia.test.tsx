import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { centro, get } = vi.hoisted(() => ({ centro: { items: [] as { id: number; titulo: string; fecha_ultima: string }[], cargando: false }, get: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { get }, mensajeError: String }));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ user: { nombre: 'Ana Guardia', rol: 'Guardia' }, puede: (p: string) => p === 'operacion:monitorear' }) }));
vi.mock('../src/aplicacion/tiempoReal', () => ({ useEvento: () => undefined, useReconexion: () => undefined }));
vi.mock('../src/aplicacion/notificaciones', () => ({ useCentroNotificaciones: () => centro }));
vi.mock('../src/interfaz/componentes/CentroNotificaciones', () => ({ ItemNotificacion: ({ n }: { n: { titulo: string } }) => <div>{n.titulo}</div> }));
import Inicio from '../src/interfaz/paginas/Inicio';

describe('Dashboard del guardia', () => {
  beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
  afterEach(() => vi.unstubAllGlobals());
  it('muestra el balance real y los avisos de su bandeja aunque no haya detecciones en lista negra', async () => {
    centro.items = [];
    get.mockImplementation(async (ruta: string) => ({ data: ruta === '/panel/resumen' ? {
      hoy: { total: 2, autorizados: 2, alertas: 0, no_registrados: 0, pendientes: 0, validados: 2 },
      movimientos: { ingresos: 3, entradas: 2, salidas: 1, dentro: 4, registros_completos: 12, registros_acceso: 27 }, por_hora: [], tendencia: [], camaras: [],
      cola_revision: 0, ultimas_alertas: [], listas: { alertas_vigentes: 0 },
    } : { items: [], total: 0 } }));
    const vista = render(<MemoryRouter><Inicio /></MemoryRouter>);
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
    expect(screen.getByText('Detecciones por hora')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver todas' })).toHaveAttribute('href', '/notificaciones');
    expect(screen.getByText('Sin alertas registradas')).toBeInTheDocument();
    centro.items = [{ id: 8, titulo: 'Nuevo permiso autorizado', fecha_ultima: '2026-10-22T15:00:00Z' }];
    vista.rerender(<MemoryRouter><Inicio /></MemoryRouter>);
    expect(screen.getByText('Nuevo permiso autorizado')).toBeInTheDocument();
    expect(screen.queryByText('Sin alertas registradas')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar entrada' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Registrar salida' })).toHaveAttribute('href', '/monitoreo');
  });
});
