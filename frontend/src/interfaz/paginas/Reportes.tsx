import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CarFront, ClipboardList, Download, FileSpreadsheet, FileText, Printer, Search, ShieldCheck } from 'lucide-react';
import api, { mensajeError, mensajeErrorDescarga } from '../../infraestructura/api';
import { useAuth } from '../../aplicacion/AuthContext';
import { useConsulta } from '../../aplicacion/hooks';
import type { Deteccion, Pagina } from '../../dominio/tipos';
import { fecha, fechaHora, fechaIsoLocal, limiteDia, nombreDescarga, numero } from '../../dominio/formato';
import { formatearPlaca, normalizarPlaca, validarPlaca } from '../../dominio/validacion';
import { descargarBlob } from '../../infraestructura/descargas';
import { Aviso, Cargando, Pestanas, Segmentado, Tarjeta, Vacio } from '../componentes/ui';
import { Informe, ResumenInforme, TablaAccesosInforme } from '../componentes/InformeImprimible';
import { type ResultadoBusqueda } from '../componentes/SituacionPlaca';
import { useNotificar } from '../componentes/Notificaciones';
import { SelectorPeriodo } from '../componentes/SelectorPeriodo';

/**
 * Reportes para consultar e imprimir:
 *   - Accesos por fecha: autorizados, no autorizados, alertas o pendientes de un período.
 *   - Historial de un vehículo: su situación en las listas y cada día que ingresó.
 *   - Hoja de control de garita: el formato oficial en PDF o Excel.
 * Cada informe se muestra como el documento que se imprime (logo, datos, tabla y firmas).
 */

type Vista = 'accesos' | 'vehiculo' | 'control';
type TipoAcceso = 'todos' | 'autorizados' | 'no_autorizados' | 'alertas' | 'pendientes';

const TIPOS: Record<TipoAcceso, { etiqueta: string; titulo: string; estado?: string }> = {
  todos: { etiqueta: 'Todos', titulo: 'Reporte de accesos vehiculares' },
  autorizados: { etiqueta: 'Autorizados', titulo: 'Reporte de accesos autorizados', estado: 'autorizado' },
  no_autorizados: { etiqueta: 'No autorizados', titulo: 'Reporte de accesos no autorizados', estado: 'no_reconocido,alerta' },
  alertas: { etiqueta: 'Lista negra', titulo: 'Reporte de alertas de lista negra', estado: 'alerta' },
  pendientes: { etiqueta: 'Pendientes', titulo: 'Reporte de accesos pendientes de autorización', estado: 'pendiente_revision' },
};

/** Máximo de filas por informe impreso (20 páginas de la API). */
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

/* ─────────────── Accesos por fecha ─────────────── */

const ReporteAccesos: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const notificar = useNotificar();
  const hoy = fechaIsoLocal();
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [tipo, setTipo] = useState<TipoAcceso>('todos');
  const [exportando, setExportando] = useState(false);
  const params = { desde: limiteDia(desde), hasta: limiteDia(hasta, true), estado: TIPOS[tipo].estado };
  const { datos, cargando, error } = useConsulta(() => cargarAccesos(params), [desde, hasta, tipo]);
  const filas = datos?.items ?? [];
  const cuenta = (...estados: string[]) => filas.filter(d => estados.includes(d.estado_validacion)).length;

  const exportar = async () => {
    setExportando(true);
    try {
      const r = await api.get('/detecciones/exportar', { params: { ...params, movimiento: 'ingreso', orden: 'antiguo' }, responseType: 'blob' });
      descargarBlob(r.data, nombreDescarga(r.headers['content-disposition'], `accesos_${desde}_${hasta}.csv`));
    } catch (e) { notificar('error', 'No se pudo exportar', mensajeError(e)); } finally { setExportando(false); }
  };

  return <>
    <Tarjeta className="no-imprimir">
      <div className="filtros">
        <SelectorPeriodo prefijo="ra" desde={desde} hasta={hasta} onCambiar={(d, h) => { setDesde(d || hoy); setHasta(h || hoy); }} />
        <div className="campo"><span className="etiqueta-campo">Accesos</span>
          <Segmentado<TipoAcceso> valor={tipo} onCambiar={setTipo} opciones={(Object.keys(TIPOS) as TipoAcceso[]).map(t => ({ valor: t, etiqueta: TIPOS[t].etiqueta }))} />
        </div>
        <div className="fila" style={{ marginLeft: 'auto' }}>
          <button className="btn btn-secondary" onClick={exportar} disabled={exportando || !filas.length}><Download size={15} /> {exportando ? 'Exportando…' : 'Excel (CSV)'}</button>
          <button className="btn btn-navy" onClick={() => window.print()} disabled={!filas.length}><Printer size={15} /> Imprimir</button>
        </div>
      </div>
    </Tarjeta>
    {error && <Aviso tipo="error">{error}</Aviso>}
    {cargando && !datos ? <Cargando alto={260} /> : (
      <Informe titulo={TIPOS[tipo].titulo} generadoPor={user?.nombre}
        datos={[['Período', textoPeriodo(desde, hasta)], ['Accesos', TIPOS[tipo].etiqueta], ['Registros', numero(datos?.total ?? 0)]]}>
        <ResumenInforme cifras={[
          ['Ingresos', numero(filas.length)], ['Autorizados', numero(cuenta('autorizado'))], ['No autorizados', numero(cuenta('no_reconocido'))],
          ['Lista negra', numero(cuenta('alerta'))], ['Pendientes', numero(cuenta('pendiente_revision'))], ['Con salida', numero(filas.filter(d => d.fecha_hora_salida).length)],
        ]} />
        {datos && datos.total > filas.length && <p className="informe-nota">Se muestran los primeros {numero(filas.length)} de {numero(datos.total)} registros. Acote el período o use la exportación a Excel para el detalle completo.</p>}
        {filas.length
          ? <TablaAccesosInforme filas={filas} onAbrir={d => navigate(`/detecciones/${d.id}`)} />
          : <p className="informe-vacio">No hay accesos {tipo === 'todos' ? '' : `${TIPOS[tipo].etiqueta.toLowerCase()} `}registrados en el período.</p>}
      </Informe>
    )}
  </>;
};

/* ─────────────── Historial de un vehículo ─────────────── */

const SITUACION: Record<ResultadoBusqueda['estado'], string> = {
  autorizado: 'Autorizado en la lista blanca', alerta: 'En la lista negra (alerta)', restringido: 'Permiso no vigente en este momento', no_registrado: 'No consta en las listas',
};

const ReporteVehiculo: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [texto, setTexto] = useState('');
  const [consulta, setConsulta] = useState<{ placa: string; desde: string; hasta: string } | null>(null);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [errorPlaca, setErrorPlaca] = useState<string | null>(null);

  const { datos, cargando, error } = useConsulta(async () => {
    if (!consulta) return null;
    const [situacion, accesos] = await Promise.all([
      api.get<ResultadoBusqueda & { autorizado: Record<string, string | null> | null }>(`/detecciones/buscar-placa/${encodeURIComponent(consulta.placa)}`).then(r => r.data),
      cargarAccesos({ placa: consulta.placa, desde: consulta.desde ? limiteDia(consulta.desde) : undefined, hasta: consulta.hasta ? limiteDia(consulta.hasta, true) : undefined }),
    ]);
    // La búsqueda por placa es parcial: el informe es de esta placa exacta
    return { situacion, items: accesos.items.filter(d => normalizarPlaca(d.placa) === consulta.placa), total: accesos.total };
  }, [consulta]);

  const consultar = (e: React.FormEvent) => {
    e.preventDefault();
    const v = validarPlaca(texto);
    if (!v.ok) { setErrorPlaca(v.error); return; }
    setErrorPlaca(null);
    setConsulta({ placa: v.valor.placa, desde, hasta });
  };

  const filas = datos?.items ?? [];
  const permiso = datos?.situacion.estado === 'autorizado' || datos?.situacion.estado === 'restringido' ? datos.situacion.autorizado : null;
  const dias = new Set(filas.map(d => fecha(d.fecha_hora_ingreso))).size;

  return <>
    <Tarjeta className="no-imprimir">
      <form className="filtros" onSubmit={consultar}>
        <div className="campo"><label htmlFor="r-placa">Placa del vehículo</label>
          <input id="r-placa" className="input placa-input" value={texto} maxLength={8} placeholder="ABC-1234" autoComplete="off"
            onChange={e => setTexto(e.target.value.toUpperCase())} aria-invalid={Boolean(errorPlaca)} />
          {errorPlaca && <span className="error">{errorPlaca}</span>}
        </div>
        <div className="campo" style={{ minWidth: 150 }}><label htmlFor="rv-desde">Desde (opcional)</label>
          <input id="rv-desde" type="date" className="input" value={desde} max={hasta || fechaIsoLocal()} onChange={e => setDesde(e.target.value)} /></div>
        <div className="campo" style={{ minWidth: 150 }}><label htmlFor="rv-hasta">Hasta (opcional)</label>
          <input id="rv-hasta" type="date" className="input" value={hasta} min={desde || undefined} max={fechaIsoLocal()} onChange={e => setHasta(e.target.value)} /></div>
        <button type="submit" className="btn btn-navy"><Search size={15} /> Consultar</button>
        <button type="button" className="btn btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => window.print()} disabled={!datos}><Printer size={15} /> Imprimir</button>
      </form>
    </Tarjeta>
    {error && <Aviso tipo="error">{error}</Aviso>}
    {!consulta ? (
      <Tarjeta><Vacio titulo="Consulte una placa" icono={<CarFront size={22} />}
        texto="Escriba la placa (por ejemplo ABC-1234) para ver su situación en las listas y cada ingreso registrado. Puede acotar las fechas." /></Tarjeta>
    ) : cargando && !datos ? <Cargando alto={260} /> : datos && (
      <Informe titulo={`Historial del vehículo ${formatearPlaca(consulta.placa)}`} generadoPor={user?.nombre}
        datos={[
          ['Placa', <span className="informe-placa">{formatearPlaca(consulta.placa)}</span>],
          ['Situación', SITUACION[datos.situacion.estado]],
          ['Período', consulta.desde && consulta.hasta ? textoPeriodo(consulta.desde, consulta.hasta)
            : consulta.desde ? `Desde el ${textoDia(consulta.desde)}` : consulta.hasta ? `Hasta el ${textoDia(consulta.hasta)}` : 'Todo el historial'],
          ...(permiso ? [
            ['Titular', permiso.propietario ?? '—'], ['Cédula', permiso.cedula ?? '—'],
            ['Vehículo', [permiso.tipo_vehiculo, permiso.marca, permiso.modelo, permiso.color].filter(Boolean).join(' · ') || '—'],
            ['Vigencia', permiso.fecha_vencimiento ? `hasta ${fecha(permiso.fecha_vencimiento)}` : 'Sin vencimiento'],
          ] as [string, string][] : []),
          ...(datos.situacion.estado === 'alerta' ? [['Motivo de la alerta', datos.situacion.alerta.motivo]] as [string, string][] : []),
        ]}>
        <ResumenInforme cifras={[
          ['Ingresos', numero(filas.length)], ['Días con ingreso', numero(dias)],
          ['Primer ingreso', filas[0] ? fechaHora(filas[0].fecha_hora_ingreso) : '—'],
          ['Último ingreso', filas.length ? fechaHora(filas[filas.length - 1].fecha_hora_ingreso) : '—'],
        ]} />
        {filas.length
          ? <TablaAccesosInforme filas={filas} sinPlaca onAbrir={d => navigate(`/detecciones/${d.id}`)} />
          : <p className="informe-vacio">El vehículo {formatearPlaca(consulta.placa)} no registra ingresos{consulta.desde || consulta.hasta ? ' en el período' : ''}.</p>}
      </Informe>
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
  const [generando, setGenerando] = useState<'pdf' | 'xlsx' | null>(null);
  const descargar = async (formato: 'pdf' | 'xlsx') => {
    setGenerando(formato);
    try {
      const x = await api.get('/reportes/control-vehicular', { params: { desde: limiteDia(desde), hasta: limiteDia(hasta, true), turno, formato }, responseType: 'blob' });
      descargarBlob(x.data, nombreDescarga(x.headers['content-disposition'], `control_vehicular_${desde}_${hasta}_${turno}.${formato}`));
    } catch (e) {
      notificar('error', 'No se pudo generar la hoja de control', await mensajeErrorDescarga(e));
    } finally { setGenerando(null); }
  };
  return (
    <Tarjeta titulo="Hoja de control vehicular de la garita"
      subtitulo="Formato oficial con el logo del ECU 911: fecha, nombres y apellidos, tipo, marca, placa, horas de ingreso y salida y motivo, con la firma del agente.">
      <div className="filtros">
        <SelectorPeriodo prefijo="rc" desde={desde} hasta={hasta} onCambiar={(d, h) => { setDesde(d || hoy); setHasta(h || hoy); }} />
        <div className="campo"><span className="etiqueta-campo">Turno</span>
          <Segmentado<Turno> valor={turno} onCambiar={setTurno} opciones={[
            { valor: 'completo', etiqueta: 'Día completo' }, { valor: 'diurno', etiqueta: 'Diurno 07:00–19:00' }, { valor: 'nocturno', etiqueta: 'Nocturno 19:00–07:00' },
          ]} />
        </div>
        <div className="fila" style={{ marginLeft: 'auto' }}>
          <button className="btn btn-secondary" onClick={() => descargar('xlsx')} disabled={generando !== null}><FileSpreadsheet size={15} /> {generando === 'xlsx' ? 'Generando…' : 'Excel'}</button>
          <button className="btn btn-navy" onClick={() => descargar('pdf')} disabled={generando !== null}><FileText size={15} /> {generando === 'pdf' ? 'Generando…' : 'PDF'}</button>
        </div>
      </div>
    </Tarjeta>
  );
};

const Reportes: React.FC = () => {
  const [vista, setVista] = useState<Vista>('accesos');
  return (
    <div className="pagina">
      <div className="encabezado-pagina no-imprimir">
        <div>
          <h2>Reportes</h2>
          <p>Consulte e imprima los accesos registrados por período, el historial de un vehículo o la hoja de control de la garita.</p>
        </div>
      </div>
      <div className="pila">
        <div className="no-imprimir">
          <Pestanas<Vista> valor={vista} onCambiar={setVista} opciones={[
            { valor: 'accesos', etiqueta: 'Accesos por fecha', icono: <ShieldCheck size={15} /> },
            { valor: 'vehiculo', etiqueta: 'Historial de un vehículo', icono: <CarFront size={15} /> },
            { valor: 'control', etiqueta: 'Hoja de control de garita', icono: <ClipboardList size={15} /> },
          ]} />
        </div>
        {vista === 'accesos' && <ReporteAccesos />}
        {vista === 'vehiculo' && <ReporteVehiculo />}
        {vista === 'control' && <HojaControl />}
      </div>
    </div>
  );
};

export default Reportes;
