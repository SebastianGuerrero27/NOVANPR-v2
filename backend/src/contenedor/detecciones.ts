import { casosDetecciones, type DeteccionDTO } from '../aplicacion/detecciones';
import { getDB } from '../infraestructura/db';
import { auditoriaSql, eventosSocket } from '../infraestructura/adaptadores';
import { repositorioDeteccionesSql } from '../infraestructura/persistencia/deteccionesSql';
import { presentarDeteccion } from '../infraestructura/presentacionDetecciones';
import { notificarDecision, type PasoNotificable } from '../infraestructura/servicios/avisosAcceso';
import { politicaAutorizacion } from '../infraestructura/servicios/configuracion';
import { eliminarEvidencia } from '../infraestructura/servicios/media';
import { estadoServicioAnpr, guardarCuadroAnpr, historialAnpr } from '../infraestructura/servicios/servicioAnpr';
import { resolverPorDeteccion } from '../infraestructura/servicios/notificaciones';
import { findBlacklistMatch, findPermisoExacto } from '../infraestructura/servicios/plateMatching';
import { ZONA_HORARIA } from '../infraestructura/servicios/tiempo';
import { compararVehiculo } from '../dominio/vehiculoAtributos';
import { pdfRegistros } from '../infraestructura/servicios/documentosRegistros';
import { conservarEvidenciaListas } from '../infraestructura/servicios/evidenciaListas';
import { LISTA_BLANCA } from '../dominio/listas';
import { listas } from './listas';

/**
 * Raíz de composición de las detecciones: SQL Server, cruce con las listas, evidencia en disco,
 * difusión por Socket.IO, centro de notificaciones y auditoría.
 */
export const detecciones = casosDetecciones({
  pdfRegistros,
  repositorio: repositorioDeteccionesSql,
  listas: {
    alerta: placa => findBlacklistMatch(getDB(), placa),
    permiso: placa => findPermisoExacto(getDB(), placa),
  },
  presentar: presentarDeteccion,
  politica: politicaAutorizacion,
  compararVehiculo: (registrado, observado) => compararVehiculo(registrado, observado),
  avisos: {
    // Sin esperar: un fallo de notificación no interrumpe el registro del paso
    decision: (dto: DeteccionDTO, decision, permiso) => { void notificarDecision(dto as unknown as PasoNotificable, decision, permiso); },
    resolverPorDeteccion,
  },
  evidencia: { eliminar: eliminarEvidencia },
  // Mismo caso de uso que el formulario de la lista blanca: valida, guarda (o reactiva), audita y avisa
  padron: {
    async registrar(entrada, actor) {
      const { accion } = await listas.registrar(LISTA_BLANCA, entrada, actor);
      return { accion: accion === 'reactivado' ? 'reactivado' : 'creado' };
    },
  },
  evidenciaListas: { conservar: fila => conservarEvidenciaListas(getDB(), fila, {
    alGuardar: lista => eventosSocket.emitir('listas:actualizadas', { lista }),
  }) },
  evidenciaManual: {
    async cuadros(camaraId) {
      try {
        const h = await historialAnpr();
        if (h.camara_id !== camaraId) {
          return { disponible: false, motivo: 'Solo hay fotos de los últimos 30 s de la cámara que procesa el motor ANPR.', cuadros: [] };
        }
        return { disponible: true, cuadros: h.cuadros };
      } catch {
        return { disponible: false, motivo: 'El motor ANPR no respondió.', cuadros: [] };
      }
    },
    async guardar(camaraId, t) {
      const estado = await estadoServicioAnpr();
      return estado.camara_activa?.id === camaraId ? guardarCuadroAnpr(t) : null;
    },
  },
  eventos: eventosSocket,
  auditoria: auditoriaSql,
  tiempo: { ahora: () => new Date(), zona: ZONA_HORARIA },
});
