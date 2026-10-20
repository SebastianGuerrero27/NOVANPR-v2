/**
 * Evidencia de la lectura automática de un paso. El motor envía dos formas distintas: la de una
 * lectura de placa (formato, fila de caracteres, consenso, segundo OCR; ver
 * services/anpr/app/aplicacion/verificacion_placa.py) y la de un paso que registró sin lectura,
 * con el vehículo que vio en la zona de interés (services/anpr/app/aplicacion/paso_sin_placa.py).
 * El detalle del paso mostraba la segunda como si fuera la primera y fallaba al abrirlo.
 */
import type { EvidenciaLectura, EvidenciaSinPlaca } from './tipos';

/** Qué vio el motor en un paso sin lectura de placa, según su motivo. */
export const MOTIVO_SIN_PLACA: Record<string, string> = {
  vehiculo_sin_placa: 'El motor vio un vehículo en la zona de interés sin ninguna placa a la vista.',
  placa_no_leida: 'El motor vio algo con forma de placa durante el paso, pero no pudo leerlo.',
};

/** La evidencia es la de un paso registrado sin lectura de placa (no la de una lectura). */
export const esEvidenciaSinPlaca = (ev: EvidenciaLectura | EvidenciaSinPlaca | null | undefined): ev is EvidenciaSinPlaca =>
  !!ev && typeof (ev as EvidenciaSinPlaca).motivo === 'string' && !('valido' in ev);
