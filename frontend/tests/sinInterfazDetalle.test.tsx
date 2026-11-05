import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sesion, permisos } = vi.hoisted(() => {
  const permisos = new Set<string>();
  return { permisos, sesion: { user: null as Record<string, unknown> | null, loading: false, errorSesion: null,
    puede: (permiso: string) => permisos.has(permiso) } };
});
vi.mock('../src/aplicacion/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>, useAuth: () => sesion,
}));
vi.mock('../src/aplicacion/tiempoReal', () => ({ TiempoRealProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../src/aplicacion/notificaciones', () => ({ CentroNotificacionesProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ NotificacionesProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../src/interfaz/plantilla/AppLayout', () => ({ AppLayout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../src/interfaz/paginas/Monitoreo', () => ({ default: () => {
  const location = useLocation();
  return <output aria-label="Destino del registro">{location.pathname + location.search}</output>;
} }));
vi.mock('../src/interfaz/paginas/Inicio', () => ({ default: () => {
  const location = useLocation();
  return <output aria-label="Inicio permitido">{location.pathname + location.search}</output>;
} }));
vi.mock('../src/interfaz/paginas/auth/Acceso', () => ({ default: () => {
  const location = useLocation();
  return <output aria-label="Acceso requerido">{location.state?.desde}</output>;
} }));
import App from '../src/interfaz/App';

beforeEach(() => {
  permisos.clear(); sesion.user = null; sesion.loading = false;
  window.history.replaceState({}, '', '/detecciones/15');
});

describe('Enlaces anteriores a la pantalla de detalle retirada', () => {
  it.each(['Admin', 'Guardia'])('el rol %s abre el registro en monitoreo sin otra pantalla', async rol => {
    sesion.user = { id: 1, rol }; permisos.add('operacion:monitorear');
    render(<App />);
    expect(await screen.findByLabelText('Destino del registro')).toHaveTextContent('/monitoreo?registro=15');
    expect(window.location.pathname).toBe('/monitoreo');
    expect(window.location.search).toBe('?registro=15');
  });

  it('el enlace anterior mantiene la sesión obligatoria y conserva el destino para iniciar sesión', async () => {
    render(<App />);
    expect(await screen.findByLabelText('Acceso requerido')).toHaveTextContent('/detecciones/15');
    expect(window.location.pathname).toBe('/login');
    expect(screen.queryByLabelText('Destino del registro')).not.toBeInTheDocument();
  });

  it('el gestor de permisos permanece en su vista en lugar de entrar al monitoreo', async () => {
    sesion.user = { id: 2, rol: 'GestorPermisos' }; permisos.add('padron:gestionar');
    render(<App />);
    expect(await screen.findByLabelText('Inicio permitido')).toHaveTextContent('/');
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByLabelText('Destino del registro')).not.toBeInTheDocument();
  });

  it('una sesión sin permiso operativo tampoco puede usar la ruta anterior como acceso al monitoreo', async () => {
    sesion.user = { id: 3, rol: 'Guardia' };
    render(<App />);
    await screen.findByLabelText('Inicio permitido');
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByLabelText('Destino del registro')).not.toBeInTheDocument();
  });
});
