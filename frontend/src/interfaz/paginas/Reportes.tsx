import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CarFront, Download, FileText, Printer, UserRound } from 'lucide-react';
import api, { mensajeError, mensajeErrorDescarga } from '../../infraestructura/api';
import { useAuth } from '../../aplicacion/AuthContext';
import { useConsulta } from '../../aplicacion/hooks';
import type { Deteccion, Pagina } from '../../dominio/tipos';
import { fecha, fechaHora, fechaIsoLocal, limiteDia, nombreDescarga, numero } from '../../dominio/formato';
import { formatearPlaca, normalizarPlaca, validarPlaca } from '../../dominio/validacion';
import {
  agrupar, diaLocal, diasEntre, duracion, hallazgos, promedioSemanal, type Sujeto, type Unidad, unidadPara,
} from '../../dominio/analisisAccesos';
import { descargarBlob } from '../../infraestructura/descargas';
import { Aviso, Cargando, Tarjeta, Vacio } from '../componentes/ui';
import { Informe, ResumenInforme, TablaAccesosInforme } from '../componentes/InformeImprimible';
import { cargarAnalisis, type DatosAnalisis, GraficosAnalisis, Hallazgos, TablaFrecuentes, TablaPersonas } from '../componentes/InformeAnalitico';
import { type ResultadoBusqueda } from '../componentes/SituacionPlaca';
import { useNotificar } from '../componentes/Notificaciones';
import { PeriodoCompacto } from '../componentes/PeriodoCompacto';
import { ReportesRegistros } from '../componentes/ReportesRegistros';
import './Reportes.css';

/**
 * Reportes para consultar e imprimir:
 *   - Accesos por fecha: los ingresos de un período con sus hallazgos, gráficos y los vehículos y
 *     personas más frecuentes.
 *   - Reporte de un vehículo: su situación en las listas, cuándo suele ingresar (semana, día, hora),
 *     cuánto permanece, quién lo ingresa y cada ingreso.
 *   - Reporte de una persona (nombres y apellidos o cédula): lo mismo, con los vehículos que usó.
 *   - Hoja de control de garita: el formato oficial en PDF o Excel.
 * Cada informe se muestra como el documento que se imprime (logo, datos, tabla y firmas). La pestaña
 * y lo consultado viven en la URL: Historial completo abre aquí el reporte de una fila.
 */

type Vista = 'registros' | 'accesos' | 'analisis_vehiculo' | 'analisis_persona' | 'control';
const VISTAS: readonly Vista[] = ['registros', 'accesos', 'analisis_vehiculo', 'analisis_persona', 'control'];
type TipoAcceso = 'todos' | 'autorizados' | 'no_autorizados' | 'alertas' | 'pendientes';

const TIPOS: Record<TipoAcceso, { etiqueta: string; titulo: string; estado?: string }> = {
  todos: { etiqueta: 'Todos', titulo: 'Reporte de accesos vehiculares' },
  autorizados: { etiqueta: 'Autorizados', titulo: 'Reporte de accesos autorizados', estado: 'autorizado' },
  no_autorizados: { etiqueta: 'No autorizados', titulo: 'Reporte de accesos no autorizados', estado: 'no_reconocido,alerta' },
  alertas: { etiqueta: 'Lista negra', titulo: 'Reporte de alertas de lista negra', estado: 'alerta' },
  pendientes: { etiqueta: 'Pendientes', titulo: 'Reporte de accesos pendientes de autorización', estado: 'pendiente_revision' },
};

/** Máximo de filas del detalle impreso (20 páginas de la API); los totales y gráficos cuentan todo. */
const MAX_FILAS = 2000;

/** Todos los ingresos que cumplen los filtros, en orden cronológico, hasta MAX_FILAS. */
async function cargarAccesos(params: Record<string, string | undefined>): Promise<{ items: Deteccion[]; total: number }> {
  const pagina = (n: number) => api.get<Pagina<Deteccion>>('/detecciones', { params: { ...params, movimiento: 'ingreso', orden: 'antiguo', pagina: n, tamano: 100 } }).then(r => r.data);
  const primera = await pagina(1);
  const items = [...primera.items];
  const paginas = Math.min(Math.ceil(primera.total / 100), MAX_FILAS / 100);
  for (let n = 2; n <= paginas; n++) items.push(...(await pagina(n)).items);
  return { items, total: primera.total };
}

const textoDia = (ymd: string) => fecha(`${ymd}T12:00:00-05:00`);
const textoPeriodo = (desde: string, hasta: string) => (desde === hasta ? textoDia(desde) : `${textoDia(desde)} al ${textoDia(hasta)}`);
const textoPeriodoAbierto = (desde: string, hasta: string) => (desde && hasta ? textoPeriodo(desde, hasta)
  : desde ? `Desde el ${textoDia(desde)}` : hasta ? `Hasta el ${textoDia(hasta)}` : 'Todo el historial');
const limites = (desde: string, hasta: string) => ({ desde: desde ? limiteDia(desde) : undefined, hasta: hasta ? limiteDia(hasta, true) : undefined });
const promedio = (v: number) => v.toLocaleString('es-EC', { maximumFractionDigits: 1 });

function errorPeriodo(desde: string, hasta: string, obligatorio = false): string | null {
  if (obligatorio && (!desde || !hasta)) return 'Seleccione la fecha de inicio y de fin.';
  if (desde && hasta && desde > hasta) return 'La fecha de inicio debe ser anterior o igual a la fecha de fin.';
  if (desde > fechaIsoLocal() || hasta > fechaIsoLocal()) return 'Seleccione fechas hasta el día de hoy.';
  return null;
}

const VistaPrevia: React.FC<React.ComponentProps<typeof Informe>> = props => <>
  <div className="reporte-paso no-imprimir"><span>3</span><strong>Vista previa</strong><small>Documento listo para imprimir o guardar en PDF.</small></div>
  <Informe {...props} />
</>;

/** Hallazgos y gráficos de un informe; el período sin fechas va del primer ingreso a hoy. */
const Analitica: React.FC<{ datos: DatosAnalisis; sujeto: Sujeto; desde: string; hasta: string; unidad?: Unidad }> = ({ datos, sujeto, desde, hasta, unidad }) => {
  const hoy = fechaIsoLocal();
  const d = desde || (datos.resumen.primero ? diaLocal(datos.resumen.primero) : hoy);
  const h = hasta || hoy;
  const u = unidad ?? unidadPara(d, h);
  const barras = agrupar(datos.analisis.por_dia, u, d, h);
  if (!datos.resumen.ingresos) return null;
  return <>
    <Hallazgos items={hallazgos(datos.analisis, datos.resumen, sujeto, { desde: d, hasta: h, barras, unidad: u })} />
    <GraficosAnalisis analisis={datos.analisis} barras={barras} unidad={u} principal={sujeto === 'periodo' ? 'hora' : 'semana'} />
  </>;
};

/* ─────────────── Accesos por fecha ─────────────── */

const ReporteAccesos: React.FC<{ onVehiculo: (placa: string) => void; onPersona: (nombre: string) => void }> = ({ onVehiculo, onPersona }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const notificar = useNotificar();
  const hoy = fechaIsoLocal();
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [tipo, setTipo] = useState<TipoAcceso>('todos');
  const [consulta, setConsulta] = useState<{ desde: string; hasta: string; tipo: TipoAcceso } | null>(null);
  const [errorFormulario, setErrorFormulario] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  const params = consulta ? { desde: limiteDia(consulta.desde), hasta: limiteDia(consulta.hasta, true), estado: TIPOS[consulta.tipo].estado } : {};
  const { datos, cargando, error } = useConsulta(async () => {
    if (!consulta) return null;
    const [accesos, analitica] = await Promise.all([cargarAccesos(params), cargarAnalisis(params)]);
    return { ...accesos, analitica };
  }, [consulta]);
  const filas = datos?.items ?? [];
  const r = datos?.analitica.resumen;
  const permanencia = datos?.analitica.analisis.permanencia;
  const modificado = Boolean(consulta && (consulta.desde !== desde || consulta.hasta !== hasta || consulta.tipo !== tipo));
  const listo = Boolean(consulta && datos && !cargando && !error && !modificado);

  const generar = (e: React.FormEvent) => {
    e.preventDefault();
    const fallo = errorPeriodo(desde, hasta, true);
    setErrorFormulario(fallo);
    if (!fallo) setConsulta({ desde, hasta, tipo });
  };

  const exportar = async () => {
    if (!listo || !consulta || exportando) return;
    setExportando(true);
    try {
      const x = await api.get('/detecciones/exportar', { params: { ...params, movimiento: 'ingreso', orden: 'antiguo' }, responseType: 'blob' });
      descargarBlob(x.data, nombreDescarga(x.headers['content-disposition'], `accesos_${consulta.desde}_${consulta.hasta}.csv`));
    } catch (e) { notificar('error', 'No se pudo exportar', mensajeError(e)); } finally { setExportando(false); }
  };

  return <>
    <Tarjeta className="no-imprimir reporte-barra">
      <form className="reporte-parametros" onSubmit={generar}>
        <PeriodoCompacto id="ra" desde={desde} hasta={hasta} onCambiar={(d, h) => { setDesde(d); setHasta(h); setErrorFormulario(null); }} />
        <div className="campo">
          <label htmlFor="ra-tipo">Accesos</label>
          <select id="ra-tipo" className="select" value={tipo} onChange={e => setTipo(e.target.value as TipoAcceso)}>
            {(Object.keys(TIPOS) as TipoAcceso[]).map(t => <option key={t} value={t}>{TIPOS[t].etiqueta}</option>)}
          </select>
        </div>
        <button type="submit" className="btn btn-navy" disabled={Boolean(consulta && cargando) || exportando}><FileText size={15} /> {consulta && cargando ? 'Generando…' : 'Generar reporte'}</button>
        <div className="reporte-acciones">
          <button type="button" className="btn btn-secondary" onClick={exportar} disabled={exportando || !listo || !filas.length}><Download size={15} /> {exportando ? 'Exportando…' : 'Exportar CSV'}</button>
          <button type="button" className="btn btn-secondary" onClick={() => window.print()} disabled={!listo || !filas.length}><Printer size={15} /> Imprimir / guardar PDF</button>
        </div>
      </form>
      {errorFormulario && <p className="error reporte-aviso" role="alert">{errorFormulario}</p>}
      {modificado && <p className="texto-secundario reporte-aviso" role="status">Cambió los filtros. Pulse «Generar reporte» para actualizar la vista previa.</p>}
    </Tarjeta>
    {error && <Aviso tipo="error">{error}</Aviso>}
    {!consulta ? <Tarjeta><Vacio titulo="Genere su reporte" icono={<FileText size={22} />}
      texto="Elija el período y los accesos que necesita. Pulse «Generar reporte» para ver el documento y luego imprimirlo, guardarlo en PDF o exportar sus registros." /></Tarjeta>
      : cargando ? <Cargando alto={260} /> : !error && datos && r && (
      <VistaPrevia titulo={TIPOS[consulta.tipo].titulo} generadoPor={user?.nombre}
        datos={[['Período', textoPeriodo(consulta.desde, consulta.hasta)], ['Accesos', TIPOS[consulta.tipo].etiqueta], ['Registros', numero(datos.total)]]}>
        <ResumenInforme cifras={[
          ['Ingresos', numero(r.ingresos)], ['Autorizados', numero(r.autorizados)], ['No autorizados', numero(r.no_registrados)],
          ['Lista negra', numero(r.alertas)], ['Vehículos distintos', numero(r.placas)],
          ['Permanencia (mediana)', permanencia ? duracion(permanencia.mediana_min) : '—'],
        ]} />
        <Analitica datos={datos.analitica} sujeto="periodo" desde={consulta.desde} hasta={consulta.hasta} />
        <div className="informe-dos-columnas">
          <TablaFrecuentes filas={datos.analitica.analisis.frecuentes} max={5} onAbrir={onVehiculo} />
          <TablaPersonas filas={datos.analitica.analisis.personas} max={5} onAbrir={onPersona} />
        </div>
        <section className="informe-seccion">
          <h2>Detalle de los ingresos</h2>
          {datos.total > filas.length && <p className="informe-nota">Se muestran los primeros {numero(filas.length)} de {numero(datos.total)} registros; los totales, hallazgos y gráficos cuentan todos. Acote el período o use «Exportar CSV» para el detalle completo.</p>}
          {filas.length
            ? <TablaAccesosInforme filas={filas} etiqueta="Detalle de los ingresos" onAbrir={d => navigate(`/monitoreo?registro=${d.id}`)} />
            : <p className="informe-vacio">No hay accesos {consulta.tipo === 'todos' ? '' : `${TIPOS[consulta.tipo].etiqueta.toLowerCase()} `}registrados en el período.</p>}
        </section>
      </VistaPrevia>
    )}
  </>;
};

/* ─────────────── Reporte de un vehículo ─────────────── */

const SITUACION: Record<ResultadoBusqueda['estado'], string> = {
  autorizado: 'Autorizado en la lista blanca', alerta: 'En la lista negra (alerta)', restringido: 'Permiso no vigente en este momento', no_registrado: 'No consta en las listas',
};

interface Consulta { valor: string; desde: string; hasta: string }

/** Formulario de los reportes de vehículo y persona: lo consultado y el período (opcional) van a la URL. */
const FormularioReporte: React.FC<{
  id: string; etiqueta: string; placeholder: string; inicial: Consulta; placa?: boolean; listo: boolean; cargando: boolean;
  validar: (texto: string) => { ok: true; valor: string } | { ok: false; error: string }; onConsultar: (c: Consulta) => void;
}> = ({ id, etiqueta, placeholder, inicial, placa, listo, cargando, validar, onConsultar }) => {
  const [texto, setTexto] = useState(placa ? formatearPlaca(inicial.valor) || inicial.valor : inicial.valor);
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const [error, setError] = useState<string | null>(null);
  const modificado = Boolean(inicial.valor && ((placa ? normalizarPlaca(texto) : texto.trim().replace(/\s+/g, ' ')) !== inicial.valor || desde !== inicial.desde || hasta !== inicial.hasta));
  useEffect(() => { setTexto(placa ? formatearPlaca(inicial.valor) || inicial.valor : inicial.valor); setDesde(inicial.desde); setHasta(inicial.hasta); setError(null); },
    [inicial.valor, inicial.desde, inicial.hasta, placa]);
  const consultar = (e: React.FormEvent) => {
    e.preventDefault();
    if (cargando) return;
    const v = validar(texto);
    if (!v.ok) { setError(v.error); return; }
    const fallo = errorPeriodo(desde, hasta);
    if (fallo) { setError(fallo); return; }
    setError(null);
    onConsultar({ valor: v.valor, desde, hasta });
  };
  return (
    <Tarjeta className="no-imprimir reporte-barra">
      <form className="reporte-parametros" onSubmit={consultar}>
        <div className={`campo reporte-consulta${placa ? ' reporte-consulta-placa' : ''}`}><label htmlFor={id}>{etiqueta}</label>
          <input id={id} className={`input${placa ? ' placa-input' : ''}`} value={texto} maxLength={placa ? 8 : 100} placeholder={placeholder} autoComplete="off"
            onChange={e => { setTexto(placa ? e.target.value.toUpperCase() : e.target.value); setError(null); }} aria-invalid={Boolean(error)} />
          {error && <span className="error">{error}</span>}
        </div>
        <PeriodoCompacto id={`${id}-p`} desde={desde} hasta={hasta} todo onCambiar={(d, h) => { setDesde(d); setHasta(h); setError(null); }} />
        <button type="submit" className="btn btn-navy" disabled={cargando}><FileText size={15} /> {cargando ? 'Generando…' : 'Generar reporte'}</button>
        <div className="reporte-acciones">
          <button type="button" className="btn btn-secondary" onClick={() => window.print()} disabled={!listo || modificado || cargando}><Printer size={15} /> Imprimir / guardar PDF</button>
        </div>
      </form>
      {modificado && <p className="texto-secundario reporte-aviso" role="status">Cambió los datos. Pulse «Generar reporte» para actualizar la vista previa.</p>}
    </Tarjeta>
  );
};

const ReporteVehiculo: React.FC<{ consulta: Consulta | null; onConsultar: (c: Consulta) => void; onPersona: (nombre: string) => void }> = ({ consulta, onConsultar, onPersona }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { datos, cargando, error, recargar } = useConsulta(async () => {
    if (!consulta) return null;
    const filtros = { placa: consulta.valor, exacta: 'si', ...limites(consulta.desde, consulta.hasta) };
    const [situacion, analitica, accesos] = await Promise.all([
      api.get<ResultadoBusqueda & { autorizado: Record<string, string | null> | null }>(`/detecciones/buscar-placa/${encodeURIComponent(consulta.valor)}`).then(r => r.data),
      cargarAnalisis(filtros),
      cargarAccesos(filtros),
    ]);
    // La API ya pide la placa exacta; esto solo protege el informe de una respuesta más amplia
    return { situacion, analitica, items: accesos.items.filter(d => normalizarPlaca(d.placa) === consulta.valor), total: accesos.total };
  }, [consulta?.valor, consulta?.desde, consulta?.hasta]);

  const filas = datos?.items ?? [];
  const r = datos?.analitica.resumen;
  const a = datos?.analitica.analisis;
  const permiso = datos?.situacion.estado === 'autorizado' || datos?.situacion.estado === 'restringido' ? datos.situacion.autorizado : null;
  const hoy = fechaIsoLocal();
  const desdeEf = consulta?.desde || (r?.primero ? diaLocal(r.primero) : hoy);
  const hastaEf = consulta?.hasta || hoy;

  return <>
    <FormularioReporte id="r-placa" etiqueta="Placa del vehículo" placeholder="ABC-1234" placa listo={Boolean(datos) && !error && !cargando} cargando={Boolean(consulta && cargando)}
      inicial={consulta ?? { valor: '', desde: '', hasta: '' }} onConsultar={c => {
        if (consulta?.valor === c.valor && consulta.desde === c.desde && consulta.hasta === c.hasta) void recargar();
        else onConsultar(c);
      }}
      validar={t => { const v = validarPlaca(t); return v.ok ? { ok: true, valor: v.valor.placa } : v; }} />
    {error && <Aviso tipo="error">{error}</Aviso>}
    {!consulta ? (
      <Tarjeta><Vacio titulo="Consulte una placa" icono={<CarFront size={22} />}
        texto="Escriba la placa (por ejemplo ABC-1234) para ver su situación en las listas, cuándo suele ingresar, cuánto permanece, quién lo ingresa y cada ingreso. Puede acotar las fechas." /></Tarjeta>
    ) : cargando ? <Cargando alto={260} /> : !error && datos && r && a && (
      <VistaPrevia titulo={`Reporte del vehículo ${formatearPlaca(consulta.valor)}`} generadoPor={user?.nombre}
        datos={[
          ['Placa', <span className="informe-placa">{formatearPlaca(consulta.valor)}</span>],
          ['Situación', SITUACION[datos.situacion.estado]],
          ['Período', textoPeriodoAbierto(consulta.desde, consulta.hasta)],
          ...(permiso ? [
            ['Titular', permiso.propietario ?? '—'], ['Cédula', permiso.cedula ?? '—'],
            ['Vehículo', [permiso.tipo_vehiculo, permiso.marca, permiso.modelo, permiso.color].filter(Boolean).join(' · ') || '—'],
            ['Vigencia', permiso.fecha_vencimiento ? `hasta ${fecha(permiso.fecha_vencimiento)}` : 'Sin vencimiento'],
          ] as [string, string][] : []),
          ...(datos.situacion.estado === 'alerta' ? [['Motivo de la alerta', datos.situacion.alerta.motivo]] as [string, string][] : []),
        ]}>
        <ResumenInforme cifras={[
          ['Ingresos', numero(r.ingresos)], ['Días con ingreso', numero(a.por_dia.length)],
          ['Promedio por semana', r.ingresos ? promedio(promedioSemanal(r.ingresos, desdeEf, hastaEf)) : '—'],
          ['Permanencia (mediana)', a.permanencia ? duracion(a.permanencia.mediana_min) : '—'],
          ['Último ingreso', r.ultimo ? fechaHora(r.ultimo) : '—'],
        ]} />
        <Analitica datos={datos.analitica} sujeto="vehiculo" desde={consulta.desde} hasta={consulta.hasta}
          unidad={diasEntre(desdeEf, hastaEf) > 364 ? 'mes' : 'semana'} />
        <TablaPersonas filas={a.personas} titulo="Personas que lo ingresaron" onAbrir={onPersona} />
        <section className="informe-seccion">
          <h2>Ingresos del vehículo</h2>
          {datos.total > filas.length && <p className="informe-nota">Se muestran los primeros {numero(filas.length)} de {numero(datos.total)} ingresos; los totales, hallazgos y gráficos cuentan todos.</p>}
          {filas.length
            ? <TablaAccesosInforme filas={filas} sinPlaca etiqueta="Ingresos del vehículo" onAbrir={d => navigate(`/monitoreo?registro=${d.id}`)} />
            : <p className="informe-vacio">El vehículo {formatearPlaca(consulta.valor)} no registra ingresos{consulta.desde || consulta.hasta ? ' en el período' : ''}.</p>}
        </section>
      </VistaPrevia>
    )}
  </>;
};

/* ─────────────── Reporte de una persona ─────────────── */

const ReportePersona: React.FC<{ consulta: Consulta | null; onConsultar: (c: Consulta) => void; onVehiculo: (placa: string) => void }> = ({ consulta, onConsultar, onVehiculo }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { datos, cargando, error, recargar } = useConsulta(async () => {
    if (!consulta) return null;
    const filtros = { persona: consulta.valor, ...limites(consulta.desde, consulta.hasta) };
    const [analitica, accesos] = await Promise.all([cargarAnalisis(filtros), cargarAccesos(filtros)]);
    return { analitica, ...accesos };
  }, [consulta?.valor, consulta?.desde, consulta?.hasta]);

  const filas = datos?.items ?? [];
  const r = datos?.analitica.resumen;
  const a = datos?.analitica.analisis;
  const hoy = fechaIsoLocal();
  const desdeEf = consulta?.desde || (r?.primero ? diaLocal(r.primero) : hoy);
  const hastaEf = consulta?.hasta || hoy;
  const nombres = a?.personas ?? [];

  return <>
    <FormularioReporte id="r-persona" etiqueta="Nombres y apellidos o cédula" placeholder="Ej.: María Pérez o 0912345678" listo={Boolean(datos) && !error && !cargando} cargando={Boolean(consulta && cargando)}
      inicial={consulta ?? { valor: '', desde: '', hasta: '' }} onConsultar={c => {
        if (consulta?.valor === c.valor && consulta.desde === c.desde && consulta.hasta === c.hasta) void recargar();
        else onConsultar(c);
      }}
      validar={t => (t.trim().length >= 3 ? { ok: true, valor: t.trim().replace(/\s+/g, ' ') } : { ok: false, error: 'Escriba al menos 3 caracteres del nombre, del apellido o de la cédula.' })} />
    {error && <Aviso tipo="error">{error}</Aviso>}
    {!consulta ? (
      <Tarjeta><Vacio titulo="Consulte una persona" icono={<UserRound size={22} />}
        texto="Escriba sus nombres y apellidos, en cualquier orden, o su cédula. El reporte muestra cuándo suele ingresar, cuánto permanece, los vehículos que usó y cada ingreso." /></Tarjeta>
    ) : cargando ? <Cargando alto={260} /> : !error && datos && r && a && (
      <VistaPrevia titulo={`Reporte de la persona «${consulta.valor}»`} generadoPor={user?.nombre}
        datos={[
          ['Búsqueda', consulta.valor],
          ['Coincide con', nombres.length ? nombres.slice(0, 3).map(p => p.nombre).join(', ') + (nombres.length > 3 ? ` y ${nombres.length - 3} más` : '') : '—'],
          ['Período', textoPeriodoAbierto(consulta.desde, consulta.hasta)],
        ]}>
        {nombres.length > 1 && (
          <p className="informe-nota">La búsqueda coincide con {numero(nombres.length)} personas y el reporte las incluye a todas. Escriba el nombre completo o la cédula para acotarlo.</p>
        )}
        <ResumenInforme cifras={[
          ['Ingresos', numero(r.ingresos)], ['Días con ingreso', numero(a.por_dia.length)], ['Vehículos', numero(r.placas)],
          ['Promedio por semana', r.ingresos ? promedio(promedioSemanal(r.ingresos, desdeEf, hastaEf)) : '—'],
          ['Último ingreso', r.ultimo ? fechaHora(r.ultimo) : '—'],
        ]} />
        <Analitica datos={datos.analitica} sujeto="persona" desde={consulta.desde} hasta={consulta.hasta}
          unidad={diasEntre(desdeEf, hastaEf) > 364 ? 'mes' : 'semana'} />
        <TablaFrecuentes filas={a.frecuentes} titulo="Vehículos que usó" onAbrir={onVehiculo} />
        {nombres.length > 1 && <TablaPersonas filas={nombres} titulo="Personas que coinciden con la búsqueda" />}
        <section className="informe-seccion">
          <h2>Ingresos de la persona</h2>
          {datos.total > filas.length && <p className="informe-nota">Se muestran los primeros {numero(filas.length)} de {numero(datos.total)} ingresos; los totales, hallazgos y gráficos cuentan todos.</p>}
          {filas.length
            ? <TablaAccesosInforme filas={filas} etiqueta="Ingresos de la persona" onAbrir={d => navigate(`/monitoreo?registro=${d.id}`)} />
            : <p className="informe-vacio">No hay ingresos de «{consulta.valor}»{consulta.desde || consulta.hasta ? ' en el período' : ''}.</p>}
        </section>
      </VistaPrevia>
    )}
  </>;
};

/* ─────────────── Hoja de control de garita ─────────────── */

type Turno = 'completo' | 'diurno' | 'nocturno';

/** Formato oficial de la garita (PDF o Excel con el logo del ECU 911), por período y turno. */
const HojaControl: React.FC = () => {
  const notificar = useNotificar();
  const hoy = fechaIsoLocal();
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [turno, setTurno] = useState<Turno>('completo');
  const [formato, setFormato] = useState<'pdf' | 'xlsx'>('pdf');
  const [error, setError] = useState<string | null>(null);
  const [descargado, setDescargado] = useState<string | null>(null);
  const [generando, setGenerando] = useState<'pdf' | 'xlsx' | null>(null);
  const descargar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (generando) return;
    const fallo = errorPeriodo(desde, hasta, true);
    setError(fallo);
    setDescargado(null);
    if (fallo) return;
    setGenerando(formato);
    try {
      const x = await api.get('/reportes/control-vehicular', { params: { desde: limiteDia(desde), hasta: limiteDia(hasta, true), turno, formato }, responseType: 'blob' });
      descargarBlob(x.data, nombreDescarga(x.headers['content-disposition'], `control_vehicular_${desde}_${hasta}_${turno}.${formato}`));
      setDescargado(`Reporte descargado en ${formato === 'pdf' ? 'PDF' : 'Excel'}.`);
    } catch (e) {
      notificar('error', 'No se pudo generar la hoja de control', await mensajeErrorDescarga(e));
    } finally { setGenerando(null); }
  };
  return (
    <Tarjeta titulo="Hoja de control vehicular de la garita"
      subtitulo="Formato oficial con el logo del ECU 911: fecha, nombres y apellidos, tipo, marca, placa, horas de ingreso y salida y motivo, con la firma del agente.">
      <form className="reporte-parametros" onSubmit={descargar}>
        <PeriodoCompacto id="rc" desde={desde} hasta={hasta} onCambiar={(d, h) => { setDesde(d); setHasta(h); setError(null); setDescargado(null); }} />
        <div className="campo"><label htmlFor="rc-turno">Turno</label>
          <select id="rc-turno" className="select" value={turno} onChange={e => { setTurno(e.target.value as Turno); setDescargado(null); }} disabled={Boolean(generando)}>
            <option value="completo">Día completo</option>
            <option value="diurno">Diurno · 07:00–19:00</option>
            <option value="nocturno">Nocturno · 19:00–07:00</option>
          </select>
        </div>
        <div className="campo"><label htmlFor="rc-formato">Formato</label>
          <select id="rc-formato" className="select" value={formato} onChange={e => { setFormato(e.target.value as 'pdf' | 'xlsx'); setDescargado(null); }} disabled={Boolean(generando)}>
            <option value="pdf">PDF · para imprimir</option>
            <option value="xlsx">Excel · para trabajar los datos</option>
          </select>
        </div>
        <button type="submit" className="btn btn-navy" disabled={generando !== null}><Download size={15} /> {generando ? 'Generando…' : 'Generar y descargar'}</button>
      </form>
      {error && <p className="error reporte-aviso" role="alert">{error}</p>}
      {descargado && <p className="texto-exito reporte-aviso" role="status">{descargado}</p>}
    </Tarjeta>
  );
};

const Reportes: React.FC = () => {
  const [params, setParams] = useSearchParams();
  // Los enlaces anteriores del historial (?vista=vehiculo/persona) abren ahora la lista ya filtrada.
  const vista: Vista = (VISTAS as readonly string[]).includes(params.get('vista') ?? '') ? params.get('vista') as Vista : 'registros';
  const consulta = (clave: 'placa' | 'persona'): Consulta | null => {
    const valor = clave === 'placa' ? normalizarPlaca(params.get('placa')) : (params.get('persona') ?? '').trim();
    return valor ? { valor, desde: params.get('desde') ?? '', hasta: params.get('hasta') ?? '' } : null;
  };
  const ir = (cambios: Record<string, string>) => {
    setParams(Object.fromEntries(Object.entries(cambios).filter(([, v]) => v)));
    window.scrollTo?.({ top: 0 });
  };
  const verVehiculo = (placa: string) => ir({ vista: 'analisis_vehiculo', placa });
  const verPersona = (persona: string) => ir({ vista: 'analisis_persona', persona });
  return (
    <div className="pagina">
      <div className="encabezado-pagina no-imprimir">
        <div>
          <h2>Reportes</h2>
          <p>Filtre los registros y genere un reporte solo con esa lista.</p>
        </div>
      </div>
      <div className="pila">
        <div className="campo reportes-vista no-imprimir">
          <label htmlFor="reportes-vista">Vista de reportes</label>
          <select id="reportes-vista" className="select" value={vista} onChange={e => ir({ vista: e.target.value })}>
            <option value="registros">Registros y filtros</option>
            <optgroup label="Análisis e informes adicionales">
              <option value="accesos">Análisis de accesos por período</option>
              <option value="analisis_vehiculo">Análisis de un vehículo</option>
              <option value="analisis_persona">Análisis de una persona</option>
              <option value="control">Hoja de control de garita</option>
            </optgroup>
          </select>
        </div>
        {vista === 'registros' && <ReportesRegistros />}
        {vista !== 'registros' && <div className="reporte-paso no-imprimir"><strong>{vista === 'control' ? 'Elija el período, turno y formato' : 'Complete los datos y pulse «Generar reporte»'}</strong></div>}
        {vista === 'accesos' && <ReporteAccesos onVehiculo={verVehiculo} onPersona={verPersona} />}
        {vista === 'analisis_vehiculo' && <ReporteVehiculo consulta={consulta('placa')} onPersona={verPersona}
          onConsultar={c => ir({ vista: 'analisis_vehiculo', placa: c.valor, desde: c.desde, hasta: c.hasta })} />}
        {vista === 'analisis_persona' && <ReportePersona consulta={consulta('persona')} onVehiculo={verVehiculo}
          onConsultar={c => ir({ vista: 'analisis_persona', persona: c.valor, desde: c.desde, hasta: c.hasta })} />}
        {vista === 'control' && <HojaControl />}
      </div>
    </div>
  );
};

export default Reportes;
