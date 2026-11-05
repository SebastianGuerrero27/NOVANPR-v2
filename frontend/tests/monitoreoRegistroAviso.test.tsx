import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../src/infraestructura/api', async original => ({ ...await original<typeof import('../src/infraestructura/api')>(), default: { get } }));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ puede: () => false }) }));
vi.mock('../src/aplicacion/tiempoReal', () => ({ useEvento: () => undefined, useReconexion: () => undefined }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
import Monitoreo from '../src/interfaz/paginas/Monitoreo';
const registro = (id: number, placa: string) => ({ id, placa, placa_reconocida: placa, estado_validacion: 'autorizado', estado_procesamiento: 'procesado', tipo_movimiento: 'ingreso',
  fecha_hora_ingreso: '2026-11-04T15:00:00Z', persona_ingreso: 'Persona de prueba', vehiculo: {}, confianza_ocr: 0.9,
  imagen_vehiculo: null, imagen_placa: null, camara: null, autorizado: null, alerta: null });
const filas = [registro(1, 'PZX1010'), registro(2, 'PZX2020')];
beforeEach(() => {
  get.mockReset(); get.mockImplementation(async (url: string) => ({ data: url === '/camaras' ? [] : url === '/monitoreo/estado' ? { en_linea: false, salida_manual: false }
    : url === '/detecciones/recientes' ? filas : url === '/detecciones/99' ? registro(99, 'PZX9090')
      : url === '/detecciones/2' ? filas[1] : { items: filas, total: 2, pagina: 1, tamano: 30 } }));
});
const Cambiar = () => { const ir = useNavigate(); return <button onClick={() => ir('/monitoreo?registro=2')}>Otro aviso</button>; };
const abrir = (url: string) => render(<MemoryRouter initialEntries={[url]}><Monitoreo /><Cambiar /></MemoryRouter>);

it('abre un registro fuera del feed en el panel sin insertarlo artificialmente en Todos los accesos', async () => {
  abrir('/monitoreo?registro=99');
  await screen.findByText(/Registro de la notificación N.º 99 seleccionado/);
  expect(screen.getByText('PZX-9090')).toBeInTheDocument();
  const tabla = screen.getByRole('region', { name: 'Tabla de accesos' });
  expect(within(tabla).queryByText('PZX-9090')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Filtrar accesos' })).toHaveValue('todos');
  expect(get).toHaveBeenCalledWith('/detecciones/99');
  fireEvent.click(screen.getByRole('button', { name: 'Otro aviso' }));
  await screen.findByText(/Registro de la notificación N.º 2 seleccionado/);
  expect(screen.queryByText('PZX-9090')).not.toBeInTheDocument();
});

it('un registro inexistente muestra el error y mantiene disponible la tabla de todos los accesos', async () => {
  const actual = get.getMockImplementation()!;
  get.mockImplementation((url: string, ...args: unknown[]) => url === '/detecciones/99'
    ? Promise.reject({ response: { status: 404, data: { error: 'Registro no encontrado.' } } }) : actual(url, ...args));
  abrir('/monitoreo?registro=99');
  await screen.findByText('Registro no encontrado.');
  await waitFor(() => expect(within(screen.getByRole('region', { name: 'Tabla de accesos' })).getByText('PZX-1010')).toBeInTheDocument());
});
