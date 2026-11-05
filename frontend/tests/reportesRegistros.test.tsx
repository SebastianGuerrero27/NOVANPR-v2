/** La lista y el archivo usan los mismos filtros; los datos son artificiales. */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deteccion } from '../src/dominio/tipos';

const { get, descargar } = vi.hoisted(() => ({ get: vi.fn(), descargar: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { get }, mensajeError: (e: Error) => e.message,
  mensajeErrorDescarga: async (e: Error) => e.message }));
vi.mock('../src/infraestructura/descargas', () => ({ descargarBlob: descargar }));
import { ReportesRegistros } from '../src/interfaz/componentes/ReportesRegistros';

const fila = (id = 1, cambios: Partial<Deteccion> = {}): Deteccion => ({
  id, placa: 'PZX1010', placa_reconocida: 'PZX1010', placa_validada: null,
  estado_validacion: 'autorizado', estado_procesamiento: 'procesado', fecha_hora_ingreso: '2026-10-28T13:00:00Z',
  fecha_hora_salida: null, tipo_movimiento: 'ingreso', persona_ingreso: 'Persona de prueba', motivo_ingreso: 'Jornada laboral',
  vehiculo: { tipo: 'SUV', marca: 'Kia', modelo: 'Rio', color: 'Blanco' }, datos_permiso: { cedula: '0000000000' },
  autorizado: null, imagen_vehiculo: null, imagen_placa: null, camara: null, confianza_ocr: 0.94, validado_manualmente: false, ...cambios,
} as Deteccion);
const pagina = (p: Record<string, unknown> = {}, items = [fila()], total = items.length) => ({
  data: { items, total, pagina: Number(p.pagina || 1), tamano: Number(p.tamano || 50) },
});
const consultas = () => get.mock.calls.filter(c => c[0] === '/detecciones').map(c => c[1].params);
const ultimaConsulta = () => { const lista = consultas(); return lista[lista.length - 1]; };
const generar = () => screen.getByRole('button', { name: 'Generar reporte de esta lista' });
const Ubicacion = () => { const l = useLocation(); return <output data-testid="url">{l.search}</output>; };
function mostrar(url = '/reportes') { return render(<MemoryRouter initialEntries={[url]}><ReportesRegistros /><Ubicacion /></MemoryRouter>); }
function apiLista(responder = (p: Record<string, unknown>) => pagina(p)) {
  get.mockImplementation(async (ruta: string, op?: { params?: Record<string, unknown> }) => {
    if (ruta === '/camaras') return { data: [{ id: 4, nombre: 'Garita norte' }] };
    if (ruta === '/detecciones') return responder(op?.params ?? {});
    return { data: new Blob(['fixture']), headers: { 'content-disposition': 'attachment; filename="lista_filtrada.pdf"' } };
  });
}
beforeEach(() => { get.mockReset(); descargar.mockReset(); apiLista(); });

describe('Reportes · lista filtrada primero', () => {
  it('abre todos los registros sin fecha ni movimiento implícitos y pagina de 50 en 50', async () => {
    apiLista(p => pagina(p, [fila(Number(p.pagina) === 2 ? 51 : 1)], 51));
    mostrar();
    expect(screen.getByLabelText('Período')).toHaveValue('todo');
    await screen.findByRole('button', { name: 'Filtrar por placa PZX-1010' });
    expect(consultas()[0]).toMatchObject({ pagina: 1, tamano: 50, unir_salidas: 'si', orden: 'reciente' });
    expect(consultas()[0].desde).toBeUndefined(); expect(consultas()[0].hasta).toBeUndefined();
    expect(consultas()[0].movimiento).toBeUndefined(); expect(consultas()[0].completos).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ pagina: 2 }));
    await waitFor(() => expect(generar()).toBeEnabled());
    expect(screen.getByText('51 registros coinciden')).toBeInTheDocument();
  });

  it('combina filtros y descarga el PDF de TODOS los resultados, sin limitarlo a la página visible', async () => {
    apiLista(p => pagina(p, [fila()], 75));
    mostrar(); await screen.findByRole('button', { name: 'Filtrar por placa PZX-1010' });
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'no_autorizados' } });
    await within(screen.getByLabelText('Cámara')).findByText('Garita norte');
    fireEvent.change(screen.getByLabelText('Cámara'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Período'), { target: { value: '7d' } });
    await waitFor(() => expect(generar()).toBeEnabled());
    const filtros = { ...ultimaConsulta() }; delete filtros.pagina; delete filtros.tamano;
    fireEvent.click(generar());
    await waitFor(() => expect(descargar).toHaveBeenCalled());
    expect(get).toHaveBeenCalledWith('/detecciones/historial/reporte.pdf', expect.objectContaining({ params: filtros, responseType: 'blob' }));
    expect(filtros).toMatchObject({ estado: 'no_reconocido,alerta', camara: '4', unir_salidas: 'si' });
    expect(filtros.desde).toBeTruthy(); expect(filtros.hasta).toBeTruthy();
    expect(screen.getByText(/75 registros al consultar/)).toBeInTheDocument();
  });

  it('permite elegir placa y persona de una fila y conserva ambos criterios para CSV', async () => {
    mostrar();
    fireEvent.click(await screen.findByRole('button', { name: 'Filtrar por placa PZX-1010' }));
    await waitFor(() => expect(generar()).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por persona Persona de prueba' }));
    await waitFor(() => expect(generar()).toBeEnabled());
    expect(screen.getByLabelText('Placa exacta')).toHaveValue('PZX1010');
    expect(screen.getByLabelText('Persona o cédula')).toHaveValue('Persona de prueba');
    fireEvent.change(screen.getByLabelText('Formato del reporte'), { target: { value: 'csv' } });
    fireEvent.click(generar());
    await waitFor(() => expect(get).toHaveBeenCalledWith('/detecciones/exportar', expect.objectContaining({ params: expect.objectContaining({ placa: 'PZX1010', exacta: 'si', persona: 'Persona de prueba' }) })));
    const exportacion = get.mock.calls.find(c => c[0] === '/detecciones/exportar')![1].params;
    expect(exportacion.pagina).toBeUndefined(); expect(exportacion.tamano).toBeUndefined();
  });

  it('un enlace de vehículo o persona llega con una lista consultada, sin exigir pulsar consultar', async () => {
    mostrar('/reportes?vista=vehiculo&placa=PZX1010&persona=Persona%20de%20prueba');
    await screen.findByRole('button', { name: 'Filtrar por placa PZX-1010' });
    expect(consultas()[0]).toMatchObject({ placa: 'PZX1010', exacta: 'si', persona: 'Persona de prueba' });
    expect(screen.queryByText('Consulte una placa')).not.toBeInTheDocument();
  });

  it('bloquea la descarga inmediatamente al escribir y mientras la nueva búsqueda no ha terminado', async () => {
    let resolver: ((r: ReturnType<typeof pagina>) => void) | undefined;
    get.mockImplementation((ruta: string, op?: { params: Record<string, unknown> }) => {
      if (ruta === '/camaras') return Promise.resolve({ data: [] });
      if (op?.params.buscar === 'nueva') return new Promise(r => { resolver = r; });
      return Promise.resolve(pagina(op?.params));
    });
    mostrar(); await waitFor(() => expect(generar()).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Buscar registros'), { target: { value: 'nueva' } });
    expect(generar()).toBeDisabled();
    await waitFor(() => expect(ultimaConsulta().buscar).toBe('nueva'));
    expect(generar()).toBeDisabled();
    await act(async () => { resolver!(pagina({ pagina: 1, tamano: 50 }, [fila(2, { persona_ingreso: 'Nueva persona' })])); });
    await waitFor(() => expect(generar()).toBeEnabled());
    expect(screen.queryByRole('button', { name: 'Filtrar por persona Persona de prueba' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filtrar por persona Nueva persona' })).toBeInTheDocument();
  });

  it('una respuesta tardía de los filtros anteriores no reemplaza la lista actual', async () => {
    let terminarAutorizados: ((r: ReturnType<typeof pagina>) => void) | undefined;
    get.mockImplementation((ruta: string, op?: { params: Record<string, unknown> }) => {
      if (ruta === '/camaras') return Promise.resolve({ data: [] });
      if (op?.params.estado === 'autorizado') return new Promise(r => { terminarAutorizados = r; });
      return Promise.resolve(pagina(op?.params, [fila(2, { persona_ingreso: 'Lista vigente' })]));
    });
    mostrar(); await waitFor(() => expect(generar()).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'autorizados' } });
    await waitFor(() => expect(terminarAutorizados).toBeTypeOf('function'));
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'alertas' } });
    await waitFor(() => expect(generar()).toBeEnabled());
    await act(async () => { terminarAutorizados!(pagina({}, [fila(3, { persona_ingreso: 'Resultado obsoleto' })])); });
    expect(screen.getByRole('button', { name: 'Filtrar por persona Lista vigente' })).toBeInTheDocument();
    expect(screen.queryByText('Resultado obsoleto')).not.toBeInTheDocument();
    fireEvent.click(generar());
    await waitFor(() => expect(get).toHaveBeenCalledWith('/detecciones/historial/reporte.pdf', expect.objectContaining({ params: expect.objectContaining({ estado: 'alerta' }) })));
  });

  it('recomienda CSV para más de 5000 resultados en vez de truncar un PDF', async () => {
    apiLista(p => pagina(p, [fila()], 5001)); mostrar();
    await waitFor(() => expect(screen.getByLabelText('Formato del reporte')).toHaveValue('csv'));
    expect(screen.getByRole('option', { name: 'PDF · para imprimir' })).toBeDisabled();
    expect(screen.getByText(/descargue CSV o acote/)).toBeInTheDocument();
    fireEvent.click(generar());
    await waitFor(() => expect(get).toHaveBeenCalledWith('/detecciones/exportar', expect.objectContaining({ responseType: 'blob' })));
    expect(get.mock.calls.some(c => c[0] === '/detecciones/historial/reporte.pdf')).toBe(false);
  });

  it('un período inválido no consulta ni descarga; un error de consulta no habilita un reporte anterior', async () => {
    const { unmount } = mostrar('/reportes?desde=2026-10-30&hasta=2026-10-01');
    expect(screen.getByRole('alert')).toHaveTextContent('La fecha de inicio');
    expect(consultas()).toHaveLength(0); expect(generar()).toBeDisabled(); unmount();
    get.mockImplementation(async (ruta: string) => {
      if (ruta === '/camaras') return { data: [] };
      throw new Error('Servidor sin conexión');
    });
    mostrar();
    await screen.findByText('Servidor sin conexión');
    expect(generar()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reintentar consulta' })).toBeInTheDocument();
  });

  it('combina salidas coherentemente y limpiar vuelve al historial sin restricciones', async () => {
    mostrar('/reportes?buscar=prueba');
    await waitFor(() => expect(generar()).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Más filtros' }));
    fireEvent.change(screen.getByLabelText('Salida del ingreso'), { target: { value: 'si' } });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ cerrados: 'si', movimiento: 'ingreso' }));
    fireEvent.change(screen.getByLabelText('Movimiento'), { target: { value: 'salida' } });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ movimiento: 'salida', cerrados: undefined }));
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    await waitFor(() => expect(generar()).toBeEnabled());
    expect(ultimaConsulta()).toMatchObject({ buscar: undefined, movimiento: undefined, cerrados: undefined, desde: undefined, hasta: undefined });
    expect(screen.getByTestId('url')).toHaveTextContent('');
  });

  it('cambiar entre estados de ingreso y salida elimina criterios que darían combinaciones imposibles', async () => {
    mostrar(); await waitFor(() => expect(generar()).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'salidas' } });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ estado: 'salida_registrada', movimiento: 'salida' }));
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'autorizados' } });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ estado: 'autorizado', movimiento: undefined }));
    fireEvent.click(screen.getByRole('button', { name: 'Más filtros' }));
    fireEvent.change(screen.getByLabelText('Movimiento'), { target: { value: 'salida' } });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ movimiento: 'salida', estado: undefined }));
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'salidas' } });
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: '' } });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ movimiento: undefined, estado: undefined }));
  });
});
