import React from 'react';
import { fecha, fechaIsoLocal } from '../../dominio/formato';
import { CampoFecha } from './campos';
export const VigenciaPermiso: React.FC<{ prefijo: string; inicio: string; fin: string; onCambiar: (inicio: string, fin: string) => void; titulo?: string }> = ({ prefijo, inicio, fin, onCambiar, titulo = 'Vigencia del permiso' }) => {
  const hoy = fechaIsoLocal(), efectivo = inicio || hoy;
  const finDe = (dias: number | null) => (dias === null ? '' : fechaIsoLocal(new Date(new Date(`${hoy}T12:00:00-05:00`).getTime() + (dias - 1) * 86400000)));
  const rapido = (dias: number | null) => onCambiar(hoy, finDe(dias));
  // La opción rápida que coincide con las fechas actuales queda marcada como seleccionada
  const elegida = (dias: number | null) => efectivo === hoy && fin === finDe(dias);
  const OPCIONES: [number | null, string][] = [[1, 'Solo hoy'], [7, '7 días'], [30, '30 días'], [null, 'Desde hoy, sin vencimiento']];
  return <fieldset className="completo" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
    <legend className="etiqueta-campo">{titulo}</legend>
    <div className="fila" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
      {OPCIONES.map(([dias, etiqueta]) => (
        <button key={etiqueta} type="button" className="btn btn-secondary btn-sm btn-opcion" aria-pressed={elegida(dias)} onClick={() => rapido(dias)}>{etiqueta}</button>
      ))}
    </div>
    <div className="form-grid">
      <CampoFecha id={`${prefijo}-inicio`} etiqueta="Vigente desde" nombre="Fecha de inicio" valor={inicio} max={fin || undefined} onCambiar={v => onCambiar(v, fin)} ayuda="Si no selecciona una fecha, comienza hoy." />
      <CampoFecha id={`${prefijo}-vence`} etiqueta="Vigente hasta" nombre="Fecha de vencimiento" valor={fin} min={efectivo} deshabilitado={!fin} onCambiar={v => onCambiar(inicio, v)} error={fin && efectivo > fin ? 'El vencimiento no puede ser anterior al inicio.' : null} ayuda="El último día seleccionado también está incluido." />
    </div>
    <label className="fila" style={{ marginTop: 10 }}><input type="checkbox" checked={!fin} onChange={e => onCambiar(inicio, e.target.checked ? '' : efectivo)} /> Sin fecha de vencimiento</label>
    <p className="texto-secundario" style={{ marginTop: 10 }}>Desde {fecha(`${efectivo}T12:00:00-05:00`)}{fin ? ` hasta ${fecha(`${fin}T12:00:00-05:00`)} inclusive` : ', sin vencimiento'}.</p>
  </fieldset>;
};
