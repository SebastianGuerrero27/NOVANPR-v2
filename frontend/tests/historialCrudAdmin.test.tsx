import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deteccion, ResumenHistorial } from '../src/dominio/tipos';

const { get, patch, post, borrar, sesion } = vi.hoisted(() => ({
  get: vi.fn(), patch: vi.fn(), post: vi.fn(), borrar: vi.fn(),
  sesion: { rol: 'Admin', gestionar: true, eliminar: true, eliminarIndividual: true },
}));
vi.mock('../src/infraestructura/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/infraestructura/api')>()),
  default: { get, patch, post, delete: borrar },
}));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({
  user: { id: 1, rol: sesion.rol }, puede: (p: string) => p === 'detecciones:gestionar' ? sesion.gestionar : p === 'detecciones:eliminar' ? sesion.eliminar : p === 'detecciones:eliminar-individual' ? sesion.eliminarIndividual : true,
}) }));
vi.mock('../src/aplicacion/tiempoReal', () => ({ useEvento: () => undefined, useReconexion: () => undefined }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
import HistorialCompleto from '../src/interfaz/paginas/HistorialCompleto';

const paso = (id: number, cambios: Partial<Deteccion> = {}) => ({
  id, placa: `PZX${1000 + id}`, placa_reconocida: `PZX${1000 + id}`, placa_validada: null,
  estado_validacion: 'autorizado', estado_procesamiento: 'procesado', tipo_movimiento: 'ingreso',
  fecha_hora_ingreso: '2026-11-04T13:00:00Z', persona_ingreso: `Persona Prueba ${id}`,
  motivo_ingreso: 'Jornada laboral', vehiculo: { tipo: 'SUV', marca: 'Kia', modelo: 'Sportage', color: 'Gris' },
  datos_permiso: { cedula: '0912345678' }, autorizado: null, imagen_vehiculo: null, imagen_placa: null,
  camara: null, confianza_ocr: 0.97, validado_manualmente: false, ...cambios,
}) as unknown as Deteccion;
let filas: Deteccion[];
const resumen = (): ResumenHistorial => ({
  total: filas.length, ingresos: filas.length, salidas: 0, con_salida: 0, autorizados: filas.length,
  alertas: 0, no_registrados: 0, pendientes: 0, sin_lectura: 0, placas: filas.length,
  camara: 0, manuales: filas.length, primero: null, ultimo: null,
});
const Ubicacion = () => { const l = useLocation(); return <output aria-label="URL actual">{l.pathname}{l.search}</output>; };
const abrir = (ruta = '/historial?placa=PZX1001&todo=1') => render(<MemoryRouter initialEntries={[ruta]}>
  <Routes><Route path="/historial" element={<><HistorialCompleto /><Ubicacion /></>} /><Route path="*" element={<Ubicacion />} /></Routes>
</MemoryRouter>);
const contar = (ruta: string) => get.mock.calls.filter(c => c[0] === ruta).length;

beforeEach(() => {
  get.mockReset(); patch.mockReset(); post.mockReset(); borrar.mockReset();
  sesion.rol = 'Admin'; sesion.gestionar = true; sesion.eliminar = true; sesion.eliminarIndividual = true; filas = [paso(1), paso(2)];
  get.mockImplementation(async (ruta: string) => ({ data: ruta === '/camaras' ? []
    : ruta === '/monitoreo/estado' ? { salida_manual: true }
      : ruta === '/detecciones/historial/resumen' ? resumen()
        : { items: [...filas], total: filas.length, pagina: 1, tamano: 50 } }));
});

describe('CRUD del administrador en el historial completo', () => {
  it('el borrado global pide confirmación y elimina todas las fechas sin heredar los filtros de la vista', async () => {
    abrir('/historial?placa=PZX1001&desde=2026-10-01&hasta=2026-10-31');
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar todos' }));
    const dialogo = screen.getByRole('dialog', { name: 'Eliminar todo el historial' });
    expect(within(dialogo).getByText(/Los filtros de la pantalla no limitan/)).toBeInTheDocument();
    const confirmar = within(dialogo).getByRole('button', { name: 'Eliminar todo el historial' });
    expect(confirmar).toBeDisabled(); expect(borrar).not.toHaveBeenCalled();
    fireEvent.change(within(dialogo).getByLabelText(/Para confirmar escriba/), { target: { value: 'ELIMINAR' } });
    expect(confirmar).toBeDisabled();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Prueba del sistema' }));
    expect(confirmar).toBeEnabled();
    borrar.mockImplementationOnce(async () => { filas = []; return { data: { message: 'Registros eliminados.', total: 4 } }; });
    fireEvent.click(confirmar);
    await waitFor(() => expect(borrar).toHaveBeenCalledWith('/detecciones', {
      params: undefined, data: { motivo: 'Prueba del sistema', confirmacion: 'ELIMINAR' },
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('URL actual')).toHaveTextContent('placa=PZX1001');
    await waitFor(() => expect(screen.queryByText('Persona Prueba 1')).not.toBeInTheDocument());
  });

  it('cancelar el borrado global conserva los datos y no envía ninguna eliminación', async () => {
    abrir(); fireEvent.click(await screen.findByText('Persona Prueba 1'));
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar todos' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(borrar).not.toHaveBeenCalled();
    expect(screen.getByRole('complementary', { name: 'Registro PZX-1001' })).toBeInTheDocument();
  });

  it('un administrador sin permiso de eliminación no puede abrir el borrado global', async () => {
    sesion.eliminar = false; abrir(); await screen.findByText('Persona Prueba 1');
    expect(screen.queryByRole('button', { name: 'Eliminar todos' })).not.toBeInTheDocument();
  });

  it('el error de borrado conserva la confirmación para reintentar y no vacía la tabla', async () => {
    abrir(); fireEvent.click(await screen.findByRole('button', { name: 'Eliminar todos' }));
    const dialogo = screen.getByRole('dialog');
    fireEvent.change(within(dialogo).getByLabelText(/Para confirmar escriba/), { target: { value: 'ELIMINAR' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Prueba del sistema' }));
    borrar.mockRejectedValueOnce({ response: { status: 500, data: { error: 'No se pudo eliminar el historial.' } } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar todo el historial' }));
    await within(dialogo).findByText('No se pudo eliminar el historial.');
    expect(within(dialogo).getByLabelText(/Para confirmar escriba/)).toHaveValue('ELIMINAR');
    expect(screen.getByText('Persona Prueba 1')).toBeInTheDocument();
  });

  it.each(['Guardia', 'GestorPermisos'])('el rol %s consulta sin las acciones administrativas aunque el mock entregue permisos', async rol => {
    sesion.rol = rol; sesion.eliminarIndividual = rol === 'Guardia';
    abrir();
    await screen.findByText('Persona Prueba 1');
    expect(screen.queryByRole('button', { name: 'Crear registro' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar todos' })).not.toBeInTheDocument();
    if (rol === 'Guardia') {
      expect(screen.getByRole('columnheader', { name: 'Acciones' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Eliminar registro 1' })).toBeInTheDocument();
    } else {
      expect(screen.queryByRole('columnheader', { name: 'Acciones' })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /Editar registro/ })).not.toBeInTheDocument();
  });

  it('respeta el permiso de gestión de la sesión del administrador', async () => {
    sesion.gestionar = false; abrir();
    await screen.findByText('Persona Prueba 1');
    expect(screen.queryByRole('button', { name: 'Crear registro' })).not.toBeInTheDocument();
  });

  it('edita solamente campos cambiados con motivo auditado, refresca tabla/resumen/panel y conserva filtros', async () => {
    abrir();
    fireEvent.click(await screen.findByText('Persona Prueba 1'));
    const panel = screen.getByRole('complementary', { name: 'Registro PZX-1001' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Editar registro' }));
    const dialogo = screen.getByRole('dialog', { name: 'Editar registro del historial' });
    const guardar = within(dialogo).getByRole('button', { name: 'Guardar cambios' });
    expect(guardar).toBeDisabled();
    fireEvent.change(within(dialogo).getByLabelText('Modelo'), { target: { value: 'Picanto' } });
    expect(guardar).toBeDisabled();
    fireEvent.change(within(dialogo).getByLabelText('Motivo de la corrección*'), { target: { value: 'Corrección del modelo observado' } });
    patch.mockImplementation(async () => {
      filas = filas.map(d => d.id === 1 ? { ...d, vehiculo: { ...d.vehiculo, modelo: 'Picanto' } } : d);
      return { data: { deteccion: filas[0] } };
    });
    const consultas = contar('/detecciones'); const totales = contar('/detecciones/historial/resumen');
    fireEvent.click(guardar);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(patch).toHaveBeenCalledWith('/detecciones/1/registro', { modelo: 'Picanto', motivo_correccion: 'Corrección del modelo observado' });
    expect(post).not.toHaveBeenCalled(); // La edición histórica no usa la autorización ni la lista blanca.
    await waitFor(() => expect(contar('/detecciones')).toBeGreaterThan(consultas));
    expect(contar('/detecciones/historial/resumen')).toBeGreaterThan(totales);
    expect(within(panel).getByText(/Picanto/)).toBeInTheDocument();
    expect(screen.getByLabelText('URL actual')).toHaveTextContent('/historial?placa=PZX1001&todo=1');
  });

  it('la placa de una salida queda bloqueada y permite actualizar el resto de su ficha', async () => {
    filas = [paso(1, { tipo_movimiento: 'salida', estado_validacion: 'salida_registrada' })];
    abrir(); fireEvent.click(await screen.findByRole('button', { name: 'Editar registro 1' }));
    const dialogo = screen.getByRole('dialog');
    expect(within(dialogo).getByLabelText('Placa')).toBeDisabled();
    expect(within(dialogo).getByText('Para corregir la placa de una salida, use su validación.')).toBeInTheDocument();
    expect(within(dialogo).getByText('Lectura del motor:')).toBeInTheDocument();
    fireEvent.change(within(dialogo).getByLabelText('Modelo'), { target: { value: 'Picanto' } });
    fireEvent.change(within(dialogo).getByLabelText('Motivo de la corrección*'), { target: { value: 'Corrección del modelo observado' } });
    patch.mockResolvedValueOnce({ data: { deteccion: { ...filas[0], vehiculo: { ...filas[0].vehiculo, modelo: 'Picanto' } } } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(patch).toHaveBeenCalledWith('/detecciones/1/registro', { modelo: 'Picanto', motivo_correccion: 'Corrección del modelo observado' });
  });

  it('muestra el error del servidor sin cerrar el formulario ni perder la corrección escrita', async () => {
    abrir(); fireEvent.click(await screen.findByRole('button', { name: 'Editar registro 1' }));
    const dialogo = screen.getByRole('dialog');
    fireEvent.change(within(dialogo).getByLabelText('Placa'), { target: { value: 'PZX9999' } });
    fireEvent.change(within(dialogo).getByLabelText('Motivo de la corrección*'), { target: { value: 'Corrección visual de la placa' } });
    patch.mockRejectedValueOnce({ response: { status: 409, data: { error: 'El ingreso tiene una salida vinculada.' } } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }));
    expect(await within(dialogo).findByText('El ingreso tiene una salida vinculada.')).toBeInTheDocument();
    expect(patch).toHaveBeenCalledWith('/detecciones/1/registro', { placa: 'PZX9999', motivo_correccion: 'Corrección visual de la placa' });
    expect(within(dialogo).getByLabelText('Placa')).toHaveValue('PZX9999');
    expect(within(dialogo).getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
  });

  it('no trunca ni envía una lectura OCR antigua inválida al corregir otro campo', async () => {
    filas = [paso(1, { placa: 'LECTURAANTIGUA', placa_reconocida: 'LECTURAANTIGUA' })];
    abrir(); fireEvent.click(await screen.findByRole('button', { name: 'Editar registro 1' }));
    const dialogo = screen.getByRole('dialog');
    expect(within(dialogo).getByLabelText('Placa')).toHaveValue('LECTURAANTIGUA');
    fireEvent.change(within(dialogo).getByLabelText('Modelo'), { target: { value: 'Picanto' } });
    fireEvent.change(within(dialogo).getByLabelText('Motivo de la corrección*'), { target: { value: 'Corrección del modelo' } });
    patch.mockResolvedValueOnce({ data: { deteccion: filas[0] } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/detecciones/1/registro', { modelo: 'Picanto', motivo_correccion: 'Corrección del modelo' }));
  });

  it('advierte que cambiar la placa de un ingreso lo deja pendiente y bloquea formatos inválidos', async () => {
    abrir(); fireEvent.click(await screen.findByRole('button', { name: 'Editar registro 1' }));
    const dialogo = screen.getByRole('dialog');
    fireEvent.change(within(dialogo).getByLabelText('Placa'), { target: { value: 'PZX9' } });
    fireEvent.change(within(dialogo).getByLabelText('Motivo de la corrección*'), { target: { value: 'Corrección de lectura' } });
    expect(within(dialogo).getByText(/el ingreso quedará pendiente de revisión/)).toBeInTheDocument();
    expect(within(dialogo).getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('las acciones de una fila no seleccionan otra fila ni abren la ficha por doble clic o teclado', async () => {
    abrir(); fireEvent.click(await screen.findByText('Persona Prueba 1'));
    const editar = screen.getByRole('button', { name: 'Editar registro 2' });
    fireEvent.keyDown(editar, { key: ' ' }); fireEvent.doubleClick(editar); fireEvent.click(editar);
    expect(screen.getByRole('complementary', { name: 'Registro PZX-1001' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Registro PZX-1002' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('URL actual')).toHaveTextContent('/historial?placa=PZX1001&todo=1');
  });

  it('crear registra un ingreso manual y recarga el historial sin cambiar los filtros', async () => {
    abrir(); await screen.findByText('Persona Prueba 1');
    fireEvent.click(screen.getByRole('button', { name: 'Crear registro' }));
    const dialogo = screen.getByRole('dialog', { name: 'Registrar ingreso manual' });
    fireEvent.change(within(dialogo).getByLabelText('Placa (opcional)'), { target: { value: 'PZX1111' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'La cámara no lo registró' }));
    fireEvent.change(within(dialogo).getByLabelText('Nombres y apellidos de quien ingresa'), { target: { value: 'Ana Prueba' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Jornada laboral' }));
    post.mockResolvedValueOnce({ data: { deteccion: paso(11) } });
    const consultas = contar('/detecciones');
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar ingreso' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/detecciones/registro-manual', expect.objectContaining({ placa: 'PZX1111', persona_ingreso: 'Ana Prueba', motivo_ingreso: 'Jornada laboral' })));
    await waitFor(() => expect(contar('/detecciones')).toBeGreaterThan(consultas));
    expect(screen.getByLabelText('URL actual')).toHaveTextContent('/historial?placa=PZX1001&todo=1');
  });

  it.each(['Admin', 'Guardia'])('%s elimina un registro con motivo y actualiza tabla, totales y panel', async rol => {
    sesion.rol = rol; sesion.eliminar = rol === 'Admin';
    abrir(); fireEvent.click(await screen.findByText('Persona Prueba 1'));
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar registro 1' }));
    expect(borrar).not.toHaveBeenCalled();
    const dialogo = screen.getByRole('dialog', { name: 'Eliminar registro' });
    borrar.mockImplementation(async () => { filas = filas.filter(d => d.id !== 1); return { data: {} }; });
    const totales = contar('/detecciones/historial/resumen');
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(borrar).toHaveBeenCalledWith('/detecciones/1', { data: { motivo: 'Falso positivo (no corresponde a un vehículo)' } });
    expect(screen.queryByRole('complementary', { name: 'Registro PZX-1001' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Persona Prueba 1')).not.toBeInTheDocument());
    expect(contar('/detecciones/historial/resumen')).toBeGreaterThan(totales);
  });
});
