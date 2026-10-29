import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import type { Deteccion } from '../src/dominio/tipos';
vi.mock('../src/infraestructura/api', () => ({ default: {}, mensajeError: String, urlMedia: (r: string) => r }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
import { TarjetaDeteccion } from '../src/interfaz/componentes/deteccion';
import { RestringirVehiculoModal } from '../src/interfaz/componentes/RestringirVehiculoModal';
const paso = { id: 9, placa: 'ABC1234', estado_validacion: 'no_reconocido', estado_procesamiento: 'procesado', fecha_hora_ingreso: '2026-10-24T15:00:00Z', imagen_vehiculo: '/media/auto.jpg', imagen_placa: null, confianza_ocr: null, confianza_deteccion: null, vehiculo: { marca: 'Mazda', modelo: 'CX-5', tipo: 'SUV', color: 'rojo' }, camara: null } as Deteccion;
it.each(['no_reconocido', 'pendiente_revision'] as const)('ofrece Autorizar y Restringir en %s sin navegar al tocar los botones', estado_validacion => {
  const validar = vi.fn(), restringir = vi.fn();
  const d = { ...paso, estado_validacion };
  render(<MemoryRouter><TarjetaDeteccion d={d} onValidar={validar} onRestringir={restringir} /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Autorizar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Restringir' }));
  expect(validar).toHaveBeenCalledWith(d);
  expect(restringir).toHaveBeenCalledWith(d);
});
it('la placa ilegible permite abrir el formulario y confirmarla mirando la foto', () => {
  render(<MemoryRouter><RestringirVehiculoModal d={{ ...paso, placa: null, estado_procesamiento: 'no_legible' }} onCerrar={vi.fn()} /></MemoryRouter>);
  expect(screen.getByAltText('Vehículo del permiso')).toHaveStyle({ objectFit: 'contain' });
  expect(screen.getByLabelText('Marca')).toHaveValue('Mazda');
  expect(screen.getByLabelText('Placa*')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Ampliar foto del vehículo' }));
  expect(screen.getByRole('dialog', { name: 'Evidencia de ingreso sin lectura' })).toBeInTheDocument();
});
it('los autorizados no muestran estas acciones de revisión', () => {
  render(<MemoryRouter><TarjetaDeteccion d={{ ...paso, estado_validacion: 'autorizado' }} onValidar={vi.fn()} onRestringir={vi.fn()} /></MemoryRouter>);
  expect(screen.queryByRole('button', { name: 'Autorizar' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Restringir' })).not.toBeInTheDocument();
});
