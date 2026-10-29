import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Deteccion } from '../src/dominio/tipos';

const { get, patch } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { get, patch }, mensajeError: String, urlMedia: (v: string | null) => v }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
import { TablaIngresosRecientes } from '../src/interfaz/paginas/Monitoreo';

const paso = (id: number, cambios: Partial<Deteccion> = {}): Deteccion => ({
  id, placa: `ABC000${id}`, placa_reconocida: `ABC000${id}`, placa_validada: null,
  estado_validacion: 'pendiente_revision', estado_procesamiento: 'procesado',
  confianza_deteccion: null, confianza_ocr: null,
  fecha_hora_ingreso: '2026-10-26T15:00:00Z', fecha_hora_salida: null,
  tipo_movimiento: 'ingreso', fecha_hora_procesamiento: null, fuente: 'manual', tracking_id: null,
  imagen_vehiculo: '/media/vehiculo.jpg', imagen_placa: null, camara: null,
  tipo_vehiculo: 'Automóvil', vehiculo: { tipo: 'Automóvil', marca: 'Kia', modelo: 'Aveo', color: null },
  verificacion_vehiculo: null, verificacion_detalle: null, alerta: null, autorizado: null,
  validado_manualmente: false, validacion: null, persona_ingreso: `Titular ${id}`, motivo_ingreso: 'Visita',
  ...cambios,
});

const permiso = { id: 1, propietario: 'Ana Torres', departamento: null };

function mostrar(items: Deteccion[], editable = false) {
  get.mockResolvedValue({ data: { items, total: items.length, pagina: 1, tamano: 30 } });
  const acciones = { onValidar: vi.fn(), onRestringir: vi.fn(), onEliminar: vi.fn(), onSeleccionar: vi.fn(), onRegistrarSalida: vi.fn() };
  render(<MemoryRouter><TablaIngresosRecientes items={items} {...acciones}
    puedeEditarCampos={editable} seleccionada={null} registrandoSalida={null} /></MemoryRouter>);
  return acciones;
}

describe('Tabla de registros de ingreso', () => {
  it('presenta los inputs de los datos directamente en la cuadrícula sin botones de edición', async () => {
    mostrar([paso(1, { datos_permiso: { cedula: '0123456789' } })], true);
    expect(await screen.findByLabelText('Cédula del registro 1')).toHaveValue('0123456789');
    expect(screen.getByLabelText('Titular del registro 1')).toHaveValue('Titular 1');
    expect(screen.getByLabelText('Vehículo del registro 1')).toHaveValue('Automóvil');
    expect(screen.getByLabelText('Marca del registro 1')).toHaveValue('Kia');
    expect(screen.getByLabelText('Modelo del registro 1')).toHaveValue('Aveo');
    expect(screen.getByLabelText('Motivo del registro 1')).toHaveValue('Visita');
    expect(screen.queryByRole('button', { name: /Editar titular|Editar tipo de vehículo/ })).not.toBeInTheDocument();
  });

  it('separa placa, motivo y confianza, sin duplicar el porcentaje OCR en la placa', async () => {
    mostrar([paso(1, { confianza_ocr: 0.996 })], true);
    const fila = (await screen.findByLabelText('Titular del registro 1')).closest('tr')!;
    const cabeceras = screen.getAllByRole('columnheader').map(celda => celda.textContent);
    expect(cabeceras).toEqual([
      'N.º', 'Cédula', 'Titular', 'Placa', 'Motivo', 'Fecha', 'Hora de entrada', 'Hora de salida',
      'Vehículo', 'Marca', 'Modelo', 'Cámara', 'Estado', 'Confianza', 'Registro de salida', 'Acciones',
    ]);
    expect(screen.queryByRole('columnheader', { name: 'Validación' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Evidencia y placa' })).not.toBeInTheDocument();
    const celdas = within(fila).getAllByRole('cell');
    expect(celdas[3]).toHaveTextContent('ABC-0001');
    expect(celdas[3]).not.toHaveTextContent(/OCR|%|99\.6/);
    expect(within(celdas[4]).getByLabelText('Motivo del registro 1')).toHaveValue('Visita');
    expect(celdas[13]).toHaveTextContent(/99\.6\s*%/);
    expect(within(fila).getAllByText(/99\.6\s*%/)).toHaveLength(1);
  });

  it('conserva dos celdas guardadas rápidamente aunque sus respuestas lleguen en orden inverso', async () => {
    const original = paso(1);
    let terminarNombre!: (respuesta: { data: { deteccion: Deteccion } }) => void;
    let terminarMarca!: (respuesta: { data: { deteccion: Deteccion } }) => void;
    patch.mockReset();
    patch.mockImplementation((_url, cambios) => new Promise(resolve => {
      if ('persona_ingreso' in cambios) terminarNombre = resolve;
      if ('marca' in cambios) terminarMarca = resolve;
    }));
    const acciones = mostrar([original], true);
    const nombre = await screen.findByLabelText('Titular del registro 1');
    const marca = screen.getByLabelText('Marca del registro 1');
    fireEvent.change(nombre, { target: { value: 'Ana Torres' } });
    fireEvent.blur(nombre);
    fireEvent.change(marca, { target: { value: 'Mazda' } });
    fireEvent.blur(marca);
    expect(patch).toHaveBeenCalledTimes(2);

    await act(async () => terminarMarca({ data: { deteccion: { ...original, vehiculo: { ...original.vehiculo, marca: 'Mazda' } } } }));
    await act(async () => terminarNombre({ data: { deteccion: { ...original, persona_ingreso: 'Ana Torres' } } }));
    await waitFor(() => {
      expect(nombre).toHaveValue('Ana Torres');
      expect(marca).toHaveValue('Mazda');
    });
    fireEvent.click(nombre.closest('tr')!);
    expect(acciones.onSeleccionar).toHaveBeenCalledWith(expect.objectContaining({
      persona_ingreso: 'Ana Torres', vehiculo: expect.objectContaining({ marca: 'Mazda' }),
    }));
  });

  it('pinta de rojo solo la lista negra y los pasos sin lectura de placa; lo demás queda en blanco', async () => {
    mostrar([
      paso(1),
      paso(2, { estado_validacion: 'no_reconocido', fecha_hora_salida: '2026-10-26T15:30:00Z' }),
      paso(3, { estado_validacion: 'autorizado', autorizado: permiso }),
      paso(4, { autorizado: permiso }),
      paso(5, { estado_validacion: 'salida_registrada', tipo_movimiento: 'salida' }),
      paso(6, { estado_validacion: 'alerta' }),
      paso(7, { estado_procesamiento: 'no_legible', placa: null, placa_reconocida: null }),
    ]);
    await screen.findByLabelText('Titular del registro 7');
    expect(screen.getAllByRole('columnheader').slice(0, 3).map(celda => celda.textContent)).toEqual(['N.º', 'Cédula', 'Titular']);
    const fila = (id: number) => screen.getByLabelText(`Titular del registro ${id}`).closest('tr')!;
    for (const id of [1, 2, 3, 4, 5]) expect(fila(id).className).not.toMatch(/fila-(alerta|sin-lectura)/);
    expect(fila(6)).toHaveClass('fila-alerta');
    expect(fila(7)).toHaveClass('fila-sin-lectura');
    expect(within(fila(1)).getAllByRole('cell')[13]).toHaveTextContent(/^—$/);
    const horaSalida = within(fila(2)).getAllByRole('cell')[7];
    expect(horaSalida).toHaveTextContent('10:30:00');
    expect(horaSalida.style.background).toBe('');
    expect(horaSalida.style.backgroundColor).toBe('');
  });

  it('el ingreso autorizado sigue en blanco después de registrar su salida', async () => {
    const ingreso = paso(1, { estado_validacion: 'autorizado', autorizado: permiso });
    const actualizada = { ...ingreso, fecha_hora_salida: '2026-10-26T16:00:00Z' };
    const acciones = mostrar([ingreso]);
    acciones.onRegistrarSalida.mockResolvedValue(actualizada);

    fireEvent.click(await screen.findByRole('button', { name: 'Registrar salida' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Titular del registro 1').closest('tr')).toHaveTextContent('Registrada');
    });
    expect(screen.getByLabelText('Titular del registro 1').closest('tr')!.className).not.toMatch(/fila-(alerta|sin-lectura)/);
  });

  it('conserva la autorización devuelta al guardar datos de un vehículo sin placa', async () => {
    const ingreso = paso(1, { estado_validacion: 'no_reconocido', sin_placa: true, placa: null, placa_reconocida: null });
    const guardado = {
      ...ingreso,
      estado_validacion: 'autorizado' as const,
      validado_manualmente: true,
      autorizado: { id: 8, propietario: 'Nuevo Titular', departamento: null },
      persona_ingreso: 'Nuevo Titular',
      vehiculo: { ...ingreso.vehiculo, modelo: 'Aveo' },
    };
    patch.mockResolvedValue({ data: { deteccion: guardado } });
    mostrar([ingreso], true);

    const titular = await screen.findByLabelText('Titular del registro 1');
    const fila1Antes = titular.closest('tr');
    fireEvent.change(titular, { target: { value: 'Nuevo Titular' } });
    fireEvent.blur(titular);

    // Sin placa pero identificado y autorizado por su titular: deja el rojo
    expect(fila1Antes).toHaveClass('fila-sin-lectura');
    await waitFor(() => expect(titular.closest('tr')!.className).not.toMatch(/fila-sin-lectura/));
  });

  it('muestra solo los iconos de editar y eliminar sin seleccionar al pulsar las acciones', async () => {
    const ingreso = paso(1);
    const acciones = mostrar([ingreso]);
    const fila = (await screen.findByLabelText('Titular del registro 1')).closest('tr')!;
    fireEvent.click(fila);
    expect(acciones.onSeleccionar).toHaveBeenCalledWith(ingreso);
    acciones.onSeleccionar.mockClear();

    const celdaAcciones = within(fila).getAllByRole('cell')[15];
    const botones = within(celdaAcciones).getAllByRole('button');
    expect(botones).toHaveLength(2);
    expect(botones.every(boton => boton.textContent === '')).toBe(true);
    expect(within(celdaAcciones).queryByRole('button', { name: 'Restringir' })).not.toBeInTheDocument();
    expect(within(celdaAcciones).queryByRole('button', { name: 'Ampliar evidencia' })).not.toBeInTheDocument();
    fireEvent.click(within(celdaAcciones).getByRole('button', { name: 'Editar registro' }));
    expect(acciones.onValidar).toHaveBeenCalledWith(ingreso);
    fireEvent.click(within(fila).getByRole('button', { name: 'Eliminar registro' }));
    expect(acciones.onEliminar).toHaveBeenCalledWith(ingreso);
    expect(acciones.onSeleccionar).not.toHaveBeenCalled();
  });
});
