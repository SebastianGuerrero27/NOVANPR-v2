import { errorNoDisponible, errorNoEncontrado, errorProhibido, errorValidacion, type Actor, type PuertoAuditoria } from './comun';
import { tienePermiso, type Rol } from '../dominio/permisos';
export interface DatosConsultaPersona { cedula: string; nombre: string }
export interface ProveedorConsultaPersona { habilitado(): boolean; consultar(cedula: string): Promise<DatosConsultaPersona | null> }
export function casosConsultaPersona(d: { proveedor: ProveedorConsultaPersona; auditoria: PuertoAuditoria; nombreProveedor?: string }) {
  const nombreProveedor = d.nombreProveedor ?? 'EcuadorAPI';
  return { async consultar(entrada: unknown, actor: Actor) {
    if (!tienePermiso(actor.rol as Rol, 'padron:gestionar') && !tienePermiso(actor.rol as Rol, 'solicitudes:crear')) throw errorProhibido('No tiene permiso para consultar identidades de permisos.');
    if (typeof entrada !== 'string' || !/^\d{10}$/.test(entrada.trim())) throw errorValidacion('La cédula debe contener exactamente 10 dígitos.');
    if (!d.proveedor.habilitado()) throw errorNoDisponible(`Consulta por cédula sin configurar. El administrador debe configurar la credencial de ${nombreProveedor}. Puede completar el nombre manualmente.`);
    let datos: DatosConsultaPersona | null;
    try { datos = await d.proveedor.consultar(entrada.trim()); }
    catch {
      await d.auditoria.operacion(actor, 'CONSULTA_IDENTIDAD', 'permiso', null, `${nombreProveedor} · error`);
      throw errorNoDisponible(`No se pudo consultar el nombre en ${nombreProveedor}. Revise la conexión y la vigencia de la credencial o complete el nombre manualmente.`);
    }
    await d.auditoria.operacion(actor, 'CONSULTA_IDENTIDAD', 'permiso', null, `${nombreProveedor} · ${datos ? 'encontrado' : 'sin resultado'}`);
    if (!datos) throw errorNoEncontrado('No se encontraron nombres para esta cédula. Puede completarlos manualmente.');
    return datos;
  } };
}
