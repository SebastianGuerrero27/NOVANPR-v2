/**
 * Reportes e historial: accesos por fecha con hallazgos y gráficos, reporte de un vehículo y de una
 * persona (también abiertos desde una fila del historial completo) y el historial completo con sus
 * filtros, totales y panel de la fila elegida (datos ficticios).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AnalisisHistorial, Deteccion, ResumenHistorial } from '../src/dominio/tipos';

const { get, permisos, descargar } = vi.hoisted(() => ({ get: vi.fn(), permisos: { reportes: true }, descargar: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { get }, mensajeError: String, mensajeErrorDescarga: async () => 'error', urlMedia: (r: string | null) => r }));
vi.mock('../src/infraestructura/descargas', () => ({ descargarBlob: descargar }));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, nombre: 'Ana Supervisora' }, puede: (p: string) => p !== 'reportes:ver' || permisos.reportes }) }));
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

const resumen = (c: Partial<ResumenHistorial> = {}): ResumenHistorial => ({
  total: 3, ingresos: 3, salidas: 0, con_salida: 2, autorizados: 2, alertas: 0, no_registrados: 1, pendientes: 0, sin_lectura: 0,
  placas: 2, camara: 3, manuales: 0, primero: '2026-10-27T13:00:00Z', ultimo: '2026-11-03T13:00:00Z', ...c,
});
const horas = Array(24).fill(0);
horas[7] = 2; horas[8] = 1;
const diaHora = Array.from({ length: 7 }, () => Array(24).fill(0));
diaHora[1][7] = 2; diaHora[1][8] = 1;
const analisis: AnalisisHistorial = {
  por_dia: [
    { dia: '2026-10-27', ingresos: 2, autorizados: 1, no_registrados: 1, alertas: 0, pendientes: 0 },
    { dia: '2026-11-03', ingresos: 1, autorizados: 1, no_registrados: 0, alertas: 0, pendientes: 0 },
  ],
  por_dia_semana: [0, 3, 0, 0, 0, 0, 0], por_hora: horas, dia_hora: diaHora,
  permanencia: { n: 2, media_min: 95, mediana_min: 95, p90_min: 120 },
  frecuentes: [{ placa: 'PZX1010', ingresos: 2, ultimo: '2026-11-03T13:00:00Z', persona: 'Rosa Vera' }, { placa: 'PZX2020', ingresos: 1, ultimo: '2026-10-27T14:00:00Z', persona: null }],
  personas: [{ nombre: 'Rosa Vera', ingresos: 2, placas: 1, ultimo: '2026-11-03T13:00:00Z' }],
};

/** Respuestas de la API según la ruta (lista paginada, totales, análisis y situación de la placa). */
function api(lista: (params: Record<string, unknown>) => Deteccion[]) {
  get.mockImplementation(async (ruta: string, opciones?: { params?: Record<string, unknown> }) => {
    const params = opciones?.params ?? {};
    if (ruta === '/detecciones/historial/resumen') return { data: resumen() };
    if (ruta === '/detecciones/historial/analisis') return { data: analisis };
    if (ruta.startsWith('/detecciones/buscar-placa/')) {
      return { data: { placa: 'PZX1010', estado: 'autorizado', autorizado: { propietario: 'Rosa Vera', cedula: '0912345678', marca: 'Kia', fecha_vencimiento: null }, ultimos_ingresos: [] } };
    }
    if (ruta === '/camaras') return { data: [{ id: 4, nombre: 'Garita norte' }] };
    const items = lista(params);
    return { data: { items, total: items.length, pagina: 1, tamano: 100 } };
  });
}
const llamadas = (ruta: string) => get.mock.calls.filter(c => c[0] === ruta).map(c => c[1]?.params ?? {});
const ultima = (ruta: string) => { const l = llamadas(ruta); return l[l.length - 1]; };

const Ubicacion = () => { const l = useLocation(); return <p data-testid="ubicacion">{l.pathname}{l.search}</p>; };

beforeEach(() => { get.mockReset(); descargar.mockReset(); permisos.reportes = true; vi.stubGlobal('scrollTo', vi.fn()); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); });
afterEach(() => vi.unstubAllGlobals());

it('accesos por fecha: documento con totales, hallazgos, gráficos y los más frecuentes; «No autorizados» filtra en la API', async () => {
  api(p => (p.estado ? [paso(2, { estado_validacion: 'no_reconocido', placa: 'PZX2020' })] : [paso(1), paso(2, { estado_validacion: 'no_reconocido', placa: 'PZX2020' })]));
  render(<MemoryRouter initialEntries={['/reportes?vista=accesos']}><Reportes /></MemoryRouter>);
  expect(screen.getByText('Genere su reporte')).toBeInTheDocument();
  expect(get).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /Imprimir/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Generar reporte' }));
  const informe = await screen.findByRole('article', { name: 'Reporte de accesos vehiculares' });
  const detalle = await within(informe).findByRole('table', { name: 'Detalle de los ingresos' });
  expect(within(detalle).getByText('PZX-2020')).toBeInTheDocument();
  expect(within(informe).getByText('Ana Supervisora', { exact: false })).toBeInTheDocument();
  expect(within(informe).getByText('Elaborado por')).toBeInTheDocument();
  // Hallazgos escritos y gráficos con los datos de la API (todos los ingresos, no solo los cargados)
  const hallazgos = within(informe).getByRole('region', { name: 'Puntos clave' });
  expect(hallazgos).toHaveTextContent('El día de la semana con más ingresos es el martes: 3 de 3 ingresos (100 %).');
  expect(hallazgos).toHaveTextContent('Hora pico: de 07:00 a 09:00');
  expect(hallazgos).toHaveTextContent('1 ingreso no autorizado.');
  expect(within(informe).getByText('Por día de la semana')).toBeInTheDocument();
  expect(within(informe).getByRole('table', { name: 'Ingresos por día de la semana y hora' })).toBeInTheDocument();
  expect(within(informe).getByRole('table', { name: 'Vehículos más frecuentes' })).toHaveTextContent('Rosa Vera');
  expect(llamadas('/detecciones')[0]).toMatchObject({ movimiento: 'ingreso', orden: 'antiguo', estado: undefined });
  expect(llamadas('/detecciones/historial/analisis')[0]).toMatchObject({ movimiento: 'ingreso' });

  fireEvent.change(screen.getByLabelText('Accesos'), { target: { value: 'no_autorizados' } });
  expect(ultima('/detecciones')).toMatchObject({ estado: undefined });
  expect(screen.getByRole('button', { name: /Imprimir/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Exportar CSV' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Generar reporte' }));
  await screen.findByRole('article', { name: 'Reporte de accesos no autorizados' });
  await waitFor(() => expect(ultima('/detecciones')).toMatchObject({ estado: 'no_reconocido,alerta' }));
  expect(ultima('/detecciones/historial/analisis')).toMatchObject({ estado: 'no_reconocido,alerta' });
});

it('un vehículo frecuente del período abre su reporte', async () => {
  api(() => [paso(1)]);
  render(<MemoryRouter initialEntries={['/reportes?vista=accesos']}><Reportes /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Generar reporte' }));
  const informe = await screen.findByRole('article', { name: 'Reporte de accesos vehiculares' });
  fireEvent.click(within(within(informe).getByRole('table', { name: 'Vehículos más frecuentes' })).getByText('PZX-2020'));
  await screen.findByRole('article', { name: 'Reporte del vehículo PZX-2020' });
  expect(ultima('/detecciones/historial/analisis')).toMatchObject({ placa: 'PZX2020', exacta: 'si', movimiento: 'ingreso' });
});

it('reporte de un vehículo: exige una placa válida y muestra su situación, sus costumbres y sus ingresos', async () => {
  api(() => [paso(1), paso(3, { placa: 'PZX10109' })]);
  render(<MemoryRouter initialEntries={['/reportes?vista=accesos']}><Reportes /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Vista de reportes'), { target: { value: 'analisis_vehiculo' } });
  fireEvent.change(screen.getByLabelText('Placa del vehículo'), { target: { value: 'PZX' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generar reporte' }));
  expect(screen.getByText(/Placa inválida/)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Placa del vehículo'), { target: { value: 'pzx-1010' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generar reporte' }));
  const informe = await screen.findByRole('article', { name: 'Reporte del vehículo PZX-1010' });
  expect(within(informe).getByText('Autorizado en la lista blanca')).toBeInTheDocument();
  expect(within(informe).getByText('0912345678')).toBeInTheDocument();
  const hallazgos = within(informe).getByRole('region', { name: 'Puntos clave' });
  expect(hallazgos).toHaveTextContent('Ingresa con más frecuencia los martes: 3 de 3 ingresos (100 %).');
  expect(hallazgos).toHaveTextContent('Suele ingresar entre las 07:00 y las 09:00');
  expect(hallazgos).toHaveTextContent('Siempre lo ingresó Rosa Vera.');
  expect(within(hallazgos).getAllByRole('listitem').length).toBeLessThanOrEqual(6);
  expect(within(hallazgos).getAllByRole('listitem')[0]).toHaveTextContent('1 ingreso no autorizado.');
  expect(hallazgos).toHaveTextContent('1 ingreso sin salida registrada.');
  expect(within(informe).getByText('Ingresos por semana')).toBeInTheDocument();
  // La API pide la placa exacta; una respuesta más amplia no entra al informe
  expect(ultima('/detecciones')).toMatchObject({ placa: 'PZX1010', exacta: 'si' });
  expect(within(within(informe).getByRole('table', { name: 'Ingresos del vehículo' })).getAllByRole('row')).toHaveLength(2);
});

it('reporte de una persona: busca por nombres y apellidos y muestra los vehículos que usó', async () => {
  api(() => [paso(1)]);
  render(<MemoryRouter initialEntries={['/reportes?vista=analisis_persona']}><Reportes /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Nombres y apellidos o cédula'), { target: { value: 'ro' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generar reporte' }));
  expect(screen.getByText(/al menos 3 caracteres/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Nombres y apellidos o cédula'), { target: { value: '  vera   rosa ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generar reporte' }));
  const informe = await screen.findByRole('article', { name: 'Reporte de la persona «vera rosa»' });
  expect(ultima('/detecciones/historial/analisis')).toMatchObject({ persona: 'vera rosa', movimiento: 'ingreso' });
  expect(within(informe).getByRole('region', { name: 'Puntos clave' })).toHaveTextContent('Usó 2 vehículos: PZX-1010 (2 veces) y PZX-2020 (1 vez).');
  fireEvent.click(within(within(informe).getByRole('table', { name: 'Vehículos que usó' })).getByText('PZX-1010'));
  await screen.findByRole('article', { name: 'Reporte del vehículo PZX-1010' });
});

it('un enlace con la placa abre directamente el reporte del vehículo', async () => {
  api(() => [paso(1)]);
  render(<MemoryRouter initialEntries={['/reportes?vista=analisis_vehiculo&placa=PZX1010&desde=2026-10-01&hasta=2026-11-03']}><Reportes /></MemoryRouter>);
  const informe = await screen.findByRole('article', { name: 'Reporte del vehículo PZX-1010' });
  expect(within(informe).getByText(/01 oct 2026 al 03 nov 2026/)).toBeInTheDocument();
  expect(screen.getByLabelText('Placa del vehículo')).toHaveValue('PZX-1010');
});

it('no consulta ni descarga fechas incompletas o invertidas y permite volver a generar el mismo período', async () => {
  api(() => [paso(1)]);
  render(<MemoryRouter initialEntries={['/reportes?vista=accesos']}><Reportes /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'rango' } });
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Generar reporte' }).closest('form')!);
  expect(screen.getByRole('alert')).toHaveTextContent('Seleccione la fecha de inicio y de fin.');
  expect(get).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-20' } });
  fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-01' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Generar reporte' }).closest('form')!);
  expect(screen.getByRole('alert')).toHaveTextContent('La fecha de inicio debe ser anterior o igual a la fecha de fin.');
  expect(get).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-31' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generar reporte' }));
  await screen.findByRole('article', { name: 'Reporte de accesos vehiculares' });
  const anteriores = llamadas('/detecciones').length;
  fireEvent.click(screen.getByRole('button', { name: 'Generar reporte' }));
  await waitFor(() => expect(llamadas('/detecciones')).toHaveLength(anteriores + 1));
});

it('cambiar la placa del formulario no consulta ni permite imprimir el reporte anterior hasta generar el nuevo', async () => {
  api(() => [paso(1)]);
  render(<MemoryRouter initialEntries={['/reportes?vista=analisis_vehiculo&placa=PZX1010']}><Reportes /></MemoryRouter>);
  await screen.findByRole('article', { name: 'Reporte del vehículo PZX-1010' });
  expect(screen.getByRole('button', { name: /Imprimir/ })).toBeEnabled();
  const anteriores = llamadas('/detecciones').length;
  fireEvent.change(screen.getByLabelText('Placa del vehículo'), { target: { value: 'PZX-2020' } });
  expect(screen.getByRole('button', { name: /Imprimir/ })).toBeDisabled();
  expect(llamadas('/detecciones')).toHaveLength(anteriores);
  fireEvent.click(screen.getByRole('button', { name: 'Generar reporte' }));
  await screen.findByRole('article', { name: 'Reporte del vehículo PZX-2020' });
  expect(ultima('/detecciones')).toMatchObject({ placa: 'PZX2020', exacta: 'si' });
  expect(screen.getByRole('button', { name: /Imprimir/ })).toBeEnabled();
});

it('la hoja de control descarga el formato elegido con un solo botón y conserva turno y período', async () => {
  const archivo = new Blob(['contenido ficticio'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  get.mockResolvedValue({ data: archivo, headers: { 'content-disposition': 'attachment; filename="control.xlsx"' } });
  render(<MemoryRouter initialEntries={['/reportes?vista=control']}><Reportes /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'rango' } });
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } });
  fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-31' } });
  fireEvent.change(screen.getByLabelText('Turno'), { target: { value: 'nocturno' } });
  fireEvent.change(screen.getByLabelText('Formato'), { target: { value: 'xlsx' } });
  expect(get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Generar y descargar' }));
  await waitFor(() => expect(descargar).toHaveBeenCalledWith(archivo, 'control.xlsx'));
  expect(ultima('/reportes/control-vehicular')).toEqual({
    desde: new Date('2026-10-01T00:00:00-05:00').toISOString(), hasta: new Date('2026-10-31T23:59:59.999-05:00').toISOString(), turno: 'nocturno', formato: 'xlsx',
  });
  expect(screen.getByRole('status')).toHaveTextContent('Reporte descargado en Excel.');
});

it('historial completo: por omisión consulta el día de hoy y el estado «No autorizados» filtra en la API', async () => {
  api(() => [paso(1)]);
  render(<MemoryRouter initialEntries={['/historial']}><HistorialCompleto /></MemoryRouter>);
  await screen.findByText('Rosa Vera');
  const primera = llamadas('/detecciones')[0];
  expect(primera.desde).toBeTruthy();
  expect(primera.hasta).toBeTruthy();
  // Una visita, una fila: la salida que cerró un ingreso va en su fila
  expect(primera.unir_salidas).toBe('si');
  expect(llamadas('/detecciones/historial/resumen')[0].unir_salidas).toBe('si');
  expect(screen.getByLabelText('Período')).toHaveValue('hoy');
  fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'no_autorizados' } });
  await waitFor(() => expect(ultima('/detecciones')).toMatchObject({ estado: 'no_reconocido,alerta' }));
  fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'todo' } });
  await waitFor(() => expect(ultima('/detecciones')).toMatchObject({ desde: undefined, hasta: undefined }));
});

it('historial completo: rango de fechas propio, cámara a la vista y rojo solo en lista negra y pasos sin lectura', async () => {
  api(() => [paso(1), paso(2, { estado_validacion: 'alerta', placa: 'PZX2020' }), paso(3, { placa: null, estado_validacion: 'pendiente_revision', persona_ingreso: 'Luis Mora' })]);
  render(<MemoryRouter initialEntries={['/historial']}><HistorialCompleto /></MemoryRouter>);
  const tabla = await screen.findByRole('region', { name: 'Tabla del historial completo' });
  await within(tabla).findByText('PZX-1010');
  expect(within(tabla).getByText('PZX-1010').closest('tr')).not.toHaveClass('acento-alerta');
  expect(within(tabla).getByText('PZX-2020').closest('tr')).toHaveClass('acento-alerta');
  expect(within(tabla).getByText('Luis Mora').closest('tr')).toHaveClass('acento-sin_lectura');
  expect(within(tabla).getByText('Sin lectura')).toHaveClass('historial-sin-lectura');

  expect(screen.queryByLabelText('Desde')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'rango' } });
  fireEvent.change(await screen.findByLabelText('Desde'), { target: { value: '2026-10-01' } });
  await waitFor(() => expect(ultima('/detecciones').desde).toBe(new Date('2026-10-01T00:00:00-05:00').toISOString()));
  expect(screen.getByLabelText('Hasta')).toBeInTheDocument();

  await within(screen.getByLabelText('Cámara')).findByText('Garita norte');
  fireEvent.change(screen.getByLabelText('Cámara'), { target: { value: '4' } });
  await waitFor(() => expect(ultima('/detecciones')).toMatchObject({ camara: '4' }));
});

it('historial completo: los totales de la consulta filtran con un toque y «Más filtros» agrega movimiento, origen y franja', async () => {
  api(() => [paso(1)]);
  render(<MemoryRouter initialEntries={['/historial']}><HistorialCompleto /></MemoryRouter>);
  const totales = await screen.findByRole('group', { name: 'Totales de la consulta' });
  await within(totales).findByText('Vehículos');
  fireEvent.click(within(totales).getByRole('button', { name: /Lista negra/ }));
  await waitFor(() => expect(ultima('/detecciones')).toMatchObject({ estado: 'alerta' }));
  expect(within(totales).getByRole('button', { name: /Lista negra/ })).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(within(totales).getByRole('button', { name: /Siguen dentro/ }));
  await waitFor(() => expect(ultima('/detecciones')).toMatchObject({ cerrados: 'no' }));
  fireEvent.click(within(totales).getByRole('button', { name: /Siguen dentro/ }));
  await waitFor(() => expect(ultima('/detecciones')).toMatchObject({ cerrados: undefined }));

  fireEvent.click(screen.getByRole('button', { name: /Más filtros/ }));
  fireEvent.change(screen.getByLabelText('Movimiento'), { target: { value: 'salida' } });
  fireEvent.change(screen.getByLabelText('Origen'), { target: { value: 'manual' } });
  fireEvent.change(screen.getByLabelText('Desde la hora'), { target: { value: '22:00' } });
  await waitFor(() => expect(ultima('/detecciones')).toMatchObject({ movimiento: 'salida', origen: 'manual', hora_desde: '22:00' }));
  expect(ultima('/detecciones/historial/resumen')).toMatchObject({ movimiento: 'salida', origen: 'manual' });
  expect(screen.getByRole('button', { name: /Más filtros \(3\)/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
  await waitFor(() => expect(ultima('/detecciones')).toMatchObject({ movimiento: undefined, origen: undefined, estado: undefined }));
});

it('historial completo: una fila abre su panel con los reportes del vehículo y de la persona', async () => {
  api(() => [paso(1)]);
  render(<MemoryRouter initialEntries={['/historial']}>
    <Routes><Route path="/historial" element={<HistorialCompleto />} /><Route path="/reportes" element={<Ubicacion />} /></Routes>
  </MemoryRouter>);
  fireEvent.click(await screen.findByText('Rosa Vera'));
  const panel = screen.getByRole('complementary', { name: 'Registro PZX-1010' });
  expect(within(panel).getByText('Jornada laboral')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Tabla del historial completo' })).getByText('Rosa Vera').closest('tr')).toHaveAttribute('aria-selected', 'true');
  expect(within(panel).getByRole('button', { name: /Reporte de la persona/ })).toBeInTheDocument();
  fireEvent.click(within(panel).getByRole('button', { name: /Reporte del vehículo/ }));
  expect(screen.getByTestId('ubicacion')).toHaveTextContent('/reportes?vista=vehiculo&placa=PZX1010');
});

it('historial completo: Escape cierra el panel y «Ver todos sus pasos» filtra la placa en todo el historial', async () => {
  api(() => [paso(1)]);
  render(<MemoryRouter initialEntries={['/historial']}><HistorialCompleto /></MemoryRouter>);
  fireEvent.click(await screen.findByText('Rosa Vera'));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Rosa Vera'));
  fireEvent.click(screen.getByRole('button', { name: /Ver todos sus pasos/ }));
  await waitFor(() => expect(ultima('/detecciones')).toMatchObject({ placa: 'PZX1010', desde: undefined, hasta: undefined }));
});

it('historial completo: sin permiso de reportes el panel no ofrece reportes; buscar una placa ofrece su reporte a quien sí lo tiene', async () => {
  permisos.reportes = false;
  api(() => [paso(1)]);
  const { unmount } = render(<MemoryRouter initialEntries={['/historial']}><HistorialCompleto /></MemoryRouter>);
  fireEvent.click(await screen.findByText('Rosa Vera'));
  expect(screen.queryByRole('button', { name: /Reporte del vehículo/ })).not.toBeInTheDocument();
  unmount();
  permisos.reportes = true;
  render(<MemoryRouter initialEntries={['/historial?buscar=PZX-1010']}><HistorialCompleto /></MemoryRouter>);
  expect(await screen.findByRole('button', { name: 'Reporte del vehículo PZX-1010' })).toBeInTheDocument();
});
