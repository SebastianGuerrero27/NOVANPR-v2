import { getDB } from '../db';
import { asignarCamaras, parsearExclusiones, parsearRoi } from '../../dominio/camaras';
import { CamaraParaMotor, enviarCamarasAnpr, estadoServicioAnpr } from './servicioAnpr';
import { emitEvent } from './socket';
import { rutaCamara, sincronizarRutas, urlLecturaMotor } from './medios';

/**
 * Cámaras que procesa cada motor ANPR.
 *
 * Toda cámara habilitada con análisis ANPR se reparte entre los motores en línea
 * (dominio/camaras.ts → asignarCamaras) y cada motor recibe su lista completa. Se repite al iniciar,
 * cada 15 s y al cambiar una cámara: reenviar la misma lista no cambia nada, así un motor reiniciado
 * retoma sus cámaras y las de un motor caído pasan a otro con capacidad. El motor no se conecta directo
 * a la cámara sino a su ruta en MediaMTX (una sola conexión con la cámara, compartida con el video
 * WebRTC de los navegadores). Junto con cada cámara viajan sus zonas: la región de interés y las zonas
 * de exclusión.
 */
const INTERVALO_MS = 15_000;

async function camarasAAnalizar(): Promise<CamaraParaMotor[]> {
  const r = await getDB().request().query(
    'SELECT id, nombre, roi, exclusiones FROM Camaras WHERE activa = TRUE AND analisis_anpr = TRUE ORDER BY id');
  return r.recordset.map(c => ({
    id: c.id, nombre: c.nombre, rtsp_url: urlLecturaMotor(rutaCamara(c.id)), roi: parsearRoi(c.roi), exclusiones: parsearExclusiones(c.exclusiones),
  }));
}

let sinCapacidad: number[] = [];
/** Cámaras con análisis ANPR que no caben en los motores en línea. */
export const camarasSinCapacidad = () => sinCapacidad;

let reparto = '';
let ocupado = false;
let pendiente = false;

async function repartir(): Promise<void> {
  const estado = await estadoServicioAnpr();
  const motores = (estado.motores ?? []).filter(m => m.en_linea);
  if (!motores.length) return;
  const camaras = await camarasAAnalizar();
  const asignacion = asignarCamaras(camaras.map(c => c.id), motores.map(m => ({ indice: m.indice, capacidad: m.max_camaras, camaras: m.camaras })));
  if (camaras.length) await sincronizarRutas();
  await Promise.all(motores.map(async m => {
    const suyas = asignacion.porMotor.get(m.indice) ?? [];
    try {
      await enviarCamarasAnpr(m.indice, camaras.filter(c => suyas.includes(c.id)));
    } catch (e: any) {
      console.warn(`[MONITOREO] El motor ${m.indice} no aceptó sus cámaras:`, e.message);
    }
  }));
  if (asignacion.sinCapacidad.length && asignacion.sinCapacidad.join() !== sinCapacidad.join()) {
    console.warn(`[MONITOREO] Sin capacidad para analizar las cámaras ${asignacion.sinCapacidad.join(', ')}: agregue un motor o aumente ANPR_MAX_CAMARAS.`);
  }
  sinCapacidad = asignacion.sinCapacidad;
  const nuevo = JSON.stringify([[...asignacion.porMotor.entries()].sort(), sinCapacidad]);
  if (nuevo !== reparto) {
    reparto = nuevo;
    console.log(`[MONITOREO] Cámaras por motor: ${[...asignacion.porMotor.entries()].map(([m, ids]) => `motor ${m}: ${ids.join(', ') || '—'}`).join(' · ')}`);
    emitEvent('monitoreo:camaras', { sin_capacidad: sinCapacidad });
  }
}

/** Reparte las cámaras entre los motores; si ya está en curso, se repite al terminar para no perder el cambio. */
export async function sincronizarMotores(): Promise<void> {
  if (ocupado) { pendiente = true; return; }
  ocupado = true;
  try {
    do {
      pendiente = false;
      await repartir();
    } while (pendiente);
  } catch (e: any) {
    console.warn('[MONITOREO] No se pudieron asignar las cámaras a los motores:', e.message);
  } finally {
    ocupado = false;
  }
}

export function iniciarSincronizacionMotor(): void {
  setTimeout(() => void sincronizarMotores(), 5000).unref();
  setInterval(() => void sincronizarMotores(), INTERVALO_MS).unref();
}
