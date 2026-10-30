import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegistroLista } from '../src/dominio/tipos';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { get }, mensajeError: String, urlMedia: (ruta: string | null) => ruta }));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ puede: () => true }) }));
vi.mock('../src/aplicacion/tiempoReal', () => ({ useEvento: () => undefined, useReconexion: () => undefined }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
import { CeldaEvidenciaLista } from '../src/interfaz/componentes/EvidenciaLista';
import { FormularioLista } from '../src/interfaz/componentes/FormularioLista';
import Listas from '../src/interfaz/paginas/Listas';

const registro = (cambios: Partial<RegistroLista> = {}): RegistroLista => ({
  id: 18, placa: 'PBA1234', propietario: 'Ana Torres', marca: 'Mazda', modelo: 'CX-5', color: 'Blanco',
  observaciones: null, fecha_vencimiento: null, fecha_registro: '2026-10-28T12:00:00Z', fecha_actualizacion: null,
  registrado_por_email: null, vigente: true, por_vencer: false, ingresos: 0,
  motivo: 'Restricción de seguridad', nivel_alerta: 'ALTA',
  imagen_vehiculo: null, imagen_placa: null, ...cambios,
});
const fotos = { imagen_vehiculo: '/media/listas/auto.jpg', imagen_placa: '/media/listas/placa.jpg',
  fecha_evidencia_vehiculo: '2026-10-28T17:30:00Z', fecha_evidencia_placa: '2026-10-28T17:30:01Z' };
const celdas = (r: RegistroLista) => <table><tbody><tr><CeldaEvidenciaLista registro={r} tipo="vehiculo" /><CeldaEvidenciaLista registro={r} tipo="placa" /></tr></tbody></table>;

beforeEach(() => get.mockReset());

describe('Evidencia conservada de lista blanca y lista negra', () => {
  it('presenta ambos estados pendientes sin inventar fotos ni habilitar ampliación', () => {
    render(celdas(registro()));
    expect(screen.getByText('Vehículo aún no ha ingresado').closest('td')).not.toHaveClass('evidencia-capturada');
    expect(screen.getByText('Placa aún no ingresada').closest('td')).not.toHaveClass('evidencia-capturada');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ampliar foto/ })).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('cambia cada celda de forma independiente cuando llega la evidencia; tener auto no inventa un recorte', () => {
    const vista = render(celdas(registro()));
    vista.rerender(celdas(registro({ imagen_vehiculo: fotos.imagen_vehiculo, fecha_evidencia_vehiculo: fotos.fecha_evidencia_vehiculo })));
    expect(screen.getByText('Vehículo ingresado').closest('td')).toHaveClass('evidencia-capturada');
    expect(screen.getByText('Placa aún no ingresada').closest('td')).not.toHaveClass('evidencia-capturada');
    expect(screen.getByAltText('Foto del vehículo')).toHaveAttribute('src', fotos.imagen_vehiculo);
    expect(screen.queryByAltText('Placa recortada')).not.toBeInTheDocument();
    expect(screen.getByText(/28 oct 2026/).tagName).toBe('TIME');
    vista.rerender(celdas(registro(fotos)));
    expect(screen.getByText('Placa ingresada').closest('td')).toHaveClass('evidencia-capturada');
    expect(screen.getByAltText('Placa recortada')).toHaveAttribute('src', fotos.imagen_placa);
  });

  it('amplía las dos fotos originales y permite aumentar el zoom de la placa', () => {
    render(celdas(registro(fotos)));
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar foto de la placa PBA1234' }));
    const visor = screen.getByRole('dialog', { name: 'Evidencia de PBA1234' });
    expect(within(visor).getByAltText('Vehículo PBA1234')).toHaveAttribute('src', fotos.imagen_vehiculo);
    expect(within(visor).getByAltText('Placa PBA1234')).toHaveAttribute('src', fotos.imagen_placa);
    const placa = within(visor).getByText('Recorte de la placa').closest('section')!;
    fireEvent.click(within(placa).getByRole('button', { name: 'Ampliar' }));
    expect(within(placa).getByText('130 %')).toBeInTheDocument();
    expect(within(placa).getByAltText('Placa PBA1234')).toHaveStyle({ transform: 'translate(0px, 0px) scale(1.3)' });
    expect(get).not.toHaveBeenCalled();
  });

  it.each(['autorizados', 'alertas'] as const)('muestra los estados, fotos y zoom en la tabla de %s', async tipo => {
    get.mockResolvedValue({ data: [registro(fotos)] });
    render(<MemoryRouter><Listas tipo={tipo} incrustada soloMios={tipo === 'autorizados'} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Vehículo ingresado')).toBeInTheDocument());
    expect(screen.getByText('Placa ingresada').closest('td')).toHaveClass('evidencia-capturada');
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar foto del vehículo PBA1234' }));
    expect(screen.getByRole('dialog', { name: 'Evidencia de PBA1234' })).toBeInTheDocument();
    if (tipo === 'autorizados') expect(get).toHaveBeenCalledWith('/vehiculos-autorizados/mis-permisos', { params: { estado: 'activos' } });
    else expect(get).toHaveBeenCalledWith('/blacklist');
  });

  it.each(['autorizados', 'alertas'] as const)('conserva fotos al editar %s y Escape cierra sólo el zoom', tipo => {
    const cerrarFormulario = vi.fn();
    render(<MemoryRouter><FormularioLista tipo={tipo} registro={registro(fotos)} onCerrar={cerrarFormulario} onGuardado={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('region', { name: 'Evidencia conservada del registro' })).toBeInTheDocument();
    const ampliar = screen.getByRole('button', { name: 'Ampliar foto de la placa PBA1234' });
    ampliar.focus();
    fireEvent.click(ampliar);
    expect(screen.getByRole('dialog', { name: 'Evidencia de PBA1234' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Evidencia de PBA1234' })).not.toBeInTheDocument();
    expect(cerrarFormulario).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Ampliar foto de la placa PBA1234' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(cerrarFormulario).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
  });

  it('oculta las fotos de la placa anterior si se cambia la placa del registro antes de guardar', () => {
    render(<MemoryRouter><FormularioLista tipo="autorizados" registro={registro(fotos)} onCerrar={vi.fn()} onGuardado={vi.fn()} /></MemoryRouter>);
    expect(screen.getByAltText('Foto del vehículo')).toHaveAttribute('src', fotos.imagen_vehiculo);
    fireEvent.change(screen.getByLabelText('Placa (opcional)'), { target: { value: 'PBC5678' } });
    expect(screen.getByText('Vehículo aún no ha ingresado')).toBeInTheDocument();
    expect(screen.getByText('Placa aún no ingresada')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Placa (opcional)'), { target: { value: 'PBA-1234' } });
    expect(screen.getByAltText('Foto del vehículo')).toHaveAttribute('src', fotos.imagen_vehiculo);
  });
});
