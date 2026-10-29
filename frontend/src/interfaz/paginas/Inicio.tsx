import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowRight, Camera, CarFront, CheckCircle2, ClipboardPlus, Clock, History, LogOut, MonitorPlay, ShieldAlert, ShieldCheck,
  TrendingDown, TrendingUp,
} from 'lucide-react';
import api from '../../infraestructura/api';
import { useAuth } from '../../aplicacion/AuthContext';
import { useEvento, useReconexion } from '../../aplicacion/tiempoReal';
import { useConsulta, useDiferido, usePaginaVisible } from '../../aplicacion/hooks';
import type { Deteccion, ResumenPanel } from '../../dominio/tipos';
import { diaCorto, fecha, hora, numero, relativo, SERIES_ESTADO } from '../../dominio/formato';
import { ESTADOS_ACCESO, estadoAcceso } from '../../dominio/estadoAcceso';
import { Aviso, Cargando, FilasEsqueleto, InsigniaEstado, Kpi, Tarjeta, Vacio } from '../componentes/ui';
import { BarrasApiladas, BarrasHorizontales, Dona, Leyenda } from '../componentes/Graficos';
import { PlacaFoto, RegistroManualModal, TarjetaDeteccion, ValidarModal } from '../componentes/deteccion';
import { CeldaIngreso, actualizarCampoIngreso, type CampoIngreso } from '../componentes/CeldaIngreso';
import { ConfianzaRegistro } from '../componentes/ConfianzaRegistro';
import { VisorZoom } from '../componentes/ZoomDual';
import GestionPermisos from './GestionPermisos';
import { useCentroNotificaciones } from '../../aplicacion/notificaciones';
import { ItemNotificacion } from '../componentes/CentroNotificaciones';

function saludo(): string {
  const h = Number(new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', hour: 'numeric', hour12: false }).format(new Date()));
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

/** Recarga el resumen cuando llegan eventos (agrupados cada 5 s) y al volver a la pestaña. */
function useResumen() {
  const consulta = useConsulta<ResumenPanel>(() => api.get('/panel/resumen').then(r => r.data), []);
  const visible = usePaginaVisible();
  const [pendiente, setPendiente] = useState(false);
  const recargar = useDiferido(() => {
    if (document.visibilityState === 'visible') consulta.recargar(true);
    else setPendiente(true);
  }, 5000);
  useEffect(() => { if (visible && pendiente) { setPendiente(false); consulta.recargar(true); } }, [visible, pendiente]); // eslint-disable-line react-hooks/exhaustive-deps
  useEvento('deteccion:nueva', recargar);
  useEvento('deteccion:actualizada', () => {
    recargar();
    void consulta.recargar(true);
  });
  useEvento('deteccion:alerta', recargar);
  useEvento('deteccion:eliminada', recargar);
  useEvento('deteccion:eliminadas', recargar);
  useReconexion(recargar);
  useEvento('camara:estado', recargar);
  useEvento('camara:actualizada', recargar);
  useEvento('listas:actualizadas', recargar);
  return consulta;
}

const Variacion: React.FC<{ hoy: number; ayer: number }> = ({ hoy, ayer }) => {
  if (!ayer) return <span>{hoy ? 'Sin registros ayer a esta hora' : 'Sin actividad todavía'}</span>;
  const d = Math.round(((hoy - ayer) / ayer) * 100);
  return d === 0 ? <span>Igual que ayer a esta hora</span> : (
    <span className={d > 0 ? 'sube' : 'baja'} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      {d > 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{Math.abs(d)} % vs. ayer a esta hora
    </span>
  );
};

/* ─────────────── Panel operativo (todos los roles) ─────────────── */

const KpisDelDia: React.FC<{ r: ResumenPanel | null; cargando: boolean }> = ({ r, cargando }) => {
  const navigate = useNavigate();
  const hoy = r?.hoy;
  return (
    <div className="grid-kpi">
      <Kpi etiqueta="Ingresos hoy" valor={numero(hoy?.total)} icono={<CarFront size={17} />} cargando={cargando}
        pie={r && <Variacion hoy={r.hoy.total} ayer={r.ayer_misma_hora} />} onClick={() => navigate('/monitoreo')} />
      <Kpi etiqueta="Autorizados" valor={numero(hoy?.autorizados)} icono={<ShieldCheck size={17} />} color="var(--autorizado)" fondo="var(--autorizado-bg)" cargando={cargando}
        pie={hoy && hoy.total > 0 ? `${Math.round((hoy.autorizados / hoy.total) * 100)} % del total` : 'Padrón institucional'}
        onClick={() => navigate('/monitoreo?estado=autorizado')} />
      <Kpi etiqueta="Por autorizar" valor={numero(r?.cola_revision)} icono={<Clock size={17} />} color="var(--pendiente)" fondo="var(--pendiente-bg)" cargando={cargando}
        pie="Lecturas dudosas o sin lectura" onClick={() => navigate('/monitoreo?estado=pendiente_revision&validado=no')} />
      <Kpi etiqueta="No registrados" valor={numero(hoy?.no_registrados)} icono={<AlertTriangle size={17} />} color="var(--no-registrado)" fondo="var(--no-registrado-bg)" cargando={cargando}
        pie="Fuera del padrón y sin alerta" onClick={() => navigate('/monitoreo?estado=no_reconocido')} />
      <Kpi etiqueta="Alertas hoy" valor={numero(hoy?.alertas)} icono={<ShieldAlert size={17} />} color="var(--alerta)" fondo="var(--alerta-bg)" cargando={cargando}
        pie={`${numero(r?.listas.alertas_vigentes)} placas en la lista`} onClick={() => navigate('/monitoreo?estado=alerta&hoy=1')} />
    </div>
  );
};

const GraficoPorHora: React.FC<{ r: ResumenPanel; detecciones?: boolean }> = ({ r, detecciones = false }) => {
  const horaActual = Number(new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', hour: 'numeric', hour12: false }).format(new Date()));
  return (
    <Tarjeta titulo={detecciones ? 'Detecciones por hora' : 'Ingresos por hora'} subtitulo={detecciones ? 'Lecturas de cámara de hoy, incluidas las pendientes y denegadas' : 'Hoy, por estado de la decisión'} acciones={<Leyenda series={SERIES_ESTADO} />}>
      {r.hoy.total === 0
        ? <Vacio titulo={detecciones ? 'Sin detecciones hoy' : 'Sin ingresos hoy'} texto="El gráfico se completa a medida que el sistema registra pasos vehiculares." icono={<Activity size={22} />} />
        : <BarrasApiladas datos={r.por_hora} series={SERIES_ESTADO} etiquetaX={d => String(d.hora).padStart(2, '0')}
            tituloTip={d => `${String(d.hora).padStart(2, '0')}:00 – ${String(d.hora).padStart(2, '0')}:59`} cadaEtiqueta={2} resaltar={horaActual} />}
    </Tarjeta>
  );
};

const EstadoCamaras: React.FC<{ r: ResumenPanel }> = ({ r }) => (
  <Tarjeta titulo="Cámaras" subtitulo="Conectividad del puerto RTSP" sinPadding>
    {r.camaras.length === 0 ? <Vacio titulo="No hay cámaras registradas" texto="El administrador registra los canales en Operación › Registro de cámaras." icono={<Camera size={22} />} /> : (
      <div className="tabla-contenedor"><table className="tabla"><tbody>
        {r.camaras.map(c => {
          const e = !c.activa ? { p: 'gris', t: 'Deshabilitada' } : c.estado === 'EN_LINEA' ? { p: 'verde', t: 'En línea' } : c.estado === 'SIN_CONEXION' ? { p: 'rojo', t: 'Sin conexión' } : { p: 'gris', t: 'Sin verificar' };
          return (
            <tr key={c.id}>
              <td><strong style={{ color: 'var(--text)' }}>{c.nombre}</strong><span className="secundario">{c.ubicacion}</span></td>
              <td><span className="fila" style={{ gap: 6 }}><span className={`punto ${e.p}`} />{e.t}</span>
                <span className="secundario">{c.ultimo_ping ? `Verificada ${relativo(c.ultimo_ping)}` : 'Nunca verificada'}</span></td>
              <td className="num"><strong style={{ color: 'var(--text)' }}>{numero(c.detecciones_hoy)}</strong><span className="secundario">hoy</span></td>
            </tr>
          );
        })}
      </tbody></table></div>
    )}
  </Tarjeta>
);

const UltimasAlertas: React.FC<{ r: ResumenPanel | null }> = ({ r }) => {
  const { items, cargando } = useCentroNotificaciones();
  const avisos = [...items].sort((a, b) => new Date(b.fecha_ultima).getTime() - new Date(a.fecha_ultima).getTime()).slice(0, 5);
  return <Tarjeta titulo="Últimas alertas" subtitulo="Avisos y notificaciones de su cuenta, en tiempo real"
    acciones={<Link to="/notificaciones" className="btn btn-ghost btn-sm">Ver todas <ArrowRight size={14} /></Link>} sinPadding>
    {cargando && !avisos.length ? <Cargando /> : avisos.length > 0
      ? <div className="guardia-avisos">{avisos.map(n => <ItemNotificacion key={n.id} n={n} />)}</div>
      : r && r.ultimas_alertas.length > 0
        ? <div className="pila" style={{ gap: 8, padding: 12 }}>{r.ultimas_alertas.map(d => <TarjetaDeteccion key={d.id} d={d} />)}</div>
        : <Vacio titulo="Sin alertas registradas" texto="Los avisos recibidos aparecerán aquí automáticamente." icono={<ShieldCheck size={22} />} />}
  </Tarjeta>;
};

const RelojGuardia: React.FC = () => {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => { const id = window.setInterval(() => setAhora(new Date()), 1000); return () => window.clearInterval(id); }, []);
  return <div className="guardia-reloj">
    <time dateTime={ahora.toISOString()}>{new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(ahora)}</time>
    <span>{new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(ahora)}</span>
  </div>;
};

/**
 * Balance del turno sobre los ingresos de hoy (todos los estados, como «Todos los accesos»):
 * las entradas son los que aún no registran salida y bajan cuando el guardia la registra; las
 * salidas suben. Entradas + salidas = ingresos de hoy.
 */
const BalanceGuardia: React.FC<{ ingresos: number; entradas: number; salidas: number }> = ({ ingresos, entradas, salidas }) => {
  const total = ingresos || entradas + salidas;
  return <div className="guardia-balance">{[
    { titulo: 'Entradas de hoy', valor: entradas, color: '#16a66a', clase: 'entrada' },
    { titulo: 'Salidas de hoy', valor: salidas, color: '#e35454', clase: 'salida' },
  ].map(x => {
    const porcentaje = total ? Math.round(x.valor / total * 100) : 0;
    return <section key={x.clase} className={`guardia-balance-item ${x.clase}`}>
      <h3>{x.titulo}</h3>
      <div className="guardia-anillo" role="img" aria-label={`${x.titulo}: ${x.valor}, ${porcentaje} % de los ingresos de hoy`}
        style={{ background: `conic-gradient(${x.color} ${porcentaje}%, var(--surface-3) 0)` }}>
        <div><strong>{numero(x.valor)}</strong><span>{porcentaje} % de los ingresos</span></div>
      </div>
      <span className="texto-secundario">{x.clase === 'entrada' ? 'Ingresaron hoy y aún no registran salida' : 'Ingresaron hoy y ya registraron su salida'}</span>
    </section>;
  })}<div className="guardia-balance-total">Ingresos de hoy <strong>{numero(total)}</strong> = {numero(entradas)} entradas + {numero(salidas)} salidas · al registrar una salida, la entrada pasa a salidas.</div></div>;
};

/** Panel del guardia: su turno, la cola de validación y accesos directos. */
const PanelOperador: React.FC = () => {
  const { user } = useAuth();
  const { datos: r, cargando, error } = useResumen();
  const cola = useConsulta<{ items: Deteccion[]; total: number }>(
    () => api.get('/detecciones', { params: { estado: 'pendiente_revision', validado: 'no', tamano: 6 } }).then(x => x.data), []);
  const recargarCola = useDiferido(() => cola.recargar(true), 1500);
  useEvento('deteccion:actualizada', recargarCola);
  useEvento('deteccion:nueva', recargarCola);
  const [validando, setValidando] = useState<Deteccion | null>(null);
  const [manual, setManual] = useState(false);

  return (
    <div className="pagina dashboard-guardia">
      <div className="encabezado-pagina">
        <div>
          <h2>Control de garita</h2>
          <p>{saludo()}, {user?.nombre.split(' ')[0]} · su panel de operación</p>
        </div>
        <div className="fila">
          <Link to="/monitoreo" className="btn btn-primary"><MonitorPlay size={16} /> Abrir Gestión de Accesos</Link>
        </div>
      </div>
      {error && <Aviso tipo="error" style={{ marginBottom: 16 }}>{error}</Aviso>}
      <div className="pila">
        <section className="guardia-control">
          <RelojGuardia />
          <div className="guardia-acciones">
            <button className="btn guardia-entrada" onClick={() => setManual(true)}><ClipboardPlus size={17} /> Registrar entrada</button>
            <Link className="btn guardia-salida" to="/monitoreo"><ArrowRight size={17} /> Registrar salida</Link>
          </div>
          <p className="guardia-indicacion">Para registrar una salida, seleccione el vehículo en Movimientos recientes.</p>
          <div className="guardia-dentro"><span>Ingresos de hoy</span><strong>{cargando && !r ? '…' : numero(r?.movimientos?.ingresos)}</strong>
            <small>Todos los ingresos de hoy (autorizados, pendientes y denegados) · total histórico de «Todos los accesos»: {cargando && !r ? '…' : numero(r?.movimientos?.registros_acceso)}.</small></div>
          <div className="fila" style={{ gap: 8 }}>
            <Link to="/detecciones" className="btn btn-secondary btn-sm"><LogOut size={14} /> Registro de Salidas: {cargando && !r ? '…' : numero(r?.movimientos?.registros_completos)}</Link>
            <Link to="/historial" className="btn btn-secondary btn-sm"><History size={14} /> Historial completo</Link>
          </div>
          <small className="texto-secundario">Registro de Salidas: registros completos con nombre, placa, tipo, marca, motivo y salida. Historial completo: todos los pasos.</small>
        </section>
        {r?.movimientos && <BalanceGuardia ingresos={r.movimientos.ingresos ?? 0} entradas={r.movimientos.entradas} salidas={r.movimientos.salidas} />}
        <div className="grid-principal">
          <Tarjeta titulo="Pendientes de autorización" subtitulo="Pasos sin lectura confiable: confirme la placa con la evidencia"
            acciones={<Link to="/monitoreo" className="btn btn-ghost btn-sm">Ver todos ({numero(cola.datos?.total)}) <ArrowRight size={14} /></Link>} sinPadding>
            {cola.cargando ? <Cargando /> : !cola.datos?.items.length
              ? <Vacio titulo="Nada pendiente" texto="Todas las lecturas están confirmadas." icono={<CheckCircle2 size={22} />} />
              : <div className="grid-2" style={{ padding: 12, gap: 8 }}>{cola.datos.items.map(d => <TarjetaDeteccion key={d.id} d={d} onValidar={setValidando} />)}</div>}
          </Tarjeta>
          <UltimasAlertas r={r} />
        </div>
        {r && <div className="grid-principal"><GraficoPorHora r={r} detecciones /><EstadoCamaras r={r} /></div>}
      </div>
      {validando && <ValidarModal d={validando} onCerrar={() => setValidando(null)} onValidada={() => cola.recargar(true)} />}
      {manual && <RegistroManualModal onCerrar={() => setManual(false)} />}
    </div>
  );
};

/* ─────────────── Panel de gestión (permiso alertas:gestionar: Administrador) ─────────────── */

/** Dona: cómo se repartieron los ingresos de hoy entre los estados de la decisión. */
const DistribucionHoy: React.FC<{ r: ResumenPanel }> = ({ r }) => (
  <Tarjeta titulo="Distribución de ingresos" subtitulo={`Hoy · ${numero(r.hoy.total)} ingresos, ${numero(r.hoy.validados)} confirmados por el personal`}>
    {r.hoy.total === 0
      ? <Vacio titulo="Sin ingresos hoy" texto="La distribución aparece con el primer paso registrado." icono={<Activity size={22} />} />
      : <Dona valores={r.hoy} series={SERIES_ESTADO} />}
  </Tarjeta>
);

/** Barras horizontales: ingresos de cada uno de los últimos 7 días, del más reciente al más antiguo. */
const UltimosSieteDias: React.FC<{ r: ResumenPanel }> = ({ r }) => {
  const total = r.tendencia.reduce((s, d) => s + d.total, 0);
  return (
    <Tarjeta titulo="Ingresos por día" subtitulo={`Últimos 7 días · ${numero(total)} ingresos`}>
      {total === 0 ? <Vacio titulo="Sin ingresos en los últimos 7 días" icono={<Activity size={22} />} /> : (
        <div className="pila" style={{ gap: 14 }}>
          <BarrasHorizontales series={SERIES_ESTADO}
            filas={[...r.tendencia].reverse().map(d => ({ etiqueta: diaCorto(d.fecha), total: d.total, valores: d }))} />
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}><Leyenda series={SERIES_ESTADO} /></div>
        </div>
      )}
    </Tarjeta>
  );
};

/** Los 50 ingresos más recientes en una tabla, actualizada en tiempo real. */
const IngresosRecientes: React.FC = () => {
  const [zoom, setZoom] = useState<Deteccion | null>(null);
  const navigate = useNavigate();
  const puedeEditarCampos = useAuth().puede('detecciones:validar');
  const { datos, cargando, error, recargar, setDatos } = useConsulta<Deteccion[]>(
    () => api.get('/detecciones/recientes', { params: { limite: 50 } }).then(r => r.data), []);
  const alEditar = (actualizada: Deteccion, campo?: CampoIngreso) => {
    setDatos(actuales => actuales?.map(d => d.id === actualizada.id ? actualizarCampoIngreso(d, actualizada, campo) : d) ?? null);
  };
  const diferido = useDiferido(() => recargar(true), 1500);
  useEvento('deteccion:nueva', diferido);
  useEvento('deteccion:actualizada', diferido);
  useEvento('deteccion:eliminada', diferido);
  useEvento('deteccion:eliminadas', diferido);
  useReconexion(diferido);
  return (
    <Tarjeta titulo="Movimientos recientes" subtitulo="Ingresos sin salida o con datos pendientes para el reporte; se actualiza en tiempo real"
      acciones={<Link to="/historial" className="btn btn-ghost btn-sm"><History size={14} /> Historial completo <ArrowRight size={14} /></Link>} sinPadding>
      {error && <Aviso tipo="error" style={{ margin: 12 }}>{error}</Aviso>}
      <div className="tabla-contenedor" style={{ maxHeight: 560 }} role="region" aria-label="Tabla de movimientos recientes" tabIndex={0}>
        <table className="tabla tabla-registros">
          <thead><tr>
            <th className="num" style={{ width: 44 }}>N.º</th><th>Cédula</th><th>Titular</th><th>Placa</th><th>Motivo</th><th>Fecha</th><th>Hora de entrada</th><th>Hora de salida</th>
            <th>Vehículo</th><th>Marca</th><th>Modelo</th><th>Cámara</th><th>Estado</th><th>Confianza</th><th>Registro de salida</th>
          </tr></thead>
          <tbody>
            {cargando && !datos ? <FilasEsqueleto columnas={15} /> : (datos ?? []).map((d, i) => (
              <tr key={d.id} className={`clic ${ESTADOS_ACCESO[estadoAcceso(d)].clase}`} onClick={() => navigate(`/detecciones/${d.id}`)}>
                <td className="num texto-secundario">{i + 1}</td>
                <CeldaIngreso d={d} campo="cedula" editable={puedeEditarCampos && d.tipo_movimiento !== 'salida'} onActualizada={alEditar} />
                <CeldaIngreso d={d} campo="persona_ingreso" editable={puedeEditarCampos && d.tipo_movimiento !== 'salida'} onActualizada={alEditar} />
                <td className="nowrap">
                  <PlacaFoto d={d} alto={36} onClick={() => setZoom(d)} />
                </td>
                <CeldaIngreso d={d} campo="motivo_ingreso" editable={puedeEditarCampos && d.tipo_movimiento !== 'salida'} onActualizada={alEditar} />
                <td className="nowrap">{fecha(d.fecha_hora_ingreso)}</td>
                <td className="nowrap"><strong style={{ color: 'var(--text)', fontWeight: 600 }}>{hora(d.fecha_hora_ingreso)}</strong></td>
                <td className="nowrap">{d.fecha_hora_salida ? hora(d.fecha_hora_salida) : '—'}</td>
                <CeldaIngreso d={d} campo="tipo_vehiculo" editable={puedeEditarCampos && d.tipo_movimiento !== 'salida'} onActualizada={alEditar} />
                <CeldaIngreso d={d} campo="marca" editable={puedeEditarCampos && d.tipo_movimiento !== 'salida'} onActualizada={alEditar} />
                <CeldaIngreso d={d} campo="modelo" editable={puedeEditarCampos && d.tipo_movimiento !== 'salida'} onActualizada={alEditar} />
                <td>{d.camara ? <>{d.camara.nombre}<span className="secundario">{d.camara.ubicacion}</span></> : <span className="texto-secundario">{d.fuente === 'manual' ? 'Registro manual' : '—'}</span>}</td>
                <td className="nowrap"><InsigniaEstado estado={d.estado_validacion} procesando={d.estado_procesamiento === 'pendiente_ocr'} corta /></td>
                <td className="nowrap"><ConfianzaRegistro valor={d.confianza_ocr} /></td>
                <td className="nowrap">{d.fecha_hora_salida ? <span className="texto-secundario">Registrada</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {datos && datos.length === 0 && (
        <Vacio titulo="Aún no hay ingresos registrados" texto="Los pasos vehiculares aparecerán aquí en cuanto el motor ANPR los registre." icono={<CarFront size={22} />} />
      )}
      {zoom && <VisorZoom d={zoom} onCerrar={() => setZoom(null)} />}
    </Tarjeta>
  );
};

/**
 * Dashboard de gestión, simple como el de vigilance-heart: indicadores del día, la distribución de
 * hoy, los últimos 7 días y los 50 ingresos recientes. Servicios, cuentas, listas de control y
 * exactitud están en Estado del sistema.
 */
const PanelGestion: React.FC = () => {
  const { user } = useAuth();
  const { datos: r, cargando, error } = useResumen();
  return (
    <div className="pagina">
      <div className="encabezado-pagina">
        <div>
          <h2>Dashboard</h2>
          <p>Vista general del acceso vehicular · {saludo()}, {user?.nombre.split(' ')[0]} · {r ? `actualizado ${relativo(r.generado)}` : 'cargando…'}</p>
        </div>
        <div className="fila">
          <Link to="/reportes" className="btn btn-secondary"><Activity size={16} /> Reportes</Link>
          <Link to="/monitoreo" className="btn btn-primary"><MonitorPlay size={16} /> Gestión de Accesos</Link>
        </div>
      </div>
      {error && <Aviso tipo="error" style={{ marginBottom: 16 }}>{error}</Aviso>}
      <div className="pila">
        <KpisDelDia r={r} cargando={cargando} />
        {r
          ? <div className="grid-2"><DistribucionHoy r={r} /><UltimosSieteDias r={r} /></div>
          : <Tarjeta titulo="Distribución de ingresos"><Cargando /></Tarjeta>}
        <IngresosRecientes />
      </div>
    </div>
  );
};

/**
 * Inicio según los permisos: quien supervisa (reportes y alertas) ve la gestión; el gestor de
 * permisos, su única vista de gestión de permisos; el guardia, su turno.
 */
const Inicio: React.FC = () => {
  const { puede, user } = useAuth();
  // Guardia puede gestionar listas, pero su inicio sigue siendo el panel operativo del turno.
  // La matriz RBAC no debe decidir por sí sola qué dashboard se muestra.
  if (user?.rol === 'Guardia') return <PanelOperador />;
  if (puede('alertas:gestionar')) return <PanelGestion />;
  if (puede('padron:gestionar')) return <GestionPermisos />;
  if (puede('operacion:monitorear')) return <PanelOperador />;
  return <div className="pagina"><div className="tarjeta" style={{ padding: 24 }}>Su cuenta no tiene permisos asignados. Contacte al administrador.</div></div>;
};

export default Inicio;
