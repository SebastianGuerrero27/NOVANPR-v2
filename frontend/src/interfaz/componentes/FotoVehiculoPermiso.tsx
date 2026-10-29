import React, { useState } from 'react';
import type { Deteccion } from '../../dominio/tipos';
import { ImagenEvidencia, recortePlaca } from './deteccion';
import { VisorZoom } from './ZoomDual';
export const FotoVehiculoPermiso: React.FC<{ deteccion?: Deteccion; incluirPlaca?: boolean }> = ({ deteccion, incluirPlaca = false }) => {
  const [zoom, setZoom] = useState(false);
  const recorte = deteccion ? recortePlaca(deteccion) : null;
  const imagenVehiculo = deteccion?.imagen_vehiculo ?? null;
  const vehiculo = <section aria-label="Foto del vehículo">
    <span className="etiqueta-campo">Foto del vehículo para identificar marca y modelo</span>
    <button type="button" className="btn btn-ghost btn-sm" disabled={!imagenVehiculo} onClick={() => setZoom(true)}>Ampliar foto del vehículo</button>
    <ImagenEvidencia ruta={imagenVehiculo} alt="Vehículo del permiso" alto={incluirPlaca ? 160 : 240} ajuste="contain" fondoOscuro onClick={() => setZoom(true)} />
    {!imagenVehiculo && <p className="texto-secundario">{deteccion ? 'Este acceso no tiene foto del vehículo disponible.' : 'No hay una foto del vehículo disponible.'}</p>}
  </section>;
  return <div className="completo">
    {incluirPlaca ? <div className="grid-2" style={{ gap: 12 }}>
      {vehiculo}
      <section aria-label="Foto recortada de la placa">
        <span className="etiqueta-campo">Placa recortada</span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!recorte} onClick={() => setZoom(true)}>Ampliar foto de la placa</button>
        <ImagenEvidencia ruta={recorte} alt="Placa recortada del ingreso" alto={160} ajuste="contain" fondoOscuro onClick={() => setZoom(true)} />
        {!recorte && <p className="texto-secundario">{deteccion ? 'Este acceso no tiene un recorte de placa disponible.' : 'No hay una foto recortada de la placa disponible.'}</p>}
      </section>
    </div> : vehiculo}
    {zoom && deteccion && <VisorZoom d={deteccion} onCerrar={() => setZoom(false)} />}
  </div>;
};
