import React from 'react';

export type EstadoPing = 'reposo' | 'probando' | 'ok' | 'error';

const TITULO: Record<EstadoPing, string> = {
  reposo: 'Ping de red y diagnóstico RTSP',
  probando: 'Probando la conexión…',
  ok: 'La cámara responde. Ping de nuevo para volver a probar',
  error: 'La cámara no responde. Ping de nuevo para volver a probar',
};

/**
 * Botón Ping con una antena wifi: las ondas se encienden una tras otra mientras se prueba la conexión,
 * y queda verde si la cámara entrega video o roja si no. El color no es lo único que informa: el
 * título y el panel de diagnóstico dicen el resultado.
 */
export const BotonPing: React.FC<{ estado: EstadoPing; onClick: () => void; deshabilitado?: boolean; pequeno?: boolean }> = ({ estado, onClick, deshabilitado, pequeno }) => (
  <button type="button" className={`btn btn-secondary${pequeno ? ' btn-sm' : ''} boton-ping ${estado}`} onClick={onClick}
    disabled={deshabilitado || estado === 'probando'} title={TITULO[estado]} aria-busy={estado === 'probando'}>
    <svg className="antena-ping" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path className="onda onda-3" d="M2 8.82a15 15 0 0 1 20 0" />
      <path className="onda onda-2" d="M5 12.86a10 10 0 0 1 14 0" />
      <path className="onda onda-1" d="M8.5 16.43a5 5 0 0 1 7 0" />
      <path className="onda-punto" d="M12 20h.01" />
    </svg>
    Ping
  </button>
);
