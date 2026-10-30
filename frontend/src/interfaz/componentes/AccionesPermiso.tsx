import React, { useState } from 'react';
import { Edit3, Power, PowerOff, RotateCcw, Trash2 } from 'lucide-react';
import api, { mensajeError } from '../../infraestructura/api';
import type { RegistroLista } from '../../dominio/tipos';
import { fecha } from '../../dominio/formato';
import { formatearPlaca } from '../../dominio/validacion';
import { Confirmar } from './ui';
import { FormularioLista } from './FormularioLista';
import { useNotificar } from './Notificaciones';

/**
 * Acciones sobre un permiso de la lista blanca, iguales para el administrador y el gestor de
 * permisos. Desactivar es inmediato y reversible: el permiso deja de autorizar el ingreso pero
 * conserva sus datos e historial, y se puede activar de nuevo mientras su vigencia no haya
 * terminado. Un permiso vencido no se activa: se renueva con fechas nuevas (fieldset de vigencia).
 */
export type AccionPermiso = 'editar' | 'desactivar' | 'activar' | 'renovar' | 'eliminar';

/** Estado visible del permiso: desactivado, vencido o activo con su vigencia. */
export const estadoPermiso = (r: RegistroLista): { texto: string; clase: string } => {
  if (r.activo === false) return { texto: r.vigente === false ? `Desactivado · venció ${fecha(r.fecha_vencimiento)}` : 'Desactivado', clase: 'neutro' };
  if (!r.vigente) return { texto: `Vencido · ${fecha(r.fecha_vencimiento)}`, clase: 'alerta' };
  if (r.pendiente_inicio) return { texto: `Desde ${fecha(r.fecha_inicio)}`, clase: 'info' };
  if (r.por_vencer) return { texto: `Vence ${fecha(r.fecha_vencimiento)}`, clase: 'no_reconocido' };
  return { texto: r.fecha_vencimiento ? `Hasta ${fecha(r.fecha_vencimiento)}` : 'Permanente', clase: 'autorizado' };
};

const nombre = (r: RegistroLista) => (r.placa ? formatearPlaca(r.placa) : r.propietario ?? 'Permiso sin placa');

/** Botones de la columna Acciones según el estado del permiso. */
export const AccionesPermiso: React.FC<{
  r: RegistroLista; onAccion: (accion: AccionPermiso, r: RegistroLista) => void;
  /** Eliminar definitivamente (solo el administrador; un permiso con ingresos se conserva) */
  puedeEliminar?: boolean;
}> = ({ r, onAccion, puedeEliminar }) => {
  const activo = r.activo !== false;
  const vencido = r.vigente === false;
  return (
    <div className="acciones-registro">
      {activo && !vencido && (
        <button className="btn btn-ghost btn-sm btn-icono" onClick={() => onAccion('editar', r)} title="Editar" aria-label={`Editar el permiso de ${nombre(r)}`}><Edit3 size={15} /></button>
      )}
      {vencido && (
        <button className="btn btn-ghost btn-sm" onClick={() => onAccion(activo ? 'editar' : 'renovar', r)} title="Renovar con una vigencia nueva">
          <RotateCcw size={14} /> Renovar
        </button>
      )}
      {activo ? (
        <button className="btn btn-ghost btn-sm accion-desactivar" onClick={() => onAccion('desactivar', r)}
          title="Deja de autorizar el ingreso desde ahora; se puede activar de nuevo">
          <PowerOff size={14} /> Desactivar
        </button>
      ) : !vencido && (
        <button className="btn btn-ghost btn-sm accion-activar" onClick={() => onAccion('activar', r)} title="Vuelve a autorizar el ingreso con sus mismos datos y vigencia">
          <Power size={14} /> Activar
        </button>
      )}
      {puedeEliminar && (!activo || vencido) && (
        <button className="btn btn-ghost btn-sm" onClick={() => onAccion('eliminar', r)} disabled={r.ingresos > 0}
          title={r.ingresos > 0 ? `Tiene ${r.ingresos} ingresos en el historial: se conserva desactivado para la trazabilidad` : 'Eliminar definitivamente'}>
          <Trash2 size={14} color={r.ingresos > 0 ? undefined : 'var(--alerta)'} /> Eliminar
        </button>
      )}
    </div>
  );
};

/** Diálogos de las acciones (confirmación o formulario) y su llamada a la API; `alCambiar` recarga la tabla. */
export function useAccionesPermiso(alCambiar: () => void) {
  const notificar = useNotificar();
  const [accion, setAccion] = useState<{ tipo: AccionPermiso; r: RegistroLista } | null>(null);
  const cerrar = () => setAccion(null);
  const ejecutar = async (llamada: () => Promise<unknown>, titulo: string, detalle?: string) => {
    try { await llamada(); } catch (e) { throw new Error(mensajeError(e)); }
    alCambiar();
    notificar('exito', titulo, detalle);
  };

  let dialogo: React.ReactNode = null;
  if (accion) {
    const { tipo, r } = accion;
    if (tipo === 'editar') {
      dialogo = <FormularioLista tipo="autorizados" registro={r} onCerrar={cerrar}
        onGuardado={() => { cerrar(); alCambiar(); notificar('exito', 'Cambios guardados'); }} />;
    } else if (tipo === 'renovar') {
      // Renovar = alta con los mismos datos y una vigencia nueva (la API reactiva el registro de esa placa)
      dialogo = <FormularioLista tipo="autorizados" inicial={{ ...r, fecha_inicio: '', fecha_vencimiento: '', fecha_fin: '' }} onCerrar={cerrar}
        onGuardado={() => { cerrar(); alCambiar(); notificar('exito', 'Permiso renovado', 'Queda activo con la vigencia nueva.'); }} />;
    } else if (tipo === 'desactivar') {
      dialogo = <Confirmar titulo="Desactivar permiso" peligro textoBoton="Desactivar" onCerrar={cerrar}
        mensaje={<>El permiso de <b>{nombre(r)}</b>{r.registrado_por_nombre ? <>, otorgado por {r.registrado_por_nombre},</> : ''} dejará de autorizar el ingreso <b>desde ahora</b>.
          Conserva sus datos y su historial: puede activarlo de nuevo mientras su vigencia no termine.</>}
        onConfirmar={() => ejecutar(() => api.delete(`/vehiculos-autorizados/${r.id}`), `Permiso de ${nombre(r)} desactivado`, 'Ya no autoriza el ingreso.')} />;
    } else if (tipo === 'activar') {
      dialogo = <Confirmar titulo="Activar permiso" textoBoton="Activar" onCerrar={cerrar}
        mensaje={<>El permiso de <b>{nombre(r)}</b> vuelve a autorizar el ingreso con sus mismos datos, vigencia
          {r.fecha_vencimiento ? <> (hasta el {fecha(r.fecha_vencimiento)})</> : ' (permanente)'} y horario.</>}
        onConfirmar={() => ejecutar(() => api.post(`/vehiculos-autorizados/${r.id}/reactivar`, {}), `Permiso de ${nombre(r)} activado`)} />;
    } else {
      dialogo = <Confirmar titulo="Eliminar definitivamente" peligro textoBoton="Eliminar definitivamente" onCerrar={cerrar}
        mensaje={<>Se borrará el permiso de <b>{nombre(r)}</b> ({r.activo === false ? 'desactivado' : 'vencido'}) y sus fotos. <b>No se puede deshacer</b>; la eliminación queda registrada en la auditoría.</>}
        onConfirmar={() => ejecutar(() => api.delete(`/vehiculos-autorizados/${r.id}/definitivo`), 'Permiso eliminado')} />;
    }
  }
  return { abrir: (tipo: AccionPermiso, r: RegistroLista) => setAccion({ tipo, r }), dialogo };
}
