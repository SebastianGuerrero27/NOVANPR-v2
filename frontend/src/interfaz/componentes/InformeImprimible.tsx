import React from 'react';
import logoEcu911 from '../../assets/ecu911.png';
import type { Deteccion, EstadoValidacion } from '../../dominio/tipos';
import { ESTADOS, fecha, fechaHora, hora } from '../../dominio/formato';
import { formatearPlaca } from '../../dominio/validacion';

/**
 * Informe con formato de documento (hoja blanca con el logo del ECU 911, datos del informe,
 * tabla y firmas). Se ve igual en pantalla (vista previa) y al imprimir: el resto de la página
 * lleva `no-imprimir`.
 */

export const Informe: React.FC<{
  titulo: string; subtitulo?: string; datos: [string, React.ReactNode][]; generadoPor?: string; children: React.ReactNode;
}> = ({ titulo, subtitulo, datos, generadoPor, children }) => (
  <article className="informe" aria-label={titulo}>
    <header className="informe-cabecera">
      <img src={logoEcu911} alt="ECU 911" />
      <div>
        <p className="informe-institucion">Servicio Integrado de Seguridad ECU 911 · Control de acceso vehicular</p>
        <h1>{titulo}</h1>
        {subtitulo && <p className="informe-subtitulo">{subtitulo}</p>}
      </div>
    </header>
    <dl className="informe-datos">
      {datos.map(([etiqueta, valor]) => <div key={etiqueta}><dt>{etiqueta}</dt><dd>{valor}</dd></div>)}
      <div><dt>Generado</dt><dd>{fechaHora(new Date())}{generadoPor ? ` · ${generadoPor}` : ''}</dd></div>
    </dl>
    {children}
    <footer className="informe-firmas">
      <div><span>Elaborado por</span></div>
      <div><span>Revisado por</span></div>
    </footer>
  </article>
);

/** Totales en una franja de cifras sobrias (sin tarjetas de colores). */
export const ResumenInforme: React.FC<{ cifras: [string, number | string][] }> = ({ cifras }) => (
  <div className="informe-resumen">
    {cifras.map(([etiqueta, valor]) => <div key={etiqueta}><strong>{valor}</strong><span>{etiqueta}</span></div>)}
  </div>
);

/** Nombre del estado del acceso en el informe (texto, legible también en blanco y negro). */
export const EstadoInforme: React.FC<{ estado: EstadoValidacion }> = ({ estado }) => (
  <span className={`informe-estado ${estado}`}>{estado === 'no_reconocido' ? 'No autorizado' : ESTADOS[estado]?.etiqueta ?? estado}</span>
);

const vehiculo = (d: Deteccion) => [d.vehiculo?.tipo ?? d.tipo_vehiculo, [d.vehiculo?.marca, d.vehiculo?.modelo].filter(Boolean).join(' '), d.vehiculo?.color]
  .filter(Boolean).join(' · ');

/** Tabla de accesos del informe: una fila por ingreso, en orden cronológico. */
export const TablaAccesosInforme: React.FC<{ filas: Deteccion[]; sinPlaca?: boolean; onAbrir?: (d: Deteccion) => void }> = ({ filas, sinPlaca, onAbrir }) => (
  <table className="informe-tabla">
    <thead>
      <tr>
        <th className="num">N.º</th><th>Fecha</th><th>Ingreso</th><th>Salida</th>{!sinPlaca && <th>Placa</th>}
        <th>Persona</th><th>Vehículo</th><th>Motivo</th><th>Estado</th>
      </tr>
    </thead>
    <tbody>
      {filas.map((d, i) => (
        <tr key={d.id} className={onAbrir ? 'clic' : undefined} onClick={onAbrir ? () => onAbrir(d) : undefined}>
          <td className="num">{i + 1}</td>
          <td className="nowrap">{fecha(d.fecha_hora_ingreso)}</td>
          <td className="nowrap">{hora(d.fecha_hora_ingreso)}</td>
          <td className="nowrap">{d.fecha_hora_salida ? hora(d.fecha_hora_salida) : '—'}</td>
          {!sinPlaca && <td className="nowrap informe-placa">{d.placa ? formatearPlaca(d.placa) : 'Sin lectura'}</td>}
          <td>{d.persona_ingreso || d.autorizado?.propietario || '—'}</td>
          <td>{vehiculo(d) || '—'}</td>
          <td>{d.motivo_ingreso || '—'}</td>
          <td className="nowrap"><EstadoInforme estado={d.estado_validacion} /></td>
        </tr>
      ))}
    </tbody>
  </table>
);
