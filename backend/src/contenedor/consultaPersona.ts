import { casosConsultaPersona } from '../aplicacion/consultaPersona';
import { ProveedorNombresEcuadorApi, ProveedorNombresSocketStudio } from '../infraestructura/servicios/consultaPersona';
import { auditoriaSql } from '../infraestructura/adaptadores';
const socket = process.env.CONSULTA_PERSONA_PROVEEDOR === 'socketstudio';
export const consultaPersona = casosConsultaPersona({ proveedor: socket ? new ProveedorNombresSocketStudio() : new ProveedorNombresEcuadorApi(), auditoria: auditoriaSql, nombreProveedor: socket ? 'Socket Studio' : 'EcuadorAPI' });
