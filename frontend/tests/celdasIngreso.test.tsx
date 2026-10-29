import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deteccion } from '../src/dominio/tipos';

const { patch } = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({ default: { patch }, mensajeError: String }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
import { CeldaIngreso } from '../src/interfaz/componentes/CeldaIngreso';

const ingreso = (cambios: Partial<Deteccion> = {}): Deteccion => ({
  id: 15, placa: 'PBA1234', placa_reconocida: 'PBA1234', placa_validada: null,
  estado_validacion: 'pendiente_revision', estado_procesamiento: 'procesado',
  confianza_deteccion: null, confianza_ocr: null,
  fecha_hora_ingreso: '2026-10-26T15:00:00Z', fecha_hora_salida: null,
  tipo_movimiento: 'ingreso', fecha_hora_procesamiento: null, fuente: 'manual', tracking_id: null,
  imagen_vehiculo: null, imagen_placa: null, camara: null,
  tipo_vehiculo: 'Automóvil', vehiculo: { tipo: 'Automóvil', marca: 'Kia', modelo: 'Aveo', color: null },
  verificacion_vehiculo: null, verificacion_detalle: null, alerta: null, autorizado: null,
  validado_manualmente: false, validacion: null, persona_ingreso: 'Ana Torres', motivo_ingreso: 'Visita',
  datos_permiso: { cedula: '0123456789' },
  ...cambios,
});

type Campo = ComponentProps<typeof CeldaIngreso>['campo'];
function contenido(campo: Campo, d: Deteccion, onActualizada = vi.fn(), editable = true) {
  return <table><tbody><tr><CeldaIngreso d={d} campo={campo} editable={editable} onActualizada={onActualizada} /></tr></tbody></table>;
}

describe('Inputs visibles en las celdas de ingreso', () => {
  beforeEach(() => { patch.mockReset(); });

  it.each([
    ['cedula', 'Cédula', '0123456789'],
    ['persona_ingreso', 'Titular', 'Ana Torres'],
    ['tipo_vehiculo', 'Vehículo', 'Automóvil'],
    ['marca', 'Marca', 'Kia'],
    ['modelo', 'Modelo', 'Aveo'],
    ['motivo_ingreso', 'Motivo', 'Visita'],
  ] as const)('muestra el input %s sin abrir un editor', (campo, etiqueta, valor) => {
    render(contenido(campo, ingreso()));
    expect(screen.getByLabelText(`${etiqueta} del registro 15`)).toHaveValue(valor);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([['marca', 'Marca'], ['modelo', 'Modelo']] as const)('permite llenar %s cuando no vino de la cámara', (campo, etiqueta) => {
    render(contenido(campo, ingreso({ vehiculo: { tipo: 'Automóvil', marca: null, modelo: null, color: null } })));
    const input = screen.getByLabelText(`${etiqueta} del registro 15`);
    expect(input).toHaveValue('');
    expect(input).not.toHaveAttribute('readonly');
    fireEvent.change(input, { target: { value: campo === 'marca' ? 'Mazda' : 'CX-5' } });
    expect(input).toHaveValue(campo === 'marca' ? 'Mazda' : 'CX-5');
  });

  it('guarda al salir de la cédula y conserva sus ceros iniciales', async () => {
    const actualizada = ingreso({ datos_permiso: { cedula: '0012345678' } });
    patch.mockResolvedValue({ data: { deteccion: actualizada } });
    const onActualizada = vi.fn();
    render(contenido('cedula', ingreso(), onActualizada));
    const input = screen.getByLabelText('Cédula del registro 15');
    fireEvent.change(input, { target: { value: '0012345678' } });
    fireEvent.blur(input);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/detecciones/15/ingreso', { cedula: '0012345678' }));
    await waitFor(() => expect(onActualizada).toHaveBeenCalledWith(actualizada, 'cedula'));
    expect(input).toHaveValue('0012345678');
  });

  it('guarda el motivo escrito directamente en la celda', async () => {
    const actualizada = ingreso({ motivo_ingreso: 'Reunión de coordinación' });
    patch.mockResolvedValue({ data: { deteccion: actualizada } });
    const onActualizada = vi.fn();
    render(contenido('motivo_ingreso', ingreso(), onActualizada));
    const input = screen.getByLabelText('Motivo del registro 15');
    fireEvent.change(input, { target: { value: 'Reunión de coordinación' } });
    fireEvent.blur(input);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/detecciones/15/ingreso', { motivo_ingreso: 'Reunión de coordinación' }));
    await waitFor(() => expect(onActualizada).toHaveBeenCalledWith(actualizada, 'motivo_ingreso'));
    expect(input).toHaveValue('Reunión de coordinación');
  });

  it('Enter y blur guardan una sola vez mientras la petición está pendiente', async () => {
    let terminar!: (v: { data: { deteccion: Deteccion } }) => void;
    patch.mockImplementation(() => new Promise(resolve => { terminar = resolve; }));
    render(contenido('marca', ingreso()));
    const input = screen.getByLabelText('Marca del registro 15');
    fireEvent.change(input, { target: { value: 'Mazda' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/detecciones/15/ingreso', { marca: 'Mazda' });
    await act(async () => terminar({ data: { deteccion: ingreso({ vehiculo: { tipo: 'Automóvil', marca: 'Mazda', modelo: 'Aveo', color: null } }) } }));
    fireEvent.blur(input);
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('Escape restaura el valor guardado sin enviar el borrador', () => {
    render(contenido('persona_ingreso', ingreso()));
    const input = screen.getByLabelText('Titular del registro 15');
    fireEvent.change(input, { target: { value: 'María Pérez' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('Ana Torres');
    fireEvent.blur(input);
    expect(patch).not.toHaveBeenCalled();
  });

  it('señala la cédula incompleta sin enviarla ni borrar lo escrito', async () => {
    render(contenido('cedula', ingreso()));
    const input = screen.getByLabelText('Cédula del registro 15');
    fireEvent.change(input, { target: { value: '0123' } });
    fireEvent.blur(input);
    expect(patch).not.toHaveBeenCalled();
    expect(input).toHaveValue('0123');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(await screen.findByText(/10 dígitos/)).toBeInTheDocument();
  });

  it('un error al guardar mantiene el borrador y permite reintentar', async () => {
    patch.mockRejectedValueOnce(new Error('fallo del servidor'));
    patch.mockResolvedValueOnce({ data: { deteccion: ingreso({ persona_ingreso: 'María Pérez' }) } });
    render(contenido('persona_ingreso', ingreso()));
    const input = screen.getByLabelText('Titular del registro 15');
    fireEvent.change(input, { target: { value: 'María Pérez' } });
    fireEvent.blur(input);
    expect(await screen.findByText(/fallo del servidor/)).toBeInTheDocument();
    expect(input).toHaveValue('María Pérez');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
  });

  it('un refresco de la fila conserva la edición en curso', () => {
    const actual = ingreso();
    const vista = render(contenido('persona_ingreso', actual));
    const input = screen.getByLabelText('Titular del registro 15');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'María Pérez' } });
    vista.rerender(contenido('persona_ingreso', { ...actual, persona_ingreso: 'Valor remoto' }));
    expect(input).toHaveValue('María Pérez');
    expect(patch).not.toHaveBeenCalled();
  });

  it('sin permiso mantiene el input visible y de solo lectura', () => {
    render(contenido('cedula', ingreso(), vi.fn(), false));
    const input = screen.getByLabelText('Cédula del registro 15');
    expect(input).toHaveValue('0123456789');
    expect(input).toHaveAttribute('readonly');
    fireEvent.blur(input);
    expect(patch).not.toHaveBeenCalled();
  });
});
