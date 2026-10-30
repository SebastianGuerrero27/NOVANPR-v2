/**
 * Configuración › Correo saliente (SMTP): contraseña de aplicación de Google, la contraseña nunca
 * vuelve al navegador, prueba de envío y la verificación de correo que exige SMTP. Datos ficticios.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { erroresCorreo, perfilDe } from '../src/dominio/correoSaliente';

const { get, put, post } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { get, put, post, delete: vi.fn() }, mensajeError: (e: { message?: string }) => e?.message ?? String(e) }));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, nombre: 'Admin', email: 'admin@ecu911.gob.ec' }, puede: () => true }) }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
import Configuracion from '../src/interfaz/paginas/Configuracion';

const SIN_CORREO = { origen_vigente: null, cuenta_del_servidor: false, verificacion_exigida: false, guardado: null };
const GUARDADO = {
  origen_vigente: 'sistema', cuenta_del_servidor: false, verificacion_exigida: false,
  guardado: {
    servidor: 'smtp.gmail.com', puerto: 587, usuario: 'anpr.zonal3@gmail.com', remitente_nombre: 'Sistema ANPR · ECU 911', remitente_correo: null,
    habilitado: true, clave_guardada: true, clave_legible: true, actualizado_por: 'admin@ecu911.gob.ec', fecha_actualizacion: '2026-10-29T10:00:00Z', ultima_prueba: null,
  },
};
const CONFIG = {
  parametros: [
    { clave: 'registro_verificacion_email_habilitada', tipo: 'booleano', etiqueta: 'Verificación de correo en el registro', descripcion: '—', grupo: 'Acceso y cuentas', valor: 'false', origen: 'omision', actualizado_por: null, fecha_actualizacion: null },
    { clave: 'sesion_horas', tipo: 'entero', etiqueta: 'Duración de la sesión (horas)', descripcion: '—', grupo: 'Acceso y cuentas', min: 1, max: 24, valor: '8', origen: 'omision', actualizado_por: null, fecha_actualizacion: null },
    { clave: 'notif_reincidencia_umbral', tipo: 'entero', etiqueta: 'Intentos denegados que avisan a la garita', descripcion: '—', grupo: 'Notificaciones', min: 2, max: 20, valor: '3', origen: 'omision', actualizado_por: null, fecha_actualizacion: null },
  ],
  entorno: { zona_horaria: 'America/Guayaquil', correo_configurado: false, remitente_correo: null, frontend_url: 'http://localhost:3000', entorno: 'production', anpr: { en_linea: false } },
};

function montar(correo: object) {
  get.mockImplementation(async (ruta: string) => ({ data: ruta === '/configuracion/correo' ? correo : CONFIG }));
  return render(<MemoryRouter><Configuracion /></MemoryRouter>);
}

beforeEach(() => { get.mockReset(); put.mockReset(); post.mockReset(); });

describe('Correo saliente · reglas', () => {
  it('Google: 16 letras con o sin espacios; la contraseña de la cuenta se rechaza', () => {
    const f = { servidor: 'smtp.gmail.com', puerto: '587', usuario: 'anpr@gmail.com', clave: 'abcd efgh ijkl mnop', remitente_nombre: '', remitente_correo: '' };
    expect(erroresCorreo(f, false).clave).toBeNull();
    expect(erroresCorreo({ ...f, clave: 'MiClave2026!' }, false).clave).toMatch(/16 letras/);
    expect(erroresCorreo({ ...f, clave: '' }, false).clave).toMatch(/obligatorio/);
    expect(erroresCorreo({ ...f, clave: '' }, true).clave).toBeNull();
    expect(perfilDe('SMTP.GMAIL.COM')).toBe('google');
    expect(perfilDe('mail.ecu911.gob.ec')).toBe('otro');
  });
});

describe('Configuración · correo saliente', () => {
  it('alta con Gmail: guía de la contraseña de aplicación; tras guardar, la contraseña no queda en pantalla', async () => {
    put.mockResolvedValue({ data: { message: 'Correo saliente guardado.', correo: GUARDADO } });
    montar(SIN_CORREO);
    expect(await screen.findByText('Contraseña de aplicación de Google')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Contraseñas de aplicación/ })).toHaveAttribute('href', 'https://myaccount.google.com/apppasswords');
    expect(screen.getByRole('button', { name: /Enviar prueba/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Correo de la cuenta*'), { target: { value: 'anpr.zonal3@gmail.com' } });
    const clave = screen.getByLabelText('Contraseña de aplicación*');
    expect(clave).toHaveAttribute('type', 'password');
    fireEvent.change(clave, { target: { value: 'MiClaveNormal1' } });
    expect(screen.getByText(/son 16 letras/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Guardar correo/ })).toBeDisabled();
    fireEvent.change(clave, { target: { value: 'abcd efgh ijkl mnop' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar correo/ }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/configuracion/correo', expect.objectContaining({
      servidor: 'smtp.gmail.com', puerto: 587, usuario: 'anpr.zonal3@gmail.com', clave: 'abcd efgh ijkl mnop', habilitado: true,
    })));
    // Guardada: el campo queda vacío con la indicación, nunca con la contraseña
    await waitFor(() => expect(screen.getByLabelText('Contraseña de aplicación*')).toHaveValue(''));
    expect(screen.getByLabelText('Contraseña de aplicación*')).toHaveAttribute('placeholder', 'Guardada · escriba solo para cambiarla');
  });

  it('prueba: usa la cuenta guardada y muestra la explicación del servidor', async () => {
    post.mockResolvedValue({ data: { ok: false, detalle: 'El servidor rechazó la cuenta o la contraseña.', correo: GUARDADO } });
    montar(GUARDADO);
    const destino = await screen.findByLabelText('Enviar un correo de prueba a');
    expect(destino).toHaveValue('admin@ecu911.gob.ec');
    fireEvent.click(screen.getByRole('button', { name: /Enviar prueba/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/configuracion/correo/probar', { destino: 'admin@ecu911.gob.ec' }));
    expect(await screen.findByText('El servidor rechazó la cuenta o la contraseña.')).toBeInTheDocument();
  });

  it('no deja exigir la verificación de correo sin correo saliente', async () => {
    montar(SIN_CORREO);
    const interruptor = await screen.findByRole('checkbox', { name: 'Verificación de correo en el registro' });
    fireEvent.click(interruptor);
    expect(await screen.findByText(/Configure primero el correo saliente/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Guardar configuración/ })).toBeDisabled();
  });

  it('con correo saliente la verificación se guarda; el aviso de reincidencia va a la garita', async () => {
    put.mockResolvedValue({ data: { message: 'Configuración guardada.', parametros: CONFIG.parametros } });
    montar(GUARDADO);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Verificación de correo en el registro' }));
    fireEvent.click(screen.getByRole('button', { name: /Guardar configuración/ }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/configuracion', { valores: { registro_verificacion_email_habilitada: 'true' } }));
    expect(screen.getByText('Intentos denegados que avisan a la garita')).toBeInTheDocument();
  });
});
