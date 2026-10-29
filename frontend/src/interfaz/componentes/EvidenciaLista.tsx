import React, { useState } from 'react';
import { Calendar, ZoomIn } from 'lucide-react';
import type { RegistroLista } from '../../dominio/tipos';
import { fechaHora } from '../../dominio/formato';
import { ImagenEvidencia } from './deteccion';
import { VisorEvidenciaFotos } from './ZoomDual';

type TipoFoto = 'vehiculo' | 'placa';
const fotoDe = (r: RegistroLista, tipo: TipoFoto) => tipo === 'vehiculo' ? r.imagen_vehiculo ?? null : r.imagen_placa ?? null;
const fechaDe = (r: RegistroLista, tipo: TipoFoto) => tipo === 'vehiculo' ? r.fecha_evidencia_vehiculo : r.fecha_evidencia_placa;

const VisorLista: React.FC<{ registro: RegistroLista; onCerrar: () => void }> = ({ registro: r, onCerrar }) => (
  <VisorEvidenciaFotos placa={r.placa} imagenVehiculo={r.imagen_vehiculo ?? null} imagenPlaca={r.imagen_placa ?? null} onCerrar={onCerrar}
    metadatos={<>
      {r.propietario && <span>{r.propietario}</span>}
      {r.fecha_evidencia_vehiculo && <span><Calendar size={13} /> Vehículo: {fechaHora(r.fecha_evidencia_vehiculo)}</span>}
      {r.fecha_evidencia_placa && <span><Calendar size={13} /> Placa: {fechaHora(r.fecha_evidencia_placa)}</span>}
      <span>Evidencia conservada de la primera detección de esta placa.</span>
    </>} />
);

const FotoLista: React.FC<{ registro: RegistroLista; tipo: TipoFoto; ampliar: () => void; grande?: boolean }> = ({ registro: r, tipo, ampliar, grande }) => {
  const ruta = fotoDe(r, tipo);
  const captura = fechaDe(r, tipo);
  const elemento = tipo === 'vehiculo' ? 'Vehículo' : 'Placa';
  const estado = ruta ? `${elemento} ingresad${tipo === 'vehiculo' ? 'o' : 'a'}`
    : tipo === 'vehiculo' ? 'Vehículo aún no ha ingresado' : 'Placa aún no ingresada';
  return <div className={`evidencia-lista${grande ? ' evidencia-lista-grande' : ''}`}>
    <span className="evidencia-lista-estado">{estado}</span>
    {ruta && <>
      <button type="button" className="evidencia-lista-ampliar" onClick={ampliar} aria-label={`Ampliar foto ${tipo === 'vehiculo' ? 'del vehículo' : 'de la placa'} ${r.placa ?? ''}`}>
        <ImagenEvidencia ruta={ruta} alt={tipo === 'vehiculo' ? 'Foto del vehículo' : 'Placa recortada'} alto={grande ? 160 : 58} ajuste="contain" fondoOscuro />
        <span><ZoomIn size={12} /> Ampliar</span>
      </button>
      {captura && <time className="evidencia-lista-fecha" dateTime={captura}>{fechaHora(captura)}</time>}
    </>}
  </div>;
};

/** Cada celda conserva su propio estado; tener foto del auto no implica tener un recorte. */
export const CeldaEvidenciaLista: React.FC<{ registro: RegistroLista; tipo: TipoFoto }> = ({ registro, tipo }) => {
  const [zoom, setZoom] = useState(false);
  return <td className={`celda-evidencia-lista${fotoDe(registro, tipo) ? ' evidencia-capturada' : ''}`}>
    <FotoLista registro={registro} tipo={tipo} ampliar={() => setZoom(true)} />
    {zoom && <VisorLista registro={registro} onCerrar={() => setZoom(false)} />}
  </td>;
};

/** También disponible al editar un permiso, aunque el acceso original ya no exista. */
export const FotosEvidenciaLista: React.FC<{ registro: RegistroLista }> = ({ registro }) => {
  const [zoom, setZoom] = useState(false);
  return <section className="completo evidencia-lista-formulario" aria-label="Evidencia conservada del registro">
    {(['vehiculo', 'placa'] as const).map(tipo => <div key={tipo} className={`celda-evidencia-lista${fotoDe(registro, tipo) ? ' evidencia-capturada' : ''}`}>
      <FotoLista registro={registro} tipo={tipo} ampliar={() => setZoom(true)} grande />
    </div>)}
    {zoom && <VisorLista registro={registro} onCerrar={() => setZoom(false)} />}
  </section>;
};
