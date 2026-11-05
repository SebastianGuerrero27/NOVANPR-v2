import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TiempoRealContext } from '../src/aplicacion/tiempoReal';
import type { Deteccion } from '../src/dominio/tipos';

const { get, post, patch, borrar } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), borrar: vi.fn() }));
vi.mock('../src/infraestructura/api', async original => ({
  ...await original<typeof import('../src/infraestructura/api')>(), default: { get, post, patch, delete: borrar },
}));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ puede: () => false }) }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
import Monitoreo from '../src/interfaz/paginas/Monitoreo';
import Detecciones from '../src/interfaz/paginas/Detecciones';

const registro = (id: number, cambios: Partial<Deteccion> = {}): Deteccion => ({
  id, placa: `PZX${id}010`, placa_reconocida: `PZX${id}010`, placa_validada: null,
  estado_validacion: 'autorizado', estado_procesamiento: 'procesado',
  confianza_deteccion: 0.96, confianza_ocr: 0.94,
  fecha_hora_ingreso: '2026-11-04T15:00:00Z', fecha_hora_salida: null,
  tipo_movimiento: 'ingreso', fecha_hora_procesamiento: null, fuente: 'manual', tracking_id: null,
  imagen_vehiculo: null, imagen_placa: null, camara: null,
  tipo_vehiculo: 'Automóvil', vehiculo: { tipo: 'Automóvil', marca: 'Kia', modelo: null, color: null },
  verificacion_vehiculo: null, verificacion_detalle: null, alerta: null, autorizado: null,
  validado_manualmente: true, validacion: null, persona_ingreso: `Persona ${id}`, motivo_ingreso: 'Jornada laboral',
  registro_completo: false, datos_faltantes_registro: ['Salida'], ...cambios,
});
const cerrar = (d: Deteccion): Deteccion => ({ ...d, fecha_hora_salida: '2026-11-04T17:00:00Z', registro_completo: true, datos_faltantes_registro: [] });
let filas: Deteccion[];

beforeEach(() => {
  filas = [registro(1), registro(2, {
    fecha_hora_salida: '2026-11-04T17:00:00Z', datos_faltantes_registro: ['Marca'],
    vehiculo: { tipo: 'Automóvil', marca: null, modelo: null, color: null },
  }), cerrar(registro(3))];
  get.mockReset(); post.mockReset(); patch.mockReset(); borrar.mockReset();
  get.mockImplementation(async (url: string, opciones?: { params?: Record<string, unknown> }) => {
    if (url === '/camaras') return { data: [] };
    if (url === '/monitoreo/estado') return { data: { en_linea: false, salida_manual: false } };
    if (url === '/detecciones/recientes') return { data: filas.filter(d => !d.registro_completo) };
    if (url === '/detecciones') {
      const p = opciones?.params ?? {};
      const items = filas.filter(d => (p.completos === 'si' ? d.registro_completo : p.completos === 'no' ? !d.registro_completo : true)
        && (p.cerrados === 'si' ? Boolean(d.fecha_hora_salida) : true));
      return { data: { items, total: items.length, pagina: 1, tamano: p.tamano ?? 30 } };
    }
    throw new Error(`Petición no prevista: ${url}`);
  });
});

function abrir() {
  const manejadores = new Map<string, Set<(d: unknown) => void>>();
  const socket = {
    on(evento: string, fn: (d: unknown) => void) {
      if (!manejadores.has(evento)) manejadores.set(evento, new Set());
      manejadores.get(evento)!.add(fn);
    },
    off(evento: string, fn: (d: unknown) => void) { manejadores.get(evento)?.delete(fn); },
  } as unknown as Socket;
  render(<MemoryRouter><TiempoRealContext.Provider value={{ socket, conectado: true, reconexiones: 0 }}>
    <section aria-label="Monitoreo de prueba"><Monitoreo /></section>
    <section aria-label="Salidas de prueba"><Detecciones /></section>
  </TiempoRealContext.Provider></MemoryRouter>);
  const monitor = within(screen.getByRole('region', { name: 'Monitoreo de prueba' }));
  const salidas = within(screen.getByRole('region', { name: 'Salidas de prueba' }));
  const actualizar = async (actualizada: Deteccion) => {
    filas = filas.map(d => d.id === actualizada.id ? actualizada : d);
    await act(async () => { for (const fn of manejadores.get('deteccion:actualizada') ?? []) fn(actualizada); });
  };
  return { monitor, salidas, actualizar };
}

describe('Distribución de registros entre monitoreo y Registro de Salidas', () => {
  it('mantiene ingresos abiertos y salidas incompletas en monitoreo, y consulta los completos con salida aparte', async () => {
    const { monitor, salidas } = abrir();
    await monitor.findByRole('region', { name: 'Tabla de accesos' });
    await salidas.findByRole('region', { name: 'Tabla de registros completos' });
    expect(monitor.getByLabelText('Titular del registro 1')).toBeInTheDocument();
    expect(monitor.getByLabelText('Titular del registro 2')).toBeInTheDocument();
    expect(monitor.queryByLabelText('Titular del registro 3')).not.toBeInTheDocument();
    expect(salidas.getByLabelText('Titular del registro 3')).toBeInTheDocument();
    expect(salidas.queryByLabelText('Titular del registro 1')).not.toBeInTheDocument();
    expect(salidas.queryByLabelText('Titular del registro 2')).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/detecciones', expect.objectContaining({ params: expect.objectContaining({ completos: 'no', pagina: 1 }) }));
    expect(get).toHaveBeenCalledWith('/detecciones', expect.objectContaining({ params: expect.objectContaining({ completos: 'si', cerrados: 'si' }) }));
    expect(borrar).not.toHaveBeenCalled();
  });

  it('retira del feed y de la tabla un ingreso cuando se registra su salida, y lo muestra en Salidas', async () => {
    const { monitor, salidas, actualizar } = abrir();
    await monitor.findByLabelText('Titular del registro 1');
    await actualizar(cerrar(filas[0]));
    await waitFor(() => {
      expect(monitor.queryByLabelText('Titular del registro 1')).not.toBeInTheDocument();
      expect(monitor.queryAllByText('PZX-1010')).toHaveLength(0);
      expect(salidas.getByLabelText('Titular del registro 1')).toBeInTheDocument();
    });
    expect(monitor.getByLabelText('Titular del registro 2')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    expect(borrar).not.toHaveBeenCalled();
  });

  it('traslada también un registro con salida previa al completar su último dato pendiente', async () => {
    const { monitor, salidas, actualizar } = abrir();
    await monitor.findByLabelText('Marca del registro 2');
    await actualizar(cerrar({ ...filas[1], vehiculo: { ...filas[1].vehiculo, marca: 'Kia' } }));
    await waitFor(() => {
      expect(monitor.queryByLabelText('Titular del registro 2')).not.toBeInTheDocument();
      expect(salidas.getByLabelText('Titular del registro 2')).toBeInTheDocument();
    });
    expect(monitor.getByLabelText('Titular del registro 1')).toBeInTheDocument();
    expect(borrar).not.toHaveBeenCalled();
  });
});
