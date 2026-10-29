import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Deteccion } from '../src/dominio/tipos';

vi.mock('../src/infraestructura/api', () => ({ default: { post: vi.fn(), get: vi.fn().mockResolvedValue({ data: { autorizado: null } }) }, mensajeError: String, urlMedia: (ruta: string | null) => ruta }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
// La ventana de autorizar consulta la sesión: un guardia gestiona el padrón (agrega a la lista blanca)
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ user: { id: 3, nombre: 'Guardia' }, puede: () => true }) }));
import { ValidarModal } from '../src/interfaz/componentes/deteccion';

const ingreso = (cambios: Partial<Deteccion> = {}): Deteccion => ({
  id: 15, placa: 'PBA1234', placa_reconocida: 'PBA1234', placa_validada: null,
  estado_validacion: 'pendiente_revision', estado_procesamiento: 'procesado',
  confianza_deteccion: 0.95, confianza_ocr: 0.98, fecha_hora_ingreso: '2026-10-26T15:00:00Z',
  tipo_movimiento: 'ingreso', fecha_hora_procesamiento: null, fuente: 'manual', tracking_id: null,
  imagen_vehiculo: '/media/vehiculo.jpg', imagen_placa: '/media/placa.jpg', camara: null,
  tipo_vehiculo: 'Automóvil', vehiculo: { tipo: 'Automóvil', marca: 'Mazda', modelo: 'CX-5', color: 'Blanco' },
  verificacion_vehiculo: null, verificacion_detalle: null, alerta: null, autorizado: null,
  validado_manualmente: false, validacion: null, persona_ingreso: 'Ana Torres', motivo_ingreso: 'Visita',
  ...cambios,
});

const mostrar = (d = ingreso()) => render(<MemoryRouter><ValidarModal d={d} onCerrar={vi.fn()} /></MemoryRouter>);

describe('Evidencia en Validar ingreso', () => {
  it('usa el formulario panorámico y muestra juntas la foto completa del vehículo y su placa recortada', () => {
    mostrar();
    const modal = screen.getByRole('dialog', { name: 'Autorizar ingreso' });
    expect(modal).toHaveClass('panoramico');
    expect(modal.querySelector('.formulario-permiso')).toHaveClass('panoramico');
    const foto = within(modal).getByAltText('Vehículo del permiso');
    const placa = within(modal).getByAltText('Placa recortada del ingreso');
    expect(foto).toHaveAttribute('src', '/media/vehiculo.jpg');
    expect(placa).toHaveAttribute('src', '/media/placa.jpg');
    expect(foto).toHaveStyle({ objectFit: 'contain' });
    expect(placa).toHaveStyle({ objectFit: 'contain' });
    expect(within(modal).getAllByAltText('Vehículo del permiso')).toHaveLength(1);
    expect(within(modal).getByRole('button', { name: 'Ampliar foto del vehículo' })).toBeEnabled();
    expect(within(modal).getByRole('button', { name: 'Ampliar foto de la placa' })).toBeEnabled();
    expect(within(modal).getByRole('button', { name: 'Confirmar placa' })).toBeEnabled();
  });

  it('permite ampliar el recorte con el visor de evidencia existente', () => {
    mostrar();
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar foto de la placa' }));
    expect(screen.getByRole('dialog', { name: 'Evidencia de PBA1234' })).toBeInTheDocument();
  });

  it('muestra la ausencia de recorte sin utilizar la foto del auto como si fuera una placa', () => {
    mostrar(ingreso({ imagen_placa: '/media/vehiculo.jpg' }));
    expect(screen.getAllByAltText('Vehículo del permiso')).toHaveLength(1);
    expect(screen.queryByAltText('Placa recortada del ingreso')).not.toBeInTheDocument();
    expect(screen.getByText('Este acceso no tiene un recorte de placa disponible.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ampliar foto de la placa' })).toBeDisabled();
  });

  it('mantiene obligatorios los datos del vehículo en el formulario ampliado', () => {
    mostrar(ingreso({ vehiculo: { tipo: 'Automóvil', marca: null, modelo: 'CX-5', color: 'Blanco' } }));
    expect(screen.getByLabelText('Marca*')).toHaveAttribute('aria-required', 'true');
    expect(screen.getByRole('button', { name: 'Confirmar placa' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Marca*'), { target: { value: 'Mazda' } });
    expect(screen.getByRole('button', { name: 'Confirmar placa' })).toBeEnabled();
  });
});
