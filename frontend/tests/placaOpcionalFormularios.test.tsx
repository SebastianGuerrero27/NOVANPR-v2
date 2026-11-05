import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deteccion } from '../src/dominio/tipos';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../src/infraestructura/api', async original => ({
  ...await original<typeof import('../src/infraestructura/api')>(), default: { get, post },
}));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ puede: () => false }) }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
import { RegistroManualModal, ValidarModal } from '../src/interfaz/componentes/deteccion';

const paso = (cambios: Partial<Deteccion> = {}): Deteccion => ({
  id: 15, placa: 'QIH6060', placa_reconocida: 'QIH6060', placa_validada: null,
  estado_validacion: 'pendiente_revision', estado_procesamiento: 'procesado', tipo_movimiento: 'ingreso',
  fecha_hora_ingreso: '2026-11-04T14:00:00Z', confianza_ocr: 0.6,
  persona_ingreso: 'Ana Torres', motivo_ingreso: 'Jornada laboral',
  tipo_vehiculo: 'Automóvil', vehiculo: { tipo: 'Automóvil', marca: 'Haval', modelo: 'H6', color: 'Blanco' },
  datos_permiso: { observaciones: 'Identificado por el guardia' },
  evidencia_lectura: { observacion_ocr: 'HAVAL / ambacar' },
  imagen_vehiculo: '/media/auto.jpg', imagen_placa: '/media/rotulo.jpg',
  autorizado: null, alerta: null, camara: null, ...cambios,
} as Deteccion);

beforeEach(() => {
  get.mockReset(); post.mockReset();
  get.mockImplementation(async (ruta: string) => ({ data: ruta === '/camaras' ? [] : ruta === '/monitoreo/estado'
    ? { salida_manual: true } : { placa: 'QIH6060', autorizado: null, alerta: null } }));
  post.mockResolvedValue({ data: { deteccion: paso({ placa: null, placa_validada: null, estado_validacion: 'autorizado' }) } });
});

const validar = (d = paso()) => render(<MemoryRouter><ValidarModal d={d} onCerrar={vi.fn()} /></MemoryRouter>);

describe('Formularios con placa opcional', () => {
  it('descarta la propuesta OCR y envía null conservando el rótulo, las fotos y las observaciones', async () => {
    const d = paso();
    validar(d);
    expect(screen.getByLabelText('Placa (opcional)')).toHaveValue('QIH-6060');
    fireEvent.click(screen.getByRole('button', { name: 'Sin placa legible' }));
    expect(screen.getByLabelText('Placa (opcional)')).toHaveValue('');
    expect(screen.getByText(/HAVAL \/ ambacar/)).toBeInTheDocument();
    expect(screen.getByAltText('Vehículo del permiso').getAttribute('src')).toMatch(/\/media\/auto\.jpg$/);
    expect(d.evidencia_lectura?.observacion_ocr).toBe('HAVAL / ambacar');
    const confirmar = screen.getByRole('button', { name: 'Confirmar ingreso sin placa' });
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/detecciones/validar/15', expect.objectContaining({
      placa_validada: null,
      datos_permiso: expect.objectContaining({ placa: null, observaciones: 'Identificado por el guardia' }),
    })));
  });

  it('un ingreso sin lectura puede confirmarse con los demás datos completos', async () => {
    validar(paso({ placa: null, placa_reconocida: null }));
    expect(screen.getByLabelText('Placa (opcional)')).not.toHaveAttribute('aria-required', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar ingreso sin placa' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/detecciones/validar/15', expect.objectContaining({ placa_validada: null })));
  });

  it('una matrícula escrita sigue exigiendo un formato válido', () => {
    validar();
    fireEvent.change(screen.getByLabelText('Placa (opcional)'), { target: { value: 'QIH' } });
    expect(screen.getByRole('button', { name: 'Confirmar placa' })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('la corrección de una salida admite placa vacía sin marcar el campo como obligatorio', async () => {
    validar(paso({ tipo_movimiento: 'salida' }));
    const placa = screen.getByLabelText('Placa confirmada (opcional)');
    fireEvent.change(placa, { target: { value: '' } });
    fireEvent.blur(placa);
    expect(placa).not.toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Registrar salida' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/detecciones/validar/15', expect.objectContaining({ placa_validada: null })));
  });

  it('el registro manual envía placa null cuando no hay matrícula legible', async () => {
    render(<MemoryRouter><RegistroManualModal onCerrar={vi.fn()} /></MemoryRouter>);
    const placa = screen.getByLabelText('Placa (opcional)');
    expect(placa).not.toHaveAttribute('aria-required', 'true');
    fireEvent.blur(placa);
    expect(placa).not.toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(screen.getByLabelText('Motivo del registro manual*'), { target: { value: 'Rótulo de concesionaria sin matrícula' } });
    fireEvent.change(screen.getByLabelText('Nombres y apellidos de quien ingresa'), { target: { value: 'Ana Torres' } });
    fireEvent.change(screen.getByLabelText('Motivo de ingreso'), { target: { value: 'Jornada laboral' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar ingreso' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/detecciones/registro-manual', expect.objectContaining({
      placa: null, persona_ingreso: 'Ana Torres', motivo_ingreso: 'Jornada laboral',
    })));
  });

  it('el registro manual no convierte una placa incompleta en null', () => {
    render(<MemoryRouter><RegistroManualModal onCerrar={vi.fn()} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Motivo del registro manual*'), { target: { value: 'Cámara fuera de servicio' } });
    fireEvent.change(screen.getByLabelText('Placa (opcional)'), { target: { value: 'PBA' } });
    expect(screen.getByRole('button', { name: 'Registrar ingreso' })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });
});
