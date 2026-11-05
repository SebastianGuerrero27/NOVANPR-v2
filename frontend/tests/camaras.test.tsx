/**
 * Página de cámaras: estados de carga, sin cámaras (con la acción de registrar), error de la API
 * y listado sin credenciales a la vista.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { get, post, eliminar } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), eliminar: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({
  default: { get, post, put: vi.fn(), delete: eliminar },
  mensajeError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import Camaras from '../src/interfaz/paginas/Camaras';

const responder = (camaras: Promise<unknown>) => {
  get.mockImplementation((ruta: string) => (ruta === '/camaras' ? camaras : Promise.resolve({ data: { en_linea: false } })));
};
const pagina = () => render(<MemoryRouter><Camaras /></MemoryRouter>);

describe('Página de cámaras', () => {
  afterEach(() => get.mockReset());

  it('mientras carga muestra un esqueleto, no una lista vacía ni datos de ejemplo', () => {
    responder(new Promise(() => undefined));
    const { container } = pagina();
    expect(container.querySelector('.esqueleto')).not.toBeNull();
    expect(screen.queryByText('Aún no hay cámaras')).toBeNull();
  });

  it('sin cámaras registradas: estado vacío con la acción de registrar', async () => {
    responder(Promise.resolve({ data: [] }));
    pagina();
    expect(await screen.findByText('Aún no hay cámaras')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Registrar cámara/ })).toHaveLength(2);
  });

  it('si la API falla muestra el error', async () => {
    responder(Promise.reject(new Error('Error al listar las cámaras.')));
    pagina();
    expect(await screen.findByText('Error al listar las cámaras.')).toBeInTheDocument();
  });

  const camara = (detecciones: unknown) => ({
    id: 3, nombre: 'Garita norte', ubicacion: 'Acceso', ip: '192.0.2.10', rtsp_url: 'rtsp://192.0.2.10/101', rtsp_url_vista: null,
    tiene_credenciales: false, activa: true, estado: 'EN_LINEA', ultimo_ping: null, tiempo_respuesta_ms: 12, mensaje_ping: null,
    created_at: '2026-10-09T10:00:00Z', detecciones, roi: null,
  });

  // '0' llegó así de la API (bigint de PostgreSQL) y dejaba el botón deshabilitado para siempre
  it.each([[0], ['0'], [undefined]])('sin detecciones (%s) se puede eliminar la cámara', async detecciones => {
    responder(Promise.resolve({ data: [camara(detecciones)] }));
    eliminar.mockResolvedValue({ data: {} });
    pagina();
    const boton = await screen.findByRole('button', { name: 'Eliminar' });
    expect(boton).toBeEnabled();
    fireEvent.click(boton);
    const dialogo = await screen.findByRole('dialog');
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(eliminar).toHaveBeenCalledWith('/camaras/3'));
    await waitFor(() => expect(screen.queryByText('Garita norte')).toBeNull());
    eliminar.mockReset();
  });

  it.each([[true, 'ok', 'SIN_CONEXION'], [false, 'error', 'EN_LINEA']])('Ping: la antena se anima y queda según el resultado (en línea: %s)', async (enLinea, clase, inicial) => {
    responder(Promise.resolve({ data: [{ ...camara(0), estado: inicial }] }));
    let responderPing: (valor: unknown) => void = () => undefined;
    post.mockImplementation(() => new Promise(resolver => { responderPing = resolver; }));
    pagina();
    const boton = await screen.findByRole('button', { name: 'Ping' });
    fireEvent.click(boton);
    expect(boton).toHaveClass('probando');
    expect(boton).toBeDisabled();
    responderPing({ data: { ping: { host: '192.0.2.10', responde: enLinea, tiempo_ms: 4, mensaje: '' }, rtsp: { en_linea: enLinea, puerto: 554, mensaje: 'x', tiempo_ms: 8, servidor: null, diagnostico: 'ok' } } });
    await waitFor(() => expect(boton).toHaveClass(clase));
    expect(boton).toBeEnabled();
    expect(post).toHaveBeenCalledWith('/camaras/3/ping');
    post.mockReset();
  });

  it('una cámara deshabilitada no se ve verde ni roja', async () => {
    responder(Promise.resolve({ data: [{ ...camara(0), activa: false, estado: 'SIN_CONEXION' }] }));
    pagina();
    expect(await screen.findByRole('button', { name: 'Ping' })).toHaveClass('reposo');
  });

  it.each([[2], ['2']])('con detecciones (%s) no se elimina y explica por qué', async detecciones => {
    responder(Promise.resolve({ data: [camara(detecciones)] }));
    pagina();
    const boton = await screen.findByRole('button', { name: 'Eliminar' });
    expect(boton).toBeDisabled();
    expect(boton).toHaveAttribute('title', 'Tiene 2 detecciones en el historial: deshabilítela en su lugar');
  });

  it('el listado muestra la URL con la contraseña enmascarada tal como la entrega la API', async () => {
    responder(Promise.resolve({ data: [{
      id: 3, nombre: 'Garita norte', ubicacion: 'Acceso vehicular norte', ip: '192.0.2.10',
      rtsp_url: 'rtsp://admin:******@192.0.2.10:554/Streaming/Channels/101', rtsp_url_vista: null, tiene_credenciales: true,
      activa: true, estado: 'EN_LINEA', ultimo_ping: null, tiempo_respuesta_ms: 12, mensaje_ping: 'Flujo de video disponible',
      created_at: '2026-10-09T10:00:00Z', detecciones: 0, roi: null,
    }] }));
    pagina();
    expect(await screen.findByText('Garita norte')).toBeInTheDocument();
    expect(screen.getByText(/admin:\*{6}@192\.0\.2\.10/)).toBeInTheDocument();
  });
});
