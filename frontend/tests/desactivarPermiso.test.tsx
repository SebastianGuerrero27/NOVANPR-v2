/**
 * Gestor de permisos · «Mis permisos»: desactivar un permiso en Acciones, ver los desactivados y
 * volver a activarlos; un permiso vencido no se activa, se renueva. Datos ficticios.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';

const { get, post, borrar } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), borrar: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { get, post, delete: borrar }, mensajeError: String, urlMedia: (r: string) => r }));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ user: { id: 9, nombre: 'Gestora' }, puede: (p: string) => ['listas:ver', 'padron:gestionar', 'solicitudes:resolver'].includes(p) }) }));
vi.mock('../src/aplicacion/tiempoReal', () => ({ useEvento: () => undefined, useReconexion: () => undefined }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
import Listas from '../src/interfaz/paginas/Listas';

const permiso = (id: number, propietario: string, c: Record<string, unknown> = {}) => ({
  id, placa: `PZX${1000 + id}`, propietario, cedula: null, institucion: null, cargo: null, departamento: null, marca: 'Kia', modelo: 'Rio',
  tipo_vehiculo: 'Automóvil', color: 'Gris', observaciones: null, motivo_ingreso: null, horario: null, horario_texto: null,
  fecha_inicio: null, fecha_vencimiento: '2026-12-31', fecha_registro: '2026-10-20T10:00:00Z', fecha_actualizacion: null,
  vigente: true, por_vencer: false, pendiente_inicio: false, ingresos: 0, activo: true,
  registrado_por: 9, registrado_por_nombre: 'Gestora', registrado_por_email: 'gestora@example.com', ...c,
});

beforeEach(() => {
  post.mockReset().mockResolvedValue({ data: {} });
  borrar.mockReset().mockResolvedValue({ data: {} });
  get.mockReset().mockImplementation(async (_ruta: string, opciones?: { params?: { estado?: string } }) => ({
    data: opciones?.params?.estado === 'activos'
      ? [permiso(1, 'Rosa Vera')]
      : [permiso(2, 'Luis Mora', { activo: false }), permiso(3, 'Ana Toapanta', { activo: false, vigente: false, fecha_vencimiento: '2026-10-01' })],
  }));
});

it('desactiva un permiso activo desde Acciones (inmediato, reversible y sin motivo)', async () => {
  render(<MemoryRouter><Listas tipo="autorizados" incrustada soloMios /></MemoryRouter>);
  const fila = (await screen.findByText('Rosa Vera')).closest('tr')!;
  expect(get).toHaveBeenCalledWith('/vehiculos-autorizados/mis-permisos', { params: { estado: 'activos' } });
  expect(within(fila).getByRole('button', { name: /Editar el permiso/ })).toBeInTheDocument();
  fireEvent.click(within(fila).getByRole('button', { name: /Desactivar/ }));
  const dialogo = screen.getByRole('dialog');
  expect(within(dialogo).getByText(/puede activarlo de nuevo/)).toBeInTheDocument();
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Desactivar' }));
  await waitFor(() => expect(borrar).toHaveBeenCalledWith('/vehiculos-autorizados/1'));
});

it('los desactivados se activan de nuevo; uno vencido solo se renueva y el gestor no elimina', async () => {
  render(<MemoryRouter><Listas tipo="autorizados" incrustada soloMios /></MemoryRouter>);
  await screen.findByText('Rosa Vera');
  fireEvent.click(screen.getByRole('tab', { name: 'Desactivados' }));
  const desactivado = (await screen.findByText('Luis Mora')).closest('tr')!;
  expect(get).toHaveBeenLastCalledWith('/vehiculos-autorizados/mis-permisos', { params: { estado: 'retirados' } });
  expect(within(desactivado).getByText('Desactivado')).toBeInTheDocument();
  fireEvent.click(within(desactivado).getByRole('button', { name: /Activar/ }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Activar' }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/vehiculos-autorizados/2/reactivar', {}));

  const vencido = screen.getByText('Ana Toapanta').closest('tr')!;
  expect(within(vencido).queryByRole('button', { name: /Activar/ })).not.toBeInTheDocument();
  expect(within(vencido).getByRole('button', { name: /Renovar/ })).toBeInTheDocument();
  expect(within(vencido).queryByRole('button', { name: /Eliminar/ })).not.toBeInTheDocument();
});
