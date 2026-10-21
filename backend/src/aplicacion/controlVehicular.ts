import { errorValidacion, type Actor, type PuertoAuditoria } from './comun';
import type { CalendarioLocal } from './calendario';
import { leerPeriodoReporte } from '../dominio/periodo';
import {
  diaLocal, extensionTurno, fechaHoraHoja, filasControlVehicular, leerFormato, leerTurno, lineaFecha,
  TIPO_ARCHIVO, TITULO_CONTROL, TURNOS, type HojaControl, type MovimientoControl,
} from '../dominio/controlVehicular';

/**
 * Reporte de control vehicular de la garita en PDF o Excel (dominio/controlVehicular.ts): los
 * ingresos de un período y turno, cada uno con su salida, en el formato de la hoja que se llenaba
 * a mano. Por omisión, el día de hoy completo. La descarga queda en la auditoría.
 */

export interface RepositorioControlVehicular {
  /**
   * Ingresos (de `camara`, si se indica) y salidas (de cualquier cámara) entre `desde` y `hasta`,
   * ya procesados.
   */
  movimientos(desde: Date, hasta: Date, camara: number | null): Promise<MovimientoControl[]>;
  /** Nombre de la cámara (para el encabezado) */
  nombreCamara(id: number): Promise<string | null>;
}

/** Genera el archivo de la hoja (infraestructura/servicios/documentosControl.ts). */
export interface PuertoDocumentosControl {
  pdf(hoja: HojaControl): Promise<Buffer>;
  excel(hoja: HojaControl): Promise<Buffer>;
}

export interface DependenciasControlVehicular {
  repositorio: RepositorioControlVehicular;
  documentos: PuertoDocumentosControl;
  tiempo: CalendarioLocal;
  /** Encabezado configurable (Configuración › Institución) */
  institucion: () => { sede: string; lugar: string; ciudad: string };
  auditoria: PuertoAuditoria;
}

/** Las salidas se buscan hasta 24 h después del último ingreso del período. */
const MARGEN_SALIDAS_MS = 24 * 3_600_000;

export function casosControlVehicular(d: DependenciasControlVehicular) {
  return {
    async generar(consulta: { desde?: unknown; hasta?: unknown; camara?: unknown; turno?: unknown; formato?: unknown }, actor: Actor) {
      const ahora = d.tiempo.ahora();
      const periodo = leerPeriodoReporte(consulta, { desde: d.tiempo.inicioDiaLocal(ahora), hasta: ahora });
      if (!periodo.ok) throw errorValidacion(periodo.error);
      const turno = leerTurno(consulta.turno);
      if (!turno.ok) throw errorValidacion(turno.error);
      const formato = leerFormato(consulta.formato);
      if (!formato.ok) throw errorValidacion(formato.error);

      const { desde, hasta, camara } = periodo.valor;
      const desfase = d.tiempo.desfaseMinutos(ahora);
      const primerDia = diaLocal(desde, desfase);
      const ultimoDia = diaLocal(hasta, desfase);
      // El turno nocturno del último día termina a las 07:00 del siguiente
      const fin = new Date(hasta.getTime() + extensionTurno(turno.valor) + MARGEN_SALIDAS_MS);
      const [movimientos, nombreCamara] = await Promise.all([
        d.repositorio.movimientos(desde, fin, camara),
        camara ? d.repositorio.nombreCamara(camara) : Promise.resolve(null),
      ]);
      const filas = filasControlVehicular(movimientos, { turno: turno.valor, desfase, primerDia, ultimoDia });

      const inst = d.institucion();
      const hoja: HojaControl = {
        sede: inst.sede, titulo: TITULO_CONTROL, lugar: inst.lugar,
        lineaFecha: lineaFecha(inst.ciudad, primerDia, ultimoDia),
        agente: actor.nombre, turno: TURNOS[turno.valor].etiqueta, horario: TURNOS[turno.valor].horario,
        camara: camara ? nombreCamara ?? `Cámara ${camara}` : null,
        generado: fechaHoraHoja(ahora, desfase), filas,
      };
      const contenido = formato.valor === 'pdf' ? await d.documentos.pdf(hoja) : await d.documentos.excel(hoja);
      await d.auditoria.operacion(actor, 'REPORTE_CONTROL_VEHICULAR', 'deteccion', null,
        `${formato.valor.toUpperCase()} · ${primerDia}${ultimoDia !== primerDia ? ` a ${ultimoDia}` : ''} · turno ${TURNOS[turno.valor].etiqueta.toLowerCase()}`
        + `${hoja.camara ? ` · ${hoja.camara}` : ''} · ${filas.length} ingresos`);
      const dias = ultimoDia !== primerDia ? `${primerDia}_${ultimoDia}` : primerDia;
      return { nombre: `control_vehicular_${dias}_${turno.valor}.${formato.valor}`, tipo: TIPO_ARCHIVO[formato.valor], contenido, ingresos: filas.length };
    },
  };
}

export type CasosControlVehicular = ReturnType<typeof casosControlVehicular>;
