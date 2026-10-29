import React, { useRef, useState } from 'react';
import { Camera, Check, Eraser, Hand, Plus, Save, Undo2, X } from 'lucide-react';
import api, { mensajeError } from '../../infraestructura/api';
import type { Camara } from '../../dominio/tipos';
import { Aviso, Modal } from './ui';
import { ReproductorWebRTC } from './envivo';
import { Punto } from './hud';

// Una única región normalizada sobre el flujo principal: su exterior queda excluido.
const MAX_VERTICES = 12;
const limitar = (v: number) => Math.min(1, Math.max(0, v));
const redondear = (v: number) => Math.round(v * 10000) / 10000;
interface Traslacion { inicio: Punto; original: Punto[] }

export function errorZonas(roi: Punto[]): string | null {
  if (roi.length > 0 && roi.length < 3) return 'La zona de interés necesita al menos 3 vértices (o bórrela para analizar el cuadro completo).';
  if (roi.length >= 3 && !poligonoSimple(roi)) return 'La zona de interés se cruza consigo misma o no forma un área válida. Ajuste sus vértices.';
  return null;
}

const orientacion = (a: Punto, b: Punto, c: Punto) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function segmentosSeCruzan(a: Punto, b: Punto, c: Punto, d: Punto): boolean {
  const abC = orientacion(a, b, c), abD = orientacion(a, b, d);
  const cdA = orientacion(c, d, a), cdB = orientacion(c, d, b);
  const eps = 1e-9;
  const entre = (v: number, x: number, y: number) => v >= Math.min(x, y) - eps && v <= Math.max(x, y) + eps;
  const sobre = (p: Punto, x: Punto, y: Punto) => Math.abs(orientacion(x, y, p)) < eps
    && entre(p[0], x[0], y[0]) && entre(p[1], x[1], y[1]);
  if (((abC > eps && abD < -eps) || (abC < -eps && abD > eps))
    && ((cdA > eps && cdB < -eps) || (cdA < -eps && cdB > eps))) return true;
  return sobre(c, a, b) || sobre(d, a, b) || sobre(a, c, d) || sobre(b, c, d);
}
function poligonoSimple(puntos: Punto[]): boolean {
  let dobleArea = 0;
  for (let i = 0; i < puntos.length; i++) {
    const a = puntos[i], b = puntos[(i + 1) % puntos.length];
    dobleArea += a[0] * b[1] - b[0] * a[1];
  }
  if (Math.abs(dobleArea) < 1e-6) return false;
  for (let i = 0; i < puntos.length; i++) {
    const iSiguiente = (i + 1) % puntos.length;
    for (let j = i + 1; j < puntos.length; j++) {
      const jSiguiente = (j + 1) % puntos.length;
      if (i === j || iSiguiente === j || jSiguiente === i) continue;
      if (segmentosSeCruzan(puntos[i], puntos[iSiguiente], puntos[j], puntos[jSiguiente])) return false;
    }
  }
  return true;
}

const centro = (z: Punto[]): Punto => [z.reduce((s, p) => s + p[0], 0) / z.length, z.reduce((s, p) => s + p[1], 0) / z.length];
const puntosSvg = (z: Punto[]) => z.map(([x, y]) => `${x},${y}`).join(' ');

export const EditorRoi: React.FC<{ camara: Camara; onCerrar: () => void; onGuardada: (c: Camara) => void }> = ({ camara, onCerrar, onGuardada }) => {
  const [roi, setRoi] = useState<Punto[]>(camara.roi ?? []);
  const [dibujando, setDibujando] = useState(false);
  const [puntero, setPuntero] = useState<Punto | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolucion, setResolucion] = useState<{ ancho: number; alto: number } | null>(null);
  const superficie = useRef<HTMLDivElement>(null);
  const arrastre = useRef<number | null>(null);
  const traslacion = useRef<Traslacion | null>(null);
  const anterior = useRef<Punto[]>([]);

  const posicion = (e: React.PointerEvent): Punto => {
    const r = superficie.current!.getBoundingClientRect();
    return [redondear(limitar((e.clientX - r.left) / r.width)), redondear(limitar((e.clientY - r.top) / r.height))];
  };
  const finalizarDibujo = () => {
    const problema = roi.length < 3 ? 'Marque al menos 3 vértices antes de cerrar el polígono.' : errorZonas(roi);
    if (problema) { setError(problema); return; }
    setDibujando(false);
    setPuntero(null);
    setError(null);
  };
  const alPulsar = (e: React.PointerEvent) => {
    if (e.button !== 0 || arrastre.current !== null || !dibujando) return;
    setError(null);
    const p = posicion(e);
    const r = superficie.current!.getBoundingClientRect();
    if (roi.length >= 3 && (e.detail > 1 || Math.hypot((p[0] - roi[0][0]) * r.width, (p[1] - roi[0][1]) * r.height) <= 16)) {
      finalizarDibujo();
      return;
    }
    if (roi.length >= MAX_VERTICES) { setError(`Máximo ${MAX_VERTICES} vértices por zona.`); return; }
    setRoi(l => [...l, p]);
  };
  const alMover = (e: React.PointerEvent) => {
    const p = posicion(e);
    const movimiento = traslacion.current;
    if (movimiento) {
      const minX = Math.min(...movimiento.original.map(q => q[0])), maxX = Math.max(...movimiento.original.map(q => q[0]));
      const minY = Math.min(...movimiento.original.map(q => q[1])), maxY = Math.max(...movimiento.original.map(q => q[1]));
      const dx = Math.max(-minX, Math.min(1 - maxX, p[0] - movimiento.inicio[0]));
      const dy = Math.max(-minY, Math.min(1 - maxY, p[1] - movimiento.inicio[1]));
      setRoi(movimiento.original.map(([x, y]) => [redondear(x + dx), redondear(y + dy)]));
    } else if (arrastre.current !== null) {
      const vertice = arrastre.current;
      setRoi(l => l.map((q, i) => i === vertice ? p : q));
    } else if (dibujando) setPuntero(p);
  };
  const alSoltar = () => { arrastre.current = null; traslacion.current = null; };
  const borrar = () => {
    setRoi([]);
    setDibujando(false);
    setPuntero(null);
    setError(null);
    alSoltar();
  };
  const iniciarDibujo = () => {
    anterior.current = roi;
    setRoi([]);
    setPuntero(null);
    setError(null);
    setDibujando(true);
  };
  const cancelarDibujo = () => {
    setRoi(anterior.current);
    setDibujando(false);
    setPuntero(null);
    setError(null);
  };
  const guardar = async () => {
    const problema = errorZonas(roi);
    if (problema) { setError(problema); return; }
    setGuardando(true);
    setError(null);
    try {
      // Limpia exclusiones antiguas para que no queden huecos ocultos dentro de la región.
      const r = await api.put(`/camaras/${camara.id}/roi`, { roi: roi.length ? roi : null, exclusiones: [] });
      onGuardada(r.data.camera);
    } catch (e) { setError(mensajeError(e)); }
    finally { setGuardando(false); }
  };
  const exterior = roi.length >= 3 && !dibujando
    ? `M0 0H1V1H0Z M${roi.map(([x, y]) => `${x} ${y}`).join(' L')} Z` : null;
  const capa = (
    <div ref={superficie} data-testid="superficie-zonas" onPointerDown={alPulsar} onPointerMove={alMover}
      onPointerUp={alSoltar} onPointerCancel={alSoltar} onPointerLeave={() => setPuntero(null)}
      style={{ position: 'absolute', inset: 0, cursor: dibujando ? 'crosshair' : 'default', touchAction: 'none' }}>
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        {exterior && <path data-testid="exterior-excluido" d={exterior} fill="rgba(2,6,23,0.55)" fillRule="evenodd" />}
        {roi.length >= 2 && (dibujando
          ? <polyline points={puntosSvg(roi)} fill="none" stroke="#7dd3fc" strokeWidth={2.5} strokeDasharray="8 5" vectorEffect="non-scaling-stroke" />
          : <polygon points={puntosSvg(roi)} fill="rgba(56,189,248,0.14)" stroke="#7dd3fc" strokeWidth={2.5} strokeDasharray="8 5" vectorEffect="non-scaling-stroke" />)}
        {dibujando && roi.length > 0 && puntero && <polyline points={`${puntosSvg(roi)} ${puntero[0]},${puntero[1]}`} fill="none" stroke="#7dd3fc" strokeWidth={1.5} strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />}
      </svg>
      {roi.map(([x, y], i) => <span key={i} role="button" aria-label={`Vértice ${i + 1}`}
        title={dibujando ? 'Pulse el primer vértice para cerrar' : 'Arrastre para mover · doble clic para quitar'}
        onPointerDown={e => {
          if (e.button !== 0) return;
          e.stopPropagation();
          if (dibujando) { if (i === 0) finalizarDibujo(); return; }
          arrastre.current = i;
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onDoubleClick={e => { e.stopPropagation(); if (!dibujando) setRoi(l => l.filter((_, j) => j !== i)); }}
        style={{ position: 'absolute', left: `${x * 100}%`, top: `${y * 100}%`, width: 16, height: 16, marginLeft: -8, marginTop: -8,
          borderRadius: '50%', background: i === 0 ? '#38bdf8' : '#fff', border: '2px solid #0369a1', cursor: dibujando ? 'pointer' : 'grab',
          boxShadow: '0 0 0 3px rgba(255,255,255,.2), 0 1px 4px rgba(0,0,0,.5)' }} />)}
      {!dibujando && roi.length >= 3 && <button type="button" aria-label="Mover área" title="Arrastre para mover el polígono completo"
        onPointerDown={e => {
          if (e.button !== 0) return;
          e.stopPropagation(); e.preventDefault();
          traslacion.current = { inicio: posicion(e), original: roi };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        style={{ position: 'absolute', left: `${centro(roi)[0] * 100}%`, top: `${centro(roi)[1] * 100}%`, transform: 'translate(-50%,-50%)',
          width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 6, border: '1px solid rgba(255,255,255,.8)',
          color: '#fff', background: '#0369a1', boxShadow: '0 1px 6px #0008', cursor: 'move' }}><Hand size={15} /></button>}
    </div>
  );
  return (
    <Modal titulo={`Zona de interés · ${camara.nombre}`} subtitulo="El motor analiza dentro del polígono e ignora su exterior" onCerrar={onCerrar} tamano="ancho"
      pie={<>
        <button className="btn btn-secondary" onClick={onCerrar} disabled={guardando}>Cancelar</button>
        <button className="btn btn-navy" onClick={guardar} disabled={guardando || dibujando}><Save size={14} /> {guardando ? 'Guardando…' : 'Guardar zona'}</button>
      </>}>
      <div className="pila" style={{ gap: 12 }}>
        <div className="fila" style={{ gap: 6, flexWrap: 'wrap' }}>
          {dibujando ? <>
            <button className="btn btn-secondary btn-sm" onClick={finalizarDibujo} disabled={roi.length < 3}><Check size={14} /> Cerrar polígono</button>
            <button className="btn btn-ghost btn-sm" onClick={cancelarDibujo}><X size={14} /> Cancelar dibujo</button>
          </> : <button className="btn btn-secondary btn-sm" onClick={iniciarDibujo}><Plus size={14} /> Polígono</button>}
          <button className="btn btn-ghost btn-sm" onClick={() => { setRoi(l => l.slice(0, -1)); setError(null); }} disabled={!roi.length}><Undo2 size={14} /> Deshacer</button>
          <button className="btn btn-ghost btn-sm" onClick={borrar} disabled={!roi.length}><Eraser size={14} /> Borrar área</button>
        </div>
        <Aviso tipo="info">Dibuje la <b>zona de interés</b> con Polígono. Al cerrarlo, use la mano para moverlo o arrastre sus vértices. <b>Todo lo que queda fuera se ignora automáticamente.</b> Sin zona se analiza el cuadro completo.</Aviso>
        <ReproductorWebRTC etiqueta="ZONA DE INTERÉS" capa={capa} adaptarProporcion
          onEstadisticas={s => { if (s && s.ancho > 0 && s.alto > 0) setResolucion({ ancho: s.ancho, alto: s.alto }); }}
          obtener={async () => {
            const r = (await api.post(`/camaras/${camara.id}/video`)).data;
            return { whep: `${r.webrtc}/${r.ruta}/whep?ticket=${encodeURIComponent(r.ticket)}` };
          }} onFallo={m => setError(m)} />
        <div className="fila" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="insignia"><Camera size={13} /> Flujo principal · cuadro que procesa ANPR</span>
          {resolucion && <span className="insignia">Cuadro detectado: {resolucion.ancho} × {resolucion.alto}</span>}
          <span className="texto-secundario">{roi.length === 0 ? 'Sin área: se analiza el cuadro completo.' : `${roi.length} vértices · exterior excluido automáticamente`}</span>
        </div>
        {error && <Aviso tipo="error">{error}</Aviso>}
      </div>
    </Modal>
  );
};
