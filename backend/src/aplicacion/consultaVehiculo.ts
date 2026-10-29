import { errorNoDisponible, errorNoEncontrado, errorProhibido, errorValidacion, type Actor, type PuertoAuditoria } from './comun';
import { tienePermiso, type Rol } from '../dominio/permisos';
import { validarPlaca } from '../dominio/validacion';
export interface DatosConsultaVehiculo { placa: string; marca: string | null; modelo: string | null; color: string | null; tipo_vehiculo: string | null }
export interface EstadoConsultaVehiculo {
  capacidad_local: true;
  estado_proveedor: 'sin_comprobar' | 'error_reciente';
  habilitado: boolean;
  puede_consultar: boolean;
  mensaje: string | null;
  reintentar_en_s: number;
}
export class ErrorProveedorVehiculo extends Error {
  constructor(mensaje: string, readonly codigo = 'temporal') { super(mensaje); }
}
export interface ProveedorConsultaVehiculo {
  consultar(placa: string): Promise<DatosConsultaVehiculo | null>;
  habilitado(): boolean;
  estado(): EstadoConsultaVehiculo;
}
export function casosConsultaVehiculo(d: { proveedor: ProveedorConsultaVehiculo; auditoria: PuertoAuditoria }) {
  const autorizar = (actor: Actor) => {
    if (!tienePermiso(actor.rol as Rol, 'padron:gestionar') && !tienePermiso(actor.rol as Rol, 'solicitudes:crear')) throw errorProhibido('No tiene permiso para consultar datos de vehículos.');
  };
  return {
    estado(actor: Actor) {
      autorizar(actor);
      return d.proveedor.estado();
    },
    async consultar(entrada: unknown, actor: Actor) {
      autorizar(actor);
      const r = validarPlaca(entrada);
      if (!r.ok) throw errorValidacion(r.error);
      if (!d.proveedor.habilitado()) throw errorNoDisponible('La consulta externa de vehículos no está habilitada. El administrador debe configurar el proveedor y su clave de acceso. Puede completar los datos manualmente.');
      const estado = d.proveedor.estado();
      if (!estado.puede_consultar) throw errorNoDisponible(estado.mensaje || 'La consulta externa no está disponible. Puede completar los datos manualmente.');
      const placa = r.valor.placa;
      let datos: DatosConsultaVehiculo | null;
      try { datos = await d.proveedor.consultar(placa); }
      catch (error) {
        const codigo = error instanceof ErrorProveedorVehiculo ? error.codigo : 'desconocido';
        await d.auditoria.operacion(actor, 'CONSULTA_VEHICULO', 'vehiculo', null, `${placa} · proveedor EcuadorAPI · error:${codigo}`);
        throw errorNoDisponible(error instanceof ErrorProveedorVehiculo ? error.message : 'No se pudo consultar el vehículo. Revise la disponibilidad, la clave y el saldo del proveedor, o complete los datos manualmente.');
      }
      await d.auditoria.operacion(actor, 'CONSULTA_VEHICULO', 'vehiculo', null, `${placa} · proveedor EcuadorAPI · ${datos ? 'encontrado' : 'sin resultado'}`);
      if (!datos) throw errorNoEncontrado('No se encontraron datos del vehículo para esta placa.');
      return datos;
    },
  };
}
