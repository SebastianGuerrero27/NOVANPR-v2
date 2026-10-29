import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import type { Deteccion } from '../src/dominio/tipos';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { get }, mensajeError: String, urlMedia: (v: string) => v }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
import { TablaIngresosRecientes } from '../src/interfaz/paginas/Monitoreo';

it('permite avanzar después de los primeros 30 accesos y consultar los autorizados sin salida', async () => {
  const seleccionar = vi.fn();
  get.mockImplementation(async (_ruta, { params }) => ({ data: {
    items: [{ id: params.pagina === 2 ? 31 : 1, placa: params.pagina === 2 ? 'ABC0031' : 'ABC0001',
      estado_validacion: 'autorizado', estado_procesamiento: 'procesado', vehiculo: {},
      fecha_hora_ingreso: '2026-10-24T15:00:00Z', fecha_hora_salida: null,
      imagen_placa: null, imagen_vehiculo: null, autorizado: null, camara: null }],
    total: params.estado ? 19 : 61, pagina: params.pagina, tamano: 30,
  } }));
  render(<MemoryRouter><TablaIngresosRecientes items={[] as Deteccion[]} onValidar={vi.fn()}
    puedeEditarCampos={false} seleccionada={null} onSeleccionar={seleccionar}
    registrandoSalida={null} onRegistrarSalida={vi.fn()} /></MemoryRouter>);
  await screen.findByText(/61 accesos en el historial/);
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
  await waitFor(() => expect(get).toHaveBeenLastCalledWith('/detecciones', expect.objectContaining({ params: expect.objectContaining({ pagina: 2 }) })));
  const placa = await screen.findByText(/ABC-0031|ABC0031/);
  fireEvent.click(placa.closest('tr')!);
  expect(seleccionar).toHaveBeenCalledWith(expect.objectContaining({ id: 31 }));
  fireEvent.change(screen.getByLabelText('Filtrar accesos'), { target: { value: 'dentro' } });
  await screen.findByText(/19 accesos autorizados sin salida/);
  expect(get).toHaveBeenLastCalledWith('/detecciones', expect.objectContaining({ params: expect.objectContaining({ pagina: 1, estado: 'autorizado', cerrados: 'no' }) }));
});
