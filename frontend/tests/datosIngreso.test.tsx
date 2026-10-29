/**
 * Quién ingresa y motivo de ingreso (reporte de control vehicular de la garita): al validar un
 * ingreso se propone el titular de la lista blanca, el motivo se elige con un toque y ambos se
 * envían; una salida no los pide.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Deteccion } from '../src/dominio/tipos';

const { api, notificar } = vi.hoisted(() => ({
  api: { post: vi.fn(), patch: vi.fn(), get: vi.fn().mockResolvedValue({ data: [] }) },
  notificar: vi.fn(),
}));
vi.mock('../src/infraestructura/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/infraestructura/api')>()),
  default: api,
}));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => notificar }));
// La ventana de autorizar consulta la sesión: un guardia gestiona el padrón (agrega a la lista blanca)
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ user: { id: 3, nombre: 'Guardia' }, puede: () => true }) }));

import { ValidarModal } from '../src/interfaz/componentes/deteccion';
import { FormularioLista } from '../src/interfaz/componentes/FormularioLista';
import { FormularioSolicitud } from '../src/interfaz/componentes/FormularioSolicitud';

const paso = (cambios: Partial<Deteccion> = {}): Deteccion => ({
  id: 15, placa: 'PBA1234', placa_reconocida: 'PBA1234', placa_validada: null, estado_validacion: 'pendiente_revision',
  estado_procesamiento: 'procesado', confianza_deteccion: 0.9, confianza_ocr: 0.95, fecha_hora_ingreso: '2026-10-19T14:52:00Z',
  tipo_movimiento: 'ingreso', fecha_hora_procesamiento: null, fuente: 'rtsp', tracking_id: 4, imagen_vehiculo: null, imagen_placa: null,
  camara: null, tipo_vehiculo: null, vehiculo: { tipo: null, marca: null, modelo: null, color: null }, verificacion_vehiculo: null,
  verificacion_detalle: null, alerta: null, autorizado: { id: 2, propietario: 'Luis Torres', departamento: null }, validado_manualmente: false,
  validacion: null, ...cambios,
} as Deteccion);

const completarVehiculo = () => {
  fireEvent.change(screen.getByLabelText('Tipo de vehículo*'), { target: { value: 'Automóvil' } });
  fireEvent.change(screen.getByLabelText('Marca*'), { target: { value: 'Mazda' } });
  fireEvent.change(screen.getByLabelText('Modelo*'), { target: { value: 'CX-5' } });
  fireEvent.change(screen.getByLabelText('Color*'), { target: { value: 'Blanco' } });
};

describe('Quién ingresa y motivo de ingreso', () => {
  afterEach(() => vi.clearAllMocks());

  it('al validar un ingreso propone el titular, el motivo se elige con un toque y ambos se envían', async () => {
    api.post.mockResolvedValue({ data: { deteccion: paso({ estado_validacion: 'autorizado' }) } });
    render(<MemoryRouter><ValidarModal d={paso()} onCerrar={() => undefined} /></MemoryRouter>);
    expect(screen.getByLabelText('Nombres y apellidos*')).toHaveValue('Luis Torres');
    completarVehiculo();
    fireEvent.click(screen.getByRole('button', { name: 'Recorrido del ECU 911' }));
    expect(screen.getByLabelText('Motivo de ingreso')).toHaveValue('Recorrido del ECU 911');
    fireEvent.click(screen.getByRole('button', { name: /Confirmar placa/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/detecciones/validar/15', expect.objectContaining({
      placa_validada: 'PBA1234', persona_ingreso: 'Luis Torres', motivo_ingreso: 'Recorrido del ECU 911',
    })));
  });

  it('una salida no pide quién ingresa ni el motivo', () => {
    render(<MemoryRouter><ValidarModal d={paso({ tipo_movimiento: 'salida' })} onCerrar={() => undefined} /></MemoryRouter>);
    expect(screen.queryByLabelText('Nombres y apellidos de quien ingresa')).toBeNull();
    expect(screen.queryByLabelText('Motivo de ingreso')).toBeNull();
    expect(screen.getByRole('button', { name: 'Registrar salida' })).toBeEnabled();
    expect(screen.queryByRole('group', { name: 'Datos del vehículo' })).not.toBeInTheDocument();
  });

  it('agrupa la placa con el vehículo y exige completar sus datos antes de confirmar el ingreso', () => {
    render(<MemoryRouter><ValidarModal d={paso()} onCerrar={vi.fn()} /></MemoryRouter>);
    const grupo = screen.getByRole('group', { name: 'Datos del vehículo' });
    expect(within(grupo).getByLabelText('Placa*')).toHaveAttribute('aria-required', 'true');
    expect(screen.queryByText('Datos del vehículo (opcionales)')).not.toBeInTheDocument();
    const confirmar = screen.getByRole('button', { name: 'Confirmar placa' });
    fireEvent.click(screen.getByRole('button', { name: 'Visita' }));
    expect(confirmar).toBeDisabled();
    const campos = [['Tipo de vehículo*', 'Automóvil'], ['Marca*', 'Mazda'], ['Modelo*', 'CX-5'], ['Color*', 'Blanco']];
    for (const [etiqueta, valor] of campos) {
      const campo = within(grupo).getByLabelText(etiqueta);
      expect(campo).toHaveAttribute('aria-required', 'true');
      fireEvent.change(campo, { target: { value: valor } });
      if (etiqueta !== 'Color*') expect(confirmar).toBeDisabled();
    }
    expect(confirmar).toBeEnabled();
    for (const [etiqueta, valor] of campos) {
      const campo = within(grupo).getByLabelText(etiqueta);
      fireEvent.change(campo, { target: { value: '' } });
      expect(confirmar).toBeDisabled();
      fireEvent.change(campo, { target: { value: valor } });
      expect(confirmar).toBeEnabled();
    }
    fireEvent.change(within(grupo).getByLabelText('Placa*'), { target: { value: '' } });
    expect(confirmar).toBeDisabled();
  });
  it('muestra la foto del permiso y guarda la marca y el modelo revisados en la validación', async () => {
    const d = paso({ imagen_vehiculo: '/media/vehiculo.jpg' });
    const permiso = render(<FormularioLista tipo="autorizados" deteccion={d} onCerrar={vi.fn()} onGuardado={vi.fn()} />);
    expect(screen.getByAltText('Vehículo del permiso')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ampliar foto del vehículo' })).toBeEnabled();
    permiso.unmount();
    const solicitud = render(<FormularioSolicitud deteccion={d} inicial={{ placa: d.placa, deteccion_id: d.id }} onCerrar={vi.fn()} onEnviada={vi.fn()} />);
    expect(screen.getByAltText('Vehículo del permiso')).toHaveStyle({ objectFit: 'contain' });
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar foto del vehículo' }));
    expect(screen.getByRole('dialog', { name: `Evidencia de ${d.placa}` })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Cerrar \(Esc\)/ }));
    expect(screen.getByLabelText('Modelo')).toBeInTheDocument();
    solicitud.unmount();
    api.post.mockResolvedValue({ data: { deteccion: paso({ estado_validacion: 'autorizado' }) } });
    render(<MemoryRouter><ValidarModal d={d} onCerrar={vi.fn()} /></MemoryRouter>);
    expect(screen.getByAltText('Vehículo del permiso')).toHaveStyle({ objectFit: 'contain' });
    completarVehiculo();
    fireEvent.change(screen.getByLabelText('Cédula'), { target: { value: '0123456789' } });
    fireEvent.change(screen.getByLabelText('Institución'), { target: { value: 'ECU 911' } });
    fireEvent.change(screen.getByLabelText('Cargo'), { target: { value: 'Analista' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar placa/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/detecciones/validar/15', expect.objectContaining({ marca: 'Mazda', modelo: 'CX-5', datos_permiso: expect.objectContaining({ cedula: '0123456789', institucion: 'ECU 911', cargo: 'Analista' }) })));
  });
});
