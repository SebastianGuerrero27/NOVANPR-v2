import React, { useState } from 'react';
import { fechaIsoLocal, sumarDias } from '../../dominio/formato';

/**
 * Período como lista de opciones (hoy, ayer, últimos 7 y 30 días, este mes y, con `todo`, todo el
 * historial) y, al elegir «Rango de fechas…», sus dos fechas. Días locales AAAA-MM-DD; «Todo el
 * historial» deja ambas vacías.
 */

const RANGOS: Record<string, (hoy: string) => [string, string]> = {
  hoy: h => [h, h], ayer: h => [sumarDias(h, -1), sumarDias(h, -1)], '7d': h => [sumarDias(h, -6), h], '30d': h => [sumarDias(h, -29), h],
  mes: h => [`${h.slice(0, 7)}-01`, h], todo: () => ['', ''],
};
const OPCIONES: [string, string][] = [['hoy', 'Hoy'], ['ayer', 'Ayer'], ['7d', 'Últimos 7 días'], ['30d', 'Últimos 30 días'], ['mes', 'Este mes'],
  ['todo', 'Todo el historial'], ['rango', 'Rango de fechas…']];

/** Opción que corresponde a unas fechas ('rango' si no es ninguna de las fijas). */
export function periodoDe(desde: string, hasta: string, hoy = fechaIsoLocal()): string {
  return Object.keys(RANGOS).find(k => { const [d, h] = RANGOS[k](hoy); return d === desde && h === hasta; }) ?? 'rango';
}

export const PeriodoCompacto: React.FC<{
  id: string; desde: string; hasta: string; onCambiar: (desde: string, hasta: string) => void; todo?: boolean;
}> = ({ id, desde, hasta, onCambiar, todo }) => {
  const hoy = fechaIsoLocal();
  const [propio, setPropio] = useState(false);
  const actual = periodoDe(desde, hasta, hoy);
  const verRango = propio || actual === 'rango';
  const elegir = (p: string) => {
    if (p === 'rango') { setPropio(true); if (!desde && !hasta) onCambiar(hoy, hoy); return; }
    setPropio(false);
    const [d, h] = RANGOS[p](hoy);
    onCambiar(d, h);
  };
  return <>
    <div className="campo">
      <label htmlFor={`${id}-periodo`}>Período</label>
      <select id={`${id}-periodo`} className="select" value={verRango ? 'rango' : actual} onChange={e => elegir(e.target.value)}>
        {OPCIONES.filter(([v]) => todo || v !== 'todo').map(([v, e]) => <option key={v} value={v}>{e}</option>)}
      </select>
    </div>
    {verRango && <>
      <div className="campo campo-fecha">
        <label htmlFor={`${id}-desde`}>Desde</label>
        <input id={`${id}-desde`} type="date" className="input" value={desde} max={hasta || hoy} onChange={e => onCambiar(e.target.value, hasta)} />
      </div>
      <div className="campo campo-fecha">
        <label htmlFor={`${id}-hasta`}>Hasta</label>
        <input id={`${id}-hasta`} type="date" className="input" value={hasta} min={desde || undefined} max={hoy} onChange={e => onCambiar(desde, e.target.value)} />
      </div>
    </>}
  </>;
};
