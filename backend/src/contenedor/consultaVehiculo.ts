import { casosConsultaVehiculo } from '../aplicacion/consultaVehiculo';
import { ProveedorEcuadorApi } from '../infraestructura/servicios/consultaVehiculo';
import { auditoriaSql } from '../infraestructura/adaptadores';
export const consultaVehiculo = casosConsultaVehiculo({ proveedor: new ProveedorEcuadorApi(), auditoria: auditoriaSql });
