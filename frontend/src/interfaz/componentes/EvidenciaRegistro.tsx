import React, { useState } from 'react';
import api, { mensajeError } from '../../infraestructura/api';
import type { Deteccion } from '../../dominio/tipos';
import { PlacaFoto } from './deteccion';
import { VisorZoom } from './ZoomDual';
import { useNotificar } from './Notificaciones';

/** Las tablas resumidas cargan el detalle solo cuando se solicita ampliar la evidencia. */
export const EvidenciaRegistro: React.FC<{ registro: { id: number; placa: string | null; imagen_placa?: string | null; imagen_vehiculo?: string | null; confianza_ocr?: number | null; confianza?: number | null } }> = ({ registro }) => {
  const [zoom, setZoom] = useState<Deteccion | null>(null);
  const [cargando, setCargando] = useState(false);
  const notificar = useNotificar();
  const ampliar = async () => {
    if (cargando) return;
    setCargando(true);
    try { setZoom((await api.get<Deteccion>(`/detecciones/${registro.id}`)).data); }
    catch (e) { notificar('error', 'No se pudo abrir la evidencia', mensajeError(e)); }
    finally { setCargando(false); }
  };
  return <>
    <PlacaFoto d={{ placa: registro.placa, imagen_placa: registro.imagen_placa ?? null, imagen_vehiculo: registro.imagen_vehiculo ?? null }} alto={36} confianza={registro.confianza_ocr !== undefined ? registro.confianza_ocr : registro.confianza} onClick={() => void ampliar()} />
    {cargando && <small role="status"> Cargando evidencia…</small>}
    {zoom && <div onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}><VisorZoom d={zoom} onCerrar={() => setZoom(null)} /></div>}
  </>;
};
