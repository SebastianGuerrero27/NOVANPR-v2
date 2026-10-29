import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deteccion, Franja } from '../src/dominio/tipos';

const { get, post, put } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { get, post, put }, mensajeError: String,
  urlMedia: (ruta: string | null) => ruta }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
import { FormularioLista } from '../src/interfaz/componentes/FormularioLista';

const deteccion = (cambios: Partial<Deteccion> = {}): Deteccion => ({
  id: 9, placa: 'PBA1234', placa_reconocida: 'PBA1234', placa_validada: null,
  estado_validacion: 'no_reconocido', estado_procesamiento: 'procesado',
  confianza_deteccion: 0.95, confianza_ocr: 0.98, fecha_hora_ingreso: '2026-10-26T15:00:00Z',
  tipo_movimiento: 'ingreso', fecha_hora_procesamiento: null, fuente: 'manual', tracking_id: null,
  imagen_vehiculo: '/media/auto.jpg', imagen_placa: '/media/placa.jpg', camara: null,
  tipo_vehiculo: 'SUV', vehiculo: { tipo: 'SUV', marca: 'Mazda', modelo: 'CX-5', color: 'rojo' },
  verificacion_vehiculo: null, verificacion_detalle: null, alerta: null, autorizado: null,
  validado_manualmente: false, validacion: null, ...cambios,
});

const horario: Franja[] = [{ dias: [1, 2, 3, 4, 5], desde: '08:00', hasta: '17:00' }];
const inicial = {
  placa: 'PBA1234', motivo: 'Restricción temporal de seguridad', nivel_alerta: 'CRITICA',
  tipo_vehiculo: 'SUV', marca: 'Mazda', modelo: 'CX-5', color: 'rojo',
  fecha_inicio: '2026-10-26', fecha_vencimiento: '2026-11-30', horario,
  observaciones: 'Documento revisado en la garita',
};

const mostrar = (d: Deteccion | undefined = deteccion(), valores: Record<string, unknown> = inicial, onGuardado = vi.fn()) =>
  render(<MemoryRouter><FormularioLista tipo="alertas" deteccion={d} inicial={valores} onCerrar={vi.fn()} onGuardado={onGuardado} /></MemoryRouter>);

beforeEach(() => {
  get.mockReset().mockResolvedValue({ data: { ultimos_ingresos: [] } });
  post.mockReset().mockResolvedValue({ data: { item: { id: 7, placa: 'PBA1234' } } });
  put.mockReset();
});

describe('Formulario coherente para agregar una placa a la lista negra', () => {
  it('usa el modal panorámico y conserva bloques separados para alerta, vehículo y condiciones', () => {
    mostrar();
    const modal = screen.getByRole('dialog', { name: 'Agregar placa a la lista negra' });
    expect(modal).toHaveClass('panoramico');
    expect(modal.querySelector('.formulario-lista-negra')).toHaveClass('formulario-permiso', 'panoramico');
    expect(within(modal).getByRole('group', { name: 'Identificación de la alerta' })).toBeInTheDocument();
    expect(within(modal).getByRole('group', { name: 'Datos del vehículo' })).toBeInTheDocument();
    expect(modal.querySelector('.permiso-condiciones')).toBeInTheDocument();
    expect(within(modal).getByLabelText('Placa*')).toHaveValue('PBA-1234');
    expect(within(modal).getByLabelText('Nivel de alerta*')).toHaveValue('CRITICA');
  });

  it('muestra una foto del vehículo y el recorte real de placa, con ampliación de la evidencia', () => {
    mostrar();
    const modal = screen.getByRole('dialog', { name: 'Agregar placa a la lista negra' });
    const auto = within(modal).getAllByAltText('Vehículo del permiso');
    const placa = within(modal).getByAltText('Placa recortada del ingreso');
    expect(auto).toHaveLength(1);
    expect(auto[0]).toHaveAttribute('src', '/media/auto.jpg');
    expect(placa).toHaveAttribute('src', '/media/placa.jpg');
    expect(auto[0]).toHaveStyle({ objectFit: 'contain' });
    expect(placa).toHaveStyle({ objectFit: 'contain' });
    fireEvent.click(within(modal).getByRole('button', { name: 'Ampliar foto de la placa' }));
    expect(screen.getByRole('dialog', { name: 'Evidencia de PBA1234' })).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('guarda los datos de la restricción, vehículo, vigencia y horario sin perder valores precargados', async () => {
    const guardado = vi.fn();
    mostrar(deteccion(), inicial, guardado);
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/blacklist', inicial));
    await waitFor(() => expect(guardado).toHaveBeenCalledWith({ id: 7, placa: 'PBA1234' }));
    expect(put).not.toHaveBeenCalled();
  });

  it('mantiene bloqueado Guardar hasta confirmar una placa y un motivo válidos', () => {
    render(<MemoryRouter><FormularioLista tipo="alertas" onCerrar={vi.fn()} onGuardado={vi.fn()} /></MemoryRouter>);
    const guardar = screen.getByRole('button', { name: 'Guardar' });
    expect(guardar).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Motivo*'), { target: { value: 'Control de seguridad' } });
    expect(guardar).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Placa*'), { target: { value: 'PBA1234' } });
    expect(guardar).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Motivo*'), { target: { value: 'abc' } });
    expect(guardar).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('no utiliza la foto completa del auto como si fuera un recorte de placa', () => {
    mostrar(deteccion({ imagen_placa: '/media/auto.jpg' }));
    expect(screen.getAllByAltText('Vehículo del permiso')).toHaveLength(1);
    expect(screen.queryByAltText('Placa recortada del ingreso')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ampliar foto de la placa' })).toBeDisabled();
  });
});
