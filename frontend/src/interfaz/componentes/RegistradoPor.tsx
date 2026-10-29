import React from 'react';
import type { RegistroLista } from '../../dominio/tipos';
import { fecha } from '../../dominio/formato';

/** Quién otorgó o registró el permiso (nombre y correo) y cuándo: celda de las tablas de permisos. */
export const RegistradoPor: React.FC<{ r: Pick<RegistroLista, 'registrado_por_nombre' | 'registrado_por_email' | 'fecha_registro'> }> = ({ r }) => (
  <>
    <span>{r.registrado_por_nombre || r.registrado_por_email || '—'}</span>
    {r.registrado_por_nombre && r.registrado_por_email && <span className="secundario">{r.registrado_por_email}</span>}
    <span className="secundario">{fecha(r.fecha_registro)}</span>
  </>
);
