import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deteccion } from '../src/dominio/tipos';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { get }, mensajeError: (e: Error) => e.message }));
vi.mock('../src/interfaz/componentes/FotoVehiculoPermiso', () => ({
  FotoVehiculoPermiso: ({ deteccion, incluirPlaca }: { deteccion?: Deteccion; incluirPlaca?: boolean }) => <div>
    {deteccion?.imagen_vehiculo && <img alt="Vehículo de la evidencia" src={deteccion.imagen_vehiculo} />}
    {incluirPlaca && deteccion?.imagen_placa && <img alt="Placa de la evidencia" src={deteccion.imagen_placa} />}
  </div>,
}));
import { EvidenciaListaNegra } from '../src/interfaz/componentes/EvidenciaListaNegra';

const paso = (id: number, cambios: Partial<Deteccion> = {}) => ({
  id, placa: 'PBA1234', fecha_hora_ingreso: `2026-10-${id + 20}T15:00:00Z`,
  imagen_vehiculo: `/media/auto-${id}.jpg`, imagen_placa: `/media/placa-${id}.jpg`, ...cambios,
} as Deteccion);
const respuesta = (placa: string, items: Deteccion[]) => ({ data: { placa, ultimos_ingresos: items } });
const esperarConsulta = () => act(async () => { await vi.advanceTimersByTimeAsync(350); });

beforeEach(() => { vi.useFakeTimers(); get.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('Evidencia de la lista negra', () => {
  it('usa ambas fotos del acceso seleccionado aunque se corrija su placa, sin consultar el historial', async () => {
    const vista = render(<EvidenciaListaNegra placa="PBA1234" deteccion={paso(1)} />);
    expect(screen.getByAltText('Vehículo de la evidencia')).toHaveAttribute('src', '/media/auto-1.jpg');
    expect(screen.getByAltText('Placa de la evidencia')).toHaveAttribute('src', '/media/placa-1.jpg');
    vista.rerender(<EvidenciaListaNegra placa="ABC5678" deteccion={paso(1)} />);
    await esperarConsulta();
    expect(get).not.toHaveBeenCalled();
    expect(screen.getByAltText('Vehículo de la evidencia')).toHaveAttribute('src', '/media/auto-1.jpg');
  });

  it('consulta una placa válida tras la espera y selecciona el registro más reciente que tenga imágenes', async () => {
    get.mockResolvedValue(respuesta('PBA1234', [paso(1), paso(3, { imagen_vehiculo: null, imagen_placa: null }), paso(2)]));
    render(<EvidenciaListaNegra placa="pba-1234" />);
    expect(get).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Buscando imágenes');
    await esperarConsulta();
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('/detecciones/buscar-placa/PBA1234');
    expect(screen.getByAltText('Vehículo de la evidencia')).toHaveAttribute('src', '/media/auto-2.jpg');
    expect(screen.getByAltText('Placa de la evidencia')).toHaveAttribute('src', '/media/placa-2.jpg');
  });

  it('no consulta placas incompletas ni inicia una consulta después de cerrar el formulario', async () => {
    const vista = render(<EvidenciaListaNegra placa="PBA12" />);
    await esperarConsulta();
    expect(get).not.toHaveBeenCalled();
    expect(screen.getByText('Complete la placa para buscar las imágenes registradas.')).toBeInTheDocument();
    vista.rerender(<EvidenciaListaNegra placa="PBA1234" />);
    vista.unmount();
    await esperarConsulta();
    expect(get).not.toHaveBeenCalled();
  });

  it('descarta una respuesta tardía de otra placa', async () => {
    let resolverAnterior!: (r: unknown) => void;
    get.mockImplementationOnce(() => new Promise(resolve => { resolverAnterior = resolve; }));
    get.mockResolvedValueOnce(respuesta('ABC5678', [paso(2, { placa: 'ABC5678' })]));
    const vista = render(<EvidenciaListaNegra placa="PBA1234" />);
    await esperarConsulta();
    vista.rerender(<EvidenciaListaNegra placa="ABC5678" />);
    await esperarConsulta();
    expect(screen.getByAltText('Vehículo de la evidencia')).toHaveAttribute('src', '/media/auto-2.jpg');
    await act(async () => resolverAnterior(respuesta('PBA1234', [paso(1)])));
    expect(screen.getByAltText('Vehículo de la evidencia')).toHaveAttribute('src', '/media/auto-2.jpg');
  });

  it('retira inmediatamente la evidencia anterior al cambiar de placa', async () => {
    get.mockResolvedValueOnce(respuesta('PBA1234', [paso(1)]));
    get.mockResolvedValueOnce(respuesta('ABC5678', []));
    const vista = render(<EvidenciaListaNegra placa="PBA1234" />);
    await esperarConsulta();
    expect(screen.getByAltText('Vehículo de la evidencia')).toBeInTheDocument();
    vista.rerender(<EvidenciaListaNegra placa="ABC5678" />);
    expect(screen.queryByAltText('Vehículo de la evidencia')).not.toBeInTheDocument();
    await esperarConsulta();
    expect(screen.getByText('No hay imágenes registradas para esta placa.')).toBeInTheDocument();
  });

  it('muestra un fallo de consulta sin inventar imágenes ni reintentar por sí solo', async () => {
    get.mockRejectedValue(new Error('No se pudo leer el historial'));
    render(<EvidenciaListaNegra placa="PBA1234" />);
    await esperarConsulta();
    expect(screen.getByText(/No se pudieron consultar las imágenes: No se pudo leer el historial/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    await esperarConsulta();
    expect(get).toHaveBeenCalledOnce();
  });

  it('rechaza una respuesta que no corresponde a la placa consultada', async () => {
    get.mockResolvedValue(respuesta('ABC5678', [paso(1)]));
    render(<EvidenciaListaNegra placa="PBA1234" />);
    await esperarConsulta();
    expect(screen.getByText(/La respuesta no corresponde a la placa consultada/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
