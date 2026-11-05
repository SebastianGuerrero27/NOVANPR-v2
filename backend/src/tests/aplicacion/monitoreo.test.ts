import type { EstadoMotor, PuertoMotorAnpr } from '../../aplicacion/camaras';
import { ErrorAplicacion, type Actor } from '../../aplicacion/comun';
import { casosMonitoreo } from '../../aplicacion/monitoreo';
import type { AlcanceTicket } from '../../dominio/camaras';

/** Casos de uso del monitoreo en vivo con dobles de prueba: sin base de datos, sin MediaMTX ni motor ANPR. */

const ADMIN: Actor = { id: 1, email: 'admin@ecu911.gob.ec', nombre: 'Administrador', rol: 'Admin', ip: '10.0.0.1' };
const GUARDIA: Actor = { id: 3, email: 'guardia@ecu911.gob.ec', nombre: 'Guardia de garita', rol: 'Guardia', ip: '10.0.0.3' };

const EN_LINEA: EstadoMotor = {
  en_linea: true, fps_captura: 25, fps_procesamiento: 12, detector: 'YOLO26n', ocr: 'PaddleOCR', capacidad: 4,
  camaras: [{ id: 3, motor: 0, conectada: true, fps_captura: 25, fps_procesamiento: 12, latencia: null, enlace: null }],
  motores: [{ indice: 0, en_linea: true, max_camaras: 4, camaras: [3], cpu_pct: 12 }],
};

function preparar() {
  const motor: jest.Mocked<PuertoMotorAnpr> = {
    estado: jest.fn().mockResolvedValue({ en_linea: false, error: 'Sin respuesta' }),
    sincronizar: jest.fn().mockResolvedValue(undefined),
    sinCapacidad: jest.fn(() => []),
    urlPublica: jest.fn((camaraId?: number) => (camaraId === 9 ? 'https://motor2.ecu911.local' : 'https://anpr.ecu911.local')),
  };
  const dependencias = {
    motor,
    video: { urlWebrtc: jest.fn(() => 'https://video.ecu911.local') },
    tickets: { emitir: jest.fn((usuarioId: number, alcance: AlcanceTicket) => `ticket-${usuarioId}-${alcance}`) },
    salidaManual: jest.fn(() => true),
  };
  return { casos: casosMonitoreo(dependencias), ...dependencias };
}

/** Tipo y mensaje del ErrorAplicacion (cualquier otro error hace fallar la prueba). */
const comoError = (e: unknown) => {
  if (e instanceof ErrorAplicacion) return { tipo: e.tipo, mensaje: e.message };
  throw e;
};
const falloSincrono = (fn: () => unknown) => {
  try { fn(); } catch (e) { return comoError(e); }
  throw new Error('se esperaba un error');
};

describe('Casos de uso · monitoreo', () => {
  describe('estado', () => {
    it('motor fuera de línea: se informa tal cual', async () => {
      const { casos, motor } = preparar();
      expect(await casos.estado()).toEqual({ en_linea: false, error: 'Sin respuesta', salida_manual: true });
      expect(motor.sinCapacidad).not.toHaveBeenCalled();
    });

    it('informa cada cámara en análisis y las que no caben en los motores', async () => {
      const { casos, motor } = preparar();
      motor.estado.mockResolvedValue(EN_LINEA);
      expect(await casos.estado()).toEqual({ ...EN_LINEA, sin_capacidad: [], salida_manual: true });
      motor.sinCapacidad.mockReturnValue([7, 8]);
      expect(await casos.estado()).toMatchObject({ en_linea: true, sin_capacidad: [7, 8] });
    });
  });

  describe('ticket de video', () => {
    it('por omisión stream, para cualquier rol con monitoreo', () => {
      const { casos, tickets } = preparar();
      expect(casos.ticket(undefined, undefined, GUARDIA)).toEqual({ ticket: 'ticket-3-stream', url: 'https://anpr.ecu911.local', webrtc: 'https://video.ecu911.local' });
      expect(casos.ticket('stream', undefined, GUARDIA).ticket).toBe('ticket-3-stream');
      expect(tickets.emitir).toHaveBeenCalledWith(3, 'stream');
    });

    it('entrega la URL del motor que atiende la cámara', () => {
      const { casos } = preparar();
      expect(casos.ticket('stream', 9, GUARDIA).url).toBe('https://motor2.ecu911.local');
      expect(casos.ticket('stream', 3, GUARDIA).url).toBe('https://anpr.ecu911.local');
    });

    it.each(['webcam', 'WEBCAM', ' webcam', 'video', 5, {}])('alcance %p fuera de los valores permitidos → 400 (sin webcam)', alcance => {
      const { casos, tickets } = preparar();
      expect(falloSincrono(() => casos.ticket(alcance, undefined, ADMIN))).toEqual({ tipo: 'validacion', mensaje: 'Alcance inválido. Valores: stream.' });
      expect(tickets.emitir).not.toHaveBeenCalled();
    });

    it.each(['abc', -1, 1.5])('cámara %p inválida → 400', camara => {
      const { casos, tickets } = preparar();
      expect(falloSincrono(() => casos.ticket('stream', camara, ADMIN)).tipo).toBe('validacion');
      expect(tickets.emitir).not.toHaveBeenCalled();
    });
  });
});
