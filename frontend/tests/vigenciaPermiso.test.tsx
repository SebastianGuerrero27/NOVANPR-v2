import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const { post, get } = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { post, get }, mensajeError: (e: Error) => e.message }));
import { FormularioLista } from '../src/interfaz/componentes/FormularioLista';
import { fechaIsoLocal } from '../src/dominio/formato';
beforeEach(() => { post.mockReset(); get.mockReset(); });
const montar = () => render(<FormularioLista tipo="autorizados" onCerrar={vi.fn()} onGuardado={vi.fn()} />);
it('quita categoría y permite seleccionar vigencia de hoy con un clic', () => {
  montar(); expect(screen.queryByLabelText('Categoría del permiso')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Solo hoy' }));
  expect(screen.getByLabelText('Vigente desde')).toHaveValue(fechaIsoLocal());
  expect(screen.getByLabelText('Vigente hasta')).toHaveValue(fechaIsoLocal());
  expect(screen.getByRole('checkbox', { name: 'Sin fecha de vencimiento' })).not.toBeChecked();
});
it('siete días son inclusivos y permite volver a sin vencimiento', () => {
  montar(); fireEvent.click(screen.getByRole('button', { name: '7 días' }));
  const inicio = (screen.getByLabelText('Vigente desde') as HTMLInputElement).value;
  const fin = (screen.getByLabelText('Vigente hasta') as HTMLInputElement).value;
  expect((new Date(fin).getTime() - new Date(inicio).getTime()) / 86400000).toBe(6);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Sin fecha de vencimiento' }));
  expect(screen.getByLabelText('Vigente hasta')).toHaveValue('');
});
it('permite completar los datos del vehículo sin consulta externa y conserva al responsable', () => {
  montar();
  fireEvent.change(screen.getByLabelText('Nombres y apellidos*'), { target: { value: 'Ana Pérez' } });
  fireEvent.change(screen.getByLabelText('Placa (opcional)'), { target: { value: 'ABC1234' } });
  fireEvent.change(screen.getByLabelText('Marca'), { target: { value: 'TOYOTA' } });
  fireEvent.change(screen.getByLabelText('Modelo'), { target: { value: 'COROLLA' } });
  expect(screen.queryByRole('button', { name: /consultar datos|usar estos datos|completar nombre/i })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Marca')).toHaveValue('TOYOTA');
  expect(screen.getByLabelText('Modelo')).toHaveValue('COROLLA');
  expect(screen.getByLabelText('Nombres y apellidos*')).toHaveValue('Ana Pérez');
  expect(get).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});
