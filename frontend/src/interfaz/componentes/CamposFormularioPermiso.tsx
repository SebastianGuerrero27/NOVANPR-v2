import React from 'react';
import type { Deteccion, Franja } from '../../dominio/tipos';
import { CamposPersonaPermiso, type PersonaPermiso } from './CamposPersonaPermiso';
import { CamposVehiculoPermiso, type VehiculoPermiso } from './CamposVehiculoPermiso';
import { CampoPlaca, CampoTexto } from './campos';
import { VigenciaPermiso } from './VigenciaPermiso';
import { EditorHorario } from './EditorHorario';
import { MOTIVOS_INGRESO_FRECUENTES, REGLA_MOTIVO_INGRESO, REGLA_OBSERVACIONES } from '../../dominio/reglas';
import { FotoVehiculoPermiso } from './FotoVehiculoPermiso';

export interface FormularioPermiso extends PersonaPermiso, VehiculoPermiso {
  placa: string; observaciones: string; fecha_inicio: string; fecha_fin: string;
  /** Motivo habitual del ingreso: cada paso del vehículo lo toma sin que la garita lo reescriba */
  motivo_ingreso?: string;
}
/** Un mismo esquema y orden para alta, edición, solicitud y aprobación de lista blanca. */
export const CamposFormularioPermiso: React.FC<{
  prefijo: string; valor: FormularioPermiso; onCambiar: (cambios: Partial<FormularioPermiso>) => void;
  horario: Franja[] | null; onHorario: (v: Franja[] | null) => void;
  errorHorario?: string | null;
  deteccion?: Deteccion; placaObligatoria?: boolean; placaFija?: boolean; vehiculoObligatorio?: boolean; incluirFotoPlaca?: boolean;
  distribucion?: 'normal' | 'panoramica';
  /** false donde el motivo ya se pide aparte (solicitud de acceso, autorización en la garita) */
  mostrarMotivo?: boolean;
  accionesVehiculo?: React.ReactNode; children?: React.ReactNode;
}> = ({ prefijo, valor, onCambiar, horario, onHorario, errorHorario, deteccion, placaObligatoria = false, placaFija, vehiculoObligatorio = false, incluirFotoPlaca = false, distribucion = 'normal', mostrarMotivo = true, accionesVehiculo, children }) => {
  return <div className={`completo formulario-permiso${distribucion === 'panoramica' ? ' panoramico' : ''}`}>
    {deteccion && <FotoVehiculoPermiso deteccion={deteccion} incluirPlaca={incluirFotoPlaca} />}
    <fieldset className="permiso-persona formulario-seccion">
      <legend className="etiqueta-campo">Datos de la persona</legend>
      <div className="form-grid"><CamposPersonaPermiso prefijo={prefijo} valor={valor} onCambiar={(k, v) => onCambiar({ [k]: v })} autoFocus={!deteccion} /></div>
    </fieldset>
    <fieldset className="permiso-vehiculo" style={{ border: '1px dashed var(--border-strong)', borderRadius: 10, padding: '10px 14px 14px' }}>
      <legend className="etiqueta-campo" style={{ padding: '0 6px' }}>Datos del vehículo</legend>
      <div className="form-grid">
        <CampoPlaca id={`${prefijo}-placa`} className="completo" etiqueta={placaObligatoria || vehiculoObligatorio ? 'Placa*' : 'Placa (opcional)'} requerido={placaObligatoria || vehiculoObligatorio} valor={valor.placa} onCambiar={v => onCambiar({ placa: v })} deshabilitado={placaFija} />
        <CamposVehiculoPermiso prefijo={prefijo} valor={valor} onCambiar={(k, v) => onCambiar({ [k]: v })} obligatorio={vehiculoObligatorio} />
      </div>
      {accionesVehiculo}
    </fieldset>
    <section className="permiso-condiciones" aria-label="Condiciones del permiso">
    {mostrarMotivo && <div className="completo pila" style={{ gap: 6 }}>
      <CampoTexto id={`${prefijo}-motivo-ingreso`} etiqueta="Motivo de ingreso" valor={valor.motivo_ingreso ?? ''} onCambiar={v => onCambiar({ motivo_ingreso: v })}
        regla={REGLA_MOTIVO_INGRESO} placeholder="Ej.: jornada laboral, entrega de botellones de agua"
        ayuda="Se registra solo en cada ingreso del vehículo: el guardia no tiene que escribirlo cada día." />
      <div className="fila" style={{ gap: 6 }} role="group" aria-label="Motivos frecuentes del permiso">
        {MOTIVOS_INGRESO_FRECUENTES.map(m => (
          <button key={m} type="button" className="btn btn-sm btn-secondary btn-opcion" aria-pressed={valor.motivo_ingreso === m} onClick={() => onCambiar({ motivo_ingreso: m })}>{m}</button>
        ))}
      </div>
    </div>}
    <VigenciaPermiso prefijo={prefijo} inicio={valor.fecha_inicio} fin={valor.fecha_fin} onCambiar={(inicio, fin) => onCambiar({ fecha_inicio: inicio, fecha_fin: fin })} />
    <fieldset className="completo" style={{ border: '1px dashed var(--border-strong)', borderRadius: 10, padding: '10px 14px 14px' }}>
      <legend className="etiqueta-campo" style={{ padding: '0 6px' }}>Horario de acceso</legend>
      <EditorHorario valor={horario} onCambiar={onHorario} errorGuardado={errorHorario} />
    </fieldset>
    <CampoTexto id={`${prefijo}-obs`} className="completo" etiqueta="Observaciones" valor={valor.observaciones} onCambiar={v => onCambiar({ observaciones: v })} regla={REGLA_OBSERVACIONES} multilinea />
    </section>
    {children}
  </div>;
};
