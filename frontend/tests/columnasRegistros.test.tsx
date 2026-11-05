import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deteccion } from '../src/dominio/tipos';

const { get, patch, borrar, sesion } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), borrar: vi.fn(), sesion: { editable: true, eliminar: false } }));
vi.mock('../src/infraestructura/api', () => ({ default: { get, patch, delete: borrar }, mensajeError: String,
  mensajeErrorDescarga: async () => 'Error', urlMedia: (ruta: string | null) => ruta }));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, nombre: 'Personal de prueba' },
  puede: (permiso: string) => permiso === 'alertas:gestionar' || (permiso === 'detecciones:validar' && sesion.editable) || (permiso === 'detecciones:eliminar-individual' && sesion.eliminar) }) }));
vi.mock('../src/aplicacion/tiempoReal', () => ({ useEvento: () => undefined, useReconexion: () => undefined }));
vi.mock('../src/aplicacion/notificaciones', () => ({ useCentroNotificaciones: () => ({ items: [], cargando: false }) }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
import Inicio from '../src/interfaz/paginas/Inicio';
import Detecciones from '../src/interfaz/paginas/Detecciones';

const ingreso: Deteccion = {
  id: 15, placa: 'PBA1234', placa_reconocida: 'PBA1234', placa_validada: null,
  estado_validacion: 'no_reconocido', estado_procesamiento: 'procesado',
  confianza_deteccion: null, confianza_ocr: 0.975,
  fecha_hora_ingreso: '2026-10-26T15:00:00Z', fecha_hora_salida: '2026-10-26T16:00:00Z',
  tipo_movimiento: 'ingreso', fecha_hora_procesamiento: null, fuente: 'manual', tracking_id: null,
  imagen_vehiculo: null, imagen_placa: null, camara: null,
  tipo_vehiculo: 'Automóvil', vehiculo: { tipo: 'Automóvil', marca: null, modelo: null, color: 'blanco' },
  verificacion_vehiculo: null, verificacion_detalle: null, alerta: null, autorizado: null,
  validado_manualmente: false, validacion: null, persona_ingreso: 'Ana Torres', motivo_ingreso: 'Visita',
  datos_permiso: { cedula: '0123456789' },
};
const resumen = {
  hoy: { total: 0, autorizados: 0, alertas: 0, no_registrados: 0, pendientes: 0, validados: 0 },
  ayer_misma_hora: 0, cola_revision: 0, ultimas_alertas: [], listas: { alertas_vigentes: 0 },
  generado: '2026-10-26T15:00:00Z', por_hora: [], tendencia: [], camaras: [],
};

beforeEach(() => {
  sesion.editable = true;
  sesion.eliminar = false;
  patch.mockReset(); borrar.mockReset();
  get.mockReset().mockImplementation(async (ruta: string) => ({ data: ruta === '/panel/resumen' ? resumen
    : ruta === '/detecciones/recientes' ? [ingreso]
      : ruta === '/detecciones' ? { items: [ingreso], total: 1, pagina: 1, tamano: 25 } : [] }));
});

it('el permiso individual muestra la papelera y no permite eliminar todos los registros', async () => {
  sesion.eliminar = true;
  render(<MemoryRouter><Detecciones /></MemoryRouter>);
  const fila = (await screen.findByLabelText('Marca del registro 15')).closest('tr')!;
  const celdaAcciones = within(fila).getAllByRole('cell')[15];
  const botones = within(celdaAcciones).getAllByRole('button');
  expect(botones).toHaveLength(2);
  expect(botones.every(boton => boton.textContent === '')).toBe(true);
  expect(within(celdaAcciones).getByRole('button', { name: 'Eliminar registro' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Eliminar todos' })).not.toBeInTheDocument();
  fireEvent.click(within(celdaAcciones).getByRole('button', { name: 'Editar registro' }));
  expect(screen.getByRole('dialog', { name: 'Autorizar ingreso' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
  expect(screen.queryByRole('dialog', { name: 'Autorizar ingreso' })).not.toBeInTheDocument();
  borrar.mockImplementationOnce(async () => {
    get.mockImplementation(async (ruta: string) => ({ data: ruta === '/detecciones' ? { items: [], total: 0, pagina: 1, tamano: 25 } : [] }));
    return { data: { message: 'Registro eliminado.' } };
  });
  fireEvent.click(within(celdaAcciones).getByRole('button', { name: 'Eliminar registro' }));
  const dialogo = screen.getByRole('dialog', { name: 'Eliminar registro' });
  expect(borrar).not.toHaveBeenCalled();
  fireEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }));
  await waitFor(() => expect(borrar).toHaveBeenCalledWith('/detecciones/15', { data: { motivo: 'Falso positivo (no corresponde a un vehículo)' } }));
  await waitFor(() => expect(screen.queryByLabelText('Marca del registro 15')).not.toBeInTheDocument());
});

describe.each([['Inicio', Inicio], ['Registros', Detecciones]] as const)('Cuadrícula de %s', (_nombre, Pagina) => {
  it('presenta marca y modelo vacíos como inputs editables y guarda la marca al salir', async () => {
    patch.mockResolvedValue({ data: { deteccion: { ...ingreso, vehiculo: { ...ingreso.vehiculo, marca: 'Mazda' } } } });
    render(<MemoryRouter><Pagina /></MemoryRouter>);
    const marca = await screen.findByLabelText('Marca del registro 15');
    const modelo = screen.getByLabelText('Modelo del registro 15');
    expect(marca).toHaveValue('');
    expect(modelo).toHaveValue('');
    expect(marca).not.toHaveAttribute('readonly');
    expect(modelo).not.toHaveAttribute('readonly');
    const fila = marca.closest('tr')!;
    const cabeceras = within(marca.closest('table')!).getAllByRole('columnheader').map(celda => celda.textContent);
    expect(cabeceras.slice(0, 5)).toEqual(['N.º', 'Cédula', 'Titular', 'Placa', 'Motivo']);
    expect(cabeceras).toContain('Vehículo');
    expect(cabeceras).toContain('Confianza');
    expect(cabeceras).not.toContain('Validación');
    const celdas = within(fila).getAllByRole('cell');
    expect(celdas[3]).not.toHaveTextContent(/OCR|%/);
    expect(celdas[13]).toHaveTextContent(/97\.5\s*%/);
    fireEvent.change(marca, { target: { value: 'Mazda' } });
    fireEvent.blur(marca);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/detecciones/15/ingreso', { marca: 'Mazda' }));
    expect(marca).toHaveValue('Mazda');
  });

  it('mantiene los inputs visibles si la sesión solo puede consultar', async () => {
    sesion.editable = false;
    render(<MemoryRouter><Pagina /></MemoryRouter>);
    expect(await screen.findByLabelText('Marca del registro 15')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Modelo del registro 15')).toHaveAttribute('readonly');
    expect(patch).not.toHaveBeenCalled();
  });
});

describe.each([['Inicio', Inicio], ['Registros', Detecciones]] as const)('Paso de la cámara de salida en %s', (_nombre, Pagina) => {
  it('su hora va en «Hora de salida» y no en «Hora de entrada»', async () => {
    const salida: Deteccion = { ...ingreso, id: 16, tipo_movimiento: 'salida', fecha_hora_ingreso: '2026-10-26T17:30:00Z', fecha_hora_salida: null };
    get.mockImplementation(async (ruta: string) => ({ data: ruta === '/panel/resumen' ? resumen
      : ruta === '/detecciones/recientes' ? [salida]
        : ruta === '/detecciones' ? { items: [salida], total: 1, pagina: 1, tamano: 25 } : [] }));
    render(<MemoryRouter><Pagina /></MemoryRouter>);
    const fila = (await screen.findByLabelText('Marca del registro 16')).closest('tr')!;
    const cabeceras = within(fila.closest('table')!).getAllByRole('columnheader').map(celda => celda.textContent);
    const celdas = within(fila).getAllByRole('cell');
    const hora = new Intl.DateTimeFormat('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(salida.fecha_hora_ingreso));
    expect(celdas[cabeceras.indexOf('Hora de entrada')]).toHaveTextContent(/^—$/);
    expect(celdas[cabeceras.indexOf('Hora de salida')].textContent).toContain(hora.slice(0, 5));
  });
});
