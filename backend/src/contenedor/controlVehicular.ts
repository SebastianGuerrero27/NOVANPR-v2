import { casosControlVehicular } from '../aplicacion/controlVehicular';
import { auditoriaSql } from '../infraestructura/adaptadores';
import { calendarioLocal } from '../infraestructura/calendarioLocal';
import { repositorioControlVehicularSql } from '../infraestructura/persistencia/controlVehicularSql';
import { config } from '../infraestructura/servicios/configuracion';
import { documentosControl } from '../infraestructura/servicios/documentosControl';

/** Raíz de composición del reporte de control vehicular: consulta SQL, PDF y Excel, encabezado configurable y auditoría. */
export const controlVehicular = casosControlVehicular({
  repositorio: repositorioControlVehicularSql,
  documentos: documentosControl,
  tiempo: calendarioLocal,
  institucion: () => ({
    sede: config.texto('reporte_control_sede'),
    lugar: config.texto('reporte_control_lugar'),
    ciudad: config.texto('reporte_control_ciudad'),
  }),
  auditoria: auditoriaSql,
});
