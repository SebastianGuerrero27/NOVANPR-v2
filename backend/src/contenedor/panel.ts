import { casosPanel } from '../aplicacion/panel';
import { calendarioLocal } from '../infraestructura/calendarioLocal';
import { repositorioPanelSql } from '../infraestructura/persistencia/panelSql';
import { conCacheBreve } from '../infraestructura/servicios/cacheBreve';
import { presentarDeteccion } from '../infraestructura/presentacionDetecciones';
import { config } from '../infraestructura/servicios/configuracion';
import { emailService } from '../infraestructura/servicios/emailService';
import { estadoServicioAnpr } from '../infraestructura/servicios/servicioAnpr';

export { usoCpuSistema } from '../infraestructura/servicios/recursosCpu';

/** Raíz de composición del panel de inicio: agregaciones en SQL Server, calendario local y estado de los servicios. */
export const panel = casosPanel({
  // Cada paso vehicular recarga el panel de todas las sesiones: comparten una sola lectura cada 2 s
  repositorio: { ...repositorioPanelSql, operacion: conCacheBreve(repositorioPanelSql.operacion, { vigenciaMs: 2000 }) },
  tiempo: calendarioLocal,
  diasAviso: () => config.entero('aviso_vencimiento_dias'),
  // Misma representación de una detección que el historial y el tiempo real
  mapearDeteccion: fila => presentarDeteccion(fila),
  servicios: { anpr: estadoServicioAnpr, correoConfigurado: () => emailService.smtpConfigurado() },
});
