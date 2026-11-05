import { type Actor, errorValidacion } from './comun';
import type { PuertoMotorAnpr, PuertoServidorVideo, PuertoTickets } from './camaras';
import { leerAlcance, leerIdCamara } from '../dominio/camaras';

/**
 * Casos de uso del monitoreo en vivo:
 *
 *   estado()                         estado de los motores ANPR y de cada cámara en análisis
 *   ticket(alcance, camaraId, actor) credencial de 60 s para el video (WebRTC o WebSocket del motor)
 *
 * El motor no se conecta directo a la cámara: lee su ruta cam_<id> de MediaMTX, que comparte
 * una sola conexión con la cámara entre el motor y los navegadores.
 */

export interface DependenciasMonitoreo {
  motor: PuertoMotorAnpr;
  video: Pick<PuertoServidorVideo, 'urlWebrtc'>;
  tickets: Pick<PuertoTickets, 'emitir'>;
  /** La pantalla oculta «Registrar salida» si está desactivado en Configuración */
  salidaManual: () => boolean;
}

export function casosMonitoreo(d: DependenciasMonitoreo) {
  return {
    /** Con las cámaras que no caben en los motores en línea: el navegador lo avisa. */
    async estado() {
      const estado = await d.motor.estado();
      const salida_manual = d.salidaManual();
      return estado.en_linea ? { ...estado, sin_capacidad: d.motor.sinCapacidad(), salida_manual } : { ...estado, salida_manual };
    },

    /** Ticket de 60 s para ver el video de las cámaras registradas y las pistas del motor que atiende la cámara. */
    ticket(alcanceSolicitado: unknown, camaraSolicitada: unknown, actor: Actor) {
      const alcance = leerAlcance(alcanceSolicitado);
      if (!alcance.ok) throw errorValidacion(alcance.error);
      const camara = leerIdCamara(camaraSolicitada);
      if (!camara.ok) throw errorValidacion(camara.error);
      return { ticket: d.tickets.emitir(actor.id, alcance.valor), url: d.motor.urlPublica(camara.valor ?? undefined), webrtc: d.video.urlWebrtc() };
    },
  };
}

export type CasosMonitoreo = ReturnType<typeof casosMonitoreo>;
