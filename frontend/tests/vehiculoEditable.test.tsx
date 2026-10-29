import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const { post, get } = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn().mockResolvedValue({ data: { placa: 'PBA1234', ultimos_ingresos: [] } }) }));
vi.mock('../src/infraestructura/api', () => ({ default: { post, get }, mensajeError: String, urlMedia: (ruta: string | null) => ruta }));
import { FormularioLista } from '../src/interfaz/componentes/FormularioLista';
import { FormularioSolicitud } from '../src/interfaz/componentes/FormularioSolicitud';

describe('Tipo y marca editables con sugerencias', () => {
  it.each(['autorizados', 'alertas'] as const)('guarda valores fuera del catálogo en %s', async tipo => {
    post.mockResolvedValue({ data: { item: { id: 7 } } });
    render(<FormularioLista tipo={tipo} onCerrar={() => undefined} onGuardado={() => undefined} />);
    if (tipo === 'autorizados') fireEvent.change(screen.getByLabelText('Nombres y apellidos*'), { target: { value: 'Ana Pérez' } });
    else {
      fireEvent.change(screen.getByLabelText('Placa*'), { target: { value: 'PBA1234' } });
      fireEvent.change(screen.getByLabelText('Motivo*'), { target: { value: 'Alerta de prueba' } });
    }
    const campoTipo = screen.getByRole('combobox', { name: 'Tipo de vehículo' });
    const campoMarca = screen.getByRole('combobox', { name: 'Marca' });
    expect(campoTipo).toHaveAttribute('list');
    expect(campoMarca).toHaveAttribute('list');
    fireEvent.change(campoTipo, { target: { value: 'Tractocamión' } });
    fireEvent.change(campoMarca, { target: { value: 'BYD' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guardar' })); });
    expect(post).toHaveBeenCalledWith(tipo === 'autorizados' ? '/vehiculos-autorizados' : '/blacklist', expect.objectContaining({ tipo_vehiculo: 'Tractocamión', marca: 'BYD' }));
  });

  it('conserva atributos propuestos por la cámara aunque no estén en las sugerencias', () => {
    render(<FormularioSolicitud inicial={{ tipo_vehiculo: 'Microbús', marca: 'Dongfeng' }} onCerrar={() => undefined} onEnviada={() => undefined} />);
    expect(screen.getByRole('combobox', { name: 'Tipo de vehículo' })).toHaveValue('Microbús');
    expect(screen.getByRole('combobox', { name: 'Marca' })).toHaveValue('Dongfeng');
  });
});
