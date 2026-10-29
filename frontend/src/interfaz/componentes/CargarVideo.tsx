import React, { useRef, useState } from 'react';
import { FileVideo, Upload } from 'lucide-react';
import api, { mensajeError } from '../../infraestructura/api';
import type { Camara } from '../../dominio/tipos';
import { REGLAS_CAMARA } from '../../dominio/reglas';
import { erroresTexto, sinErrores } from '../../dominio/validacion';
import { formatoPorFirma, nombreDesdeArchivo, TIPO_CONTENIDO } from '../../dominio/videoPrueba';
import { Aviso, Modal, Segmentado } from './ui';
import { CampoTexto } from './campos';

/** Primeros bytes del archivo (la firma del formato). FileReader: funciona en todos los navegadores. */
const leerCabecera = (f: Blob) => new Promise<Uint8Array>((listo, fallo) => {
  const lector = new FileReader();
  lector.onload = () => listo(new Uint8Array(lector.result as ArrayBuffer));
  lector.onerror = () => fallo(lector.error);
  lector.readAsArrayBuffer(f.slice(0, 12));
});

/**
 * Cámara de prueba a partir de un video grabado (p. ej. la descarga del NVR de la garita): el
 * servidor de medios lo publica en bucle como si fuera la cámara, y desde ahí lo procesan el motor
 * ANPR y el monitoreo en vivo. Sirve para demostrar y medir el sistema con escenas reales.
 */
export const CargarVideo: React.FC<{ onCerrar: () => void; onCargada: (c: Camara) => void }> = ({ onCerrar, onCargada }) => {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [valores, setValores] = useState({ nombre: '', ubicacion: 'Video de prueba' });
  const [direccion, setDireccion] = useState<'ingreso' | 'salida'>('ingreso');
  const [progreso, setProgreso] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const errores = erroresTexto(valores, { nombre: REGLAS_CAMARA.nombre, ubicacion: REGLAS_CAMARA.ubicacion });
  const subiendo = progreso !== null;

  const elegir = async (f: File | undefined) => {
    setError(null);
    if (!f) return;
    const formato = formatoPorFirma(await leerCabecera(f));
    if (!formato) { setArchivo(null); setError('El archivo no es un video MP4, MKV o MOV.'); return; }
    setArchivo(f);
    setValores(v => ({ ...v, nombre: v.nombre || nombreDesdeArchivo(f.name) }));
  };

  const cargar = async () => {
    if (!archivo || !sinErrores(errores)) return;
    const formato = formatoPorFirma(await leerCabecera(archivo));
    if (!formato) { setError('El archivo no es un video MP4, MKV o MOV.'); return; }
    setProgreso(0);
    setError(null);
    try {
      const r = await api.post('/camaras/video-prueba', archivo, {
        params: { nombre: valores.nombre, ubicacion: valores.ubicacion, direccion },
        headers: { 'Content-Type': TIPO_CONTENIDO[formato] },
        timeout: 0,
        onUploadProgress: e => setProgreso(e.total ? Math.round((e.loaded / e.total) * 100) : null),
      });
      onCargada(r.data.camera);
    } catch (e) {
      setError(mensajeError(e));
      setProgreso(null);
    }
  };

  const mb = archivo ? (archivo.size / 1048576).toLocaleString('es-EC', { maximumFractionDigits: 1 }) : null;
  return (
    <Modal titulo="Cargar video de prueba" subtitulo="El video se procesa como si fuera la cámara: motor ANPR, Gestión de Accesos y registros"
      onCerrar={onCerrar} bloquear={subiendo}
      pie={<>
        <button className="btn btn-secondary" onClick={onCerrar} disabled={subiendo}>Cancelar</button>
        <button className="btn btn-navy" onClick={cargar} disabled={!archivo || subiendo || !sinErrores(errores)}>
          <Upload size={14} /> {subiendo ? `Subiendo… ${progreso ?? 0} %` : 'Cargar y crear cámara'}</button>
      </>}>
      <div className="pila" style={{ gap: 12 }}>
        <input ref={entrada} type="file" accept="video/mp4,video/x-matroska,video/quicktime,.mp4,.mkv,.mov" hidden
          aria-label="Archivo de video" onChange={e => void elegir(e.target.files?.[0])} />
        <button type="button" className="btn btn-secondary" onClick={() => entrada.current?.click()} disabled={subiendo}
          style={{ justifyContent: 'flex-start', height: 'auto', padding: '10px 12px' }}>
          <FileVideo size={18} />
          <span style={{ textAlign: 'left' }}>
            {archivo ? <><b>{archivo.name}</b><span className="secundario">{mb} MB</span></> : 'Elegir archivo de video (MP4, MKV o MOV)'}
          </span>
        </button>
        <CampoTexto id="video-nombre" etiqueta="Nombre de la cámara" valor={valores.nombre} regla={REGLAS_CAMARA.nombre}
          onCambiar={v => setValores(x => ({ ...x, nombre: v }))} deshabilitado={subiendo} error={errores.nombre} />
        <CampoTexto id="video-ubicacion" etiqueta="Ubicación" valor={valores.ubicacion} regla={REGLAS_CAMARA.ubicacion}
          onCambiar={v => setValores(x => ({ ...x, ubicacion: v }))} deshabilitado={subiendo} error={errores.ubicacion} />
        <div className="fila" style={{ gap: 10 }}>
          <span className="etiqueta-campo">Dirección</span>
          <Segmentado valor={direccion} onCambiar={setDireccion} opciones={[{ valor: 'ingreso', etiqueta: 'Ingreso' }, { valor: 'salida', etiqueta: 'Salida' }]} />
        </div>
        {subiendo && <div className="barra-progreso" role="progressbar" aria-valuenow={progreso ?? 0} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${progreso ?? 0}%` }} /></div>}
        <Aviso tipo="info">
          Se reproduce en bucle a su velocidad real y sin recodificar. Después de cargarlo, dibuje sus <b>Zonas</b> y asígnelo al
          motor en <b>Gestión de Accesos</b>. Los registros que genere quedan en el historial como los de una cámara real.
        </Aviso>
        {error && <Aviso tipo="error">{error}</Aviso>}
      </div>
    </Modal>
  );
};
