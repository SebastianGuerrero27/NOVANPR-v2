import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const { get, post, login } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), login: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { get, post }, mensajeError: (_: unknown, mensaje: string) => mensaje }));
vi.mock('../src/aplicacion/AuthContext', () => ({
  useAuth: () => ({ user: null, login, motivoCierre: null }),
  ErrorAcceso: class extends Error { codigo?: string; },
}));
import Acceso from '../src/interfaz/paginas/auth/Acceso';

type Rol = 'Guardia' | 'GestorPermisos';
const estado = (verificacion: boolean | undefined) => ({
  configuracion_inicial_requerida: false, registro_habilitado: true, smtp_configurado: false,
  dominios_permitidos: ['ecu911.gob.ec'], unidad_institucional: 'ECU 911',
  ...(verificacion === undefined ? {} : { verificacion_email_requerida: verificacion }),
});

async function abrir(verificacion: boolean | undefined = false) {
  get.mockResolvedValue({ data: estado(verificacion) });
  render(<MemoryRouter initialEntries={['/registro']}><Acceso /></MemoryRouter>);
  const rol = await screen.findByRole('combobox', { name: 'Rol*' });
  return { rol, form: within(rol.closest('form')!) };
}

async function completar(rol: Rol | '' = 'Guardia', verificacion = false) {
  const vista = await abrir(verificacion);
  fireEvent.change(vista.form.getByLabelText('Nombres y apellidos completos*'), { target: { value: 'Ana Torres' } });
  fireEvent.change(vista.form.getByLabelText('Correo electrónico*'), { target: { value: 'ANA@ecu911.gob.ec' } });
  fireEvent.change(vista.form.getByLabelText('Contraseña*'), { target: { value: 'ClaveSegura#2026' } });
  fireEvent.change(vista.form.getByLabelText('Confirmar contraseña*'), { target: { value: 'ClaveSegura#2026' } });
  fireEvent.click(vista.form.getByRole('checkbox'));
  if (rol) fireEvent.change(vista.rol, { target: { value: rol } });
  return vista;
}

beforeEach(() => {
  get.mockReset(); post.mockReset(); login.mockReset();
  post.mockImplementation(async (_ruta: string, datos: { rol: Rol }) => ({ data: {
    message: 'Cuenta creada. Puede iniciar sesión.', rol: datos.rol, activo: true,
    enviado: false, verificacion_email_requerida: false,
  } }));
});

describe('Registro por rol sin depender del correo', () => {
  it('reemplaza cargo por selección explícita entre dos roles, sin opción de administrador', async () => {
    const { rol, form } = await completar('');
    expect(form.queryByLabelText(/Cargo/)).not.toBeInTheDocument();
    expect(within(rol).getAllByRole('option').map(o => (o as HTMLOptionElement).value))
      .toEqual(['', 'Guardia', 'GestorPermisos']);
    expect(within(rol).queryByRole('option', { name: /Admin/ })).not.toBeInTheDocument();
    expect(form.getByRole('button', { name: 'Crear cuenta' })).toBeDisabled();
    fireEvent.blur(rol);
    expect(form.getByText('Seleccione un rol.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it.each<Rol>(['Guardia', 'GestorPermisos'])('registra %s, permite entrar y no genera solicitudes de correo', async rol => {
    const { form } = await completar(rol);
    fireEvent.click(form.getByRole('button', { name: 'Crear cuenta' }));
    await screen.findByRole('heading', { name: 'Cuenta creada' });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/auth/registro', {
      nombre_completo: 'Ana Torres', rol, email: 'ana@ecu911.gob.ec', password: 'ClaveSegura#2026',
    });
    expect(screen.getByText(/Su cuenta está activa con el rol/)).toHaveTextContent(rol === 'Guardia' ? 'Guardia' : 'Gestor de permisos');
    expect(screen.queryByRole('button', { name: /Reenviar/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Paso obligatorio/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Verifique su correo' })).not.toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ir a iniciar sesión' }));
    expect(screen.getByRole('textbox', { name: 'Correo electrónico*' })).toHaveValue('ana@ecu911.gob.ec');
    expect(screen.getByLabelText('Contraseña*', { selector: '#login-password' })).toHaveValue('');
  });

  it('respeta la respuesta del registro aunque el estado inicial todavía anunciara verificación', async () => {
    const { form } = await completar('GestorPermisos', true);
    fireEvent.click(form.getByRole('button', { name: 'Crear cuenta' }));
    await screen.findByRole('heading', { name: 'Cuenta creada' });
    expect(screen.queryByRole('button', { name: /Reenviar/ })).not.toBeInTheDocument();
  });

  it('conserva el flujo de correo al reactivar esa política y muestra el rol elegido', async () => {
    post.mockResolvedValue({ data: { message: 'Revise su correo.', rol: 'GestorPermisos', activo: false,
      enviado: true, verificacion_email_requerida: true } });
    const { form } = await completar('GestorPermisos', true);
    fireEvent.click(form.getByRole('button', { name: 'Crear cuenta' }));
    await screen.findByRole('heading', { name: 'Verifique su correo' });
    expect(screen.getByText(/Paso obligatorio/).parentElement).toHaveTextContent('Gestor de permisos');
    expect(screen.getByRole('button', { name: /Reenviar enlace/ })).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('una política de correo activada durante el envío prevalece sobre el estado inicial', async () => {
    post.mockResolvedValue({ data: { message: 'Revise su correo.', rol: 'Guardia', activo: false,
      enviado: false, verificacion_email_requerida: true } });
    const { form } = await completar('Guardia');
    fireEvent.click(form.getByRole('button', { name: 'Crear cuenta' }));
    await screen.findByRole('heading', { name: 'Verifique su correo' });
    expect(screen.getByText(/El correo de activación aún no pudo enviarse/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reenviar enlace/ })).toBeInTheDocument();
  });

  it('si la API anterior no incluye indicador mantiene la verificación, sin afirmar activación directa', async () => {
    get.mockResolvedValue({ data: estado(undefined) });
    post.mockResolvedValue({ data: { message: 'Revise su correo.' } });
    // La apertura del formulario usa una respuesta antigua sin indicador.
    render(<MemoryRouter initialEntries={['/registro']}><Acceso /></MemoryRouter>);
    const rol = await screen.findByRole('combobox', { name: 'Rol*' });
    const form = within(rol.closest('form')!);
    fireEvent.change(form.getByLabelText('Nombres y apellidos completos*'), { target: { value: 'Ana Torres' } });
    fireEvent.change(form.getByLabelText('Correo electrónico*'), { target: { value: 'ana@ecu911.gob.ec' } });
    fireEvent.change(form.getByLabelText('Contraseña*'), { target: { value: 'ClaveSegura#2026' } });
    fireEvent.change(form.getByLabelText('Confirmar contraseña*'), { target: { value: 'ClaveSegura#2026' } });
    fireEvent.change(rol, { target: { value: 'Guardia' } });
    fireEvent.click(form.getByRole('checkbox'));
    fireEvent.click(form.getByRole('button', { name: 'Crear cuenta' }));
    await screen.findByRole('heading', { name: 'Verifique su correo' });
    expect(screen.queryByText(/Su cuenta está activa/)).not.toBeInTheDocument();
  });
});
