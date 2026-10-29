import React from 'react';
import type { Deteccion } from '../../dominio/tipos';
import { formatearPlaca } from '../../dominio/validacion';
import { Aviso } from './ui';

/** Respuesta de /detecciones/buscar-placa/:placa. */
export type ResultadoBusqueda = { placa: string; ultimos_ingresos: Deteccion[] } & (
  | { estado: 'alerta'; alerta: { motivo: string; nivel_alerta: string; coincidencia?: string; placa: string } }
  | { estado: 'autorizado'; autorizado: { propietario: string; departamento?: string | null } }
  | { estado: 'restringido'; motivo: string | null }
  | { estado: 'no_registrado' }
);

/** Situación de la placa consultada en las listas de control (monitoreo e historial completo). */
export const SituacionPlaca: React.FC<{ r: ResultadoBusqueda }> = ({ r }) => {
  const placa = formatearPlaca(r.placa);
  if (r.estado === 'alerta') {
    return <Aviso tipo="error"><b>{placa} está en la lista negra</b> · {r.alerta.motivo} (nivel {r.alerta.nivel_alerta}{r.alerta.coincidencia === 'aproximada' ? `, coincidencia aproximada con ${formatearPlaca(r.alerta.placa)}` : ''})</Aviso>;
  }
  if (r.estado === 'autorizado') {
    return <Aviso tipo="exito"><b>{placa} está autorizada</b> · {r.autorizado.propietario}{r.autorizado.departamento ? ` · ${r.autorizado.departamento}` : ''}</Aviso>;
  }
  if (r.estado === 'restringido') {
    return <Aviso tipo="advertencia"><b>{placa}</b> tiene un permiso que ahora no la habilita{r.motivo ? `: ${r.motivo.toLowerCase()}` : ''}.</Aviso>;
  }
  return <Aviso tipo="advertencia"><b>{placa}</b> no consta en la lista blanca ni en la lista negra.</Aviso>;
};
