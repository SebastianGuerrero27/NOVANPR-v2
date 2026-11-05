import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, BarChart3, CarFront, Download, Edit3, ExternalLink, ImageOff, ListFilter, LogOut, Plus, Search, SlidersHorizontal, Trash2, UserRound, X } from 'lucide-react';
import api, { mensajeError, urlMedia } from '../../infraestructura/api';
import { useAuth } from '../../aplicacion/AuthContext';
import { useEvento, useReconexion } from '../../aplicacion/tiempoReal';
import { useConsulta, useDiferido, useRetardado } from '../../aplicacion/hooks';
import type { Camara, Deteccion, Pagina, ResumenHistorial } from '../../dominio/tipos';
import { fecha, fechaIsoLocal, hora, limiteDia, nombreDescarga, numero } from '../../dominio/formato';
import { estadoAcceso } from '../../dominio/estadoAcceso';
import { formatearPlaca, normalizarPlaca, validarPlaca } from '../../dominio/validacion';
import { horasDelMovimiento } from '../../dominio/movimiento';
import { descargarBlob } from '../../infraestructura/descargas';
import { Aviso, FilasEsqueleto, InsigniaEstado, Paginacion, Tarjeta, Vacio } from '../componentes/ui';
import { PlacaFoto, recortePlaca, RegistroManualModal } from '../componentes/deteccion';
import { EliminarUno, EliminarVarios } from '../componentes/EliminarDetecciones';
import { EditarRegistroHistorial } from '../componentes/EditarRegistroHistorial';
import { ConfianzaRegistro } from '../componentes/ConfianzaRegistro';
import { PeriodoCompacto } from '../componentes/PeriodoCompacto';
import { VisorZoom } from '../componentes/ZoomDual';
import { useNotificar } from '../componentes/Notificaciones';

/**
 * Historial completo: todos los pasos registrados (autorizados, no autorizados, lista negra,
 * pendientes, ingresos y salidas), consultados por fechas. Por omisión muestra el día de hoy.
 *
 * Cada visita es una fila: la salida que cerró un ingreso va en la fila de ese ingreso (las salidas
 * que no cerraron ninguno se ven aparte). Se busca por placa, nombres y apellidos (cada palabra en
 * cualquier orden, sin tildes) o cédula, y se filtra por estado y, en «Más filtros», por salida
 * registrada, movimiento, origen, cámara y franja horaria. Los totales de la consulta se leen arriba
 * y filtran con un toque. Pulsar una fila la abre en un panel
 * con su evidencia y los reportes del vehículo y de la persona. Se actualiza en tiempo real.
 * Registro de Salidas (/detecciones) conserva solo los registros completos con salida.
 *
 * Los filtros viven en la URL: los enlaces de otras pantallas llegan con ?placa= o ?camara=.
 */

const ESTADOS: Record<string, { etiqueta: string; estado?: string }> = {
  '': { etiqueta: 'Todos los estados' },
  autorizados: { etiqueta: 'Autorizados', estado: 'autorizado' },
  no_autorizados: { etiqueta: 'No autorizados', estado: 'no_reconocido,alerta' },
  alertas: { etiqueta: 'Lista negra', estado: 'alerta' },
  pendientes: { etiqueta: 'Pendientes de autorización', estado: 'pendiente_revision' },
};
const MOVIMIENTOS: Record<string, string> = { '': 'Ingresos y salidas', ingreso: 'Solo ingresos', salida: 'Solo salidas sin ingreso' };
const SALIDAS: Record<string, string> = { '': 'Con y sin salida', si: 'Con salida registrada', no: 'Sin salida (siguen dentro)' };
const ORIGENES: Record<string, string> = { '': 'Cámara y registro manual', camara: 'Solo cámara', manual: 'Solo registro manual' };
const TAMANO = 50;
const RE_HORA = /^\d{2}:\d{2}$/;

const vehiculo = (d: Deteccion) => [d.vehiculo?.tipo ?? d.tipo_vehiculo, [d.vehiculo?.marca, d.vehiculo?.modelo].filter(Boolean).join(' '), d.vehiculo?.color]
  .filter(Boolean).join(' · ');
const persona = (d: Deteccion) => d.persona_ingreso?.trim() || d.autorizado?.propietario?.trim() || '';

/** Panel lateral de la fila elegida: evidencia, datos y los reportes del vehículo y de la persona. */
const PanelRegistro: React.FC<{
  d: Deteccion; puedeReportes: boolean; onCerrar: () => void; onSoloPlaca: (placa: string) => void; onZoom: () => void;
  onEditar?: () => void; onEliminar?: () => void;
}> = ({ d, puedeReportes, onCerrar, onSoloPlaca, onZoom, onEditar, onEliminar }) => {
  const navigate = useNavigate();
  const cerrar = useRef<HTMLButtonElement>(null);
  useEffect(() => { cerrar.current?.focus(); }, [d.id]);
  const horas = horasDelMovimiento(d);
  const placa = normalizarPlaca(d.placa);
  const nombre = persona(d);
  const foto = urlMedia(d.imagen_vehiculo);
  const datos: [string, React.ReactNode][] = [
    ['Movimiento', d.tipo_movimiento === 'salida' ? 'Salida (cámara de salida)' : 'Ingreso'],
    ['Fecha', fecha(d.fecha_hora_ingreso)],
    ['Hora de entrada', horas.entrada ? hora(horas.entrada) : '—'],
    ['Hora de salida', horas.salida ? `${hora(horas.salida)}${d.salida_automatica ? ' · automática' : ''}` : '—'],
    ['Persona', nombre || '—'],
    ['Cédula', d.datos_permiso?.cedula || '—'],
    ['Vehículo', vehiculo(d) || '—'],
    ['Motivo', d.motivo_ingreso || '—'],
    ['Cámara', d.camara?.nombre ?? (d.fuente === 'manual' ? 'Registro manual' : '—')],
  ];
  return (
    <aside className="panel-registro" aria-label={`Registro ${placa ? formatearPlaca(placa) : 'sin lectura'}`}>
      <header className="panel-registro-cabecera">
        <div>
          <span className="texto-secundario">Registro N.º {d.id}</span>
          <h3 className={placa ? 'placa-titulo' : undefined}>{placa ? formatearPlaca(placa) : 'Sin lectura de placa'}</h3>
          <InsigniaEstado estado={d.estado_validacion} procesando={d.estado_procesamiento === 'pendiente_ocr'} />
        </div>
        <button ref={cerrar} type="button" className="btn btn-ghost btn-sm btn-icono" aria-label="Cerrar el panel" onClick={onCerrar}><X size={16} /></button>
      </header>
      <div className="panel-registro-fotos">
        {foto && <button type="button" className="panel-registro-foto" onClick={onZoom} aria-label="Ampliar la foto del vehículo">
          <img src={foto} alt={`Vehículo ${placa ? formatearPlaca(placa) : 'sin lectura'}`} loading="lazy" /></button>}
        <PlacaFoto d={d} alto={44} onClick={onZoom} />
      </div>
      <dl className="panel-registro-datos">
        {datos.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <div className="panel-registro-acciones">
        {onEditar && <button type="button" className="btn btn-secondary" onClick={onEditar}><Edit3 size={15} /> Editar registro</button>}
        {onEliminar && <button type="button" className="btn btn-danger" onClick={onEliminar}><Trash2 size={15} /> Eliminar registro</button>}
        {puedeReportes && placa && (
          <button type="button" className="btn btn-navy" onClick={() => navigate(`/reportes?vista=vehiculo&placa=${encodeURIComponent(placa)}`)}>
            <BarChart3 size={15} /> Reporte del vehículo</button>
        )}
        {puedeReportes && nombre && (
          <button type="button" className="btn btn-secondary" onClick={() => navigate(`/reportes?vista=persona&persona=${encodeURIComponent(nombre)}`)}>
            <UserRound size={15} /> Reporte de la persona</button>
        )}
        {placa && <button type="button" className="btn btn-secondary" onClick={() => onSoloPlaca(placa)}><ListFilter size={15} /> Ver todos sus pasos</button>}
        <button type="button" className="btn btn-ghost" onClick={() => navigate(`/monitoreo?registro=${d.id}`)}><ExternalLink size={15} /> Ver en monitoreo</button>
      </div>
    </aside>
  );
};

const HistorialCompleto: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const notificar = useNotificar();
  const { puede, user } = useAuth();
  const esAdmin = user?.rol === 'Admin' && puede('detecciones:gestionar');
  const puedeEliminar = puede('detecciones:eliminar-individual');
  const tieneAcciones = esAdmin || puedeEliminar;
  const puedeEliminarTodo = user?.rol === 'Admin' && puede('detecciones:eliminar');
  const hoy = fechaIsoLocal();
  const placa = params.get('placa') ?? '';
  const camara = params.get('camara') ?? '';
  const estado = ESTADOS[params.get('estado') ?? ''] ? params.get('estado') ?? '' : '';
  const movimiento = MOVIMIENTOS[params.get('movimiento') ?? ''] ? params.get('movimiento') ?? '' : '';
  const origen = ORIGENES[params.get('origen') ?? ''] ? params.get('origen') ?? '' : '';
  const cerrados = SALIDAS[params.get('cerrados') ?? ''] ? params.get('cerrados') ?? '' : '';
  const horaDesde = RE_HORA.test(params.get('hora_desde') ?? '') ? params.get('hora_desde')! : '';
  const horaHasta = RE_HORA.test(params.get('hora_hasta') ?? '') ? params.get('hora_hasta')! : '';
  // Sin fechas en la URL: el día de hoy, salvo que se llegue a consultar una placa, una cámara o «Todo»
  const porOmision = !placa && !camara && !params.get('buscar') && !params.has('todo');
  const desde = params.get('desde') ?? (porOmision ? hoy : '');
  const hasta = params.get('hasta') ?? (porOmision ? hoy : '');
  const pagina = Math.max(1, Number(params.get('pagina') ?? 1) || 1);
  const [texto, setTexto] = useState(() => params.get('buscar') ?? '');
  const buscar = useRetardado(texto.trim(), 400);
  const [zoom, setZoom] = useState<Deteccion | null>(null);
  const [exportando, setExportando] = useState(false);
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState<Deteccion | null>(null);
  const [eliminando, setEliminando] = useState<Deteccion | null>(null);
  const [eliminarTodos, setEliminarTodos] = useState(false);
  const [elegida, setElegida] = useState<Deteccion | null>(null);
  const [msConsulta, setMsConsulta] = useState<number | null>(null);
  // La cámara está en la fila principal; «Más filtros» cuenta los demás
  const masActivos = [cerrados, movimiento, origen, horaDesde || horaHasta].filter(Boolean).length;
  const [verMas, setVerMas] = useState(masActivos > 0);

  const cambiar = (cambios: Record<string, string | undefined>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(cambios)) { if (v) p.set(k, v); else p.delete(k); }
    if (!('pagina' in cambios)) p.delete('pagina');
    setParams(p, { replace: true });
  };
  useEffect(() => { if ((params.get('buscar') ?? '') !== buscar) cambiar({ buscar: buscar || undefined }); }, [buscar]); // eslint-disable-line react-hooks/exhaustive-deps

  const consulta = {
    desde: desde ? limiteDia(desde) : undefined, hasta: hasta ? limiteDia(hasta, true) : undefined,
    placa: placa || undefined, camara: camara || undefined, buscar: params.get('buscar') || undefined, estado: ESTADOS[estado].estado,
    movimiento: movimiento || undefined, origen: origen || undefined, hora_desde: horaDesde || undefined, hora_hasta: horaHasta || undefined,
    cerrados: cerrados || undefined,
    // Una visita, una fila: la salida que cerró un ingreso va en la fila de ese ingreso
    unir_salidas: 'si',
  };
  const clave = JSON.stringify(consulta);
  const { datos, cargando, error, recargar, setDatos } = useConsulta<Pagina<Deteccion>>(() => {
    const t0 = performance.now();
    return api.get('/detecciones', { params: { ...consulta, pagina, tamano: TAMANO } })
      .then(r => { setMsConsulta(Math.round(performance.now() - t0)); return r.data; });
  }, [clave, pagina]);
  const resumen = useConsulta<ResumenHistorial>(() => api.get('/detecciones/historial/resumen', { params: consulta }).then(r => r.data), [clave]);
  const { datos: camaras } = useConsulta<Camara[]>(() => api.get('/camaras').then(r => r.data), []);

  // En vivo: un paso nuevo o actualizado recarga la página actual y los totales sin mover la tabla
  const recargarDiferido = useDiferido(() => { void recargar(true); void resumen.recargar(true); }, 1500);
  useEvento('deteccion:nueva', recargarDiferido);
  useEvento('deteccion:actualizada', recargarDiferido);
  useEvento<{ id: number }>('deteccion:eliminada', ({ id }) => {
    setElegida(actual => actual?.id === id ? null : actual);
    recargarDiferido();
  });
  useEvento('deteccion:eliminadas', () => { setElegida(null); recargarDiferido(); });
  useReconexion(recargarDiferido);

  // La fila elegida se mantiene al día con la página recargada; Escape cierra el panel
  useEffect(() => { if (elegida && datos) setElegida(datos.items.find(d => d.id === elegida.id) ?? elegida); }, [datos]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!elegida) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape' && !zoom && !editando && !eliminando && !creando && !eliminarTodos) setElegida(null); };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [elegida, zoom, editando, eliminando, creando, eliminarTodos]);

  const recargarHistorial = () => { void recargar(true); void resumen.recargar(true); };
  const alEditar = (actualizada: Deteccion) => {
    setDatos(actual => actual && { ...actual, items: actual.items.map(d => d.id === actualizada.id ? actualizada : d) });
    setElegida(actual => actual?.id === actualizada.id ? actualizada : actual);
    recargarHistorial();
  };
  const alEliminar = (id: number) => {
    setElegida(actual => actual?.id === id ? null : actual);
    setDatos(actual => actual && { ...actual, items: actual.items.filter(d => d.id !== id), total: Math.max(0, actual.total - (actual.items.some(d => d.id === id) ? 1 : 0)) });
    if (pagina > 1 && datos?.items.length === 1) cambiar({ pagina: String(pagina - 1) });
    else void recargar(true);
    void resumen.recargar(true);
  };
  const alEliminarTodos = () => {
    setElegida(null); setZoom(null); setEditando(null); setEliminando(null);
    setDatos(actual => actual && { ...actual, items: [], total: 0 });
    if (pagina > 1) cambiar({ pagina: undefined });
    else void recargar(true);
    void resumen.recargar(true);
  };

  const exportar = async () => {
    setExportando(true);
    try {
      const r = await api.get('/detecciones/exportar', { params: consulta, responseType: 'blob' });
      descargarBlob(r.data, nombreDescarga(r.headers['content-disposition'], 'historial_anpr.csv'));
    } catch (e) {
      notificar('error', 'No se pudo exportar', mensajeError(e));
    } finally { setExportando(false); }
  };

  const limpiar = () => {
    setTexto('');
    cambiar({ placa: undefined, camara: undefined, estado: undefined, movimiento: undefined, origen: undefined, cerrados: undefined,
      hora_desde: undefined, hora_hasta: undefined, buscar: undefined });
  };

  const periodo = !desde && !hasta ? 'todo el historial' : desde === hasta ? `el ${fecha(`${desde}T12:00:00-05:00`)}`
    : `del ${desde ? fecha(`${desde}T12:00:00-05:00`) : 'inicio'} al ${hasta ? fecha(`${hasta}T12:00:00-05:00`) : 'día de hoy'}`;
  const nombreCamara = camara ? camaras?.find(c => String(c.id) === camara)?.nombre ?? `#${camara}` : '';
  const hayFiltros = Boolean(placa || camara || estado || movimiento || origen || cerrados || horaDesde || horaHasta || params.get('buscar'));

  // Reportes directos de lo buscado: una placa completa o un nombre (dos palabras o más, sin números)
  const buscado = params.get('buscar') ?? '';
  const placaReporte = (() => { const v = validarPlaca(buscado || placa); return v.ok ? v.valor.placa : ''; })();
  const nombreReporte = !placaReporte && /^[\p{L}'. -]+$/u.test(buscado) && buscado.trim().split(/\s+/).length >= 2 ? buscado.trim() : '';
  const puedeReportes = puede('reportes:ver');

  const r = resumen.datos;
  const indicador = (etiqueta: string, valor: number | undefined, filtro?: Record<string, string | undefined>, activo?: boolean, tono?: string) => {
    const cuerpo = <>
      <span className="indicador-etiqueta">{tono && <i className={`indicador-punto ${tono}`} aria-hidden="true" />}{etiqueta}</span>
      <strong>{valor === undefined ? '—' : numero(valor)}</strong>
    </>;
    return filtro
      ? <button key={etiqueta} type="button" className="indicador" aria-pressed={Boolean(activo)}
        onClick={() => cambiar(activo ? Object.fromEntries(Object.keys(filtro).map(k => [k, undefined])) : filtro)}>{cuerpo}</button>
      : <div key={etiqueta} className="indicador">{cuerpo}</div>;
  };

  return (
    <div className="pagina historial">
      <header className="historial-encabezado">
        <div>
          <h2>Historial completo</h2>
          <p className="historial-meta">
            <span>{datos ? `${numero(datos.total)} ${datos.total === 1 ? 'registro' : 'registros'}` : 'Cargando registros…'}</span>
            <span>{periodo.charAt(0).toUpperCase() + periodo.slice(1)}</span>
            {msConsulta !== null && <span>Consulta en {msConsulta < 1000 ? `${numero(msConsulta)} ms` : `${(msConsulta / 1000).toLocaleString('es-EC', { maximumFractionDigits: 1 })} s`}</span>}
            <span className="historial-vivo"><i aria-hidden="true" />En vivo</span>
          </p>
        </div>
        <div className="fila">
          {esAdmin && <button type="button" className="btn btn-exito" onClick={() => setCreando(true)}><Plus size={15} /> Crear registro</button>}
          <Link to="/detecciones" className="btn btn-secondary"><LogOut size={15} /> Registro de Salidas</Link>
          <button className="btn btn-navy" onClick={exportar} disabled={exportando || !datos?.total}><Download size={15} /> {exportando ? 'Exportando…' : 'Exportar CSV'}</button>
          {puedeEliminarTodo && <button type="button" className="btn btn-danger" onClick={() => setEliminarTodos(true)}><Trash2 size={15} /> Eliminar todos</button>}
        </div>
      </header>

      <div className="pila">
        <Tarjeta className="historial-filtros-tarjeta">
          <div className="historial-filtros">
            <div className="campo historial-buscar">
              <label htmlFor="h-buscar">Buscar</label>
              <div className="input-icono"><Search size={15} />
                <input id="h-buscar" className="input" value={texto} onChange={e => setTexto(e.target.value)} maxLength={100}
                  placeholder="Placa, nombres y apellidos o cédula" autoComplete="off" aria-describedby="h-buscar-ayuda"
                  title="Cada palabra, en cualquier orden y sin tildes: «perez maria» encuentra a «María José Pérez López»" />
                {texto && <button type="button" className="input-limpiar" aria-label="Borrar la búsqueda" onClick={() => setTexto('')}><X size={14} /></button>}
              </div>
              <span id="h-buscar-ayuda" className="solo-lectores">Cada palabra, en cualquier orden y sin tildes: «perez maria» encuentra a «María José Pérez López».</span>
            </div>
            <PeriodoCompacto id="h" desde={desde} hasta={hasta} todo
              onCambiar={(d, h) => cambiar({ desde: d || undefined, hasta: h || undefined, todo: !d && !h ? '1' : undefined })} />
            <div className="campo">
              <label htmlFor="h-camara">Cámara</label>
              <select id="h-camara" className="select" value={camara} onChange={e => cambiar({ camara: e.target.value || undefined })}>
                <option value="">Todas</option>
                {camaras?.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                {camara && !camaras?.some(c => String(c.id) === camara) && <option value={camara}>{nombreCamara}</option>}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="h-estado">Estado</label>
              <select id="h-estado" className="select" value={estado} onChange={e => cambiar({ estado: e.target.value || undefined })}>
                {Object.entries(ESTADOS).map(([v, e]) => <option key={v} value={v}>{v ? e.etiqueta : 'Todos'}</option>)}
              </select>
            </div>
            <button type="button" className={`btn btn-secondary historial-mas${masActivos ? ' con-filtros' : ''}`} aria-expanded={verMas} aria-controls="h-mas-filtros" onClick={() => setVerMas(v => !v)}>
              <SlidersHorizontal size={15} /> Más filtros{masActivos ? ` (${masActivos})` : ''}
            </button>
          </div>
          {verMas && (
            <div id="h-mas-filtros" className="historial-filtros filtros-extra">
              <div className="campo">
                <label htmlFor="h-salida">Salida registrada</label>
                <select id="h-salida" className="select" value={cerrados} onChange={e => cambiar({ cerrados: e.target.value || undefined })}>
                  {Object.entries(SALIDAS).map(([v, e]) => <option key={v} value={v}>{e}</option>)}
                </select>
              </div>
              <div className="campo">
                <label htmlFor="h-movimiento">Movimiento</label>
                <select id="h-movimiento" className="select" value={movimiento} onChange={e => cambiar({ movimiento: e.target.value || undefined })}>
                  {Object.entries(MOVIMIENTOS).map(([v, e]) => <option key={v} value={v}>{e}</option>)}
                </select>
              </div>
              <div className="campo">
                <label htmlFor="h-origen">Origen</label>
                <select id="h-origen" className="select" value={origen} onChange={e => cambiar({ origen: e.target.value || undefined })}>
                  {Object.entries(ORIGENES).map(([v, e]) => <option key={v} value={v}>{e}</option>)}
                </select>
              </div>
              <div className="campo campo-hora">
                <label htmlFor="h-hora-desde">Desde la hora</label>
                <input id="h-hora-desde" type="time" className="input" value={horaDesde} onChange={e => cambiar({ hora_desde: e.target.value || undefined })} />
              </div>
              <div className="campo campo-hora">
                <label htmlFor="h-hora-hasta">Hasta la hora</label>
                <input id="h-hora-hasta" type="time" className="input" value={horaHasta} onChange={e => cambiar({ hora_hasta: e.target.value || undefined })} />
              </div>
            </div>
          )}
          {(hayFiltros || (puedeReportes && (placaReporte || nombreReporte))) && (
            <div className="fila filtros-activos">
              {placa && <span className="chip-filtro">Placa {formatearPlaca(placa)}
                <button type="button" aria-label="Quitar el filtro de placa" onClick={() => cambiar({ placa: undefined })}><X size={12} /></button></span>}
              {camara && <span className="chip-filtro">Cámara {nombreCamara}
                <button type="button" aria-label="Quitar el filtro de cámara" onClick={() => cambiar({ camara: undefined })}><X size={12} /></button></span>}
              {estado && <span className="chip-filtro">{ESTADOS[estado].etiqueta}
                <button type="button" aria-label="Quitar el filtro de estado" onClick={() => cambiar({ estado: undefined })}><X size={12} /></button></span>}
              {cerrados && <span className="chip-filtro">{SALIDAS[cerrados]}
                <button type="button" aria-label="Quitar el filtro de salida" onClick={() => cambiar({ cerrados: undefined })}><X size={12} /></button></span>}
              {movimiento && <span className="chip-filtro">{MOVIMIENTOS[movimiento]}
                <button type="button" aria-label="Quitar el filtro de movimiento" onClick={() => cambiar({ movimiento: undefined })}><X size={12} /></button></span>}
              {origen && <span className="chip-filtro">{ORIGENES[origen]}
                <button type="button" aria-label="Quitar el filtro de origen" onClick={() => cambiar({ origen: undefined })}><X size={12} /></button></span>}
              {(horaDesde || horaHasta) && <span className="chip-filtro">De {horaDesde || '00:00'} a {horaHasta || '23:59'}
                <button type="button" aria-label="Quitar la franja horaria" onClick={() => cambiar({ hora_desde: undefined, hora_hasta: undefined })}><X size={12} /></button></span>}
              {hayFiltros && <button type="button" className="btn btn-ghost btn-sm" onClick={limpiar}>Limpiar filtros</button>}
              {puedeReportes && placaReporte && (
                <button type="button" className="btn btn-sm btn-secondary acceso-reporte" onClick={() => navigate(`/reportes?vista=vehiculo&placa=${placaReporte}`)}>
                  <BarChart3 size={14} /> Reporte del vehículo {formatearPlaca(placaReporte)}</button>
              )}
              {puedeReportes && nombreReporte && (
                <button type="button" className="btn btn-sm btn-secondary acceso-reporte" onClick={() => navigate(`/reportes?vista=persona&persona=${encodeURIComponent(nombreReporte)}`)}>
                  <UserRound size={14} /> Reporte de «{nombreReporte}»</button>
              )}
            </div>
          )}
        </Tarjeta>

        {error && <Aviso tipo="error">{error}</Aviso>}

        <section className="indicadores" aria-label="Totales de la consulta" role="group">
          <div className="indicadores-grupo">
            {indicador('Registros', r?.total)}
            {indicador('Ingresos', r?.ingresos, { movimiento: 'ingreso' }, movimiento === 'ingreso')}
            {indicador('Con salida', r?.con_salida, { cerrados: 'si' }, cerrados === 'si')}
            {indicador('Siguen dentro', r ? Math.max(0, r.ingresos - r.con_salida) : undefined, { cerrados: 'no' }, cerrados === 'no')}
            {indicador('Salidas sin ingreso', r?.salidas, { movimiento: 'salida' }, movimiento === 'salida')}
          </div>
          <div className="indicadores-grupo">
            {indicador('Autorizados', r?.autorizados, { estado: 'autorizados' }, estado === 'autorizados', 'autorizado')}
            {indicador('No autorizados', r ? r.no_registrados + r.alertas : undefined, { estado: 'no_autorizados' }, estado === 'no_autorizados', 'no-registrado')}
            {indicador('Lista negra', r?.alertas, { estado: 'alertas' }, estado === 'alertas', 'alerta')}
            {indicador('Pendientes', r?.pendientes, { estado: 'pendientes' }, estado === 'pendientes', 'pendiente')}
            {indicador('Vehículos', r?.placas)}
          </div>
        </section>

        <section className="tarjeta historial-tabla-tarjeta">
          <div className="tabla-contenedor" role="region" aria-label="Tabla del historial completo" tabIndex={0}>
            <table className="tabla tabla-historial">
              <thead><tr>
                <th className="col-imagen">Imagen</th><th>Placa</th><th>Fecha y hora</th><th>Persona</th><th>Vehículo</th><th>Cámara</th>
                <th>Confianza</th><th>Estado</th>{tieneAcciones && <th>Acciones</th>}
              </tr></thead>
              <tbody>
                {cargando && !datos ? <FilasEsqueleto columnas={tieneAcciones ? 9 : 8} /> : datos?.items.map(d => {
                  const horas = horasDelMovimiento(d);
                  const esElegida = elegida?.id === d.id;
                  const acceso = estadoAcceso(d);
                  const foto = urlMedia(d.imagen_vehiculo) ?? urlMedia(recortePlaca(d));
                  const nombre = persona(d);
                  const marcaModelo = [d.vehiculo?.marca, d.vehiculo?.modelo].filter(Boolean).join(' ');
                  return (
                    <tr key={d.id} className={`clic acento-${acceso}${esElegida ? ' fila-elegida' : ''}`} tabIndex={0} aria-selected={esElegida}
                      title="Ver la evidencia y los reportes (doble clic: abrir en monitoreo)"
                      onClick={() => setElegida(d)} onDoubleClick={() => navigate(`/monitoreo?registro=${d.id}`)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setElegida(d); } }}>
                      <td className="col-imagen" onClick={e => e.stopPropagation()}>
                        {foto
                          ? <button type="button" className="historial-foto" onClick={() => setZoom(d)} aria-label={`Ampliar fotos de ${d.placa ? formatearPlaca(d.placa) : 'vehículo sin lectura'}`}>
                            <img src={foto} alt="" loading="lazy" decoding="async" /></button>
                          : <span className="historial-foto vacia" title="Sin foto"><ImageOff size={16} /></span>}
                      </td>
                      <td className="nowrap">
                        {d.placa ? <span className="historial-placa">{formatearPlaca(d.placa)}</span>
                          : <span className={acceso === 'sin_lectura' ? 'historial-sin-lectura' : 'texto-secundario'}>{d.sin_placa ? 'Sin placa' : 'Sin lectura'}</span>}
                        {acceso === 'alerta' && <span className="marca-estado alerta">ALERTA</span>}
                      </td>
                      <td className="nowrap">
                        <span className="historial-fecha">{fecha(d.fecha_hora_ingreso)}</span>
                        <span className="historial-horas">
                          {horas.entrada && <span><ArrowDownRight size={12} aria-hidden="true" /> Entrada {hora(horas.entrada)}</span>}
                          {horas.salida && <span className="salida"><ArrowUpRight size={12} aria-hidden="true" /> Salida {hora(horas.salida)}</span>}
                        </span>
                      </td>
                      <td>{nombre ? <><span className="historial-principal">{nombre}</span>{d.datos_permiso?.cedula && <span className="historial-secundario">C.I. {d.datos_permiso.cedula}</span>}</>
                        : <span className="texto-secundario">—</span>}</td>
                      <td>{vehiculo(d) ? <><span className="historial-principal">{d.vehiculo?.tipo ?? d.tipo_vehiculo ?? 'Vehículo'}</span>
                        {(marcaModelo || d.vehiculo?.color) && <span className="historial-secundario">{[marcaModelo, d.vehiculo?.color].filter(Boolean).join(' · ')}</span>}</>
                        : <span className="texto-secundario">—</span>}</td>
                      <td>{d.camara ? <><span className="historial-principal">{d.camara.nombre}</span><span className="historial-secundario">{d.camara.ubicacion}</span></>
                        : <span className="texto-secundario">{d.fuente === 'manual' ? 'Registro manual' : '—'}</span>}</td>
                      <td className="nowrap"><ConfianzaRegistro valor={d.confianza_ocr} /></td>
                      <td className="nowrap"><InsigniaEstado estado={d.estado_validacion} procesando={d.estado_procesamiento === 'pendiente_ocr'} corta /></td>
                      {tieneAcciones && <td className="nowrap" onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                        <div className="fila" style={{ gap: 4 }}>
                          {esAdmin && <button type="button" className="btn btn-ghost btn-sm btn-icono" aria-label={`Editar registro ${d.id}`} title="Editar registro" onClick={() => setEditando(d)}><Edit3 size={15} /></button>}
                          {puedeEliminar && <button type="button" className="btn btn-ghost btn-sm btn-icono" aria-label={`Eliminar registro ${d.id}`} title="Eliminar registro" onClick={() => setEliminando(d)}><Trash2 size={15} color="var(--alerta)" /></button>}
                        </div>
                      </td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {datos && datos.items.length === 0 && (
            <Vacio titulo="Sin registros" icono={<CarFront size={22} />}
              texto={`No hay movimientos ${periodo === 'todo el historial' ? 'registrados' : `de ${periodo}`} con los filtros elegidos. Pruebe con otro período o «Todo el historial».`}
              accion={hayFiltros ? <button type="button" className="btn btn-secondary btn-sm" onClick={limpiar}>Limpiar filtros</button> : undefined} />
          )}
          {datos && datos.total > 0 && <Paginacion pagina={datos.pagina} tamano={datos.tamano} total={datos.total} onCambiar={p => cambiar({ pagina: String(p) })} />}
        </section>
      </div>
      {elegida && <PanelRegistro d={elegida} puedeReportes={puedeReportes} onCerrar={() => setElegida(null)} onZoom={() => setZoom(elegida)}
        onEditar={esAdmin ? () => setEditando(elegida) : undefined} onEliminar={puedeEliminar ? () => setEliminando(elegida) : undefined}
        onSoloPlaca={p => { setTexto(''); setElegida(null); cambiar({ placa: p, buscar: undefined, desde: undefined, hasta: undefined, todo: '1' }); }} />}
      {esAdmin && creando && <RegistroManualModal onCerrar={() => setCreando(false)} onRegistrada={recargarHistorial} />}
      {esAdmin && editando && <EditarRegistroHistorial key={editando.id} d={editando} onCerrar={() => setEditando(null)} onGuardado={alEditar} />}
      {puedeEliminar && eliminando && <EliminarUno d={eliminando} onCerrar={() => setEliminando(null)} onEliminada={alEliminar} />}
      {puedeEliminarTodo && eliminarTodos && <EliminarVarios todos
        descripcion="Todo el historial, de todas las fechas y cámaras. Los filtros actuales no se aplican."
        onCerrar={() => setEliminarTodos(false)} onHecho={alEliminarTodos} />}
      {zoom && <VisorZoom d={zoom} onCerrar={() => setZoom(null)} />}
    </div>
  );
};

export default HistorialCompleto;
