import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { post, get } = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { post, get }, mensajeError: (e: Error) => e.message }));
import { CampoPlaca } from '../src/interfaz/componentes/campos';
import { CamposVehiculoPermiso } from '../src/interfaz/componentes/CamposVehiculoPermiso';
const Formulario = ({ obligatorio = false }: { obligatorio?: boolean }) => {
  const [placa, setPlaca] = useState('');
  const [valor, setValor] = useState({ marca: '', modelo: '', color: '', tipo_vehiculo: '' });
  return <><CampoPlaca id="placa" etiqueta="Placa" valor={placa} onCambiar={setPlaca} />
    <CamposVehiculoPermiso prefijo="test" valor={valor} onCambiar={(k, v) => setValor(x => ({ ...x, [k]: v }))} obligatorio={obligatorio} /></>;
};
beforeEach(() => { vi.useFakeTimers(); post.mockReset(); get.mockReset(); });
afterEach(() => vi.useRealTimers());

it('no consulta al proveedor cuando se completa o cambia una placa válida', async () => {
  render(<Formulario />);
  fireEvent.change(screen.getByLabelText('Placa'), { target: { value: 'ABC1234' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  fireEvent.change(screen.getByLabelText('Placa'), { target: { value: 'PBA5678' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.queryByRole('button', { name: /consultar|revisar estado/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/consulta automática|saldo del proveedor/i)).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
});

it('permite llenar marca y modelo directamente y los conserva al corregir la placa', async () => {
  render(<Formulario />);
  fireEvent.change(screen.getByLabelText('Marca'), { target: { value: 'Toyota' } });
  fireEvent.change(screen.getByLabelText('Modelo'), { target: { value: 'Corolla' } });
  fireEvent.change(screen.getByLabelText('Tipo de vehículo'), { target: { value: 'Automóvil' } });
  fireEvent.change(screen.getByLabelText('Color'), { target: { value: 'blanco' } });
  fireEvent.change(screen.getByLabelText('Placa'), { target: { value: 'ABC1234' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByLabelText('Marca')).toHaveValue('Toyota');
  expect(screen.getByLabelText('Modelo')).toHaveValue('Corolla');
  expect(screen.getByLabelText('Tipo de vehículo')).toHaveValue('Automóvil');
  expect(screen.getByLabelText('Color')).toHaveValue('blanco');
  expect(post).not.toHaveBeenCalled();
});

it('mantiene los datos del vehículo obligatorios al validar un ingreso', () => {
  render(<Formulario obligatorio />);
  for (const nombre of ['Tipo de vehículo*', 'Marca*', 'Modelo*', 'Color*']) {
    expect(screen.getByLabelText(nombre)).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText(nombre)).toBeEnabled();
  }
  expect(screen.queryByRole('button', { name: /consultar/i })).not.toBeInTheDocument();
});
