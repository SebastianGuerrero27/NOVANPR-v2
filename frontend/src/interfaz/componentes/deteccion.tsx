import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ImageOff, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import api, { mensajeError } from '../../infraestructura/api';
import type { Camara, Deteccion } from '../../dominio/tipos';
import { colorConfianza, diaIso, ESTADOS, fechaHora, hora, porcentaje } from '../../dominio/formato';
import { urlMedia } from '../../infraestructura/api';
import { formatearPlaca, placaPropuesta, validarPlaca, validarTexto, valorPrecargado, validarFecha } from '../../dominio/validacion';
import {
  MOTIVOS_INGRESO_FRECUENTES, REGLA_MOTIVO_EXCEPCION, REGLA_MOTIVO_INGRESO, REGLA_MOTIVO_MANUAL, REGLA_OBSERVACION_VALIDACION,
  REGLA_PERSONA_INGRESO, REGLAS_VEHICULO, REGLAS_LISTA_BLANCA, REGLA_OBSERVACIONES,
} from '../../dominio/reglas';
import { Aviso, InsigniaEstado, InsigniaTipificacion, Modal, Placa } from './ui';
import { CampoPlaca, CampoTexto } from './campos';
import { useNotificar } from './Notificaciones';
import { useAuth } from '../../aplicacion/AuthContext';
import { VisorZoom } from './ZoomDual';
import { CamposFormularioPermiso, type FormularioPermiso } from './CamposFormularioPermiso';
import { horarioValido } from './EditorHorario';
import { leerHorarioFormulario } from '../../dominio/horario';
import type { Franja } from '../../dominio/tipos';
import { MARCAS, TIPOS_VEHICULO } from '../../dominio/catalogoVehiculos';
import { ObservacionOcr } from './ObservacionOcr';

export { TIPOS_VEHICULO } from '../../dominio/catalogoVehiculos';

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
export const PlacaFoto: React.FC<{ d: Pick<Deteccion, 'placa' | 'imagen_placa' | 'imagen_vehiculo' | 'sin_placa' | 'evidencia_lectura'>; alto?: number; grande?: boolean; confianza?: number | null; mostrarObservacion?: boolean; onClick?: () => void }> =
  ({ d, alto = 36, grande, confianza, mostrarObservacion = true, onClick }) => {
    const [error, setError] = useState(false);
    const src = urlMedia(recortePlaca(d));
    useEffect(() => setError(false), [src]);
    const foto = src && !error;
    return (
      <span className={`placa-foto${grande ? ' grande' : ''}`}>
        <span className="placa-foto-imagen" title={foto && onClick ? 'Ampliar evidencia' : foto ? undefined : 'Sin recorte de la placa'}
          role={foto && onClick ? 'button' : undefined} tabIndex={foto && onClick ? 0 : undefined}
          aria-label={foto && onClick ? `Ampliar fotos de ${d.placa ?? 'vehículo sin placa'}` : undefined}
          onClick={foto && onClick ? e => { e.stopPropagation(); onClick(); } : undefined}
          onKeyDown={foto && onClick ? e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onClick(); }
          } : undefined}
          style={{ height: alto, width: grande ? '100%' : alto * 3, cursor: foto && onClick ? 'zoom-in' : undefined }}>
          {foto
            ? <img src={src} alt={`Placa ${d.placa ?? 'sin lectura'}`} loading="lazy" decoding="async" onError={() => setError(true)} />
            : <ImageOff size={grande ? 22 : 14} />}
        </span>
        <Placa valor={d.placa} grande={grande} sinPlaca={d.sin_placa} />
        {mostrarObservacion && <ObservacionOcr evidencia={d.evidencia_lectura} />}
        {confianza !== undefined && <ConfianzaBadge valor={confianza} />}
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
export const TarjetaDeteccion: React.FC<{ d: Deteccion; onValidar?: (d: Deteccion) => void; onRestringir?: (d: Deteccion) => void; onEliminar?: (d: Deteccion) => void; resaltada?: boolean }> = ({ d, onValidar, onRestringir, onEliminar, resaltada }) => {
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
          {!procesando && !autorizado && d.tipo_movimiento !== 'salida' && <div className="fila" style={{ gap: 4, flexWrap: 'wrap' }}>
            {onValidar && <button className="btn btn-sm btn-secondary" onClick={e => { e.stopPropagation(); onValidar(d); }}>Autorizar</button>}
            {onRestringir && !alerta && <button className="btn btn-sm btn-danger" onClick={e => { e.stopPropagation(); onRestringir(d); }}>Restringir</button>}
          </div>}
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
export const CamposIngreso: React.FC<{ id: string; valor: DatosIngreso; onCambiar: (v: DatosIngreso) => void; onEnter?: () => void; mostrarMotivo?: boolean; mostrarPersona?: boolean }> =
  ({ id, valor, onCambiar, onEnter, mostrarMotivo = true, mostrarPersona = true }) => (
    <>
      {mostrarPersona && <CampoTexto id={`${id}-persona`} className="completo" etiqueta="Nombres y apellidos de quien ingresa" valor={valor.persona}
        onCambiar={persona => onCambiar({ ...valor, persona })} regla={REGLA_PERSONA_INGRESO} onEnter={onEnter}
        autoComplete="off" placeholder="Ej.: Ana Pérez" ayuda="Si el vehículo está en la lista blanca, se propone su titular." />}
      {mostrarMotivo && <div className="completo pila" style={{ gap: 6 }}>
        <CampoTexto id={`${id}-motivo`} etiqueta="Motivo de ingreso" valor={valor.motivo} onCambiar={motivo => onCambiar({ ...valor, motivo })}
          regla={REGLA_MOTIVO_INGRESO} onEnter={onEnter} placeholder="Ej.: reunión con la coordinación zonal" />
        <div className="fila" style={{ gap: 6 }} role="group" aria-label="Motivos frecuentes">
          {MOTIVOS_INGRESO_FRECUENTES.map(m => (
            <button key={m} type="button" className="btn btn-sm btn-secondary btn-opcion"
              aria-pressed={valor.motivo === m} onClick={() => onCambiar({ ...valor, motivo: m })}>{m}</button>
          ))}
        </div>
      </div>}
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
  const [permiso, setPermiso] = useState<FormularioPermiso>(() => ({
    propietario: d.datos_permiso?.propietario ?? d.persona_ingreso ?? d.autorizado?.propietario ?? '',
    cedula: d.datos_permiso?.cedula ?? '', institucion: d.datos_permiso?.institucion ?? '', cargo: d.datos_permiso?.cargo ?? '', departamento: d.datos_permiso?.departamento ?? d.autorizado?.departamento ?? '',
    placa: placaPropuesta(d.placa_validada || d.placa_reconocida),
    tipo_vehiculo: d.datos_permiso?.tipo_vehiculo ?? d.tipo_vehiculo ?? d.vehiculo.tipo ?? '',
    marca: valorPrecargado(d.datos_permiso?.marca ?? d.vehiculo.marca, REGLAS_VEHICULO.marca), modelo: valorPrecargado(d.datos_permiso?.modelo ?? d.vehiculo.modelo, REGLAS_VEHICULO.modelo), color: d.datos_permiso?.color ?? d.vehiculo.color ?? '',
    observaciones: d.datos_permiso?.observaciones ?? '', fecha_inicio: diaIso(d.datos_permiso?.fecha_inicio), fecha_fin: diaIso(d.datos_permiso?.fecha_fin),
  }));
  const [horario, setHorario] = useState<Franja[] | null>(() => leerHorarioFormulario(d.datos_permiso?.horario).horario);
  const [errorHorario, setErrorHorario] = useState<string | null>(() => d.datos_permiso?.horario_error || leerHorarioFormulario(d.datos_permiso?.horario).error);
  // Quién ingresa: lo ya registrado o, si el vehículo está en la lista blanca, su titular
  const [ingreso, setIngreso] = useState<DatosIngreso>(() => ({ persona: d.persona_ingreso ?? d.autorizado?.propietario ?? '', motivo: d.motivo_ingreso ?? '' }));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consultaPlaca, setConsultaPlaca] = useState<'consultando' | 'encontrada' | 'no-encontrada' | 'alerta' | null>(null);
  // Quien gestiona el padrón agrega la placa a la lista blanca al confirmarla (lo hace la API)
  const agregaPadron = useAuth().puede('padron:gestionar') && !excepcion;
  const reglaObservacion = excepcion ? REGLA_MOTIVO_EXCEPCION : REGLA_OBSERVACION_VALIDACION;
  const ingresoFinal = excepcion ? { ...ingreso, motivo: observacion } : ingreso;
  const camposPermisoValidos = Object.entries({ ...REGLAS_LISTA_BLANCA, ...REGLAS_VEHICULO, observaciones: REGLA_OBSERVACIONES }).every(([k, regla]) => validarTexto(permiso[k as keyof FormularioPermiso], regla).ok)
    && Object.entries(REGLAS_VEHICULO).every(([k, regla]) => validarTexto(permiso[k as keyof FormularioPermiso], { ...regla, requerido: true }).ok)
    && (!permiso.cedula || /^\d{10}$/.test(permiso.cedula)) && !errorHorario && horarioValido(horario)
    && validarFecha(permiso.fecha_inicio, { etiqueta: 'Inicio' }).ok && validarFecha(permiso.fecha_fin, { etiqueta: 'Fin' }).ok
    && (!permiso.fecha_inicio || !permiso.fecha_fin || permiso.fecha_inicio <= permiso.fecha_fin);
  const placaValida = !placa.trim() || validarPlaca(placa).ok;
  const valida = placaValida && validarTexto(observacion, reglaObservacion).ok && (!esIngreso || (camposPermisoValidos && datosIngresoValidos(ingresoFinal)));

  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    if (!esIngreso || !placa.trim() || !validarPlaca(placa).ok) {
      setConsultaPlaca(null);
      return;
    }
    let cancelado = false;
    const temporizador = window.setTimeout(async () => {
      setConsultaPlaca('consultando');
      try {
        const respuesta = await api.get<{
          placa: string;
          alerta: unknown;
          autorizado: Partial<FormularioPermiso> & {
            fecha_vencimiento?: string | null;
            horario?: Franja[] | null;
            horario_error?: string;
          } | null;
        }>(`/detecciones/buscar-placa/${encodeURIComponent(placa)}`);
        if (cancelado) return;
        if (respuesta.data.alerta || !respuesta.data.autorizado) {
          setConsultaPlaca(respuesta.data.alerta ? 'alerta' : 'no-encontrada');
          return;
        }
        const permisoEncontrado = respuesta.data.autorizado;
        const placaConfirmada = placaPropuesta(respuesta.data.placa);
        setPlaca(placaConfirmada);
        setPermiso(actual => ({
          ...actual,
          propietario: permisoEncontrado.propietario ?? actual.propietario,
          cedula: permisoEncontrado.cedula ?? actual.cedula,
          institucion: permisoEncontrado.institucion ?? actual.institucion,
          cargo: permisoEncontrado.cargo ?? actual.cargo,
          departamento: permisoEncontrado.departamento ?? actual.departamento,
          placa: placaConfirmada,
          tipo_vehiculo: permisoEncontrado.tipo_vehiculo ?? actual.tipo_vehiculo,
          marca: permisoEncontrado.marca ?? actual.marca,
          modelo: permisoEncontrado.modelo ?? actual.modelo,
          color: permisoEncontrado.color ?? actual.color,
          // Las fechas del permiso pueden venir con hora: los campos y la vigencia usan el día (AAAA-MM-DD)
          fecha_inicio: permisoEncontrado.fecha_inicio !== undefined ? diaIso(permisoEncontrado.fecha_inicio) : actual.fecha_inicio,
          fecha_fin: permisoEncontrado.fecha_vencimiento !== undefined || permisoEncontrado.fecha_fin !== undefined
            ? diaIso(permisoEncontrado.fecha_vencimiento ?? permisoEncontrado.fecha_fin) : actual.fecha_fin,
          observaciones: permisoEncontrado.observaciones ?? actual.observaciones,
        }));
        // El motivo habitual del permiso se propone si el guardia aún no escribió otro
        if (permisoEncontrado.motivo_ingreso) setIngreso(x => (x.motivo.trim() ? x : { ...x, motivo: permisoEncontrado.motivo_ingreso! }));
        if (permisoEncontrado.horario !== undefined) {
          const interpretado = leerHorarioFormulario(permisoEncontrado.horario);
          setHorario(interpretado.horario);
          setErrorHorario(permisoEncontrado.horario_error || interpretado.error);
        }
        setConsultaPlaca('encontrada');
      } catch {
        if (!cancelado) setConsultaPlaca('no-encontrada');
      }
    }, 350);
    return () => {
      cancelado = true;
      window.clearTimeout(temporizador);
    };
  }, [esIngreso, placa]);

  const guardar = async () => {
    setEnviando(true);
    setError(null);
    try {
      const r = await api.post(`/detecciones/validar/${d.id}`, {
        placa_validada: placa.trim() || null, observacion: observacion.trim() || undefined, excepcion: excepcion || undefined,
        ...(esIngreso ? { ...cuerpoIngreso({ ...ingresoFinal, persona: permiso.propietario }), tipo_vehiculo: permiso.tipo_vehiculo, marca: permiso.marca, modelo: permiso.modelo, color: permiso.color,
          datos_permiso: { ...permiso, placa: placa.trim() || null, observaciones: observacion.trim() || permiso.observaciones, fecha_vencimiento: permiso.fecha_fin || null, horario,
            motivo_ingreso: ingresoFinal.motivo.trim() || null } } : {}),
      });
      const det: Deteccion = r.data.deteccion;
      const padron = r.data.lista_blanca === 'creado' ? ' · agregada a la lista blanca' : r.data.lista_blanca === 'reactivado' ? ' · permiso reactivado en la lista blanca' : '';
      notificar(det.estado_validacion === 'alerta' ? 'error' : 'exito', `${det.tipo_movimiento === 'salida' ? 'Salida corregida' : det.estado_validacion === 'autorizado' ? 'Ingreso autorizado' : 'Ingreso revisado'}: ${formatearPlaca(det.placa)}`, ESTADOS[det.estado_validacion].etiqueta + padron);
      if (r.data.aviso) notificar('advertencia', 'No se agregó a la lista blanca', r.data.aviso);
      onValidada?.(det);
      onCerrar();
    } catch (e) {
      setError(mensajeError(e));
      setEnviando(false);
    }
  };

  return (
    <Modal titulo={d.tipo_movimiento === 'salida' ? 'Corregir lectura de salida' : excepcion ? 'Autorizar ingreso por excepción' : 'Autorizar ingreso'} subtitulo={`${fechaHora(d.fecha_hora_ingreso)}${d.camara ? ` · ${d.camara.nombre}` : ''}`} onCerrar={onCerrar} bloquear={enviando} tamano={esIngreso ? 'panoramico' : 'ancho'}
      pie={<>
        <button className="btn btn-secondary" onClick={onCerrar} disabled={enviando}>Cancelar</button>
        <button className={`btn ${excepcion ? 'btn-exito' : 'btn-navy'}`} onClick={guardar} disabled={!valida || enviando}>{enviando && <Loader2 size={14} className="girar" />} {excepcion ? 'Autorizar por excepción' : d.tipo_movimiento === 'salida' ? 'Registrar salida' : 'Confirmar placa'}</button>
      </>}>
      <div className="pila">
        {!esIngreso && <div className="grid-2" style={{ gap: 12 }}>
          <div><span className="etiqueta-campo">Placa (recorte)</span><div style={{ marginTop: 6 }}>
            <ImagenEvidencia ruta={d.imagen_placa} alt="Recorte de placa" alto={160} ajuste="contain" fondoOscuro onClick={() => setZoom(true)} /></div></div>
          <div><span className="etiqueta-campo">Vehículo</span><div style={{ marginTop: 6 }}>
            <ImagenEvidencia ruta={d.imagen_vehiculo} alt="Vehículo" alto={160} ajuste="contain" fondoOscuro onClick={() => setZoom(true)} />
            <button type="button" className="btn btn-ghost btn-sm" disabled={!d.imagen_vehiculo} onClick={() => setZoom(true)}>Ampliar foto del vehículo</button></div></div>
        </div>
        }
        {d.motivo_revision && <Aviso tipo="advertencia">{d.motivo_revision}</Aviso>}
        <div className="texto-secundario">
          Lectura automática: <b style={{ color: 'var(--text)' }}>{d.placa_reconocida ? formatearPlaca(d.placa_reconocida) : 'sin lectura'}</b>
          {d.confianza_ocr !== null && <> · confianza <b style={{ color: colorConfianza(d.confianza_ocr) }}>{porcentaje(d.confianza_ocr)}</b></>}
        </div>
        <div className="form-grid">
          {esIngreso ? <CamposFormularioPermiso prefijo="val" valor={{ ...permiso, placa }} onCambiar={c => { if (c.placa !== undefined) setPlaca(c.placa); setPermiso(x => ({ ...x, ...c })); }} horario={horario} onHorario={h => { setHorario(h); setErrorHorario(null); }} errorHorario={errorHorario} deteccion={d} vehiculoObligatorio incluirFotoPlaca distribucion="panoramica" mostrarMotivo={false} /> : <CampoPlaca id="val-placa" etiqueta="Placa confirmada (opcional)" valor={placa} onCambiar={setPlaca} ayuda="Puede dejarla vacía cuando no sea legible." />}
          {esIngreso && consultaPlaca === 'consultando' && <small className="texto-secundario">Consultando la placa corregida en la lista blanca…</small>}
          {esIngreso && consultaPlaca === 'encontrada' && <Aviso tipo="info">Placa confirmada en la lista blanca. Se cargaron los datos del titular y del vehículo.</Aviso>}
          {esIngreso && consultaPlaca === 'no-encontrada' && (agregaPadron
            ? <Aviso tipo="info">Esta placa no tiene permiso. Al confirmarla con los datos completos <b>se agrega a la lista blanca</b> con la vigencia y el horario indicados.</Aviso>
            : <small className="texto-secundario">No existe un permiso vigente para esta placa. Revise la placa y los datos antes de autorizar.</small>)}
          {esIngreso && consultaPlaca === 'alerta' && <Aviso tipo="error">La placa está en la lista negra: no se agregará a la lista blanca.</Aviso>}
          {excepcion && <CampoTexto id="val-validacion" className="completo" etiqueta="Motivo de la excepción*"
            valor={observacion} onCambiar={setObservacion} regla={reglaObservacion}
            onEnter={() => { if (valida && !enviando) guardar(); }}
            placeholder={excepcion ? 'Ej.: reunión extraordinaria autorizada por la Coordinación Zonal' : 'Ej.: placa sucia, lectura corregida por el operador'} />}
          {esIngreso && <CamposIngreso id="val" valor={ingreso} onCambiar={setIngreso} mostrarPersona={false} mostrarMotivo={!excepcion} onEnter={() => { if (valida && !enviando) guardar(); }} />}
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

interface CuadroCamara { t: number; miniatura: string }

/**
 * Fotos de los últimos 30 s de la cámara (dos por segundo) para la evidencia del registro manual: el
 * vehículo que el motor no registró (muy rápido, sin placa legible) ya pasó cuando se registra a
 * mano. El guardia toca la foto en que se ve; tocarla otra vez la quita. Es opcional.
 */
export const FotosRecientes: React.FC<{ camaraId: number; elegida: number | null; onElegir: (t: number | null) => void }> = ({ camaraId, elegida, onElegir }) => {
  const [estado, setEstado] = useState<{ cargando: boolean; cuadros: CuadroCamara[]; aviso: string | null; ahora: number }>(
    { cargando: true, cuadros: [], aviso: null, ahora: Date.now() / 1000 });
  const cargar = useCallback(async () => {
    setEstado(e => ({ ...e, cargando: true }));
    try {
      const { data } = await api.get('/detecciones/registro-manual/cuadros', { params: { camara_id: camaraId } });
      setEstado({ cargando: false, cuadros: data.disponible ? data.cuadros : [], aviso: data.disponible ? null : data.motivo ?? 'Sin fotos de esta cámara.', ahora: Date.now() / 1000 });
    } catch (e) {
      setEstado(x => ({ ...x, cargando: false, cuadros: [], aviso: mensajeError(e, 'No se pudieron obtener las fotos de la cámara.') }));
    }
  }, [camaraId]);
  useEffect(() => { onElegir(null); void cargar(); }, [cargar, onElegir]);

  return (
    <div className="campo completo">
      <div className="fila" style={{ justifyContent: 'space-between', gap: 8 }}>
        <span className="etiqueta-campo">Foto de evidencia · últimos 30 s</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void cargar()} disabled={estado.cargando}>
          {estado.cargando ? <Loader2 size={13} className="girar" /> : <RefreshCw size={13} />} Actualizar
        </button>
      </div>
      {estado.aviso
        ? <span className="texto-secundario">{estado.aviso}</span>
        : estado.cuadros.length === 0 && !estado.cargando
          ? <span className="texto-secundario">La cámara todavía no tiene fotos guardadas.</span>
          : (
            <div className="tira-fotos" aria-label="Fotos de los últimos 30 segundos">
              {estado.cuadros.map(c => {
                // Medio segundo de resolución: hay dos fotos por segundo y con segundos enteros se repetían
                const hace = (Math.max(0, Math.round((estado.ahora - c.t) * 2)) / 2).toLocaleString('es-EC');
                const activa = elegida === c.t;
                return (
                  <button key={c.t} type="button" className={`tira-foto${activa ? ' elegida' : ''}`} aria-pressed={activa}
                    onClick={() => onElegir(activa ? null : c.t)}>
                    <img src={`data:image/jpeg;base64,${c.miniatura}`} alt={`Cuadro de hace ${hace} s`} />
                    <span>hace {hace} s</span>
                  </button>
                );
              })}
            </div>
          )}
      <span className="ayuda">Opcional. Toque la foto en que se ve el vehículo: queda como evidencia del registro.</span>
    </div>
  );
};

/** Registro manual de un paso (cámara sin lectura, visita, etc.). */
export const RegistroManualModal: React.FC<{ onCerrar: () => void; placaInicial?: string }> = ({ onCerrar, placaInicial = '' }) => {
  const notificar = useNotificar();
  const [placa, setPlaca] = useState(() => placaPropuesta(placaInicial));
  const [motivo, setMotivo] = useState('');
  const [tipoVehiculo, setTipoVehiculo] = useState('');
  const [marca, setMarca] = useState('');
  const [camara, setCamara] = useState('');
  const [camaras, setCamaras] = useState<Camara[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const camaraSeleccionada = camaras.find(c => c.id === Number(camara));
  const esIngreso = camaraSeleccionada?.direccion !== 'salida';
  const [ingreso, setIngreso] = useState<DatosIngreso>({ persona: '', motivo: '' });
  const [foto, setFoto] = useState<number | null>(null);
  useEffect(() => { api.get('/camaras').then(r => setCamaras(r.data)).catch(() => undefined); }, []);
  const valido = validarPlaca(placa).ok && validarTexto(motivo, REGLA_MOTIVO_MANUAL).ok
    && validarTexto(tipoVehiculo, REGLAS_VEHICULO.tipo_vehiculo).ok && validarTexto(marca, REGLAS_VEHICULO.marca).ok
    && (!esIngreso || datosIngresoValidos(ingreso));

  const guardar = async () => {
    setEnviando(true);
    setError(null);
    try {
      const r = await api.post('/detecciones/registro-manual', {
        placa, motivo: motivo.trim(), camara_id: camara ? Number(camara) : undefined, ...(esIngreso ? cuerpoIngreso(ingreso) : {}),
        ...(esIngreso ? { tipo_vehiculo: tipoVehiculo, marca } : {}),
        ...(camara && foto !== null ? { cuadro_t: foto } : {}),
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
        {camara && <FotosRecientes camaraId={Number(camara)} elegida={foto} onElegir={setFoto} />}
        {esIngreso && <>
          <CampoTexto id="man-tipo" etiqueta="Tipo de vehículo" valor={tipoVehiculo} onCambiar={setTipoVehiculo}
            regla={REGLAS_VEHICULO.tipo_vehiculo} opciones={TIPOS_VEHICULO} placeholder="Seleccione o escriba otro tipo" />
          <CampoTexto id="man-marca" etiqueta="Marca del vehículo" valor={marca} onCambiar={setMarca}
            regla={REGLAS_VEHICULO.marca} opciones={MARCAS} placeholder="Seleccione o escriba otra marca" />
        </>}
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
