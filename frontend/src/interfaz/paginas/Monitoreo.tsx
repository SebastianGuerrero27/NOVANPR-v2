import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff, Camera, ClipboardPlus, Cpu, Film, Gauge, Pause, Play, Plus, Search, ShieldAlert, ShieldCheck, Trash2, X, ZoomIn } from 'lucide-react';
import api, { mensajeError } from '../../infraestructura/api';
import { useAuth } from '../../aplicacion/AuthContext';
import { useEvento, useReconexion } from '../../aplicacion/tiempoReal';
import { useConsulta, usePaginaVisible } from '../../aplicacion/hooks';
import type { Camara, Deteccion, EstadoAnpr } from '../../dominio/tipos';
import { codecVideo, ESTADOS, fecha, fechaHora, hora, numero, relativo } from '../../dominio/formato';
import { formatearPlaca, normalizarPlaca } from '../../dominio/validacion';
import { Aviso, Cargando, InsigniaEstado, InsigniaTipificacion, Placa, Segmentado, Tarjeta, Vacio } from '../componentes/ui';
import { filtrarEscrito } from '../componentes/campos';
import { ConfianzaBadge, describirVehiculo, ImagenEvidencia, PlacaFoto, RegistroManualModal, TarjetaDeteccion, ValidarModal } from '../componentes/deteccion';
import { VisorZoom } from '../componentes/ZoomDual';
import { EliminarUno, EliminarVarios } from '../componentes/EliminarDetecciones';
import { alCambiarSonido, fijarSonido, sonarAutorizado, sonarDenegado, sonidoActivo } from '../../infraestructura/avisos';
import { PERFILES, PerfilVideo, VisorVideo } from '../componentes/video';
import { VisorEnVivo } from '../componentes/envivo';
import { useNotificar } from '../componentes/Notificaciones';
import { VistaCuadricula } from '../componentes/VistaCuadricula';

const MAX_FEED = 30;
const CLAVE_PERFIL = 'anpr_perfil_video';
const CLAVE_MODO = 'anpr_modo_video';
const CLAVE_VISTA = 'anpr_vista_monitoreo';

const leer = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
/** Milisegundos → segundos con un decimal (latencia del motor) */
const segundos = (ms: number) => (ms / 1000).toLocaleString('es-EC', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Respuesta de /detecciones/buscar-placa/:placa. */
type ResultadoBusqueda = { placa: string; ultimos_ingresos: Deteccion[] } & (
  | { estado: 'alerta'; alerta: { motivo: string; nivel_alerta: string; coincidencia?: string; placa: string } }
  | { estado: 'autorizado'; autorizado: { propietario: string; departamento?: string | null } }
  | { estado: 'restringido'; motivo: string | null }
  | { estado: 'no_registrado' }
);

/** Situación de la placa consultada en las listas de control. */
const ResultadoConsulta: React.FC<{ r: ResultadoBusqueda }> = ({ r }) => {
  const placa = formatearPlaca(r.placa);
  if (r.estado === 'alerta') {
    return <Aviso tipo="error"><b>{placa} está en la lista negra</b> · {r.alerta.motivo} (nivel {r.alerta.nivel_alerta}{r.alerta.coincidencia === 'aproximada' ? `, coincidencia aproximada con ${formatearPlaca(r.alerta.placa)}` : ''})</Aviso>;
  }
  if (r.estado === 'autorizado') {
    return <Aviso tipo="exito"><b>{placa} está autorizada</b> · {r.autorizado.propietario}{r.autorizado.departamento ? ` · ${r.autorizado.departamento}` : ''}</Aviso>;
  }
  if (r.estado === 'restringido') {
    return <Aviso tipo="advertencia"><b>{placa}</b> tiene un permiso que ahora no la habilita{r.motivo ? `: ${r.motivo.toLowerCase()}` : ''}.</Aviso>;
  }
  return <Aviso tipo="advertencia"><b>{placa}</b> no consta en la lista blanca ni en la lista negra.</Aviso>;
};

const Monitoreo: React.FC = () => {
  const { user, puede } = useAuth();
  const navigate = useNavigate();
  const notificar = useNotificar();
  const visible = usePaginaVisible();
  const [perfil, setPerfil] = useState<PerfilVideo>(() => (leer(CLAVE_PERFIL, 'media') as PerfilVideo) in PERFILES ? leer(CLAVE_PERFIL, 'media') as PerfilVideo : 'media');
  const [pausado, setPausado] = useState(false);
  // WebRTC (MediaMTX, sin re-codificar, ~0,2–0,5 s) o compatibilidad (JPEG por WebSocket desde el motor)
  const [modo, setModo] = useState<'webrtc' | 'compat'>(() => (leer(CLAVE_MODO, 'webrtc') === 'compat' ? 'compat' : 'webrtc'));
  const cambiarModo = (m: 'webrtc' | 'compat') => { setModo(m); guardar(CLAVE_MODO, m); };
  const [vista, setVista] = useState<'anpr' | 'cuadricula'>(() => leer(CLAVE_VISTA, 'cuadricula') === 'anpr' ? 'anpr' : 'cuadricula');
  const cambiarVista = (v: 'anpr' | 'cuadricula') => { setVista(v); guardar(CLAVE_VISTA, v); };
  const [sonido, setSonido] = useState(sonidoActivo);
  useEffect(() => alCambiarSonido(setSonido), []);
  const [feed, setFeed] = useState<Deteccion[]>([]);
  const [cargandoFeed, setCargandoFeed] = useState(true);
  const [resaltada, setResaltada] = useState<number | null>(null);
  const [validando, setValidando] = useState<Deteccion | null>(null);
  const [manual, setManual] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  const [reinicioVideo, setReinicioVideo] = useState(0);
  const [eliminando, setEliminando] = useState<Deteccion | null>(null);
  const [eliminarTodos, setEliminarTodos] = useState(false);
  const esAdmin = puede('camaras:gestionar');
  const puedeCambiarCamara = puede('camaras:operar');

  const { datos: camaras, recargar: recargarCamaras } = useConsulta<Camara[]>(() => api.get('/camaras').then(r => r.data), []);
  const estadoMotor = useConsulta<EstadoAnpr>(() => api.get('/monitoreo/estado').then(r => r.data), []);

  // Estado del motor: se refresca cada 30 s solo mientras la pestaña está visible
  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(() => estadoMotor.recargar(true), 30000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const cargarFeed = useCallback(() => {
    api.get('/detecciones/recientes', { params: { limite: MAX_FEED } })
      .then(r => setFeed(r.data)).catch(() => undefined).finally(() => setCargandoFeed(false));
  }, []);
  // Carga inicial y resincronización al volver a la pestaña (por eventos perdidos mientras estaba oculta)
  useEffect(() => { if (visible) cargarFeed(); }, [visible, cargarFeed]);

  const insertar = (d: Deteccion) => {
    setFeed(f => [d, ...f.filter(x => x.id !== d.id)].slice(0, MAX_FEED));
    setResaltada(d.id);
    window.setTimeout(() => setResaltada(r => (r === d.id ? null : r)), 3000);
  };

  useEvento<Deteccion>('deteccion:nueva', insertar);
  useEvento<Deteccion>('deteccion:actualizada', d => {
    setFeed(f => (f.some(x => x.id === d.id) ? f.map(x => (x.id === d.id ? d : x)) : [d, ...f].slice(0, MAX_FEED)));
    setResaltada(d.id);
    window.setTimeout(() => setResaltada(r => (r === d.id ? null : r)), 3000);
  });
  useEvento<{ id: number }>('deteccion:eliminada', ({ id }) => setFeed(f => f.filter(x => x.id !== id)));
  useEvento('deteccion:eliminadas', () => cargarFeed());
  useReconexion(() => { cargarFeed(); estadoMotor.recargar(true); recargarCamaras(true); });
  useEvento<{ camara_id: number; nombre: string; por: string }>('monitoreo:camara', e => {
    estadoMotor.recargar(true);
    setReinicioVideo(x => x + 1);
    if (e.por !== user?.nombre) notificar('info', `El motor ANPR ahora procesa ${e.nombre}`, `Cambio realizado por ${e.por}`);
  });

  const cambiarCamara = async (id: number) => {
    setCambiando(true);
    try {
      const r = await api.post('/monitoreo/camara-activa', { camara_id: id });
      notificar('exito', r.data.message);
    } catch (e) {
      notificar('error', 'No se pudo cambiar la cámara', mensajeError(e));
    } finally {
      setCambiando(false);
      estadoMotor.recargar(true);
    }
  };

  const motor = estadoMotor.datos;
  const camaraActiva = camaras?.find(c => c.id === motor?.camara_activa?.id);
  const hayCamaras = Boolean(camaras?.some(c => c.activa));
  const pendientes = feed.filter(d => d.estado_validacion === 'pendiente_revision' && !d.validado_manualmente && d.estado_procesamiento !== 'pendiente_ocr');
  const ultima = feed.find(d => d.estado_procesamiento !== 'pendiente_ocr') ?? null;
  // La consulta de placa vive en la tarjeta de movimientos recientes (antes era un modal)
  const consultaPlaca = useRef<HTMLInputElement>(null);
  const irAConsulta = () => {
    consultaPlaca.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    consultaPlaca.current?.focus({ preventScroll: true });
  };

  return (
    <div className="pagina ancha">
      <div className="pila">
        <div className="grid-principal" style={{ gridTemplateColumns: 'minmax(0, 1.9fr) minmax(320px, 1fr)' }}>
          {/* ── Video y controles ── */}
          <div className="pila">
            {motor?.en_linea && motor.camara_activa && !motor.camara_activa.conectada && (
              <Aviso tipo="advertencia">
                <b>El motor está asignado a {camaraActiva?.nombre ?? 'la cámara'}, pero no recibe video.</b> Revise que la cámara tenga energía y
                red, y compruebe su enlace con <b>Ping</b> en Operación › Registro de cámaras. El motor se reconecta solo cuando la señal vuelve.
              </Aviso>
            )}
            {motor?.en_linea && motor.fuente_externa && hayCamaras && (
              <Aviso tipo="advertencia">
                El motor ANPR todavía no procesa ninguna cámara registrada. {puedeCambiarCamara ? 'Seleccione la cámara en la lista para asignarla.' : 'Se asignará automáticamente en unos segundos.'}
              </Aviso>
            )}
            <Tarjeta sinPadding>
              <div className="fila" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', gap: 10 }}>
                <div className="fila" style={{ gap: 8, minWidth: 0 }}>
                  <Camera size={16} color="var(--text-3)" />
                  {puedeCambiarCamara && hayCamaras ? (
                    <select className="select" style={{ height: 32, width: 'auto', maxWidth: 280 }} value={motor?.camara_activa?.id ?? ''} disabled={cambiando || !motor?.en_linea}
                      onChange={e => e.target.value && cambiarCamara(Number(e.target.value))} aria-label="Cámara que procesa el motor ANPR">
                      <option value="" disabled>Seleccione la cámara…</option>
                      {(camaras ?? []).filter(c => c.activa).map(c => <option key={c.id} value={c.id}>{c.nombre} · {c.ubicacion}</option>)}
                    </select>
                  ) : (
                    <strong className="truncar" style={{ fontSize: 13.5 }}>
                      {camaraActiva ? `${camaraActiva.nombre} · ${camaraActiva.ubicacion}` : hayCamaras ? 'Cámara sin asignar' : 'Sin cámaras habilitadas'}
                    </strong>
                  )}
                </div>
                <div className="fila" style={{ marginLeft: 'auto', gap: 8 }}>
                  {hayCamaras && (
                    <>
                      <Segmentado valor={vista} onCambiar={cambiarVista} opciones={[
                        { valor: 'anpr', etiqueta: 'Vista ANPR' },
                        { valor: 'cuadricula', etiqueta: 'Vista cuadrícula' },
                      ]} />
                      {vista === 'anpr' && <Segmentado valor={modo} onCambiar={cambiarModo} opciones={[
                        { valor: 'webrtc', etiqueta: 'Tiempo real' },
                        { valor: 'compat', etiqueta: 'Compatibilidad' },
                      ]} />}
                      {vista === 'anpr' && modo === 'compat' && (
                        <select className="select" style={{ height: 32, width: 'auto' }} value={perfil} aria-label="Calidad de video"
                          onChange={e => { const p = e.target.value as PerfilVideo; setPerfil(p); guardar(CLAVE_PERFIL, p); }}>
                          {(Object.keys(PERFILES) as PerfilVideo[]).map(p => <option key={p} value={p}>{PERFILES[p].etiqueta}</option>)}
                        </select>
                      )}
                      {vista === 'anpr' && <button className="btn btn-secondary btn-sm" onClick={() => setPausado(p => !p)}>
                        {pausado ? <><Play size={14} /> Reanudar</> : <><Pause size={14} /> Pausar video</>}
                      </button>}
                    </>
                  )}
                </div>
              </div>
              <div style={{ padding: 12 }}>
                {camaras && !hayCamaras ? (
                  <Vacio titulo="Sin cámaras habilitadas" icono={<Camera size={22} />}
                    texto={puede('camaras:gestionar')
                      ? 'Registre una cámara IP con su enlace RTSP para que el motor ANPR la procese y aparezca aquí con sus detecciones.'
                      : 'El administrador registra las cámaras en Operación › Registro de cámaras.'}
                    accion={puede('camaras:gestionar')
                      ? <button className="btn btn-navy btn-sm" onClick={() => navigate('/camaras')}><Plus size={14} /> Registrar cámara</button>
                      : undefined} />
                ) : vista === 'cuadricula'
                  ? <VistaCuadricula camaras={camaras ?? []} motorId={motor?.camara_activa?.id ?? null} />
                  : modo === 'compat' ? <VisorVideo perfil={perfil} pausado={pausado} claveReinicio={reinicioVideo} />
                    : !motor && estadoMotor.cargando ? <div style={{ aspectRatio: '16 / 9', background: '#050b16', borderRadius: 10 }} />
                      : <VisorEnVivo camaraId={motor?.camara_activa?.id ?? null} vista={Boolean(camaraActiva?.rtsp_url_vista)} pausado={pausado} claveReinicio={reinicioVideo}
                          onFallo={m => { cambiarModo('compat'); notificar('advertencia', 'Se activó el modo de compatibilidad', `WebRTC no disponible: ${m}`); }} />}
              </div>
              <div className="fila" style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', gap: 16, fontSize: 12.5, color: 'var(--text-3)' }}>
                <span className="fila" style={{ gap: 6 }}>
                  <span className={`punto ${motor?.en_linea ? 'verde' : estadoMotor.cargando ? 'gris' : 'rojo'}`} />
                  Motor ANPR {motor?.en_linea ? 'en línea' : estadoMotor.cargando ? '…' : `fuera de línea${motor?.error ? ` (${motor.error})` : ''}`}
                </span>
                {motor?.en_linea && <>
                  <span className="fila" style={{ gap: 6 }}><Cpu size={13} /> Captura {numero(motor.fps_captura ?? 0)} fps · análisis {numero(motor.fps_procesamiento ?? 0)} fps</span>
                  {motor.camara_activa && <span className="fila" style={{ gap: 6 }}><span className={`punto ${motor.camara_activa.conectada ? 'verde' : 'ambar'}`} /> Señal {motor.camara_activa.conectada ? 'recibida' : 'sin recibir'}</span>}
                  {motor.enlace && (
                    <span className="fila ocultar-movil" style={{ gap: 6 }}
                      title="Flujo principal que analiza el motor: códec, resolución, cuadros recibidos por segundo y reconexiones automáticas con la cámara">
                      <Film size={13} /> {codecVideo(motor.enlace.codec)}{motor.enlace.ancho ? ` ${motor.enlace.ancho}×${motor.enlace.alto}` : ''}
                      {' · '}{numero(motor.enlace.fps_recibidos ?? 0)} fps recibidos{motor.enlace.reconexiones ? ` · ${motor.enlace.reconexiones} reconexiones` : ''}
                    </span>
                  )}
                  {motor.latencia?.lectura_en_vivo && (
                    <span className="fila" style={{ gap: 6 }}
                      title={`Desde que la cámara captura el cuadro hasta que la lectura aparece (mediana y percentil 95 de las últimas ${motor.latencia.lectura_en_vivo.muestras}).`
                        + (motor.latencia.edad_cuadro ? ` Edad del cuadro al analizarlo: ${motor.latencia.edad_cuadro.p50_ms} ms.` : '')
                        + (motor.latencia.registro ? ` Registro confirmado: ${segundos(motor.latencia.registro.p50_ms)} s.` : '')
                        + (motor.latencia.cuadros_descartados_pct !== null ? ` Cuadros descartados por llegar uno más nuevo: ${motor.latencia.cuadros_descartados_pct} %.` : '')}>
                      <Gauge size={13} /> Lectura {segundos(motor.latencia.lectura_en_vivo.p50_ms)} s (p95 {segundos(motor.latencia.lectura_en_vivo.p95_ms)} s)
                    </span>
                  )}
                  <span className="ocultar-movil truncar" title={`${motor.detector} · ${motor.ocr}`}>Detector {motor.detector} · OCR {motor.ocr}</span>
                </>}
              </div>
            </Tarjeta>

          </div>

          {/* ── Feed en tiempo real: la altura de la columna del video, con desplazamiento propio ── */}
          <div className="columna-feed">
            <div className="pila columna-feed-contenido">
              {pendientes.length > 0 && (
                <Aviso tipo="info">
                  <b>{pendientes.length} {pendientes.length === 1 ? 'paso requiere' : 'pasos requieren'} validación</b> en el feed. Use “Validar” en cada tarjeta.
                </Aviso>
              )}
              <Tarjeta titulo="Detecciones en tiempo real" subtitulo="Actualización instantánea, sin recargar" sinPadding className="tarjeta-feed"
                acciones={esAdmin && feed.length > 0 ? <button className="btn btn-danger btn-sm" onClick={() => setEliminarTodos(true)}><Trash2 size={14} /> Eliminar todos</button> : undefined}>
                <div className="pila" style={{ gap: 8, padding: 12 }}>
                  {cargandoFeed ? <Cargando /> : feed.length === 0
                    ? <Vacio titulo="Sin detecciones" texto="Cuando el motor registre un vehículo aparecerá aquí de inmediato." />
                    : feed.map(d => <TarjetaDeteccion key={d.id} d={d} onValidar={setValidando} onEliminar={esAdmin ? setEliminando : undefined} resaltada={resaltada === d.id} />)}
                </div>
              </Tarjeta>
            </div>
          </div>
        </div>

        {/* A todo el ancho, debajo del video y del feed: antes iban en la columna del video y bajo el feed
            quedaba un hueco; la tabla, además, no cabía */}
        {/* Último paso: tamaño destacado para la garita */}
        <Tarjeta titulo="Último movimiento registrado" acciones={
          <div className="fila">
            <button className="btn btn-secondary btn-sm" onClick={irAConsulta}><Search size={14} /> Consultar placa</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setManual(true)}><ClipboardPlus size={14} /> Movimiento manual</button>
            <button className={`btn btn-sm ${sonido ? 'btn-secondary' : 'btn-ghost'}`} title={sonido ? 'Silenciar alertas' : 'Activar sonido de alertas'}
              onClick={() => fijarSonido(!sonido)}>
              {sonido ? <Bell size={14} /> : <BellOff size={14} />} {sonido ? 'Sonido activo' : 'Silenciado'}
            </button>
            <button className="btn btn-ghost btn-sm" title="Probar el sonido de vehículo autorizado" disabled={!sonido} onClick={sonarAutorizado}>
              <ShieldCheck size={14} color="var(--autorizado)" /> Probar autorizado</button>
            <button className="btn btn-ghost btn-sm" title="Probar el sonido de acceso no autorizado" disabled={!sonido} onClick={sonarDenegado}>
              <ShieldAlert size={14} color="var(--alerta)" /> Probar alerta</button>
          </div>}>
          {!ultima ? <Vacio titulo="Aún no hay pasos registrados" texto="Las detecciones aparecerán aquí en cuanto el motor ANPR registre un vehículo." /> : (
            <div className="fila" style={{ alignItems: 'stretch', gap: 16, flexWrap: 'wrap' }}>
              <div className="pila" style={{ gap: 10, minWidth: 220 }}>
                <Placa valor={ultima.placa} grande sinPlaca={ultima.sin_placa} />
                <InsigniaTipificacion placa={ultima.placa} provincia />
                <InsigniaEstado estado={ultima.estado_validacion} />
                <span className="texto-secundario">{ultima.tipo_movimiento === 'salida' ? 'Salida' : 'Ingreso'} · {fechaHora(ultima.fecha_hora_ingreso)} · {relativo(ultima.fecha_hora_ingreso)}</span>
                <span style={{ fontSize: 13 }}>
                  {ultima.alerta ? <b style={{ color: 'var(--alerta)' }}>{ultima.alerta.motivo}</b>
                    : ultima.autorizado ? <>{ultima.autorizado.propietario}{ultima.autorizado.departamento ? ` · ${ultima.autorizado.departamento}` : ''}</>
                      : ESTADOS[ultima.estado_validacion].etiqueta}
                </span>
                {ultima.estado_validacion === 'pendiente_revision' && !ultima.validado_manualmente && (
                  <button className="btn btn-navy btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setValidando(ultima)}>Validar ahora</button>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 240 }} className="grid-2">
                <TarjetaImagen d={ultima} ruta={ultima.imagen_placa} titulo="Placa" contain />
                <TarjetaImagen d={ultima} ruta={ultima.imagen_vehiculo} titulo="Vehículo" />
              </div>
            </div>
          )}
        </Tarjeta>

        <TablaIngresosRecientes items={feed.filter(d => d.estado_procesamiento !== 'pendiente_ocr')} refConsulta={consultaPlaca}
          onValidar={setValidando} onEliminar={esAdmin ? setEliminando : undefined} />
      </div>

      {validando && <ValidarModal d={validando} onCerrar={() => setValidando(null)} />}
      {manual && <RegistroManualModal onCerrar={() => setManual(false)} />}
      {eliminando && <EliminarUno d={eliminando} onCerrar={() => setEliminando(null)} onEliminada={id => setFeed(f => f.filter(x => x.id !== id))} />}
      {eliminarTodos && <TotalRegistros>{total => (
        <EliminarVarios total={total} descripcion="Todos los registros de ingreso del sistema" onCerrar={() => setEliminarTodos(false)} onHecho={() => cargarFeed()} />
      )}</TotalRegistros>}
    </div>
  );
};

const TarjetaImagen: React.FC<{ d: Deteccion; ruta: string | null; titulo: string; contain?: boolean }> = ({ d, ruta, titulo, contain }) => {
  const [zoom, setZoom] = useState(false);
  return (
    <div>
      <span className="etiqueta-campo">{titulo}</span>
      <div style={{ marginTop: 6 }} className="miniatura-zoom" title="Ampliar evidencia">
        <ImagenEvidencia ruta={ruta} alt={titulo} alto={150} ajuste={contain ? 'contain' : 'cover'} fondoOscuro={contain} onClick={() => setZoom(true)} />
      </div>
      {zoom && <VisorZoom d={d} onCerrar={() => setZoom(false)} />}
    </div>
  );
};

/**
 * Movimientos recientes: filas verdes para autorizados, rojas para alertas, con la marca OK / ALERTA
 * junto a la placa. Usa los mismos datos del feed en tiempo real. La consulta de placa está en la
 * misma tarjeta: lo que se escribe filtra los ingresos recientes y «Consultar» agrega la situación de
 * la placa en las listas; si no está entre los recientes, se muestra su historial.
 */
const TablaIngresosRecientes: React.FC<{
  items: Deteccion[]; onValidar: (d: Deteccion) => void; onEliminar?: (d: Deteccion) => void; refConsulta?: React.Ref<HTMLInputElement>;
}> = ({ items, onValidar, onEliminar, refConsulta }) => {
  const navigate = useNavigate();
  const [zoom, setZoom] = useState<Deteccion | null>(null);
  const [texto, setTexto] = useState('');
  const [resultado, setResultado] = useState<ResultadoBusqueda | null>(null);
  const [consultando, setConsultando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consultar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (texto.length < 3) return;
    setConsultando(true); setError(null);
    try { setResultado((await api.get(`/detecciones/buscar-placa/${texto}`)).data); } catch (err) { setResultado(null); setError(mensajeError(err)); } finally { setConsultando(false); }
  };
  const limpiar = () => { setTexto(''); setResultado(null); setError(null); };
  // El resultado vale mientras el texto sea el consultado
  const vigente = resultado && resultado.placa.replace(/-/g, '') === texto ? resultado : null;
  const recientes = texto ? items.filter(d => (d.placa ?? '').replace(/-/g, '').includes(texto)) : items;
  const historial = vigente && recientes.length === 0 ? vigente.ultimos_ingresos : null;
  const filas = (historial ?? recientes).slice(0, 12);
  return (
    <Tarjeta titulo="Movimientos recientes" subtitulo="Últimos pasos procesados · verde: autorizado · rojo: alerta" sinPadding acciones={
      <form className="fila" role="search" onSubmit={consultar} style={{ gap: 6 }}>
        {/* Consulta (no registro): admite una placa parcial de al menos 3 caracteres, solo letras y números */}
        <input ref={refConsulta} className="input placa-input" style={{ height: 32, width: 170 }} value={texto} maxLength={10} placeholder="Placa: ABC1234"
          onChange={e => { setTexto(filtrarEscrito(e.target, normalizarPlaca)); setError(null); }}
          aria-label="Placa a consultar o filtrar" autoComplete="off" spellCheck={false} />
        <button className="btn btn-navy btn-sm" disabled={consultando || texto.length < 3}><Search size={14} /> {consultando ? 'Consultando…' : 'Consultar'}</button>
        {texto && <button type="button" className="btn btn-ghost btn-sm btn-icono" title="Quitar el filtro" aria-label="Quitar el filtro" onClick={limpiar}><X size={14} /></button>}
      </form>}>
      {(error || vigente) && <div style={{ padding: '12px 16px 0' }}>{error ? <Aviso tipo="error">{error}</Aviso> : vigente && <ResultadoConsulta r={vigente} />}</div>}
      {historial && historial.length > 0 && (
        <p className="texto-secundario" style={{ padding: '10px 16px 0' }}>No está entre los ingresos recientes: estos son sus últimos movimientos registrados.</p>
      )}
      {filas.length === 0 ? (
        texto
          ? <Vacio titulo="Sin coincidencias" texto={vigente ? 'La placa no tiene movimientos registrados.' : `Ningún ingreso reciente contiene «${texto}». Use Consultar para ver su situación y su historial.`} />
          : <Vacio titulo="Sin ingresos procesados" texto="Los ingresos aparecerán aquí en cuanto el motor termine de leer cada placa." />
      ) : (
        <div className="tabla-contenedor">
          <table className="tabla compacta">
            <thead><tr>
              <th>Placa</th><th>Tipificación</th><th>Fecha y hora</th><th>Estado</th><th>Cámara</th>
              <th className="ocultar-movil">Vehículo / titular</th><th className="num ocultar-movil">Confianza OCR</th><th className="columna-fija">Validación</th>
            </tr></thead>
            <tbody>
              {filas.map(d => {
                const aut = d.estado_validacion === 'autorizado';
                const ale = d.estado_validacion === 'alerta';
                return (
                  <tr key={d.id} className={`clic${aut ? ' fila-autorizado' : ale ? ' fila-alerta' : ''}`} onClick={() => navigate(`/detecciones/${d.id}`)}>
                    <td className="nowrap">
                      {/* La foto real del recorte de la placa junto a la lectura, como en el Dashboard */}
                      <PlacaFoto d={d} alto={30} />
                      {aut && <span className="marca-estado ok">OK</span>}
                      {ale && <span className="marca-estado alerta">ALERTA</span>}
                    </td>
                    {/* Derivada de la placa: también para los vehículos que no están autorizados */}
                    <td><InsigniaTipificacion placa={d.placa} provincia /></td>
                    <td className="nowrap"><strong style={{ color: 'var(--text)', fontWeight: 700 }}>{hora(d.fecha_hora_ingreso)}</strong><span className="secundario">{fecha(d.fecha_hora_ingreso)}</span></td>
                    <td className="nowrap"><InsigniaEstado estado={d.estado_validacion} /></td>
                    {/* En una línea: el nombre largo de la cámara partía la columna en varias líneas por fila */}
                    <td style={{ maxWidth: 190 }} title={d.camara ? `${d.camara.nombre} · ${d.camara.ubicacion}` : undefined}>
                      {d.camara ? <><span className="truncar" style={{ display: 'block' }}>{d.camara.nombre}</span>
                        <span className="secundario truncar">{d.tipo_movimiento === 'salida' ? 'Salida' : 'Ingreso'} · {d.camara.ubicacion}</span></>
                        : <span className="texto-secundario nowrap">{d.fuente === 'manual' ? 'Registro manual' : d.tipo_movimiento === 'salida' ? 'Salida' : '—'}</span>}
                    </td>
                    <td className="ocultar-movil" style={{ maxWidth: 220 }}>
                      <span className="truncar" style={{ display: 'block', color: aut ? 'var(--autorizado)' : ale ? 'var(--alerta)' : undefined, fontWeight: aut || ale ? 600 : undefined }}>
                        {aut ? `✓ ${d.autorizado?.propietario ?? 'Lista blanca'}` : ale ? `⚠ ${d.alerta?.motivo ?? 'Lista negra'}` : describirVehiculo(d)}
                      </span>
                      {aut && d.autorizado?.departamento && <span className="secundario truncar">{d.autorizado.departamento}</span>}
                    </td>
                    <td className="num ocultar-movil"><ConfianzaBadge valor={d.confianza_ocr} /></td>
                    <td className="acciones-celda columna-fija" onClick={e => e.stopPropagation()}>
                      {d.estado_validacion === 'pendiente_revision' && !d.validado_manualmente
                        ? <button className="btn btn-navy btn-sm" onClick={() => onValidar(d)}>Validar</button>
                        : <button className="btn btn-ghost btn-sm" onClick={() => onValidar(d)}>{d.validado_manualmente ? 'Validado' : 'Corregir'}</button>}
                      <button className="btn btn-ghost btn-sm btn-icono miniatura-zoom" title="Ampliar evidencia" aria-label="Ampliar evidencia"
                        disabled={!d.imagen_placa && !d.imagen_vehiculo} onClick={() => setZoom(d)}><ZoomIn size={14} /></button>
                      {onEliminar && <button className="btn btn-ghost btn-sm btn-icono" title="Eliminar registro" aria-label="Eliminar registro" onClick={() => onEliminar(d)}><Trash2 size={14} color="var(--alerta)" /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {zoom && <VisorZoom d={zoom} onCerrar={() => setZoom(null)} />}
    </Tarjeta>
  );
};

/** Consulta el total de registros antes de mostrar la eliminación masiva. */
const TotalRegistros: React.FC<{ children: (total: number) => React.ReactNode }> = ({ children }) => {
  const { datos } = useConsulta<number>(() => api.get('/detecciones', { params: { tamano: 5 } }).then(r => r.data.total), []);
  return datos === null ? null : <>{children(datos)}</>;
};

export default Monitoreo;
