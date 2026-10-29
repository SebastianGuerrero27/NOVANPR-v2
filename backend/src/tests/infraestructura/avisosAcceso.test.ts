jest.mock('../../infraestructura/servicios/notificaciones', () => ({ notificar: jest.fn().mockResolvedValue(null) }));
jest.mock('../../infraestructura/db', () => ({ getDB: jest.fn() }));
jest.mock('../../infraestructura/servicios/configuracion', () => ({ config: { entero: () => 3 } }));

import { notificar } from '../../infraestructura/servicios/notificaciones';
import { notificarDecision, notificarPermisoOtorgado } from '../../infraestructura/servicios/avisosAcceso';
import type { Decision } from '../../dominio/decisionAcceso';

const mockNotificar = notificar as jest.Mock;
afterEach(() => mockNotificar.mockClear());

const AUTORIZADO: Decision = { estado: 'autorizado', regla: 'R5', restriccion: null, motivos: [] };
const paso = {
  id: 77, placa: 'PBA1234', fecha_hora_ingreso: '2026-10-03T12:00:00Z',
  camara: { nombre: 'Garita norte', ubicacion: 'Ingreso principal' }, alerta: null, autorizado: { propietario: 'Juan Pérez' },
};

describe('avisos de permisos de placa', () => {
  it('no agrupa la llegada de permisos de distintos gestores', async () => {
    await notificarDecision(paso, AUTORIZADO, { registrado_por: 9 });
    await notificarDecision(paso, AUTORIZADO, { registrado_por: 10 });
    const [primero, segundo] = mockNotificar.mock.calls.map(([aviso]) => aviso);
    expect(primero.destinatarios.usuarios).toEqual([9]);
    expect(segundo.destinatarios.usuarios).toEqual([10]);
    expect(primero.claveDedup).not.toBe(segundo.claveDedup);
  });
  it('permiso por nombre: avisa a garita sin mostrar una placa inexistente', async () => {
    await notificarPermisoOtorgado({ id: 7, placa: null, propietario: 'Ana Pérez' }, { id: 9, nombre: 'Gestor' });
    expect(mockNotificar).toHaveBeenCalledWith(expect.objectContaining({
      titulo: 'Agregado a la lista blanca · Ana Pérez',
      mensaje: expect.stringContaining('pendiente de placa'),
      enlace: '/listas/autorizados?q=Ana%20P%C3%A9rez',
    }));
  });
  it('permiso otorgado: avisa a la garita con enlace a la lista blanca y excluye a quien lo otorgó', async () => {
    await notificarPermisoOtorgado(
      { id: 5, placa: 'PBA1234', propietario: 'Juan Pérez', marca: 'Toyota', modelo: 'Corolla', color: 'Blanco', fecha_vencimiento: null, horario: null },
      { id: 9, nombre: 'Gabriela Gestora' },
    );
    expect(mockNotificar).toHaveBeenCalledWith(expect.objectContaining({
      tipo: 'padron.permiso_otorgado',
      mensaje: expect.stringContaining('Se ha otorgado permiso a Juan Pérez con vehículo Toyota Corolla Blanco de placa PBA1234'),
      enlace: '/listas/autorizados?q=PBA1234',
      destinatarios: { excluir: [9] },
    }));
  });

  it('llegada: se notifica a la garita y a quien otorgó el permiso', async () => {
    await notificarDecision(paso, AUTORIZADO, { registrado_por: 9, propietario: 'Juan Pérez' });
    expect(mockNotificar).toHaveBeenCalledTimes(1);
    expect(mockNotificar).toHaveBeenCalledWith(expect.objectContaining({
      tipo: 'acceso.llegada_permiso',
      titulo: 'Llegó el vehículo autorizado · PBA1234',
      enlace: '/listas/autorizados?q=PBA1234',
      destinatarios: { permiso: 'avisos:garita', usuarios: [9] },
    }));
  });

  it('llegada: sin autor conocido del permiso se notifica a la garita', async () => {
    await notificarDecision(paso, AUTORIZADO, { registrado_por: null });
    await notificarDecision(paso, AUTORIZADO);
    expect(mockNotificar).toHaveBeenCalledTimes(2);
    expect(mockNotificar).toHaveBeenCalledWith(expect.objectContaining({
      tipo: 'acceso.llegada_permiso',
      destinatarios: { permiso: 'avisos:garita', usuarios: [] },
    }));
  });
});
