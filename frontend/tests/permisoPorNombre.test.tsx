import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { post }, mensajeError: String }));
import { CompletarPlaca, FormularioLista } from '../src/interfaz/componentes/FormularioLista';
import type { RegistroLista } from '../src/dominio/tipos';

describe('Permiso con datos mínimos', () => {
  it('presenta y envía los datos de persona de la hoja sin perder ceros en la cédula', async () => {
    post.mockResolvedValue({ data: { item: { id: 7 } } });
    render(<FormularioLista tipo="autorizados" onCerrar={() => undefined} onGuardado={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Nombres y apellidos*'), { target: { value: 'Ana Pérez' } });
    fireEvent.change(screen.getByLabelText('Cédula'), { target: { value: '0703799247' } });
    fireEvent.change(screen.getByLabelText('Institución'), { target: { value: 'ECU 911' } });
    fireEvent.change(screen.getByLabelText('Cargo'), { target: { value: 'Analista de soporte zonal' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guardar' })); });
    expect(post).toHaveBeenCalledWith('/vehiculos-autorizados', expect.objectContaining({
      cedula: '0703799247', institucion: 'ECU 911', cargo: 'Analista de soporte zonal',
    }));
  });
  it('exige confirmar identidad antes de completar una placa pendiente', async () => {
    post.mockResolvedValue({ data: {} });
    const guardado = vi.fn();
    render(<CompletarPlaca registro={{ id: 7, placa: null, propietario: 'Ana Pérez' } as RegistroLista} onCerrar={() => undefined} onGuardado={guardado} />);
    fireEvent.change(screen.getByLabelText('Placa del vehículo*'), { target: { value: 'PBA1234' } });
    const guardar = screen.getByRole('button', { name: 'Guardar placa' });
    expect(guardar).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(guardar).toBeEnabled();
    await act(async () => { fireEvent.click(guardar); });
    expect(post).toHaveBeenCalledWith('/vehiculos-autorizados/7/placa', { placa: 'PBA1234', identidad_confirmada: true });
    expect(guardado).toHaveBeenCalled();
  });
  it('permite guardar solo el nombre y muestra los demás datos como opcionales', async () => {
    post.mockResolvedValue({ data: { item: { id: 7, placa: null, propietario: 'Ana Pérez' } } });
    const guardado = vi.fn();
    render(<FormularioLista tipo="autorizados" onCerrar={() => undefined} onGuardado={guardado} />);
    const guardar = screen.getByRole('button', { name: 'Guardar' });
    expect(guardar).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Nombres y apellidos*'), { target: { value: 'Ana Pérez' } });
    expect(guardar).toBeEnabled();
    expect(screen.getByLabelText('Marca')).toBeInTheDocument();
    await act(async () => { fireEvent.click(guardar); });
    expect(post).toHaveBeenCalledWith('/vehiculos-autorizados', expect.objectContaining({ propietario: 'Ana Pérez', placa: '' }));
    expect(guardado).toHaveBeenCalledWith(expect.objectContaining({ placa: null }));
  });
});
