import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';

const { get, eventos } = vi.hoisted(() => ({ get: vi.fn(), eventos: new Map<string, (datos: unknown) => void>() }));
vi.mock('../src/infraestructura/api', () => ({ default: { get }, mensajeError: String }));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ token: 'guardia', puede: () => true }) }));
vi.mock('../src/aplicacion/tiempoReal', () => ({
  useTiempoReal: () => ({ conectado: false }),
  useEvento: (nombre: string, manejar: (datos: unknown) => void) => { eventos.set(nombre, manejar); },
}));
vi.mock('../src/infraestructura/push', () => ({ registrarServiceWorker: () => undefined, sincronizarPush: async () => undefined }));
import { CentroNotificacionesProvider } from '../src/aplicacion/notificaciones';
import { CampanaNotificaciones } from '../src/interfaz/componentes/CentroNotificaciones';

const aviso = { id: 994, tipo: 'padron.permiso_otorgado', severidad: 'baja', titulo: 'Permiso otorgado: PZX-8723',
  mensaje: 'El gestor concedió permiso a Ana Torres', enlace: '/listas/autorizados?q=PZX8723', datos: null,
  repeticiones: 1, requiere_ack: false, fecha_creacion: '2026-10-26T15:59:00Z', fecha_ultima: '2026-10-26T15:59:00Z',
  leida: false, atendida: null, resuelta: false, escalada: false };
const bandeja = (items: unknown[]) => ({ data: { items, no_leidas: items.length, pendientes: 0, revisadas: 0 } });
const mostrar = () => render(<MemoryRouter><CentroNotificacionesProvider><CampanaNotificaciones /></CentroNotificacionesProvider></MemoryRouter>);

beforeEach(() => { get.mockReset().mockResolvedValue(bandeja([])); eventos.clear(); });

it('recupera por REST al abrir la campana un permiso cuyo evento no llegó', async () => {
  mostrar();
  await waitFor(() => expect(get).toHaveBeenCalledWith('/notificaciones', { params: { limite: 30 } }));
  get.mockResolvedValue(bandeja([aviso]));
  fireEvent.click(screen.getByRole('button', { name: 'Notificaciones: 0 sin leer' }));
  await screen.findByText('Permiso otorgado: PZX-8723');
  expect(screen.getByRole('button', { name: 'Notificaciones: 1 sin leer' })).toBeInTheDocument();
  expect(get).toHaveBeenCalledTimes(2);
});

it('recupera la bandeja cuando cambia la lista blanca aunque no llegue notificacion:nueva', async () => {
  mostrar();
  await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  get.mockResolvedValue(bandeja([aviso]));
  act(() => eventos.get('listas:actualizadas')?.({ lista: 'autorizado' }));
  await screen.findByRole('button', { name: 'Notificaciones: 1 sin leer' });
});
