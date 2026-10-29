/**
 * El administrador ve en Gestión de Permisos los permisos que otorgaron TODOS los usuarios
 * (los gestores los conceden directamente, sin solicitud), incluidos los retirados, y puede
 * filtrar por gestor. Datos ficticios.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';

const { get, borrar } = vi.hoisted(() => ({ get: vi.fn(), borrar: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { get, post: vi.fn(), delete: borrar }, mensajeError: String }));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, nombre: 'Admin' }, puede: () => true }) }));
vi.mock('../src/aplicacion/tiempoReal', () => ({ useEvento: () => undefined, useReconexion: () => undefined }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
import SolicitudesAcceso from '../src/interfaz/paginas/SolicitudesAcceso';

const permiso = (id: number, propietario: string, registradoPor: number, nombre: string, activo = true) => ({
  id, placa: `PZX${100 + id}`, propietario, cedula: null, vigente: true, por_vencer: false, ingresos: 0, activo,
  fecha_registro: '2026-10-26T15:59:00Z', registrado_por: registradoPor, registrado_por_nombre: nombre, registrado_por_email: `${nombre.toLowerCase()}@example.com`,
});
const USUARIOS = [
  { id: 2, nombre: 'Gestora Uno', email: 'uno@example.com', rol: 'GESTOR_PERMISOS', estado: 'activo', total: 1, activos: 1, vigentes: 1, por_vencer: 0, vencidos: 0, retirados: 0, sin_placa: 0, ultimo_registro: '2026-10-26T15:59:00Z' },
  { id: 1, nombre: 'Admin', email: 'admin@example.com', rol: 'ADMIN', estado: 'activo', total: 2, activos: 1, vigentes: 1, por_vencer: 0, vencidos: 0, retirados: 1, sin_placa: 0, ultimo_registro: '2026-10-26T15:59:00Z' },
];

beforeEach(() => {
  borrar.mockReset().mockResolvedValue({ data: {} });
  get.mockReset().mockImplementation(async (ruta: string, opciones?: { params?: { usuario?: string } }) => {
    if (ruta === '/solicitudes-acceso/resumen') return { data: { pendientes: 0 } };
    if (ruta === '/vehiculos-autorizados/registro') {
      const todos = [permiso(5, 'Ana Gestionada', 2, 'Gestora Uno'), permiso(3, 'Luis Propio', 1, 'Admin'), permiso(1, 'Rosa Retirada', 1, 'Admin', false)];
      const usuario = opciones?.params?.usuario;
      return { data: { items: usuario ? todos.filter(p => String(p.registrado_por) === usuario) : todos, usuarios: USUARIOS } };
    }
    return { data: [] };
  });
});

it('abre con los permisos de todos los usuarios, incluidos los del gestor y los retirados', async () => {
  render(<MemoryRouter initialEntries={['/solicitudes']}><SolicitudesAcceso /></MemoryRouter>);
  expect(screen.getByRole('tab', { name: /Permisos otorgados por todos los usuarios/ })).toHaveAttribute('aria-selected', 'true');
  expect(await screen.findByText('Ana Gestionada', {}, { timeout: 5000 })).toBeInTheDocument();
  expect(screen.getByText('Rosa Retirada')).toBeInTheDocument();
  expect(screen.getAllByText('Desactivado').length).toBeGreaterThan(0);
  // «Registrado por»: nombre y correo de quien otorgó el permiso
  const otorgado = screen.getByText('Ana Gestionada').closest('tr')!;
  expect(within(otorgado).getByText('Gestora Uno')).toBeInTheDocument();
  expect(within(otorgado).getByText('gestora uno@example.com')).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith('/vehiculos-autorizados/registro', { params: { usuario: undefined, estado: 'todos' } });

  // Filtrar por el gestor deja solo sus permisos
  const fila = screen.getAllByText('Gestora Uno')[0].closest('tr')!;
  fireEvent.click(within(fila).getByRole('button', { name: /Ver/ }));
  expect(await screen.findByText('Permisos de Gestora Uno')).toBeInTheDocument();
  expect(get).toHaveBeenLastCalledWith('/vehiculos-autorizados/registro', { params: { usuario: '2', estado: 'todos' } });
});

it('una notificación de solicitud (?id=) abre la pestaña de solicitudes', async () => {
  render(<MemoryRouter initialEntries={['/solicitudes?id=9']}><SolicitudesAcceso /></MemoryRouter>);
  expect(screen.getByRole('tab', { name: /Solicitudes/ })).toHaveAttribute('aria-selected', 'true');
  expect(await screen.findByText('No hay solicitudes pendientes')).toBeInTheDocument();
});

it('desactiva sin pedir motivo y elimina definitivamente un permiso desactivado', async () => {
  render(<MemoryRouter initialEntries={['/solicitudes']}><SolicitudesAcceso /></MemoryRouter>);
  const vigente = (await screen.findByText('Ana Gestionada', {}, { timeout: 5000 })).closest('tr')!;
  fireEvent.click(within(vigente).getByRole('button', { name: /Desactivar/ }));
  const dialogo = screen.getByRole('dialog');
  expect(within(dialogo).queryByRole('textbox')).not.toBeInTheDocument();
  expect(within(dialogo).getByText(/dejará de autorizar el ingreso/)).toBeInTheDocument();
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Desactivar' }));
  await waitFor(() => expect(borrar).toHaveBeenCalledWith('/vehiculos-autorizados/5'));

  const retirado = screen.getByText('Rosa Retirada').closest('tr')!;
  expect(within(retirado).getByText('Desactivado')).toBeInTheDocument();
  expect(within(retirado).getByRole('button', { name: /Activar/ })).toBeInTheDocument();
  fireEvent.click(within(retirado).getByRole('button', { name: /Eliminar/ }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar definitivamente' }));
  await waitFor(() => expect(borrar).toHaveBeenCalledWith('/vehiculos-autorizados/1/definitivo'));
});
