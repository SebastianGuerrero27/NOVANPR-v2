import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Deteccion, Franja } from '../src/dominio/tipos';
import { horarioValido, leerHorarioFormulario } from '../src/dominio/horario';

vi.mock('../src/infraestructura/api', () => ({ default: { get: vi.fn().mockResolvedValue({ data: { autorizado: null } }) }, mensajeError: String, urlMedia: (ruta: string | null) => ruta }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
// La ventana de autorizar consulta la sesión: un guardia gestiona el padrón (agrega a la lista blanca)
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ user: { id: 3, nombre: 'Guardia' }, puede: () => true }) }));
import { EditorHorario } from '../src/interfaz/componentes/EditorHorario';
import { ValidarModal } from '../src/interfaz/componentes/deteccion';

const franja = { dias: [1, 3, 5], desde: '07:00', hasta: '19:00' };
const ingreso = (horario: unknown, horario_error?: string): Deteccion => ({
  id: 15, placa: 'PBA1234', placa_reconocida: 'PBA1234', placa_validada: null,
  estado_validacion: 'pendiente_revision', estado_procesamiento: 'procesado',
  confianza_deteccion: 0.95, confianza_ocr: 0.98, fecha_hora_ingreso: '2026-10-26T15:00:00Z',
  tipo_movimiento: 'ingreso', fecha_hora_procesamiento: null, fuente: 'manual', tracking_id: null,
  imagen_vehiculo: null, imagen_placa: null, camara: null,
  tipo_vehiculo: 'Automóvil', vehiculo: { tipo: 'Automóvil', marca: 'Mazda', modelo: 'CX-5', color: 'Blanco' },
  verificacion_vehiculo: null, verificacion_detalle: null, alerta: null, autorizado: null,
  validado_manualmente: false, validacion: null, persona_ingreso: 'Titular de prueba', motivo_ingreso: 'Visita',
  datos_permiso: { horario: horario as Franja[] | null, horario_error },
});

describe('Horarios históricos en el formulario de validación', () => {
  it('interpreta la cadena JSON que conserva la ficha del permiso y muestra sus días y horas', () => {
    render(<MemoryRouter><ValidarModal d={ingreso(JSON.stringify([franja]))} onCerrar={vi.fn()} /></MemoryRouter>);
    const dias = screen.getByRole('group', { name: 'Días de la franja 1' });
    expect(within(dias).getByRole('button', { name: 'L' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dias).getByRole('button', { name: 'M' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Desde')).toHaveValue('07:00');
    expect(screen.getByLabelText('Hasta')).toHaveValue('19:00');
    expect(screen.getByRole('button', { name: 'Confirmar placa' })).toBeEnabled();
  });

  it.each([{}, '{incorrecto', [{ dias: null, desde: '07:00', hasta: '19:00' }]])('un horario dañado no cierra la pantalla ni permite guardar sin revisarlo (%j)', horario => {
    render(<MemoryRouter><ValidarModal d={ingreso(horario)} onCerrar={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('El horario guardado no es válido');
    expect(screen.queryByText(/el permiso es válido las 24 horas/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar placa' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Laboral L–V 07:00–19:00' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar placa' })).toBeEnabled();
  });

  it('respeta el marcador de corrupción normalizado por la API hasta una selección explícita', () => {
    render(<MemoryRouter><ValidarModal d={ingreso(null, 'El horario guardado no es válido.')} onCerrar={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Confirmar placa' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Sin restricción (24/7)' }));
    expect(screen.getByRole('button', { name: 'Confirmar placa' })).toBeEnabled();
  });

  it('el editor por sí mismo también protege los contratos de otras listas y solicitudes', () => {
    render(<EditorHorario valor={{} as Franja[]} onCambiar={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/horario guardado/);
  });

  it.each([null, undefined, [], '[]', JSON.stringify([franja]), [franja]])('admite horarios válidos con su representación histórica (%j)', horario => {
    expect(horarioValido(horario)).toBe(true);
  });

  it.each([{}, false, 3, 'malformado', [null], [{ ...franja, dias: [] }], [{ ...franja, dias: [8] }], [{ ...franja, hasta: '07:00' }]])('rechaza una forma inválida sin lanzar excepciones (%j)', horario => {
    expect(horarioValido(horario)).toBe(false);
    expect(leerHorarioFormulario(horario).error).toBeTruthy();
  });
});
