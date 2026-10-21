import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ImageOff, Loader2, Trash2 } from 'lucide-react';
import api, { mensajeError } from '../../infraestructura/api';
import type { Camara, Deteccion } from '../../dominio/tipos';
import { colorConfianza, ESTADOS, fechaHora, hora, porcentaje } from '../../dominio/formato';
import { urlMedia } from '../../infraestructura/api';
import { formatearPlaca, placaPropuesta, validarPlaca, validarTexto } from '../../dominio/validacion';
import {
  MOTIVOS_INGRESO_FRECUENTES, REGLA_MOTIVO_EXCEPCION, REGLA_MOTIVO_INGRESO, REGLA_MOTIVO_MANUAL, REGLA_OBSERVACION_VALIDACION, REGLA_PERSONA_INGRESO,
} from '../../dominio/reglas';
import { Aviso, InsigniaEstado, InsigniaTipificacion, Modal, Placa } from './ui';
import { CampoPlaca, CampoTexto } from './campos';
import { useNotificar } from './Notificaciones';
import { VisorZoom } from './ZoomDual';

export const TIPOS_VEHICULO = ['Automóvil', 'Camioneta', 'SUV', 'Motocicleta', 'Camión', 'Bus', 'Furgoneta'];

/** Confianza legible de placa: >=90 % verde, >=75 % amarilla y el resto roja. */
export const ConfianzaBadge: React.FC<{ valor: number | null; etiqueta?: string }> = ({ valor, etiqueta = 'OCR' }) => {
  if (valor === null) return <span className="confianza-badge confianza-sin-dato">{etiqueta} —</span>;
  const nivel = valor >= 0.9 ? 'alta' : valor >= 0.75 ? 'media' : 'baja';
  return <span className={`confianza-badge confianza-${nivel}`} title={`Confianza ${etiqueta}: ${porcentaje(valor)}`}>{etiqueta} {porcentaje(valor)}</span>;
};

/** Imagen de evidencia con carga diferida y marcador si no existe. */
export const ImagenEvidencia: React.FC<{ ruta: string | null; alt: string; alto?: number | string; ajuste?: 'cover' | 'contain'; onClick?: () => void; fondoOscuro?: boolean }> =
  ({ ruta, alt, alto = 120, ajuste = 'cover', onClick, fondoOscuro }) => {
    const [error, setError] = useState(false);
    const src = urlMedia(ruta);
    useEffect(() => setError(false), [ruta]);
    const estilo: React.CSSProperties = {
      width: '100%', height: alto, borderRadius: 8, background: fondoOscuro ? '#0b1220' : 'var(--surface-3)', overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)', cursor: onClick && src && !error ? 'zoom-in' : undefined,
    };
    if (!src || error) return <div style={estilo}><ImageOff size={20} /></div>;
    return (
      <div style={estilo} onClick={onClick}>
        <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setError(true)} style={{ width: '100%', height: '100%', objectFit: ajuste }} />
      </div>
    );
  };

/**
 * URL del recorte real de la placa. Si el motor no pudo recortarla, la API repite en imagen_placa la
 * foto del vehículo: entonces no hay recorte que mostrar.
 */
export function recortePlaca(d: Pick<Deteccion, 'imagen_placa' | 'imagen_vehiculo'>): string | null {
  return d.imagen_placa && d.imagen_placa !== d.imagen_vehiculo ? d.imagen_placa : null;
}

/**
 * La placa tal como la captó la cámara: la foto real del recorte y, al lado (o debajo, en tamaño
 * grande), la lectura del sistema. Si el paso no tiene recorte se indica en lugar de la foto.
 */
export const PlacaFoto: React.FC<{ d: Pick<Deteccion, 'placa' | 'imagen_placa' | 'imagen_vehiculo' | 'sin_placa'>; alto?: number; grande?: boolean; onClick?: () => void }> =
  ({ d, alto = 36, grande, onClick }) => {
    const [error, setError] = useState(false);
    const src = urlMedia(recortePlaca(d));
    useEffect(() => setError(false), [src]);
    const foto = src && !error;
    return (
      <span className={`placa-foto${grande ? ' grande' : ''}`}>
        <span className="placa-foto-imagen" title={foto ? undefined : 'Sin recorte de la placa'} onClick={foto ? onClick : undefined}
          style={{ height: alto, width: grande ? '100%' : alto * 3, cursor: foto && onClick ? 'zoom-in' : undefined }}>
          {foto
            ? <img src={src} alt={`Placa ${d.placa ?? 'sin lectura'}`} loading="lazy" decoding="async" onError={() => setError(true)} />
            : <ImageOff size={grande ? 22 : 14} />}
        </span>
        <Placa valor={d.placa} grande={grande} sinPlaca={d.sin_placa} />
      </span>
    );
  };

export function describirVehiculo(d: Pick<Deteccion, 'vehiculo'>): string {
  const v = d.vehiculo;
  const nombre = [v.marca, v.modelo].filter(Boolean).join(' ');
  return [nombre, v.color].filter(Boolean).join(' · ') || '—';
}

/** Tarjeta compacta de un paso vehicular (feed de monitoreo y listas cortas). */
/** Tarjeta de un paso vehicular en el feed (verde si autorizado, roja si alerta). */
export const TarjetaDeteccion: React.FC<{ d: Deteccion; onValidar?: (d: Deteccion) => void; onEliminar?: (d: Deteccion) => void; resaltada?: boolean }> = ({ d, onValidar, onEliminar, resaltada }) => {
  const navigate = useNavigate();
  const [zoom, setZoom] = useState(false);
  const procesando = d.estado_procesamiento === 'pendiente_ocr';
  const autorizado = !procesando && d.estado_validacion === 'autorizado';
  const alerta = !procesando && d.estado_validacion === 'alerta';
  const color = procesando ? 'var(--pendiente)' : ESTADOS[d.estado_validacion]?.color ?? 'var(--border)';
  const fondo = resaltada ? 'var(--fondo-resaltado)' : autorizado ? 'var(--fila-autorizado)' : alerta ? 'var(--fila-alerta)' : 'var(--surface)';
  return (
    <article className="animate-fade-in"
      onClick={() => navigate(`/detecciones/${d.id}`)}
      style={{
        display: 'grid', gridTemplateColumns: '96px 1fr', gap: 12, padding: 10, borderRadius: 10, cursor: 'pointer',
        border: `1px solid ${autorizado ? 'var(--autorizado-border)' : alerta ? 'var(--alerta-border)' : 'var(--border)'}`,
        borderLeft: `4px solid ${color}`, background: fondo, transition: 'background 0.6s',
      }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="miniatura-zoom" title="Clic para ver la fotografía y la placa con zoom" onClick={e => { e.stopPropagation(); if (d.imagen_placa || d.imagen_vehiculo) setZoom(true); }}>
          <ImagenEvidencia ruta={d.imagen_placa || d.imagen_vehiculo} alt={`Placa ${d.placa ?? 'sin lectura'}`} alto={60} ajuste="contain" fondoOscuro />
        </div>
        <div className="fila" style={{ justifyContent: 'space-around', fontSize: 9.5, gap: 4, flexWrap: 'wrap' }}>
          {d.confianza_deteccion !== null && <ConfianzaBadge valor={d.confianza_deteccion} etiqueta="Det" />}
          {procesando ? <span>OCR ⏳</span> : d.confianza_ocr !== null && <ConfianzaBadge valor={d.confianza_ocr} />}
        </div>
      </div>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div className="fila" style={{ justifyContent: 'space-between', gap: 6 }}>
          {procesando && !d.placa ? <span className="placa vacia">Leyendo…</span> : <Placa valor={d.placa} sinPlaca={d.sin_placa} />}
          <span className="fila nowrap" style={{ gap: 2 }}>
            <span className="texto-secundario" style={{ fontSize: 11.5 }}>{hora(d.fecha_hora_ingreso)}</span>
            {onEliminar && (
              <button className="btn btn-ghost btn-sm btn-icono" style={{ width: 24, height: 24 }} title="Eliminar registro" aria-label="Eliminar registro"
                onClick={e => { e.stopPropagation(); onEliminar(d); }}><Trash2 size={13} color="var(--alerta)" /></button>
            )}
          </span>
        </div>
        <div className="fila" style={{ gap: 6, justifyContent: 'space-between' }}>
          <InsigniaEstado estado={d.estado_validacion} procesando={procesando} corta solido={autorizado || alerta} />
          {!procesando && d.estado_validacion === 'pendiente_revision' && onValidar && (
            <button className="btn btn-sm btn-secondary" onClick={e => { e.stopPropagation(); onValidar(d); }}>Validar</button>
          )}
        </div>
        {!procesando && d.placa && <InsigniaTipificacion placa={d.placa} />}
        {autorizado && d.autorizado && (
          <div className="truncar" style={{ fontSize: 12, color: 'var(--autorizado)', fontWeight: 600 }} title={d.autorizado.propietario}>
            ✓ {d.autorizado.propietario}{d.autorizado.departamento ? ` (${d.autorizado.departamento})` : ''}
          </div>
        )}
        {!procesando && d.motivo_revision && (
          <div className="truncar" style={{ fontSize: 11.5, color: 'var(--no-registrado)', fontWeight: 600 }} title={d.motivo_revision}>
            {d.restriccion_acceso
              ? <>⏱ {d.restriccion_acceso === 'fuera_horario' ? 'Fuera de horario' : d.restriccion_acceso === 'no_iniciada' ? 'Permiso aún no vigente' : 'Permiso vencido'}{d.autorizado ? ` · ${d.autorizado.propietario}` : ''}</>
              : d.autorizado
                ? <>ⓘ En padrón ({d.autorizado.propietario}) · confirme la placa</>
                : d.sin_placa ? <>ⓘ Vehículo sin placa visible · verifique con la foto</>
                  : d.estado_procesamiento === 'no_legible' ? <>ⓘ Placa no leída · verifique con la foto</>
                    : <>ⓘ Lectura no confirmada · verifique la placa</>}
          </div>
        )}
        {alerta && (
          <div className="truncar" style={{ fontSize: 12, color: 'var(--alerta)', fontWeight: 600, background: 'var(--alerta-bg)', padding: '2px 6px', borderRadius: 4 }}>
            ⚠ {d.alerta?.motivo ?? 'Coincidencia con la lista negra'}
          </div>
        )}
        <div className="texto-secundario truncar" style={{ fontSize: 11.5 }}>
          {d.camara?.nombre ?? (d.fuente === 'manual' ? 'Registro manual' : 'Sin datos adicionales')}
        </div>
      </div>
      {zoom && <div onClick={e => e.stopPropagation()}><VisorZoom d={d} onCerrar={() => setZoom(false)} /></div>}
    </article>
  );
};

/** Nombres y apellidos de quien ingresa y motivo de ingreso, tal como se envían a la API. */
export interface DatosIngreso { persona: string; motivo: string }

export const datosIngresoValidos = (x: DatosIngreso) =>
  validarTexto(x.persona, REGLA_PERSONA_INGRESO).ok && validarTexto(x.motivo, REGLA_MOTIVO_INGRESO).ok;
/** Vacío = borrar (la API distingue un campo ausente de uno vacío) */
export const cuerpoIngreso = (x: DatosIngreso) => ({ persona_ingreso: x.persona.trim(), motivo_ingreso: x.motivo.trim() });

/**
 * Quién ingresa y por qué: las columnas «Nombres y apellidos» y «Observaciones» del reporte de
 * control vehicular de la garita. Los motivos frecuentes se eligen con un toque.
 */
export const CamposIngreso: React.FC<{ id: string; valor: DatosIngreso; onCambiar: (v: DatosIngreso) => void; onEnter?: () => void }> =
  ({ id, valor, onCambiar, onEnter }) => (
    <>
      <CampoTexto id={`${id}-persona`} className="completo" etiqueta="Nombres y apellidos de quien ingresa" valor={valor.persona}
        onCambiar={persona => onCambiar({ ...valor, persona })} regla={REGLA_PERSONA_INGRESO} onEnter={onEnter}
        autoComplete="off" placeholder="Ej.: Ana Pérez" ayuda="Si el vehículo está en la lista blanca, se propone su titular." />
      <div className="completo pila" style={{ gap: 6 }}>
        <CampoTexto id={`${id}-motivo`} etiqueta="Motivo de ingreso" valor={valor.motivo} onCambiar={motivo => onCambiar({ ...valor, motivo })}
          regla={REGLA_MOTIVO_INGRESO} onEnter={onEnter} placeholder="Ej.: reunión con la coordinación zonal" />
        <div className="fila" style={{ gap: 6 }} role="group" aria-label="Motivos frecuentes">
          {MOTIVOS_INGRESO_FRECUENTES.map(m => (
            <button key={m} type="button" className={`btn btn-sm ${valor.motivo === m ? 'btn-navy' : 'btn-secondary'}`}
              aria-pressed={valor.motivo === m} onClick={() => onCambiar({ ...valor, motivo: m })}>{m}</button>
          ))}
        </div>
      </div>
    </>
  );

/** Segunda línea de la columna «Vehículo / titular»: quién ingresa y por qué, si se registró. */
export const LineaIngreso: React.FC<{ d: Pick<Deteccion, 'persona_ingreso' | 'motivo_ingreso'> }> = ({ d }) => {
  const texto = [d.persona_ingreso, d.motivo_ingreso].filter(Boolean).join(' · ');
  return texto ? <span className="secundario truncar" title={texto}>{texto}</span> : null;
};

/** Edita quién ingresó y el motivo de un paso ya registrado (detalle del paso). */
export const DatosIngresoModal: React.FC<{ d: Deteccion; onCerrar: () => void; onGuardado?: (d: Deteccion) => void }> = ({ d, onCerrar, onGuardado }) => {
  const notificar = useNotificar();
  const [datos, setDatos] = useState<DatosIngreso>(() => ({ persona: d.persona_ingreso ?? d.autorizado?.propietario ?? '', motivo: d.motivo_ingreso ?? '' }));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valido = datosIngresoValidos(datos);
  const guardar = async () => {
    setEnviando(true);
    setError(null);
    try {
      const r = await api.patch(`/detecciones/${d.id}/ingreso`, cuerpoIngreso(datos));
      notificar('exito', 'Datos del ingreso guardados', formatearPlaca(d.placa) || 'Paso sin placa');
      onGuardado?.(r.data.deteccion);
      onCerrar();
    } catch (e) {
      setError(mensajeError(e));
      setEnviando(false);
    }
  };
  return (
    <Modal titulo="Quién ingresa y motivo" subtitulo={`${formatearPlaca(d.placa) || 'Sin placa'} · ${fechaHora(d.fecha_hora_ingreso)}`} onCerrar={onCerrar} bloquear={enviando}
      pie={<>
        <button className="btn btn-secondary" onClick={onCerrar} disabled={enviando}>Cancelar</button>
        <button className="btn btn-navy" onClick={guardar} disabled={!valido || enviando}>{enviando && <Loader2 size={14} className="girar" />} Guardar</button>
      </>}>
      <div className="form-grid">
        <CamposIngreso id="edi" valor={datos} onCambiar={setDatos} onEnter={() => { if (valido && !enviando) guardar(); }} />
        <div className="completo"><Aviso tipo="info">Estos datos salen en el reporte de control vehicular (Reportes). El cambio queda en la auditoría.</Aviso></div>
        {error && <div className="completo"><Aviso tipo="error">{error}</Aviso></div>}
      </div>
    </Modal>
  );
};

/** Validación / corrección manual de un paso vehicular por el personal. */
/**
 * Confirmación o corrección de la placa de un paso. Con `excepcion`, una persona con el
 * permiso accesos:excepcion concede el paso pese a la restricción temporal del permiso
 * (fuera de horario, aún no vigente o vencido); el motivo es obligatorio y queda auditado.
 */
export const ValidarModal: React.FC<{ d: Deteccion; onCerrar: () => void; onValidada?: (d: Deteccion) => void; excepcion?: boolean }> = ({ d, onCerrar, onValidada, excepcion }) => {
  const notificar = useNotificar();
  // La placa confirmada la escribe una persona: se valida con el formato ANT (la lectura de la cámara, no;
  // solo se propone como punto de partida)
  const [placa, setPlaca] = useState(() => placaPropuesta(d.placa_validada || d.placa_reconocida));
  const [observacion, setObservacion] = useState('');
  const esIngreso = d.tipo_movimiento !== 'salida';
  // Quién ingresa: lo ya registrado o, si el vehículo está en la lista blanca, su titular
  const [ingreso, setIngreso] = useState<DatosIngreso>(() => ({ persona: d.persona_ingreso ?? d.autorizado?.propietario ?? '', motivo: d.motivo_ingreso ?? '' }));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reglaObservacion = excepcion ? REGLA_MOTIVO_EXCEPCION : REGLA_OBSERVACION_VALIDACION;
  const valida = validarPlaca(placa).ok && validarTexto(observacion, reglaObservacion).ok && (!esIngreso || datosIngresoValidos(ingreso));
  const [zoom, setZoom] = useState(false);

  const guardar = async () => {
    setEnviando(true);
    setError(null);
    try {
      const r = await api.post(`/detecciones/validar/${d.id}`, {
        placa_validada: placa, observacion: observacion.trim() || undefined, excepcion: excepcion || undefined,
        ...(esIngreso ? cuerpoIngreso(ingreso) : {}),
      });
      const det: Deteccion = r.data.deteccion;
      notificar(det.estado_validacion === 'alerta' ? 'error' : 'exito', `${det.tipo_movimiento === 'salida' ? 'Salida' : 'Ingreso'} validado: ${formatearPlaca(det.placa)}`, ESTADOS[det.estado_validacion].etiqueta);
      onValidada?.(det);
      onCerrar();
    } catch (e) {
      setError(mensajeError(e));
      setEnviando(false);
    }
  };

  return (
    <Modal titulo={d.tipo_movimiento === 'salida' ? 'Corregir lectura de salida' : excepcion ? 'Autorizar ingreso por excepción' : 'Validar ingreso'} subtitulo={`${fechaHora(d.fecha_hora_ingreso)}${d.camara ? ` · ${d.camara.nombre}` : ''}`} onCerrar={onCerrar} bloquear={enviando}
      pie={<>
        <button className="btn btn-secondary" onClick={onCerrar} disabled={enviando}>Cancelar</button>
        <button className={`btn ${excepcion ? 'btn-exito' : 'btn-navy'}`} onClick={guardar} disabled={!valida || enviando}>{enviando && <Loader2 size={14} className="girar" />} {excepcion ? 'Autorizar por excepción' : d.tipo_movimiento === 'salida' ? 'Registrar salida' : 'Confirmar placa'}</button>
      </>}>
      <div className="pila">
        <div className="grid-2" style={{ gap: 10 }}>
          <div><span className="etiqueta-campo">Placa (recorte)</span><div style={{ marginTop: 6 }}>
            <ImagenEvidencia ruta={d.imagen_placa} alt="Recorte de placa" alto={110} ajuste="contain" fondoOscuro onClick={() => setZoom(true)} /></div></div>
          <div><span className="etiqueta-campo">Vehículo</span><div style={{ marginTop: 6 }}>
            <ImagenEvidencia ruta={d.imagen_vehiculo} alt="Vehículo" alto={110} onClick={() => setZoom(true)} /></div></div>
        </div>
        {d.motivo_revision && <Aviso tipo="advertencia">{d.motivo_revision}</Aviso>}
        <div className="texto-secundario">
          Lectura automática: <b style={{ color: 'var(--text)' }}>{d.placa_reconocida ? formatearPlaca(d.placa_reconocida) : 'sin lectura'}</b>
          {d.confianza_ocr !== null && <> · confianza <b style={{ color: colorConfianza(d.confianza_ocr) }}>{porcentaje(d.confianza_ocr)}</b></>}
        </div>
        <div className="form-grid">
          <CampoPlaca id="val-placa" etiqueta="Placa confirmada*" valor={placa} onCambiar={setPlaca} autoFocus
            onEnter={() => { if (valida && !enviando) guardar(); }} />
          {d.tipo_movimiento !== 'salida' && <CampoTexto id="val-obs" className="completo" etiqueta={excepcion ? 'Motivo de la excepción*' : 'Observación (opcional)'}
            valor={observacion} onCambiar={setObservacion} regla={reglaObservacion}
            onEnter={() => { if (valida && !enviando) guardar(); }}
            placeholder={excepcion ? 'Ej.: reunión extraordinaria autorizada por la Coordinación Zonal' : 'Ej.: placa sucia, lectura corregida por el operador'} />}
          {esIngreso && <CamposIngreso id="val" valor={ingreso} onCambiar={setIngreso} onEnter={() => { if (valida && !enviando) guardar(); }} />}
        </div>
        {d.tipo_movimiento === 'salida' ? <Aviso tipo="info">La corrección registra únicamente el egreso; no modifica listas ni decisiones de autorización de ingreso.</Aviso> : <Aviso tipo="info">{excepcion
          ? 'La excepción concede solo este paso: el permiso conserva su horario y vigencia. Queda registrada en la auditoría con su usuario y el motivo.'
          : 'Al confirmar, la placa se vuelve a cruzar con la lista blanca (vigencia y horario) y la lista negra. La corrección queda registrada con su usuario.'}</Aviso>}
        {error && <Aviso tipo="error">{error}</Aviso>}
      </div>
      {zoom && <VisorZoom d={d} onCerrar={() => setZoom(false)} />}
    </Modal>
  );
};

/** Registro manual de un paso (cámara sin lectura, visita, etc.). */
export const RegistroManualModal: React.FC<{ onCerrar: () => void; placaInicial?: string }> = ({ onCerrar, placaInicial = '' }) => {
  const notificar = useNotificar();
  const [placa, setPlaca] = useState(() => placaPropuesta(placaInicial));
  const [motivo, setMotivo] = useState('');
  const [camara, setCamara] = useState('');
  const [camaras, setCamaras] = useState<Camara[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const camaraSeleccionada = camaras.find(c => c.id === Number(camara));
  const esIngreso = camaraSeleccionada?.direccion !== 'salida';
  const [ingreso, setIngreso] = useState<DatosIngreso>({ persona: '', motivo: '' });
  useEffect(() => { api.get('/camaras').then(r => setCamaras(r.data)).catch(() => undefined); }, []);
  const valido = validarPlaca(placa).ok && validarTexto(motivo, REGLA_MOTIVO_MANUAL).ok && (!esIngreso || datosIngresoValidos(ingreso));

  const guardar = async () => {
    setEnviando(true);
    setError(null);
    try {
      const r = await api.post('/detecciones/registro-manual', {
        placa, motivo: motivo.trim(), camara_id: camara ? Number(camara) : undefined, ...(esIngreso ? cuerpoIngreso(ingreso) : {}),
      });
      const d: Deteccion = r.data.deteccion;
      notificar(d.estado_validacion === 'alerta' ? 'error' : 'exito', `${d.tipo_movimiento === 'salida' ? 'Salida' : 'Ingreso'} manual registrada: ${formatearPlaca(d.placa)}`, ESTADOS[d.estado_validacion].etiqueta);
      onCerrar();
      if (d.estado_validacion === 'alerta') navigate(`/detecciones/${d.id}`);
    } catch (e) {
      setError(mensajeError(e));
      setEnviando(false);
    }
  };

  return (
    <Modal titulo={`Registrar ${camaraSeleccionada?.direccion === 'salida' ? 'salida' : 'ingreso'} manual`} subtitulo="Para movimientos que la cámara no registró o no pudo leer" onCerrar={onCerrar} bloquear={enviando}
      pie={<>
        <button className="btn btn-secondary" onClick={onCerrar} disabled={enviando}>Cancelar</button>
        <button className="btn btn-navy" onClick={guardar} disabled={!valido || enviando}>{enviando && <Loader2 size={14} className="girar" />} Registrar {camaraSeleccionada?.direccion === 'salida' ? 'salida' : 'ingreso'}</button>
      </>}>
      <div className="form-grid">
        <CampoPlaca id="man-placa" etiqueta="Placa*" valor={placa} onCambiar={setPlaca} autoFocus />
        <div className="campo completo">
          <label htmlFor="man-camara">Cámara asociada</label>
          <select id="man-camara" className="select" value={camara} onChange={e => setCamara(e.target.value)}>
            <option value="">Sin cámara asociada</option>
            {camaras.map(c => <option key={c.id} value={c.id}>{c.nombre} · {c.direccion === 'salida' ? 'Salida' : 'Ingreso'} · {c.ubicacion}</option>)}
          </select>
        </div>
        <CampoTexto id="man-motivo" className="completo" etiqueta="Motivo del registro manual*" valor={motivo} onCambiar={setMotivo}
          regla={REGLA_MOTIVO_MANUAL} multilinea ayuda="Entre 5 y 300 caracteres."
          placeholder="Ej.: cámara fuera de servicio, placa ilegible por suciedad, ingreso de visita" />
        {esIngreso && <CamposIngreso id="man" valor={ingreso} onCambiar={setIngreso} />}
        <div className="completo"><Aviso tipo="info">{camaraSeleccionada?.direccion === 'salida'
          ? 'La salida se registra como movimiento independiente y no modifica permisos ni decisiones de ingreso.'
          : 'El ingreso se cruza con las listas como cualquier lectura. No modifica el padrón de autorizados: para autorizar un vehículo use la pantalla de listas.'}</Aviso></div>
        {error && <div className="completo"><Aviso tipo="error">{error}</Aviso></div>}
      </div>
    </Modal>
  );
};

export { InsigniaEstado };
