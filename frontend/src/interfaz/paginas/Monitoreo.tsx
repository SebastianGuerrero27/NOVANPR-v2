import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Bell, BellOff, Camera, ClipboardPlus, Cpu, Edit3, Film, Gauge, History, LogOut, Pause, Play, Plus, ShieldAlert, ShieldCheck, Trash2, X } from 'lucide-react';
import api, { mensajeError } from '../../infraestructura/api';
import { useAuth } from '../../aplicacion/AuthContext';
import { useEvento, useReconexion } from '../../aplicacion/tiempoReal';
import { useConsulta, usePaginaVisible } from '../../aplicacion/hooks';
import type { Camara, Deteccion, EstadoAnpr } from '../../dominio/tipos';
import { codecVideo, ESTADOS, fecha, fechaHora, fechaIsoLocal, hora, limiteDia, numero, relativo } from '../../dominio/formato';
import { formatearPlaca } from '../../dominio/validacion';
import { ESTADOS_ACCESO, esRegistroDeSalidas, estadoAcceso, faltantesSalida, puedeRegistrarSalida } from '../../dominio/estadoAcceso';
import { Aviso, Cargando, InsigniaEstado, InsigniaTipificacion, Paginacion, Placa, Segmentado, Tarjeta, Vacio } from '../componentes/ui';
import { ImagenEvidencia, PlacaFoto, RegistroManualModal, TarjetaDeteccion, ValidarModal } from '../componentes/deteccion';
import { VisorZoom } from '../componentes/ZoomDual';
import { type ResultadoBusqueda, SituacionPlaca } from '../componentes/SituacionPlaca';
import { EliminarUno, EliminarVarios } from '../componentes/EliminarDetecciones';
import { alCambiarSonido, fijarSonido, sonarAutorizado, sonarDenegado, sonidoActivo } from '../../infraestructura/avisos';
import { PERFILES, PerfilVideo, VisorVideo } from '../componentes/video';
import { VisorEnVivo } from '../componentes/envivo';
import { useNotificar } from '../componentes/Notificaciones';
import { RestringirVehiculoModal } from '../componentes/RestringirVehiculoModal';
import { VistaCuadricula } from '../componentes/VistaCuadricula';
import { actualizarCampoIngreso, CeldaIngreso, type CampoIngreso } from '../componentes/CeldaIngreso';
import { ConfianzaRegistro } from '../componentes/ConfianzaRegistro';
import { horasDelMovimiento } from '../../dominio/movimiento';

const MAX_FEED = 30;
const CLAVE_PERFIL = 'anpr_perfil_video';
// Clave nueva: con la anterior, una caída automática a compatibilidad quedaba guardada para siempre
const CLAVE_MODO = 'anpr_modo_video_elegido';
const CLAVE_VISTA = 'anpr_vista_monitoreo_v2';
const CLAVE_CAMARA = 'anpr_camara_monitoreo';

const leer = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
/** Milisegundos → segundos con un decimal (latencia del motor) */
const segundos = (ms: number) => (ms / 1000).toLocaleString('es-EC', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const Monitoreo: React.FC = () => {
  const { puede } = useAuth();
  const [paramsAviso] = useSearchParams();
  const registroAviso = paramsAviso.get('registro');
  const registroId = registroAviso && /^\d+$/.test(registroAviso) && Number(registroAviso) > 0 && Number(registroAviso) <= 2147483647 ? Number(registroAviso) : null;
  const [cargandoAviso, setCargandoAviso] = useState(false);
  const [errorAviso, setErrorAviso] = useState<string | null>(null);
  const eliminados = useRef(new Set<number>());
  const navigate = useNavigate();
  const notificar = useNotificar();
  const visible = usePaginaVisible();
  const [perfil, setPerfil] = useState<PerfilVideo>(() => (leer(CLAVE_PERFIL, 'media') as PerfilVideo) in PERFILES ? leer(CLAVE_PERFIL, 'media') as PerfilVideo : 'media');
  const [pausado, setPausado] = useState(false);
  // WebRTC (MediaMTX, sin re-codificar, ~0,2–0,5 s) o compatibilidad (JPEG por WebSocket desde el motor)
  const [modo, setModo] = useState<'webrtc' | 'compat'>(() => (leer(CLAVE_MODO, 'webrtc') === 'compat' ? 'compat' : 'webrtc'));
  const cambiarModo = (m: 'webrtc' | 'compat') => { setModo(m); guardar(CLAVE_MODO, m); };
  const [vista, setVista] = useState<'anpr' | 'cuadricula'>(() => leer(CLAVE_VISTA, 'anpr') === 'cuadricula' ? 'cuadricula' : 'anpr');
  const cambiarVista = (v: 'anpr' | 'cuadricula') => { setVista(v); guardar(CLAVE_VISTA, v); };
  const [sonido, setSonido] = useState(sonidoActivo);
  useEffect(() => alCambiarSonido(setSonido), []);
  const [feed, setFeed] = useState<Deteccion[]>([]);
  const [cargandoFeed, setCargandoFeed] = useState(true);
  const [resaltada, setResaltada] = useState<number | null>(null);
  const [validando, setValidando] = useState<Deteccion | null>(null);
  const [restringiendo, setRestringiendo] = useState<Deteccion | null>(null);
  const [manual, setManual] = useState(false);
  const [camaraElegida, setCamaraElegida] = useState<number | null>(() => Number(leer(CLAVE_CAMARA, '')) || null);
  const [eliminando, setEliminando] = useState<Deteccion | null>(null);
  const [eliminarTodos, setEliminarTodos] = useState(false);
  const puedeEliminar = puede('detecciones:eliminar-individual');
  const puedeEliminarTodos = puede('detecciones:eliminar');

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
      .then(r => setFeed((r.data as Deteccion[]).filter(d => !esRegistroDeSalidas(d)))).catch(() => undefined).finally(() => setCargandoFeed(false));
  }, []);
  // Carga inicial y resincronización al volver a la pestaña (por eventos perdidos mientras estaba oculta)
  useEffect(() => { if (visible) cargarFeed(); }, [visible, cargarFeed]);

  const insertar = (d: Deteccion) => {
    if (d.tipo_movimiento === 'salida' || esRegistroDeSalidas(d)) return;
    setFeed(f => [d, ...f.filter(x => x.id !== d.id)].slice(0, MAX_FEED));
    setResaltada(d.id);
    window.setTimeout(() => setResaltada(r => (r === d.id ? null : r)), 3000);
  };

  const actualizarMovimiento = (d: Deteccion) => {
    if (d.tipo_movimiento === 'salida' || esRegistroDeSalidas(d)) {
      setFeed(f => f.filter(x => x.id !== d.id));
      setSeleccion(s => s?.id === d.id ? null : s);
      cargarFeed();
      return;
    }
    setFeed(f => (f.some(x => x.id === d.id) ? f.map(x => (x.id === d.id ? d : x)) : [d, ...f].slice(0, MAX_FEED)));
    setSeleccion(s => s?.id === d.id ? d : s);
    setResaltada(d.id);
    window.setTimeout(() => setResaltada(r => (r === d.id ? null : r)), 3000);
  };
  useEvento<Deteccion>('deteccion:nueva', insertar);
  useEvento<Deteccion>('deteccion:actualizada', actualizarMovimiento);
  useEvento<{ id: number }>('deteccion:eliminada', ({ id }) => {
    eliminados.current.add(id);
    setFeed(f => f.filter(x => x.id !== id));
    setSeleccion(s => (s?.id === id ? null : s));
    if (id === registroId) setErrorAviso('El registro de esta notificación fue eliminado. Puede continuar consultando todos los accesos.');
  });
  useEvento('deteccion:eliminadas', () => {
    setSeleccion(null);
    if (registroId) {
      eliminados.current.add(registroId);
      setErrorAviso('El historial fue actualizado después de una eliminación. Puede continuar consultando todos los accesos.');
    }
    cargarFeed();
  });
  useReconexion(() => { cargarFeed(); estadoMotor.recargar(true); recargarCamaras(true); });
  useEvento('monitoreo:camaras', () => estadoMotor.recargar(true));
  useEvento('camara:actualizada', () => recargarCamaras(true));

  const motor = estadoMotor.datos;
  const habilitadas = (camaras ?? []).filter(c => c.activa);
  const hayCamaras = habilitadas.length > 0;
  // La cámara que se ve aquí: la elegida si sigue habilitada; si no, la primera en análisis o la primera habilitada
  const camaraActiva = habilitadas.find(c => c.id === camaraElegida)
    ?? habilitadas.find(c => motor?.camaras?.some(x => x.id === c.id)) ?? habilitadas[0];
  const analisis = motor?.camaras?.find(x => x.id === camaraActiva?.id);
  const elegirCamara = (id: number) => { setCamaraElegida(id); guardar(CLAVE_CAMARA, String(id)); };
  const camarasAnalizadas = (motor?.camaras ?? []).map(x => x.id);
  const sinCapacidad = motor?.sin_capacidad ?? [];
  const pendientes = feed.filter(d => d.estado_validacion === 'pendiente_revision' && !d.validado_manualmente && d.estado_procesamiento !== 'pendiente_ocr');
  const ultima = feed.find(d => d.estado_procesamiento !== 'pendiente_ocr') ?? null;
  // Movimiento elegido en la tabla: se ve en «Visualización de accesos» sin salir de Monitoreo. Se
  // guarda el registro (puede venir de una búsqueda) y se refresca con el feed si cambia
  const [seleccion, setSeleccion] = useState<Deteccion | null>(null);
  const enVista = seleccion ? (feed.find(d => d.id === seleccion.id) ?? seleccion) : ultima;
  const panelAccesos = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelado = false;
    setErrorAviso(null);
    if (!registroId) {
      setCargandoAviso(false);
      if (registroAviso) setErrorAviso('El enlace de la notificación no contiene un registro válido.');
      return;
    }
    setCargandoAviso(true);
    setSeleccion(null);
    setPausado(false);
    api.get<Deteccion>(`/detecciones/${registroId}`).then(({ data }) => {
      if (cancelado || eliminados.current.has(registroId)) return;
      setSeleccion(data);
      setFeed(actual => actual.map(d => d.id === data.id ? data : d).filter(d => !esRegistroDeSalidas(d)));
      setResaltada(data.id);
      if (data.camara?.id) setCamaraElegida(data.camara.id);
      window.setTimeout(() => { if (!cancelado) panelAccesos.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); }, 0);
    }).catch(e => {
      if (!cancelado) setErrorAviso(mensajeError(e, 'No se pudo abrir el registro de la notificación.'));
    }).finally(() => { if (!cancelado) setCargandoAviso(false); });
    return () => { cancelado = true; };
  }, [registroId, registroAviso]);
  const seleccionar = (d: Deteccion) => {
    setSeleccion(d);
    const caja = panelAccesos.current?.getBoundingClientRect();
    if (caja && caja.top < 0) panelAccesos.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const [registrandoSalida, setRegistrandoSalida] = useState<number | null>(null);
  /** Hora de salida del ingreso, con un toque; devuelve el registro actualizado (o null si falló). */
  const registrarSalida = async (d: Deteccion): Promise<Deteccion | null> => {
    if (!puedeRegistrarSalida(d)) {
      const faltantes = faltantesSalida(d);
      notificar(
        'advertencia',
        'No se puede registrar la salida todavía',
        `Complete estos campos del registro: ${faltantes.join(', ')}.`,
      );
      return null;
    }
    setRegistrandoSalida(d.id);
    try {
      const actualizada = (await api.post<{ deteccion: Deteccion }>(`/detecciones/${d.id}/salida`)).data.deteccion;
      actualizarMovimiento(actualizada);
      notificar('exito', 'Salida registrada', `${d.placa ? formatearPlaca(d.placa) : 'El vehículo'} salió a las ${hora(actualizada.fecha_hora_salida ?? new Date().toISOString())}.`);
      return actualizada;
    } catch (err) {
      notificar('error', 'No se pudo registrar la salida', mensajeError(err));
      return null;
    } finally {
      setRegistrandoSalida(null);
    }
  };
  // La consulta de placa vive en la tarjeta de movimientos recientes (antes era un modal)

  return (
    <div className="pagina ancha">
      <div className="pila">
        {cargandoAviso && <Aviso tipo="info">Abriendo el registro de la notificación…</Aviso>}
        {errorAviso && <Aviso tipo="error">{errorAviso}</Aviso>}
        {!cargandoAviso && !errorAviso && registroId && seleccion?.id === registroId && <Aviso tipo="info">
          Registro de la notificación N.º {registroId} seleccionado en Visualización de accesos. {esRegistroDeSalidas(seleccion)
            ? 'Este registro ya está completo y puede consultarse en Registro de Salidas.'
            : 'La tabla muestra los accesos sin salida o pendientes de completar; la fila se resalta si está en la página visible.'}
        </Aviso>}
        <div className="grid-principal" style={{ gridTemplateColumns: 'minmax(0, 1.9fr) minmax(320px, 1fr)' }}>
          {/* ── Video y controles ── */}
          <div className="pila">
            {motor?.en_linea && analisis && !analisis.conectada && (
              <Aviso tipo="advertencia">
                <b>El motor analiza {camaraActiva?.nombre ?? 'la cámara'}, pero no recibe video.</b> Revise que la cámara tenga energía y
                red, y compruebe su enlace con <b>Ping</b> en Operación › Registro de cámaras. El motor se reconecta solo cuando la señal vuelve.
              </Aviso>
            )}
            {motor?.en_linea && sinCapacidad.length > 0 && (
              <Aviso tipo="advertencia">
                <b>{sinCapacidad.length === 1 ? '1 cámara' : `${sinCapacidad.length} cámaras`} sin analizar:</b> {habilitadas.filter(c => sinCapacidad.includes(c.id)).map(c => c.nombre).join(', ')}.
                {' '}Los motores ANPR en línea ya analizan su máximo ({motor.capacidad ?? 0}): agregue otro motor, aumente ANPR_MAX_CAMARAS o marque como «solo video» las que no necesite analizar.
              </Aviso>
            )}
            <Tarjeta sinPadding>
              <div className="fila" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', gap: 10 }}>
                <div className="fila" style={{ gap: 8, minWidth: 0 }}>
                  <Camera size={16} color="var(--text-3)" />
                  {hayCamaras ? (
                    <select className="select" style={{ height: 32, width: 'auto', maxWidth: 280 }} value={camaraActiva?.id ?? ''}
                      onChange={e => e.target.value && elegirCamara(Number(e.target.value))} aria-label="Cámara que se muestra">
                      {habilitadas.map(c => <option key={c.id} value={c.id}>{c.nombre} · {c.ubicacion}{c.direccion === 'salida' ? ' (salida)' : ''}</option>)}
                    </select>
                  ) : (
                    <strong className="truncar" style={{ fontSize: 13.5 }}>Sin cámaras habilitadas</strong>
                  )}
                  {camaraActiva && !analisis && motor?.en_linea && <span className="insignia" title={camaraActiva.analisis_anpr ? 'Esta cámara aún no entra al motor ANPR' : 'No registra pasos: se activa al editar la cámara'}>{camaraActiva.analisis_anpr ? 'Sin análisis' : 'Solo video'}</span>}
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
                  ? <VistaCuadricula camaras={camaras ?? []} analizadas={camarasAnalizadas} />
                  : modo === 'compat' && analisis ? <VisorVideo camaraId={analisis.id} motor={analisis.motor} perfil={perfil} pausado={pausado} />
                    : !motor && estadoMotor.cargando ? <div style={{ aspectRatio: '16 / 9', background: '#050b16', borderRadius: 10 }} />
                      : <VisorEnVivo camaraId={camaraActiva?.id ?? null} analizada={Boolean(analisis)} vista={Boolean(camaraActiva?.rtsp_url_vista)} pausado={pausado} claveReinicio={analisis?.motor}
                          onFallo={m => { setModo('compat'); notificar('advertencia', 'Se activó el modo de compatibilidad', `WebRTC no disponible: ${m}`); }} />}
              </div>
              <div className="fila" style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', gap: 16, fontSize: 12.5, color: 'var(--text-3)' }}>
                <span className="fila" style={{ gap: 6 }}>
                  <span className={`punto ${motor?.en_linea ? 'verde' : estadoMotor.cargando ? 'gris' : 'rojo'}`} />
                  Motor ANPR {motor?.en_linea ? 'en línea' : estadoMotor.cargando ? '…' : `fuera de línea${motor?.error ? ` (${motor.error})` : ''}`}
                </span>
                {motor?.en_linea && <>
                  <span className="fila" style={{ gap: 6 }} title="Cámaras que analiza el motor ANPR y cuántas admite"><Camera size={13} /> {camarasAnalizadas.length} de {motor.capacidad ?? 0} en análisis</span>
                  {analisis && <span className="fila" style={{ gap: 6 }}><Cpu size={13} /> Captura {numero(analisis.fps_captura ?? 0)} fps · análisis {numero(analisis.fps_procesamiento ?? 0)} fps</span>}
                  {analisis && <span className="fila" style={{ gap: 6 }}><span className={`punto ${analisis.conectada ? 'verde' : 'ambar'}`} /> Señal {analisis.conectada ? 'recibida' : 'sin recibir'}</span>}
                  {analisis?.enlace && (
                    <span className="fila ocultar-movil" style={{ gap: 6 }}
                      title="Flujo principal que analiza el motor: códec, resolución, cuadros recibidos por segundo y reconexiones automáticas con la cámara">
                      <Film size={13} /> {codecVideo(analisis.enlace.codec)}{analisis.enlace.ancho ? ` ${analisis.enlace.ancho}×${analisis.enlace.alto}` : ''}
                      {' · '}{numero(analisis.enlace.fps_recibidos ?? 0)} fps recibidos{analisis.enlace.reconexiones ? ` · ${analisis.enlace.reconexiones} reconexiones` : ''}
                    </span>
                  )}
                  {analisis?.latencia?.lectura_en_vivo && (
                    <span className="fila" style={{ gap: 6 }}
                      title={`Desde que la cámara captura el cuadro hasta que la lectura aparece (mediana y percentil 95 de las últimas ${analisis.latencia.lectura_en_vivo.muestras}).`
                        + (analisis.latencia.edad_cuadro ? ` Edad del cuadro al analizarlo: ${analisis.latencia.edad_cuadro.p50_ms} ms.` : '')
                        + (analisis.latencia.registro ? ` Registro confirmado: ${segundos(analisis.latencia.registro.p50_ms)} s.` : '')
                        + (analisis.latencia.cuadros_descartados_pct !== null ? ` Cuadros descartados por llegar uno más nuevo: ${analisis.latencia.cuadros_descartados_pct} %.` : '')}>
                      <Gauge size={13} /> Lectura {segundos(analisis.latencia.lectura_en_vivo.p50_ms)} s (p95 {segundos(analisis.latencia.lectura_en_vivo.p95_ms)} s)
                    </span>
                  )}
                  <span className="ocultar-movil truncar" title={`${motor.detector} · ${motor.ocr}`}>Detector {motor.detector} · OCR {motor.ocr}</span>
                </>}
              </div>
              {vista === 'anpr' && analisis?.captura && analisis.captura.recomendaciones.length > 0 && (
                <div style={{ padding: '0 14px 12px' }}>
                  <Aviso tipo="info">
                    <b>Ajustes sugeridos para la cámara</b> (últimas {analisis.captura.placas} placas: unos {analisis.captura.ancho_px_p50} px de ancho)
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{analisis.captura.recomendaciones.map(r => <li key={r.codigo}>{r.texto}</li>)}</ul>
                  </Aviso>
                </div>
              )}
            </Tarjeta>

          </div>

          {/* ── Feed en tiempo real: la altura de la columna del video, con desplazamiento propio ── */}
          <div className="columna-feed">
            <div className="pila columna-feed-contenido">
              {pendientes.length > 0 && (
                <Aviso tipo="info">
                  <b>{pendientes.length} {pendientes.length === 1 ? 'paso requiere' : 'pasos requieren'} autorización</b> en el feed. Use “Autorizar” en cada tarjeta.
                </Aviso>
              )}
              <Tarjeta titulo="Detecciones en tiempo real" subtitulo="Actualización instantánea, sin recargar" sinPadding className="tarjeta-feed"
                acciones={puedeEliminarTodos && feed.length > 0 ? <button className="btn btn-danger btn-sm" onClick={() => setEliminarTodos(true)}><Trash2 size={14} /> Eliminar todos</button> : undefined}>
                <div className="pila" style={{ gap: 8, padding: 12 }}>
                  {cargandoFeed ? <Cargando /> : feed.length === 0
                    ? <Vacio titulo="Sin detecciones" texto="Cuando el motor registre un vehículo aparecerá aquí de inmediato." />
                    : feed.map(d => <TarjetaDeteccion key={d.id} d={d} onValidar={setValidando} onRestringir={puede('alertas:restringir') ? setRestringiendo : undefined} onEliminar={puedeEliminar ? setEliminando : undefined} resaltada={resaltada === d.id} />)}
                </div>
              </Tarjeta>
            </div>
          </div>
        </div>

        {/* A todo el ancho, debajo del video y del feed: antes iban en la columna del video y bajo el feed
            quedaba un hueco; la tabla, además, no cabía */}
        {/* Visualización de accesos: el último paso o el elegido en la tabla, con su evidencia, sin
            salir de Monitoreo (antes cada fila llevaba al detalle y había que volver) */}
        <div ref={panelAccesos}>
        <Tarjeta titulo="Visualización de accesos"
          subtitulo={seleccion ? 'Movimiento elegido en la tabla' : 'Último movimiento registrado'} acciones={
          <div className="fila">
            {seleccion && <button className="btn btn-secondary btn-sm" onClick={() => setSeleccion(null)}><History size={14} /> Volver al último</button>}
            <button className={`btn btn-sm ${sonido ? 'btn-secondary' : 'btn-ghost'}`} title={sonido ? 'Silenciar alertas' : 'Activar sonido de alertas'}
              onClick={() => fijarSonido(!sonido)}>
              {sonido ? <Bell size={14} /> : <BellOff size={14} />} {sonido ? 'Sonido activo' : 'Silenciado'}
            </button>
            <button className="btn btn-ghost btn-sm" title="Probar el sonido de vehículo autorizado" disabled={!sonido} onClick={sonarAutorizado}>
              <ShieldCheck size={14} color="var(--autorizado)" /> Probar autorizado</button>
            <button className="btn btn-ghost btn-sm" title="Probar el sonido de acceso no autorizado" disabled={!sonido} onClick={sonarDenegado}>
              <ShieldAlert size={14} color="var(--alerta)" /> Probar alerta</button>
          </div>}>
          {!enVista ? <Vacio titulo="Aún no hay pasos registrados" texto="Las detecciones aparecerán aquí en cuanto el motor ANPR registre un vehículo." /> : (
            <div className="fila" style={{ alignItems: 'stretch', gap: 16, flexWrap: 'wrap' }}>
              <div className="pila" style={{ gap: 10, minWidth: 220 }}>
                <Placa valor={enVista.placa} grande sinPlaca={enVista.sin_placa} />
                <InsigniaTipificacion placa={enVista.placa} provincia />
                <div className="fila" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <InsigniaEstado estado={enVista.estado_validacion} />
                  {estadoAcceso(enVista) !== 'registrado' && <span className={`insignia acceso ${estadoAcceso(enVista)}`}>{ESTADOS_ACCESO[estadoAcceso(enVista)].etiqueta}</span>}
                </div>
                <span className="texto-secundario">{enVista.tipo_movimiento === 'salida' ? 'Salida' : 'Ingreso'} · {fechaHora(enVista.fecha_hora_ingreso)} · {relativo(enVista.fecha_hora_ingreso)}</span>
                {enVista.fecha_hora_salida && <span className="texto-secundario">Salida · {fechaHora(enVista.fecha_hora_salida)}{enVista.salida_automatica ? ' · automática' : ''}</span>}
                <span style={{ fontSize: 13 }}>
                  {enVista.alerta ? <b style={{ color: 'var(--alerta)' }}>{enVista.alerta.motivo}</b>
                    : enVista.autorizado ? <>{enVista.autorizado.propietario}{enVista.autorizado.departamento ? ` · ${enVista.autorizado.departamento}` : ''}</>
                      : ESTADOS[enVista.estado_validacion].etiqueta}
                </span>
                <div className="acciones-visualizacion" aria-label="Acciones del acceso">
                  {enVista.estado_validacion !== 'autorizado' && enVista.tipo_movimiento !== 'salida' && (
                    <button className="btn btn-navy btn-sm" onClick={() => setValidando(enVista)}>Validar ahora</button>
                  )}
                  {puede('alertas:restringir') && enVista.estado_validacion !== 'autorizado' && enVista.estado_validacion !== 'alerta' && enVista.tipo_movimiento !== 'salida' && <button className="btn btn-danger btn-sm" onClick={() => setRestringiendo(enVista)}>Restringir</button>}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 240 }} className="grid-2">
                <TarjetaImagen key={`placa-${enVista.id}`} d={enVista} ruta={enVista.imagen_placa} titulo="Placa" contain />
                <TarjetaImagen key={`vehiculo-${enVista.id}`} d={enVista} ruta={enVista.imagen_vehiculo} titulo="Vehículo" />
              </div>
            </div>
          )}
        </Tarjeta>
        </div>

        <TablaIngresosRecientes key={registroId ?? 'todos'} items={feed}
          onRestringir={puede('alertas:restringir') ? setRestringiendo : undefined}
          onValidar={setValidando} onEliminar={puedeEliminar ? setEliminando : undefined}
          onRegistrar={() => setManual(true)}
          puedeEditarCampos={puede('detecciones:validar')}
          seleccionada={enVista?.id ?? null} onSeleccionar={seleccionar}
          registrandoSalida={registrandoSalida} onRegistrarSalida={registrarSalida} salidaManual={motor?.salida_manual !== false} />
      </div>

      {validando && <ValidarModal d={validando} onCerrar={() => setValidando(null)} onValidada={actualizarMovimiento} />}
      {restringiendo && <RestringirVehiculoModal d={restringiendo} onCerrar={() => setRestringiendo(null)} />}
      {manual && <RegistroManualModal onCerrar={() => setManual(false)} onRegistrada={insertar} />}
      {puedeEliminar && eliminando && <EliminarUno d={eliminando} onCerrar={() => setEliminando(null)} onEliminada={id => {
        eliminados.current.add(id);
        setFeed(f => f.filter(x => x.id !== id));
        setSeleccion(s => s?.id === id ? null : s);
        if (id === registroId) setErrorAviso('El registro de esta notificación fue eliminado. Puede continuar consultando todos los accesos.');
        cargarFeed();
      }} />}
      {puedeEliminarTodos && eliminarTodos && <TotalRegistros>{total => (
        <EliminarVarios total={total} descripcion="Todos los registros de ingreso del sistema" onCerrar={() => setEliminarTodos(false)} onHecho={() => cargarFeed()} />
      )}</TotalRegistros>}
    </div>
  );
};

/** «Registrar salida»: acción textual; un toque registra la hora de salida del ingreso. */
const BotonSalida: React.FC<{ ocupado: boolean; deshabilitado: boolean; sinPlaca: boolean; onRegistrar: () => void }> = ({ ocupado, deshabilitado, sinPlaca, onRegistrar }) => (<div className="pila" style={{ gap: 4, maxWidth: 210, whiteSpace: 'normal' }}>
  <button type="button" className="btn-salida" disabled={deshabilitado} title={sinPlaca ? 'Registrar salida de este ingreso sin placa legible; compruebe la evidencia' : 'Registrar salida'} onClick={onRegistrar} aria-label="Registrar salida">
    <LogOut size={13} aria-hidden />
    <span>{ocupado ? 'Registrando…' : 'Registrar salida'}</span>
  </button>
  {sinPlaca && <small className="texto-secundario">Sin placa legible</small>}
  </div>
);

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
 * Movimientos recientes, con el color del estado del acceso (dominio/estadoAcceso.ts): rojo solo para
 * las alertas de lista negra y los pasos sin lectura de placa; todo lo demás, en blanco.
 * Tocar una fila la muestra en «Visualización de accesos». Permite buscar los ingresos por placa o por
 * titular/persona y consultar las listas cuando se introduce una placa.
 */
export const TablaIngresosRecientes: React.FC<{
  items: Deteccion[]; onValidar: (d: Deteccion) => void; onEliminar?: (d: Deteccion) => void; refConsulta?: React.Ref<HTMLInputElement>;
  onRestringir?: (d: Deteccion) => void;
  onRegistrar?: () => void;
  puedeEditarCampos: boolean;
  seleccionada: number | null; onSeleccionar: (d: Deteccion) => void;
  registrandoSalida: number | null; onRegistrarSalida: (d: Deteccion) => Promise<Deteccion | null>; salidaManual?: boolean;
}> = ({ salidaManual = true, items, onValidar, onEliminar, refConsulta, onRegistrar = () => undefined, puedeEditarCampos, seleccionada, onSeleccionar, registrandoSalida, onRegistrarSalida }) => {
  const [params, setParams] = useSearchParams();
  const [zoom, setZoom] = useState<Deteccion | null>(null);
  const [texto, setTexto] = useState('');
  const [resultado, setResultado] = useState<ResultadoBusqueda | null>(null);
  const [pagina, setPagina] = useState(1);
  const [ediciones, setEdiciones] = useState<Record<number, Deteccion>>({});
  const [busquedaAplicada, setBusquedaAplicada] = useState('');
  const [consultando, setConsultando] = useState(false);
  const consultaBusqueda = useRef(0);
  // Término que ya filtra la tabla: la página vuelve a 1 solo si cambia (al abrir no deshace un «Siguiente»)
  const terminoAplicado = useRef('');
  const estadoFiltro = params.get('estado') ?? '';
  const soloDentro = estadoFiltro === 'dentro';
  const soloHoy = params.get('hoy') === '1';
  const listado = useConsulta<{ items: Deteccion[]; total: number; pagina: number; tamano: number }>(
    // La salida que cerró un ingreso aparece en la fila de ese ingreso (hora de salida), no como otra fila
    () => api.get('/detecciones', { params: { pagina, tamano: 30, unir_salidas: 'si', completos: 'no', buscar: busquedaAplicada || undefined,
      ...(estadoFiltro && !soloDentro ? { estado: estadoFiltro } : {}),
      ...(soloDentro ? { estado: 'autorizado', cerrados: 'no' } : {}),
      ...(params.get('validado') ? { validado: params.get('validado') } : {}),
      ...(soloHoy ? { desde: limiteDia(fechaIsoLocal()), hasta: limiteDia(fechaIsoLocal(), true) } : {}) } }).then(r => r.data),
    [pagina, busquedaAplicada, estadoFiltro, soloDentro, soloHoy, params]);
  useEffect(() => { void listado.recargar(true); }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (listado.datos && pagina > 1 && !listado.datos.items.length) setPagina(pagina - 1); }, [listado.datos, pagina]);
  // Una fila trasladada a Salidas deja de necesitar sus ediciones locales. Si se reabre más tarde,
  // debe mostrarse con los datos actuales del servidor, sin conservar el cierre anterior.
  useEffect(() => {
    if (!listado.datos) return;
    const visibles = new Set(listado.datos.items.map(d => d.id));
    setEdiciones(actuales => {
      const entradas = Object.entries(actuales);
      const vigentes = entradas.filter(([id]) => visibles.has(Number(id)));
      return vigentes.length === entradas.length ? actuales : Object.fromEntries(vigentes);
    });
  }, [listado.datos]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const termino = texto.trim();
    const id = ++consultaBusqueda.current;
    const temporizador = window.setTimeout(async () => {
      if (terminoAplicado.current !== termino) {
        terminoAplicado.current = termino;
        setPagina(1);
      }
      setBusquedaAplicada(termino);
      setError(null);
      if (termino.length < 2) {
        setResultado(null);
        setConsultando(false);
        return;
      }
      const esPlaca = /^[A-Za-z0-9-]{3,10}$/.test(termino);
      if (!esPlaca) {
        setResultado(null);
        setConsultando(false);
        return;
      }
      setConsultando(true);
      try {
        const respuesta = await api.get(`/detecciones/buscar-placa/${encodeURIComponent(termino)}`);
        if (consultaBusqueda.current === id) setResultado(respuesta.data);
      } catch (err) {
        if (consultaBusqueda.current === id) {
          setResultado(null);
          setError(mensajeError(err));
        }
      } finally {
        if (consultaBusqueda.current === id) setConsultando(false);
      }
    }, 250);
    return () => window.clearTimeout(temporizador);
  }, [texto]);
  const limpiar = () => { setTexto(''); setResultado(null); setPagina(1); setBusquedaAplicada(''); setError(null); };
  const cambiarFiltro = (valor: string) => {
    const siguiente = new URLSearchParams(params);
    if (valor && valor !== 'todos') siguiente.set('estado', valor);
    else siguiente.delete('estado');
    if (valor === 'alerta') siguiente.set('hoy', '1');
    else siguiente.delete('hoy');
    if (valor === 'pendiente_revision') siguiente.set('validado', 'no');
    else siguiente.delete('validado');
    setParams(siguiente, { replace: true });
    setPagina(1);
  };
  const registrarSalida = async (d: Deteccion) => {
    const actualizada = await onRegistrarSalida(d);
    if (actualizada) {
      setEdiciones(actuales => ({
        ...actuales,
        [actualizada.id]: { ...d, ...actualizada },
      }));
      void listado.recargar(true);
    }
  };
  const alEditar = (d: Deteccion, campo?: CampoIngreso) => {
    setEdiciones(actuales => {
      const anterior = actuales[d.id] ?? listado.datos?.items.find(x => x.id === d.id);
      if (!campo || !anterior) return { ...actuales, [d.id]: d };
      return { ...actuales, [d.id]: actualizarCampoIngreso(anterior, d, campo) };
    });
    void listado.recargar(true);
  };
  // El resultado vale mientras el texto sea el consultado
  const vigente = resultado && resultado.placa.replace(/-/g, '') === texto.trim().toUpperCase().replace(/-/g, '') ? resultado : null;
  const filas = (listado.datos?.items ?? []).map(d => ediciones[d.id] ?? d).filter(d => !esRegistroDeSalidas(d));
  return (
    <Tarjeta titulo="Todos los accesos"
      subtitulo={`${listado.datos?.total ?? 0} accesos${soloDentro ? ' autorizados sin salida · mismo criterio del dashboard' : soloHoy ? ' alertas de hoy' : ' sin salida o con datos pendientes · los completos con salida están en Registro de Salidas'}`}
      sinPadding acciones={
      <form className="fila" role="search" onSubmit={e => e.preventDefault()} style={{ gap: 6 }}>
        <select className="input" aria-label="Filtrar accesos" style={{ width: 230 }} value={soloDentro ? 'dentro' : estadoFiltro || 'todos'} onChange={e => cambiarFiltro(e.target.value)}>
          <option value="todos">Todos los accesos</option>
          <option value="autorizado">Autorizados</option>
          <option value="pendiente_revision">Por autorizar</option>
          <option value="no_reconocido">No registrados</option>
          <option value="alerta">Alertas hoy</option>
          <option value="dentro">Autorizados sin salida</option>
        </select>
        <input ref={refConsulta} className="input" style={{ height: 32, width: 220 }} value={texto} maxLength={100} placeholder="Placa, vehículo o titular"
          onChange={e => setTexto(e.target.value)}
          aria-label="Buscar por placa, vehículo o titular" autoComplete="off" spellCheck={false} />
        {consultando && <span className="texto-secundario" role="status">Buscando…</span>}
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRegistrar}><ClipboardPlus size={14} /> Registrar</button>
        {texto && <button type="button" className="btn btn-ghost btn-sm btn-icono" title="Quitar el filtro" aria-label="Quitar el filtro" onClick={limpiar}><X size={14} /></button>}
      </form>}>
      {(error || vigente) && <div style={{ padding: '12px 16px 0' }}>{error ? <Aviso tipo="error">{error}</Aviso> : vigente && <SituacionPlaca r={vigente} />}</div>}
      {listado.error && <Aviso tipo="error">{listado.error}</Aviso>}
      {listado.cargando && <Cargando />}
      {filas.length === 0 ? (
        busquedaAplicada
          ? <Vacio titulo="Sin coincidencias" texto={vigente ? 'La placa no tiene movimientos registrados.' : `Ningún registro coincide con «${texto}».`} />
          : <Vacio titulo="Sin accesos" texto="No hay accesos que coincidan con los filtros seleccionados." />
      ) : (
        <div className="tabla-contenedor" role="region" aria-label="Tabla de accesos" tabIndex={0}>
          <table className="tabla compacta tabla-registros">
            <thead><tr>
              <th className="num" scope="col" title="Número de fila">N.º</th>
              <th>Cédula</th><th>Titular</th><th>Placa</th><th>Motivo</th><th>Fecha</th><th>Hora de entrada</th><th>Hora de salida</th>
              <th>Vehículo</th><th>Marca</th><th>Modelo</th><th>Cámara</th>
              <th>Estado</th><th>Confianza</th><th>Registro de salida</th><th className="columna-acciones">Acciones</th>
            </tr></thead>
            <tbody>
              {filas.map((d, i) => {
                const aut = d.estado_validacion === 'autorizado';
                const ale = d.estado_validacion === 'alerta';
                const elegida = d.id === seleccionada;
                const horas = horasDelMovimiento(d);
                return (
                  <tr key={d.id} className={`clic ${ESTADOS_ACCESO[estadoAcceso(d)].clase}${elegida ? ' fila-elegida' : ''}`}
                    onClick={() => onSeleccionar(d)} tabIndex={0} aria-selected={elegida}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSeleccionar(d); } }}>
                    <td className="num texto-secundario">{(pagina - 1) * 30 + i + 1}</td>
                    <CeldaIngreso d={d} campo="cedula" editable={puedeEditarCampos} onActualizada={alEditar} />
                    <CeldaIngreso d={d} campo="persona_ingreso" editable={puedeEditarCampos} onActualizada={alEditar} />
                    <td className="nowrap">
                      <PlacaFoto d={d} alto={36} onClick={() => setZoom(d)} />
                      {aut && <span className="marca-estado ok">OK</span>}
                      {ale && <span className="marca-estado alerta">ALERTA</span>}
                    </td>
                    <CeldaIngreso d={d} campo="motivo_ingreso" editable={puedeEditarCampos && d.tipo_movimiento !== 'salida'} onActualizada={alEditar} />
                    <td className="nowrap">{fecha(d.fecha_hora_ingreso)}</td>
                    {/* La toma de la cámara de salida es una hora de salida, no de entrada */}
                    <td className={`nowrap${horas.entrada ? '' : ' texto-secundario'}`}>{horas.entrada ? <strong style={{ color: 'var(--text)', fontWeight: 700 }}>{hora(horas.entrada)}</strong> : '—'}</td>
                    <td className={`nowrap${horas.salida ? ' hora-salida-registrada' : ' texto-secundario'}`}>{horas.salida ? hora(horas.salida) : '—'}</td>
                    <CeldaIngreso d={d} campo="tipo_vehiculo" editable={puedeEditarCampos} onActualizada={alEditar} />
                    <CeldaIngreso d={d} campo="marca" editable={puedeEditarCampos} onActualizada={alEditar} />
                    <CeldaIngreso d={d} campo="modelo" editable={puedeEditarCampos} onActualizada={alEditar} />
                    <td title={d.camara ? `${d.camara.nombre} · ${d.camara.ubicacion}` : undefined}>
                      {d.camara ? <><span className="truncar" style={{ display: 'block' }}>{d.camara.nombre}</span><span className="secundario truncar">{d.camara.ubicacion}</span></>
                        : <span className="texto-secundario nowrap">{d.fuente === 'manual' ? 'Registro manual' : '—'}</span>}
                    </td>
                    <td className="nowrap"><InsigniaEstado estado={d.estado_validacion} corta /></td>
                    <td className="nowrap"><ConfianzaRegistro valor={d.confianza_ocr} /></td>
                    <td className="nowrap" onClick={e => e.stopPropagation()}>
                      {d.tipo_movimiento !== 'salida' && !d.fecha_hora_salida && !salidaManual && Boolean(d.placa)
                        ? <span className="texto-secundario" title="La registra la cámara de salida al leer la placa">Por cámara</span>
                        : d.tipo_movimiento !== 'salida' && !d.fecha_hora_salida
                        ? <BotonSalida ocupado={registrandoSalida === d.id} deshabilitado={registrandoSalida !== null} sinPlaca={!d.placa} onRegistrar={() => void registrarSalida(d)} />
                        : d.tipo_movimiento === 'salida'
                        ? <span className="texto-secundario" title="La cámara de salida no la unió a un ingreso: la placa no se leyó, no se confirmó o no tenía un ingreso abierto. Corrija la placa para cerrar su ingreso.">Sin ingreso</span>
                        : <span className="texto-secundario" title={d.salida_automatica ? 'La registró la cámara de salida al leer la placa' : undefined}>{d.fecha_hora_salida ? (d.salida_automatica ? 'Automática' : 'Registrada') : '—'}</span>}
                    </td>
                    <td className="acciones-celda" onClick={e => e.stopPropagation()}>
                      <div className="acciones-registro">
                      <button className="btn btn-ghost btn-sm btn-icono" title="Editar registro" aria-label="Editar registro" onClick={() => onValidar(d)}><Edit3 size={14} /></button>
                      {onEliminar && <button className="btn btn-ghost btn-sm btn-icono" title="Eliminar registro" aria-label="Eliminar registro" onClick={() => onEliminar(d)}><Trash2 size={14} color="var(--alerta)" /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {listado.datos && <Paginacion pagina={pagina} tamano={30} total={listado.datos.total} onCambiar={setPagina} />}
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
