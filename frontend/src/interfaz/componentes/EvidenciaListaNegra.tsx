import React, { useEffect, useState } from 'react';
import type { Deteccion } from '../../dominio/tipos';
import { normalizarPlaca, validarPlaca } from '../../dominio/validacion';
import api, { mensajeError } from '../../infraestructura/api';
import { FotoVehiculoPermiso } from './FotoVehiculoPermiso';

type Resultado = {
  placa: string;
  estado: 'cargando' | 'encontrada' | 'sin-imagenes' | 'error';
  deteccion?: Deteccion;
  error?: string;
};

/** Evidencia del paso seleccionado o del último registro de la placa; consulta solo el historial local. */
export const EvidenciaListaNegra: React.FC<{ placa: string; deteccion?: Deteccion }> = ({ placa, deteccion }) => {
  const normalizada = normalizarPlaca(placa);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  useEffect(() => {
    if (deteccion || !validarPlaca(normalizada).ok) {
      setResultado(null);
      return;
    }
    let cancelado = false;
    setResultado({ placa: normalizada, estado: 'cargando' });
    const temporizador = window.setTimeout(async () => {
      try {
        const { data } = await api.get<{ placa: string; ultimos_ingresos: Deteccion[] }>(`/detecciones/buscar-placa/${encodeURIComponent(normalizada)}`);
        if (cancelado) return;
        if (normalizarPlaca(data.placa) !== normalizada) throw new Error('La respuesta no corresponde a la placa consultada.');
        const historial = Array.isArray(data.ultimos_ingresos) ? data.ultimos_ingresos : [];
        const encontrada = [...historial]
          .filter(d => Boolean(d.imagen_vehiculo || d.imagen_placa))
          .sort((a, b) => (Date.parse(b.fecha_hora_ingreso) || 0) - (Date.parse(a.fecha_hora_ingreso) || 0) || b.id - a.id)[0];
        setResultado({ placa: normalizada, estado: encontrada ? 'encontrada' : 'sin-imagenes', deteccion: encontrada });
      } catch (e) {
        if (!cancelado) setResultado({ placa: normalizada, estado: 'error', error: mensajeError(e) });
      }
    }, 350);
    return () => { cancelado = true; window.clearTimeout(temporizador); };
  }, [deteccion, normalizada]);

  const vigente = resultado?.placa === normalizada ? resultado : null;
  const evidencia = deteccion ?? vigente?.deteccion;
  return <div className="completo pila" style={{ gap: 8 }}>
    <FotoVehiculoPermiso deteccion={evidencia} incluirPlaca />
    {!deteccion && <small className="texto-secundario" role={vigente?.estado === 'cargando' ? 'status' : undefined}>
      {!validarPlaca(normalizada).ok ? 'Complete la placa para buscar las imágenes registradas.'
        : vigente?.estado === 'cargando' ? 'Buscando imágenes en el historial de ingresos…'
          : vigente?.estado === 'error' ? `No se pudieron consultar las imágenes: ${vigente.error}`
            : vigente?.estado === 'encontrada' ? 'Imágenes del último registro con evidencia de esta placa.'
              : 'No hay imágenes registradas para esta placa.'}
    </small>}
  </div>;
};
