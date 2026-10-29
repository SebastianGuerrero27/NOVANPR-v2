import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const { post, permisos } = vi.hoisted(() => ({ post: vi.fn(), permisos: new Set<string>() }));
vi.mock('../src/infraestructura/api', () => ({ default: { post }, mensajeError: String }));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ puede: (p: string) => permisos.has(p) }) }));
import { AprobarSolicitud, FormularioSolicitud } from '../src/interfaz/componentes/FormularioSolicitud';
import type { SolicitudAcceso } from '../src/dominio/tipos';
beforeEach(() => { permisos.clear(); post.mockReset().mockResolvedValue({ data: { message: 'Aprobado', solicitud: {} } }); });
const solicitud = { id: 7, placa: 'ABC1234', propietario: 'Ana Pérez', cedula: '0102030405', institucion: 'ECU 911', cargo: 'Analista', departamento: 'Soporte', categoria: 'VISITANTE', motivo: 'Reunión de trabajo', observaciones: 'Visita programada', vehiculo: { tipo: 'SUV', marca: 'Toyota', modelo: 'RAV4', color: 'blanco' }, fecha_inicio: null, fecha_fin: null, horario: null, solicitante: { id: 2, nombre: 'Guardia', email: 'guardia@example.com' }, fecha_solicitud: '2026-10-24T12:00:00Z', version: 1 } as SolicitudAcceso;
it('la solicitud muestra los mismos campos de persona, vehículo y vigencia que el permiso', async () => {
  render(<FormularioSolicitud onCerrar={vi.fn()} onEnviada={vi.fn()} />);
  for (const campo of ['Nombres y apellidos*', 'Cédula', 'Institución', 'Cargo', 'Departamento o unidad', 'Tipo de vehículo', 'Marca', 'Modelo', 'Color', 'Observaciones', 'Vigente desde', 'Vigente hasta']) expect(screen.getByLabelText(campo)).toBeInTheDocument();
  expect(screen.queryByLabelText('Categoría')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Placa*'), { target: { value: 'ABC1234' } });
  fireEvent.change(screen.getByLabelText('Nombres y apellidos*'), { target: { value: 'Ana Pérez' } });
  fireEvent.change(screen.getByLabelText('Cédula'), { target: { value: '0102030405' } });
  fireEvent.change(screen.getByLabelText('Institución'), { target: { value: 'ECU 911' } });
  fireEvent.change(screen.getByLabelText('Motivo del ingreso*'), { target: { value: 'Reunión de trabajo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/solicitudes-acceso', expect.objectContaining({ cedula: '0102030405', institucion: 'ECU 911' })));
});
it('el gestor puede ajustar los mismos datos al aprobar y no pierde la cédula', async () => {
  render(<AprobarSolicitud s={solicitud} onCerrar={vi.fn()} onAprobada={vi.fn()} />);
  expect(screen.getByLabelText('Cédula')).toHaveValue('0102030405');
  expect(screen.queryByLabelText('Categoría')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Cargo'), { target: { value: 'Coordinadora' } });
  fireEvent.click(screen.getByRole('button', { name: 'Aprobar y agregar a lista blanca' }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/solicitudes-acceso/7/aprobar', expect.objectContaining({ version: 1, ajustes: expect.objectContaining({ cedula: '0102030405', cargo: 'Coordinadora', observaciones: 'Visita programada' }) })));
});

it('al aprobar y validar un ingreso envía los datos del vehículo revisados', async () => {
  permisos.add('detecciones:validar');
  render(<AprobarSolicitud s={{ ...solicitud, deteccion_id: 15 }} onCerrar={vi.fn()} onAprobada={vi.fn()} />);
  expect(screen.getByRole('checkbox', { name: 'Autorizar también el ingreso #15 que originó la solicitud' })).toBeChecked();
  fireEvent.change(screen.getByLabelText('Marca*'), { target: { value: 'Mazda' } });
  fireEvent.click(screen.getByRole('button', { name: 'Aprobar y agregar a lista blanca' }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/detecciones/validar/15', expect.objectContaining({
    placa_validada: 'ABC1234', persona_ingreso: 'Ana Pérez', motivo_ingreso: 'Reunión de trabajo',
    tipo_vehiculo: 'SUV', marca: 'Mazda', modelo: 'RAV4', color: 'blanco',
  })));
});

it('permite aprobar solo el permiso cuando faltan datos para validar el ingreso', async () => {
  permisos.add('detecciones:validar');
  render(<AprobarSolicitud s={{ ...solicitud, deteccion_id: 15, vehiculo: { ...solicitud.vehiculo, color: null } }} onCerrar={vi.fn()} onAprobada={vi.fn()} />);
  const validar = screen.getByRole('checkbox', { name: 'Autorizar también el ingreso #15 que originó la solicitud' });
  const aprobar = screen.getByRole('button', { name: 'Aprobar y agregar a lista blanca' });
  expect(validar).not.toBeChecked();
  expect(aprobar).toBeEnabled();
  fireEvent.click(validar);
  expect(aprobar).toBeDisabled();
  fireEvent.click(validar);
  fireEvent.click(aprobar);
  await waitFor(() => expect(post).toHaveBeenCalledWith('/solicitudes-acceso/7/aprobar', expect.anything()));
  expect(post).not.toHaveBeenCalledWith('/detecciones/validar/15', expect.anything());
});
