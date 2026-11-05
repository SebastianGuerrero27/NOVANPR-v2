import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Camara } from '../src/dominio/tipos';
import type { Permiso, Rol } from '../src/dominio/permisos';

const { get, auth } = vi.hoisted(() => ({
  get: vi.fn(),
  auth: {
    user: { id: 1, rol: 'Admin' as Rol, nombre: 'Cuenta de prueba', email: 'qa@example.invalid' },
    puede: vi.fn<(...permisos: Permiso[]) => boolean>(), logout: vi.fn(), expira: null,
  },
}));
vi.mock('../src/infraestructura/api', () => ({ default: { get } }));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../src/aplicacion/tiempoReal', () => ({ useEvento: () => undefined, useReconexion: () => undefined, useTiempoReal: () => ({ conectado: true }) }));
vi.mock('../src/aplicacion/hooks', async original => ({
  ...await original<typeof import('../src/aplicacion/hooks')>(), useTic: () => undefined, useVersionNueva: () => false,
}));
vi.mock('../src/infraestructura/avisos', () => ({ alCambiarSonido: () => () => undefined, fijarSonido: vi.fn(), sonidoActivo: () => false }));
vi.mock('../src/interfaz/componentes/AvisosAcceso', () => ({ AvisosAcceso: () => null }));
vi.mock('../src/interfaz/componentes/CentroNotificaciones', () => ({ CampanaNotificaciones: () => null }));
import { AppLayout } from '../src/interfaz/plantilla/AppLayout';
import { menuPara } from '../src/interfaz/plantilla/navegacion';

const camaras = [
  { id: 7, nombre: 'Garita entrada', direccion: 'ingreso', activa: true },
  { id: 8, nombre: 'Garita salida', direccion: 'salida', activa: false },
] as Camara[];
const Ruta = () => { const { pathname } = useLocation(); return <output data-testid="ruta-sidebar">{pathname}</output>; };
const abrir = () => {
  render(<MemoryRouter><AppLayout><Ruta /></AppLayout></MemoryRouter>);
  return screen.getByRole('complementary', { name: 'Menú principal' });
};

beforeEach(() => {
  localStorage.clear();
  auth.user.rol = 'Admin';
  auth.puede.mockReset().mockReturnValue(true);
  get.mockReset().mockImplementation(async (ruta: string) => ({ data: ruta === '/camaras' ? camaras : ruta === '/detecciones' ? { total: 0 } : { pendientes: 0 } }));
});

describe('Menú lateral y cámaras desplegables', () => {
  it.each<Rol>(['Admin', 'Guardia', 'GestorPermisos'])('presenta los módulos de %s en mayúsculas sin cambiar sus rutas', rol => {
    auth.user.rol = rol;
    const permitidos: Permiso[] = rol === 'Guardia'
      ? ['operacion:monitorear', 'listas:ver', 'padron:agregar', 'solicitudes:crear']
      : ['listas:ver', 'padron:gestionar', 'solicitudes:resolver'];
    auth.puede.mockImplementation((...permisos) => rol === 'Admin' || permisos.every(p => permitidos.includes(p)));
    const sidebar = abrir();
    const modulos = menuPara(auth.puede).flatMap(grupo => grupo.items);
    const enlaces = within(sidebar).getAllByRole('link');
    expect(enlaces).toHaveLength(modulos.length);
    modulos.forEach((modulo, i) => {
      expect(enlaces[i].querySelector('.etiqueta')).toHaveTextContent(modulo.titulo.toLocaleUpperCase('es'));
      expect(enlaces[i]).toHaveAttribute('href', modulo.ruta);
    });
    if (rol !== 'Admin') expect(within(sidebar).queryByRole('button', { name: 'Mostrar cámaras registradas' })).not.toBeInTheDocument();
  });

  it('permite desplegar y contraer las cámaras con un botón accesible sin navegar', async () => {
    const sidebar = abrir();
    const mostrar = within(sidebar).getByRole('button', { name: 'Mostrar cámaras registradas' });
    expect(mostrar).toHaveAttribute('aria-expanded', 'false');
    expect(mostrar).toHaveAttribute('aria-controls', 'sidebar-camaras-registradas');
    expect(within(sidebar).queryByRole('button', { name: /Garita entrada/ })).not.toBeInTheDocument();
    mostrar.focus();
    expect(mostrar).toHaveFocus();
    fireEvent.click(mostrar);
    await within(sidebar).findByRole('button', { name: /Garita entrada/ });
    const ocultar = within(sidebar).getByRole('button', { name: 'Ocultar cámaras registradas' });
    expect(ocultar).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('sidebar-camaras-registradas')).toBeInTheDocument();
    expect(screen.getByTestId('ruta-sidebar')).toHaveTextContent(/^\/$/);
    expect(localStorage.getItem('anpr_sidebar_camaras_abiertas')).toBe('1');
    fireEvent.click(ocultar);
    expect(within(sidebar).queryByRole('button', { name: /Garita entrada/ })).not.toBeInTheDocument();
    expect(localStorage.getItem('anpr_sidebar_camaras_abiertas')).toBe('0');
  });

  it('conserva el enlace a Registro de cámaras y lo despliega al pulsar su nombre', async () => {
    const sidebar = abrir();
    fireEvent.click(within(sidebar).getByRole('link', { name: 'REGISTRO DE CÁMARAS' }));
    await waitFor(() => expect(screen.getByTestId('ruta-sidebar')).toHaveTextContent('/camaras'));
    expect(await within(sidebar).findByRole('button', { name: /Garita entrada/ })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: 'Ocultar cámaras registradas' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('mantiene los nombres de las cámaras y su arrastre a la cuadrícula cuando está desplegado', async () => {
    localStorage.setItem('anpr_sidebar_camaras_abiertas', '1');
    const sidebar = abrir();
    const entrada = await within(sidebar).findByRole('button', { name: /Garita entrada/ });
    expect(entrada).toHaveTextContent('Garita entrada');
    expect(entrada).toHaveAttribute('draggable', 'true');
    expect(within(sidebar).getByRole('button', { name: /Garita salida/ })).toHaveAttribute('draggable', 'false');
    const dataTransfer = { setData: vi.fn(), effectAllowed: 'none' };
    fireEvent.dragStart(entrada, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith('application/x-anpr-camera', '7');
    expect(dataTransfer.effectAllowed).toBe('copy');
    fireEvent.click(entrada);
    expect(screen.getByTestId('ruta-sidebar')).toHaveTextContent('/monitoreo');
  });

  it('el menú móvil conserva las cámaras desplegadas aunque el escritorio estuviera contraído', async () => {
    localStorage.setItem('anpr_sidebar_camaras_abiertas', '1');
    const sidebar = abrir();
    await within(sidebar).findByRole('button', { name: /Garita entrada/ });
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Contraer menú' }));
    expect(sidebar).toHaveClass('colapsado');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
    expect(sidebar).toHaveClass('abierto-movil');
    expect(within(sidebar).getByRole('button', { name: 'Ocultar cámaras registradas' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(await within(sidebar).findByRole('button', { name: /Garita entrada/ }));
    expect(screen.getByTestId('ruta-sidebar')).toHaveTextContent('/monitoreo');
    expect(sidebar).not.toHaveClass('abierto-movil');
  });
});
