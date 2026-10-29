import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
const { eventos, reconocer, permisos } = vi.hoisted(() => ({ eventos: {} as Record<string, (d: unknown) => void>, reconocer: vi.fn().mockResolvedValue(undefined), permisos: { admin: false } }));
vi.mock('../src/aplicacion/tiempoReal', () => ({ useEvento: (evento: string, fn: (d: unknown) => void) => { eventos[evento] = fn; } }));
vi.mock('../src/aplicacion/AuthContext', () => ({ useAuth: () => ({ puede: (p: string) => permisos.admin || ['avisos:garita', 'solicitudes:crear', 'alertas:restringir'].includes(p) }) }));
vi.mock('../src/aplicacion/notificaciones', () => ({ useCentroNotificaciones: () => ({ reconocerDeteccion: reconocer }) }));
vi.mock('../src/interfaz/componentes/Notificaciones', () => ({ useNotificar: () => vi.fn() }));
vi.mock('../src/infraestructura/avisos', () => ({ alCambiarSonido: () => () => undefined, detenerSonido: vi.fn(), fijarSonido: vi.fn(), sonarAutorizado: vi.fn(), sonarDenegado: vi.fn(), sonidoActivo: () => false }));
vi.mock('../src/infraestructura/api', () => ({ default: {}, urlMedia: (v: string | null) => v, mensajeError: String }));
import { AvisosAcceso } from '../src/interfaz/componentes/AvisosAcceso';
beforeEach(() => { reconocer.mockClear(); permisos.admin = false; });
const mostrar = () => {
  const r = render(<MemoryRouter><AvisosAcceso /></MemoryRouter>);
  act(() => eventos['deteccion:alerta']({ id: 9, placa: 'ABC1234', fecha_hora_ingreso: new Date().toISOString(), estado_procesamiento: 'procesado', estado_validacion: 'no_reconocido', validado_manualmente: false, imagen_placa: null, imagen_vehiculo: null, camara: null }));
  return r;
};
it('muestra el acceso no autorizado en un cuadro compacto sin bloquear la pantalla', () => {
  const { container } = mostrar();
  expect(screen.getByText('ACCESO NO AUTORIZADO')).toBeInTheDocument();
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(container.querySelector('.alerta-acceso-fondo')).toBeNull();
  expect(container.querySelector('.avisos-autorizados .aviso-denegado')).not.toBeNull();
  expect(screen.getByText('Ver indicaciones').closest('details')).not.toHaveAttribute('open');
});
it('Enterado conserva el reconocimiento de la alarma y retira el cuadro', () => {
  mostrar(); fireEvent.click(screen.getByRole('button', { name: 'Enterado' }));
  expect(reconocer).toHaveBeenCalledWith(9);
  expect(screen.queryByText('ACCESO NO AUTORIZADO')).not.toBeInTheDocument();
});
it.each([false, true])('ofrece Autorizar y permite Restringir según permisos, admin=%s', admin => {
  permisos.admin = admin;
  mostrar();
  expect(screen.getByRole('button', { name: 'Autorizar' })).toBeInTheDocument();
  expect(Boolean(screen.queryByRole('button', { name: 'Restringir' }))).toBe(true);
  expect(screen.queryByRole('button', { name: /Solicitar permiso|Autorizar vehículo|Autorizar por excepción/ })).not.toBeInTheDocument();
});
it('Restringir abre directamente el formulario de lista negra', () => {
  permisos.admin = false;
  mostrar();
  fireEvent.click(screen.getByRole('button', { name: 'Restringir' }));
  expect(screen.getByText('Agregar placa a la lista negra')).toBeInTheDocument();
  expect(screen.getByText('Foto del vehículo para identificar marca y modelo')).toBeInTheDocument();
  expect(screen.getByLabelText('Placa*')).toHaveValue('ABC-1234');
});
