import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { post, get } = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { post, get }, mensajeError: (e: Error) => e.message }));
import { CamposPersonaPermiso } from '../src/interfaz/componentes/CamposPersonaPermiso';
const Formulario = () => {
  const [valor, setValor] = useState({ cedula: '', propietario: '', institucion: '', cargo: '', departamento: '' });
  return <CamposPersonaPermiso prefijo="test" valor={valor} onCambiar={(k, v) => setValor(x => ({ ...x, [k]: v }))} />;
};
beforeEach(() => { vi.useFakeTimers(); post.mockReset(); get.mockReset(); });
afterEach(() => vi.useRealTimers());

it('registra la cédula y el nombre manualmente sin consultas ni botones del proveedor', async () => {
  render(<Formulario />);
  fireEvent.change(screen.getByLabelText('Cédula'), { target: { value: '0123456789' } });
  fireEvent.change(screen.getByLabelText('Nombres y apellidos*'), { target: { value: 'ANA TORRES' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByLabelText('Cédula')).toHaveValue('0123456789');
  expect(screen.getByLabelText('Nombres y apellidos*')).toHaveValue('ANA TORRES');
  expect(screen.queryByRole('button', { name: /completar nombre|consultar/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/consulta externa|consumir saldo/i)).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
});

it('conserva el nombre escrito al cambiar la cédula y sus ceros iniciales', () => {
  render(<Formulario />);
  fireEvent.change(screen.getByLabelText('Nombres y apellidos*'), { target: { value: 'ANA TORRES' } });
  fireEvent.change(screen.getByLabelText('Cédula'), { target: { value: '0012345678' } });
  expect(screen.getByLabelText('Cédula')).toHaveValue('0012345678');
  expect(screen.getByLabelText('Nombres y apellidos*')).toHaveValue('ANA TORRES');
  expect(post).not.toHaveBeenCalled();
});

it('valida los diez dígitos localmente y permite completar el resto de los datos', () => {
  render(<Formulario />);
  fireEvent.change(screen.getByLabelText('Cédula'), { target: { value: '0123' } });
  expect(screen.getByText('La cédula debe contener exactamente 10 dígitos, sin letras ni símbolos.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Institución'), { target: { value: 'ECU 911' } });
  expect(screen.getByLabelText('Institución')).toHaveValue('ECU 911');
  fireEvent.change(screen.getByLabelText('Cédula'), { target: { value: '0123456789' } });
  expect(screen.queryByText('La cédula debe contener exactamente 10 dígitos, sin letras ni símbolos.')).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
