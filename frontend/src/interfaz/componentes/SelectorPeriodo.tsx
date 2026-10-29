import React from 'react';
import { fechaIsoLocal, sumarDias } from '../../dominio/formato';

/**
 * Desde / Hasta (días locales AAAA-MM-DD) con atajos marcados cuando coinciden. Con `todo`, el
 * atajo «Todo» deja ambas fechas vacías (sin límite de período).
 */
export const SelectorPeriodo: React.FC<{
  prefijo: string; desde: string; hasta: string; onCambiar: (desde: string, hasta: string) => void; todo?: boolean;
}> = ({ prefijo, desde, hasta, onCambiar, todo }) => {
  const hoy = fechaIsoLocal();
  const atajos: [string, string, string][] = [
    ['Hoy', hoy, hoy], ['Ayer', sumarDias(hoy, -1), sumarDias(hoy, -1)], ['Últimos 7 días', sumarDias(hoy, -6), hoy], ['Este mes', `${hoy.slice(0, 7)}-01`, hoy],
    ...(todo ? [['Todo', '', ''] as [string, string, string]] : []),
  ];
  return <>
    <div className="campo" style={{ minWidth: 150 }}><label htmlFor={`${prefijo}-desde`}>Desde</label>
      <input id={`${prefijo}-desde`} type="date" className="input" value={desde} max={hasta || hoy} onChange={e => onCambiar(e.target.value, hasta)} /></div>
    <div className="campo" style={{ minWidth: 150 }}><label htmlFor={`${prefijo}-hasta`}>Hasta</label>
      <input id={`${prefijo}-hasta`} type="date" className="input" value={hasta} min={desde || undefined} max={hoy} onChange={e => onCambiar(desde, e.target.value)} /></div>
    <div className="fila" style={{ gap: 6 }} role="group" aria-label="Períodos frecuentes">
      {atajos.map(([etiqueta, d, h]) => (
        <button key={etiqueta} type="button" className="btn btn-sm btn-secondary btn-opcion" aria-pressed={desde === d && hasta === h} onClick={() => onCambiar(d, h)}>{etiqueta}</button>
      ))}
    </div>
  </>;
};
