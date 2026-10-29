/**
 * Reportes e historial simplificados: accesos por fecha listos para imprimir, historial de un
 * vehículo por su placa y el historial completo consultado por fechas (datos ficticios).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Deteccion } from '../src/dominio/tipos';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { get }, mensajeError: String, mensajeErrorDescarga: async () => 'error', urlMedia: (r: string) => r }));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, nombre: 'Ana Supervisora' }, puede: () => true }) }));
vi.mock('../src/aplicacion/tiempoReal', () => ({ useEvento: () => undefined, useReconexion: () => undefined }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
import Reportes from '../src/interfaz/paginas/Reportes';
import HistorialCompleto from '../src/interfaz/paginas/HistorialCompleto';

const paso = (id: number, c: Partial<Deteccion> = {}) => ({
  id, placa: 'PZX1010', placa_reconocida: 'PZX1010', placa_validada: null, estado_validacion: 'autorizado', estado_procesamiento: 'procesado',
  fecha_hora_ingreso: '2026-10-28T13:00:00Z', fecha_hora_salida: null, tipo_movimiento: 'ingreso', persona_ingreso: 'Rosa Vera',
  motivo_ingreso: 'Jornada laboral', vehiculo: { tipo: 'SUV', marca: 'Kia', modelo: 'Sportage', color: 'Gris' }, autorizado: null,
  imagen_vehiculo: null, imagen_placa: null, camara: null, confianza_ocr: 0.97, validado_manualmente: false, ...c,
}) as unknown as Deteccion;

beforeEach(() => { get.mockReset(); });

it('accesos por fecha: documento con el resumen y la tabla; «No autorizados» pide no registrados y lista negra', async () => {
  get.mockImplementation(async (_ruta: string, opciones: { params: Record<string, unknown> }) => ({ data: {
    items: opciones.params.estado ? [paso(2, { estado_validacion: 'no_reconocido', placa: 'PZX2020' })] : [paso(1), paso(2, { estado_validacion: 'no_reconocido', placa: 'PZX2020' })],
    total: opciones.params.estado ? 1 : 2, pagina: 1, tamano: 100,
  } }));
  render(<MemoryRouter><Reportes /></MemoryRouter>);
  const informe = await screen.findByRole('article', { name: 'Reporte de accesos vehiculares' });
  await within(informe).findByText('PZX-2020');
  expect(within(informe).getByText('PZX-1010')).toBeInTheDocument();
  expect(within(informe).getByText('Ana Supervisora', { exact: false })).toBeInTheDocument();
  expect(within(informe).getByText('Elaborado por')).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith('/detecciones', { params: expect.objectContaining({ movimiento: 'ingreso', orden: 'antiguo', estado: undefined }) });

  fireEvent.click(screen.getByRole('tab', { name: 'No autorizados' }));
  await screen.findByRole('article', { name: 'Reporte de accesos no autorizados' });
  expect(get).toHaveBeenLastCalledWith('/detecciones', { params: expect.objectContaining({ estado: 'no_reconocido,alerta' }) });
});

it('historial de un vehículo: exige una placa válida y muestra su situación y sus ingresos', async () => {
  get.mockImplementation(async (ruta: string) => ({ data: ruta.startsWith('/detecciones/buscar-placa/')
    ? { placa: 'PZX1010', estado: 'autorizado', autorizado: { propietario: 'Rosa Vera', cedula: '0912345678', marca: 'Kia', fecha_vencimiento: null }, ultimos_ingresos: [] }
    : { items: [paso(1), paso(3, { placa: 'PZX10109' })], total: 2, pagina: 1, tamano: 100 } }));
  render(<MemoryRouter><Reportes /></MemoryRouter>);
  fireEvent.click(screen.getByRole('tab', { name: /Historial de un vehículo/ }));
  fireEvent.change(screen.getByLabelText('Placa del vehículo'), { target: { value: 'PZX' } });
  fireEvent.click(screen.getByRole('button', { name: /Consultar/ }));
  expect(screen.getByText(/Placa inválida/)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Placa del vehículo'), { target: { value: 'pzx-1010' } });
  fireEvent.click(screen.getByRole('button', { name: /Consultar/ }));
  const informe = await screen.findByRole('article', { name: 'Historial del vehículo PZX-1010' });
  expect(within(informe).getByText('Autorizado en la lista blanca')).toBeInTheDocument();
  expect(within(informe).getByText('0912345678')).toBeInTheDocument();
  // La búsqueda por placa es parcial: solo cuentan los ingresos de esa placa exacta
  expect(within(informe).getAllByRole('row')).toHaveLength(2);
});

it('historial completo: por omisión consulta el día de hoy y el estado «No autorizados» filtra en la API', async () => {
  get.mockResolvedValue({ data: { items: [paso(1)], total: 1, pagina: 1, tamano: 50 } });
  render(<MemoryRouter initialEntries={['/historial']}><HistorialCompleto /></MemoryRouter>);
  await screen.findByText('Rosa Vera');
  const primera = get.mock.calls[0][1].params;
  expect(primera.desde).toBeTruthy();
  expect(primera.hasta).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Hoy' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'no_autorizados' } });
  await waitFor(() => expect(get).toHaveBeenLastCalledWith('/detecciones', { params: expect.objectContaining({ estado: 'no_reconocido,alerta' }) }));
  fireEvent.click(screen.getByRole('button', { name: 'Todo' }));
  await waitFor(() => expect(get).toHaveBeenLastCalledWith('/detecciones', { params: expect.objectContaining({ desde: undefined, hasta: undefined }) }));
});
