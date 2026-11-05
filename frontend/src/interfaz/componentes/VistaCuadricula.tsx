import React, { useState } from 'react';
import { Camera, GripVertical, WifiOff, X } from 'lucide-react';
import { useEvento } from '../../aplicacion/tiempoReal';
import type { Camara } from '../../dominio/tipos';
import { Aviso } from './ui';
import { VisorEnVivo } from './envivo';

const CLAVE_SLOTS = 'anpr_nvr_slots_v1';
const CLAVE_CANTIDAD = 'anpr_cuadricula_cantidad_v1';
type CantidadCeldas = 1 | 2 | 4;

function leerSlots(): (number | null)[] {
  try {
    const valor: unknown = JSON.parse(localStorage.getItem(CLAVE_SLOTS) || '[]');
    if (!Array.isArray(valor)) return [null, null, null, null];
    return Array.from({ length: 4 }, (_, i) => Number.isInteger(valor[i]) && valor[i] > 0 ? valor[i] as number : null);
  } catch {
    return [null, null, null, null];
  }
}

function leerCantidad(): CantidadCeldas {
  try {
    const cantidad = Number(localStorage.getItem(CLAVE_CANTIDAD));
    return cantidad === 1 || cantidad === 2 || cantidad === 4 ? cantidad : 4;
  } catch {
    return 4;
  }
}

function hayGuardado(clave: string): boolean {
  try {
    return localStorage.getItem(clave) !== null;
  } catch {
    return false;
  }
}

/** Primeras cámaras registradas, el ingreso antes que la salida, para no empezar con las celdas vacías. */
function distribucionInicial(camaras: Camara[]): (number | null)[] {
  const orden = [...camaras].sort((a, b) => Number(a.direccion === 'salida') - Number(b.direccion === 'salida'));
  return Array.from({ length: 4 }, (_, i) => orden[i]?.id ?? null);
}

export const VistaCuadricula: React.FC<{ camaras: Camara[]; analizadas: number[] }> = ({ camaras, analizadas }) => {
  const [guardados, setSlots] = useState<(number | null)[]>(leerSlots);
  const [cantidadGuardada, setCantidad] = useState<CantidadCeldas>(leerCantidad);
  const [distribucionElegida, setDistribucionElegida] = useState(() => hayGuardado(CLAVE_SLOTS));
  const [cantidadElegida, setCantidadElegida] = useState(() => hayGuardado(CLAVE_CANTIDAD));
  // Sin distribución, o si solo quedan cámaras ya eliminadas, se llena sola. Si la persona vació las celdas, se respeta
  const conCamaras = guardados.some(id => id !== null);
  const automatica = conCamaras ? !guardados.some(id => camaras.some(c => c.id === id)) : !distribucionElegida;
  const slots = automatica ? distribucionInicial(camaras) : guardados;
  const cantidad: CantidadCeldas = automatica && !cantidadElegida ? (camaras.length <= 1 ? 1 : camaras.length === 2 ? 2 : 4) : cantidadGuardada;
  const [errorVideo, setErrorVideo] = useState<string | null>(null);
  // Conexión de cada cámara: la de la lista y luego la de cada verificación periódica del backend
  // (evento camara:estado). Sin conexión, el reproductor giraba sin fin con un error genérico
  const [conexion, setConexion] = useState<Record<number, { estado: Camara['estado']; mensaje: string | null }>>({});
  useEvento<{ id: number; estado: Camara['estado']; mensaje_ping?: string | null }>('camara:estado',
    e => setConexion(c => ({ ...c, [e.id]: { estado: e.estado, mensaje: e.mensaje_ping ?? null } })));

  const guardarSlots = (siguiente: (number | null)[]) => {
    setSlots(siguiente);
    setDistribucionElegida(true);
    try { localStorage.setItem(CLAVE_SLOTS, JSON.stringify(siguiente)); } catch { /* almacenamiento no disponible */ }
  };
  const cambiarCantidad = (siguiente: CantidadCeldas) => {
    setCantidad(siguiente);
    setCantidadElegida(true);
    try { localStorage.setItem(CLAVE_CANTIDAD, String(siguiente)); } catch { /* preferencia no disponible */ }
  };
  const colocar = (id: number, destino: number) => {
    const actual = [...slots];
    const previo = actual.indexOf(id);
    if (previo >= 0 && previo !== destino) [actual[previo], actual[destino]] = [actual[destino], actual[previo]];
    else actual[destino] = id;
    guardarSlots(actual);
  };
  const alSoltar = (e: React.DragEvent, destino: number) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData('application/x-anpr-camera'));
    if (Number.isInteger(id) && camaras.some(c => c.id === id)) colocar(id, destino);
  };

  return (
    <div className="pila" style={{ gap: 8 }}>
      <div className="fila" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span className="texto-secundario">Arrastre cámaras del menú lateral a las celdas. La distribución se conserva entre sesiones.</span>
        <div className="fila" role="group" aria-label="Cantidad de cámaras en la vista cuadrícula">
          {([1, 2, 4] as const).map(n => (
            <button key={n} type="button" className="btn btn-sm btn-secondary btn-opcion"
              aria-pressed={cantidad === n} aria-label={`Mostrar ${n} ${n === 1 ? 'cámara' : 'cámaras'}`}
              onClick={() => cambiarCantidad(n)}>{n}</button>
          ))}
        </div>
      </div>
      {errorVideo && <Aviso tipo="error">{errorVideo}</Aviso>}
      <div className={`nvr-grid nvr-grid-${cantidad}`} aria-label={`Vista cuadrícula de ${cantidad} cámaras`}>
        {slots.slice(0, cantidad).map((id, indice) => {
          const camara = camaras.find(c => c.id === id);
          const enlace = camara ? conexion[camara.id] ?? { estado: camara.estado, mensaje: camara.mensaje_ping } : null;
          return (
            <section key={indice} className="nvr-celda" onDragOver={e => e.preventDefault()} onDrop={e => alSoltar(e, indice)}
              aria-label={`Cámara ${indice + 1}${camara ? `: ${camara.nombre}` : ', vacía'}`}>
              <header className="nvr-celda-cabecera">
                <span className="fila truncar" style={{ gap: 6, minWidth: 0 }}>
                  <GripVertical size={14} />
                  <strong className="truncar">{camara?.nombre ?? `Cámara ${indice + 1}`}</strong>
                  {camara && <span className="nvr-direccion">{camara.direccion === 'salida' ? 'SALIDA' : 'INGRESO'}</span>}
                  {camara?.activa && !analizadas.includes(camara.id) && <span className="nvr-direccion">SOLO VIDEO</span>}
                </span>
                {camara && <button className="btn btn-ghost btn-sm btn-icono" title="Quitar cámara de la celda" aria-label="Quitar cámara"
                  onClick={() => guardarSlots(slots.map((s, i) => i === indice ? null : s))}><X size={14} /></button>}
              </header>
              <div className="nvr-video">
                {camara?.activa && enlace?.estado === 'SIN_CONEXION'
                  ? (
                    <div className="nvr-vacio nvr-sin-conexion" role="status">
                      <WifiOff size={22} />
                      <strong>Sin conexión con la cámara</strong>
                      <span>{camara.ip} · {enlace.mensaje ?? 'no responde'}. Este equipo debe estar en la red de la cámara; el video se abre solo cuando vuelva a responder.</span>
                    </div>
                  )
                  : camara?.activa
                  ? <VisorEnVivo camaraId={camara.id} analizada={analizadas.includes(camara.id)} vista={Boolean(camara.rtsp_url_vista)} pausado={false}
                      onFallo={m => setErrorVideo(`${camara.nombre}: ${m}`)} />
                  : camara
                    ? <div className="nvr-vacio">Cámara deshabilitada</div>
                    : <div className="nvr-vacio"><Camera size={22} /><span>Arrastre una cámara aquí</span></div>}
              </div>
            </section>
          );
        })}
      </div>
      <span className="texto-secundario">Las cajas de detección aparecen en las cámaras que analiza el motor ANPR; las marcadas SOLO VIDEO no registran pasos.</span>
    </div>
  );
};
