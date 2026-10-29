import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';

const { get, eventos } = vi.hoisted(() => ({ get: vi.fn(), eventos: new Map<string, (datos: unknown) => void>() }));
vi.mock('../src/infraestructura/api', () => ({ default: { get }, mensajeError: String }));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ user: { id: 2, nombre: 'Guardia' }, puede: (p: string) => ['listas:ver', 'solicitudes:crear', 'operacion:monitorear', 'detecciones:validar'].includes(p) }) }));
vi.mock('../src/aplicacion/tiempoReal', () => ({
  useEvento: (nombre: string, manejar: (datos: unknown) => void) => { eventos.set(nombre, manejar); },
  useReconexion: () => undefined,
}));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
import SolicitudesAcceso from '../src/interfaz/paginas/SolicitudesAcceso';

const permiso = { id: 5, placa: 'PZX8723', propietario: 'Ana Gestora', cedula: '0123456789', vigente: true,
  ingresos: 0, fecha_registro: '2026-10-26T15:59:00Z', registrado_por_email: 'gestor@example.com' };

beforeEach(() => {
  eventos.clear();
  get.mockReset().mockImplementation(async (ruta: string) => ({ data: ruta === '/vehiculos-autorizados' ? [permiso] : [] }));
});

it('muestra al guardia los permisos directos sin confundirlos con solicitudes propias', async () => {
  render(<MemoryRouter initialEntries={['/solicitudes']}><SolicitudesAcceso /></MemoryRouter>);
  expect(screen.getByRole('tab', { name: 'Permisos otorgados' })).toHaveAttribute('aria-selected', 'true');
  await screen.findByText('Ana Gestora');
  expect(screen.getByText('0123456789')).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith('/vehiculos-autorizados');
  expect(get).not.toHaveBeenCalledWith('/vehiculos-autorizados/mis-permisos');

  fireEvent.click(screen.getByRole('tab', { name: 'Mis solicitudes' }));
  await screen.findByText('No hay solicitudes pendientes');
  expect(get).toHaveBeenCalledWith('/solicitudes-acceso', { params: { estado: 'pendiente' } });
  expect(screen.queryByText('Ana Gestora')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Nueva solicitud' })).toBeInTheDocument();
});

it('actualiza los permisos de la garita cuando el gestor modifica el padrón', async () => {
  render(<MemoryRouter initialEntries={['/solicitudes']}><SolicitudesAcceso /></MemoryRouter>);
  await screen.findByText('Ana Gestora');
  get.mockResolvedValue({ data: [permiso, { ...permiso, id: 6, propietario: 'Nuevo permiso por nombre', placa: null }] });
  act(() => eventos.get('listas:actualizadas')?.({ lista: 'autorizado' }));
  await waitFor(() => expect(screen.getByText('Nuevo permiso por nombre')).toBeInTheDocument(), { timeout: 3000 });
  expect(screen.getByText('Pendiente de placa')).toBeInTheDocument();
});

it('un enlace a una solicitud conserva su detalle en Mis solicitudes', async () => {
  render(<MemoryRouter initialEntries={['/solicitudes?id=7']}><SolicitudesAcceso /></MemoryRouter>);
  expect(screen.getByRole('tab', { name: 'Mis solicitudes' })).toHaveAttribute('aria-selected', 'true');
  await screen.findByText('No hay solicitudes pendientes');
  expect(get).not.toHaveBeenCalledWith('/vehiculos-autorizados');
});
