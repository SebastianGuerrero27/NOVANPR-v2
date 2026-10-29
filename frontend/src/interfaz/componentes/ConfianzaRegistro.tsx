import React from 'react';
import { porcentaje } from '../../dominio/formato';

/** Confianza de lectura en su propia columna, separada de la placa y la evidencia. */
export const ConfianzaRegistro: React.FC<{ valor: number | null }> = ({ valor }) => {
  const disponible = valor !== null && Number.isFinite(valor);
  const nivel = !disponible ? 'sin-dato' : valor >= 0.9 ? 'alta' : valor >= 0.75 ? 'media' : 'baja';
  return <span className={`confianza-badge confianza-${nivel}`} title="Confianza de la lectura">
    {disponible ? porcentaje(valor) : '—'}
  </span>;
};
