import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, ListFilter, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import api, { mensajeErrorDescarga } from '../../infraestructura/api';
import { useConsulta, useRetardado } from '../../aplicacion/hooks';
import type { Camara, Deteccion, Pagina } from '../../dominio/tipos';
import { fecha, fechaIsoLocal, hora, limiteDia, nombreDescarga, numero } from '../../dominio/formato';
import { formatearPlaca, normalizarPlaca } from '../../dominio/validacion';
import { horasDelMovimiento } from '../../dominio/movimiento';
import { descargarBlob } from '../../infraestructura/descargas';
import { Aviso, FilasEsqueleto, InsigniaEstado, Paginacion, Tarjeta, Vacio } from './ui';
import { PeriodoCompacto } from './PeriodoCompacto';
import './ReportesRegistros.css';

const TAMANO = 50;
const MAX_PDF = 5000;
const ESTADOS: Record<string, { etiqueta: string; filtro?: string }> = {
  '': { etiqueta: 'Todos los estados' },
  autorizados: { etiqueta: 'Autorizados', filtro: 'autorizado' },
  no_autorizados: { etiqueta: 'No autorizados', filtro: 'no_reconocido,alerta' },
  alertas: { etiqueta: 'Lista negra', filtro: 'alerta' },
  pendientes: { etiqueta: 'Pendientes de autorización', filtro: 'pendiente_revision' },
  salidas: { etiqueta: 'Salidas registradas', filtro: 'salida_registrada' },
};
const MOVIMIENTOS: Record<string, string> = { '': 'Ingresos y salidas', ingreso: 'Solo ingresos', salida: 'Salidas sin ingreso' };
const SALIDAS: Record<string, string> = { '': 'Con y sin salida', si: 'Con salida registrada', no: 'Sin salida registrada' };
const FILTROS = ['buscar', 'placa', 'persona', 'desde', 'hasta', 'estado', 'camara', 'movimiento', 'cerrados'];

function errorFechas(desde: string, hasta: string): string | null {
  for (const dia of [desde, hasta].filter(Boolean)) {
    const instante = Date.parse(`${dia}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !Number.isFinite(instante) || new Date(instante).toISOString().slice(0, 10) !== dia) {
      return 'Seleccione fechas válidas para el período.';
    }
  }
  if (desde && hasta && desde > hasta) return 'La fecha de inicio debe ser anterior o igual a la fecha de fin.';
  if (desde > fechaIsoLocal() || hasta > fechaIsoLocal()) return 'Seleccione fechas hasta el día de hoy.';
  return null;
}

/** La lista y sus archivos comparten una sola consulta. Paginar nunca limita lo que se exporta. */
export const ReportesRegistros: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const buscarEscrito = params.get('buscar') ?? '';
  const buscar = useRetardado(buscarEscrito.trim(), 350);
  const placa = params.get('placa') ?? '';
  const persona = params.get('persona') ?? '';
  const placaFiltro = useRetardado(normalizarPlaca(placa), 350);
  const personaFiltro = useRetardado(persona.trim(), 350);
  const desde = params.get('desde') ?? '';
  const hasta = params.get('hasta') ?? '';
  const estado = ESTADOS[params.get('estado') ?? ''] ? params.get('estado') ?? '' : '';
  const movimiento = MOVIMIENTOS[params.get('movimiento') ?? ''] ? params.get('movimiento') ?? '' : '';
  const cerrados = SALIDAS[params.get('cerrados') ?? ''] ? params.get('cerrados') ?? '' : '';
  const camaraEntrada = params.get('camara') ?? '';
  const camara = /^\d+$/.test(camaraEntrada) && Number(camaraEntrada) >= 1 && Number(camaraEntrada) <= 2147483647 ? camaraEntrada : '';
  const paginaEntrada = Number(params.get('pagina') || 1);
  const pagina = Number.isInteger(paginaEntrada) && paginaEntrada >= 1 && paginaEntrada <= 2147483647 ? paginaEntrada : 1;
  const errorPeriodo = errorFechas(desde, hasta);
  const [masFiltros, setMasFiltros] = useState(Boolean(placa || persona || movimiento || cerrados));
  const [formato, setFormato] = useState<'pdf' | 'csv'>('pdf');
  const [generando, setGenerando] = useState(false);
  const [errorDescarga, setErrorDescarga] = useState<string | null>(null);
  const [descargado, setDescargado] = useState<string | null>(null);

  const cambiar = (cambios: Record<string, string | undefined>) => {
    setParams(actual => {
      const siguientes = new URLSearchParams(actual);
      for (const [k, v] of Object.entries(cambios)) { if (v) siguientes.set(k, v); else siguientes.delete(k); }
      if (!('pagina' in cambios)) siguientes.delete('pagina');
      return siguientes;
    }, { replace: true });
  };
  const consulta = {
    buscar: buscar || undefined, placa: placaFiltro || undefined, exacta: placaFiltro ? 'si' : undefined,
    persona: personaFiltro || undefined, desde: !errorPeriodo && desde ? limiteDia(desde) : undefined,
    hasta: !errorPeriodo && hasta ? limiteDia(hasta, true) : undefined, estado: ESTADOS[estado].filtro,
    camara: camara || undefined, movimiento: movimiento || undefined, cerrados: cerrados || undefined,
    unir_salidas: 'si', orden: 'reciente',
  };
  const clave = JSON.stringify(consulta);
  const lista = useConsulta(async () => {
    if (errorPeriodo) return null;
    const { data } = await api.get<Pagina<Deteccion>>('/detecciones', { params: { ...consulta, pagina, tamano: TAMANO } });
    return { clave, pagina, data };
  }, [clave, pagina, errorPeriodo]);
  const camaras = useConsulta<Camara[]>(() => api.get('/camaras').then(r => r.data), []);
  // También protege el primer render tras cambiar filtros, antes de que useConsulta active cargando.
  const coincide = lista.datos?.clave === clave && lista.datos?.pagina === pagina;
  const esperandoBusqueda = buscarEscrito.trim() !== buscar || normalizarPlaca(placa) !== placaFiltro || persona.trim() !== personaFiltro;
  const cargando = lista.cargando || !coincide || esperandoBusqueda;
  const datos = coincide ? lista.datos?.data : null;
  const total = datos?.total ?? 0;
  const listo = !errorPeriodo && !lista.error && !cargando && total > 0;
  const limitePdf = formato === 'pdf' && total > MAX_PDF;
  const hayFiltros = FILTROS.some(k => Boolean(params.get(k)));

  useEffect(() => { setErrorDescarga(null); setDescargado(null); }, [clave, buscarEscrito, placa, persona]);
  useEffect(() => { if (total > MAX_PDF) setFormato('csv'); }, [total]);

  const generar = async () => {
    if (!listo || limitePdf || generando) return;
    setGenerando(true); setErrorDescarga(null); setDescargado(null);
    // Captura la consulta que corresponde a la lista visible. Sin página ni tamaño.
    const filtros = { ...consulta };
    const cantidad = total;
    try {
      const { data, headers } = await api.get(formato === 'pdf' ? '/detecciones/historial/reporte.pdf' : '/detecciones/exportar', {
        params: filtros, responseType: 'blob', timeout: 120000,
      });
      descargarBlob(data, nombreDescarga(headers['content-disposition'], `registros_filtrados.${formato}`));
      setDescargado(`Reporte descargado en ${formato.toUpperCase()} con los filtros de esta lista (${numero(cantidad)} ${cantidad === 1 ? 'registro' : 'registros'} al consultar).`);
    } catch (e) { setErrorDescarga(await mensajeErrorDescarga(e, 'No se pudo generar el reporte de esta lista.')); }
    finally { setGenerando(false); }
  };
  const limpiar = () => cambiar(Object.fromEntries([...FILTROS, 'pagina'].map(k => [k, undefined])));
  const rows = datos?.items ?? [];
  const personaDe = (d: Deteccion) => d.persona_ingreso || d.autorizado?.propietario || '';

  return <div className="pila reporte-lista">
    <Tarjeta className="reporte-lista-controles no-imprimir">
      <fieldset className="reporte-lista-filtros" disabled={generando}>
        <legend className="solo-lectores">Filtros de los registros del reporte</legend>
        <div className="campo reporte-lista-buscar"><label htmlFor="rl-buscar">Buscar registros</label>
          <div className="input-icono"><Search size={15} /><input id="rl-buscar" className="input" value={buscarEscrito} maxLength={100}
            placeholder="Placa, nombres, cédula, motivo o vehículo" autoComplete="off" onChange={e => cambiar({ buscar: e.target.value || undefined })} />
            {buscarEscrito && <button type="button" className="input-limpiar" aria-label="Borrar búsqueda" onClick={() => cambiar({ buscar: undefined })}><X size={14} /></button>}
          </div>
        </div>
        <PeriodoCompacto id="rl" desde={desde} hasta={hasta} todo onCambiar={(d, h) => cambiar({ desde: d || undefined, hasta: h || undefined })} />
        <div className="campo"><label htmlFor="rl-estado">Estado</label>
          <select id="rl-estado" className="select" value={estado} onChange={e => cambiar(e.target.value === 'salidas'
            ? { estado: 'salidas', movimiento: 'salida', cerrados: undefined } : { estado: e.target.value || undefined,
              ...(movimiento === 'salida' && (estado === 'salidas' || e.target.value) ? { movimiento: undefined } : {}) })}>
            {Object.entries(ESTADOS).map(([k, e]) => <option key={k} value={k}>{e.etiqueta}</option>)}
          </select>
        </div>
        <div className="campo"><label htmlFor="rl-camara">Cámara</label>
          <select id="rl-camara" className="select" value={camara} onChange={e => cambiar({ camara: e.target.value || undefined })}>
            <option value="">Todas las cámaras</option>
            {camaras.datos?.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            {camara && !camaras.datos?.some(c => String(c.id) === camara) && <option value={camara}>Cámara #{camara}</option>}
          </select>
        </div>
        <button type="button" className="btn btn-secondary" aria-expanded={masFiltros} aria-controls="rl-mas" onClick={() => setMasFiltros(v => !v)}><SlidersHorizontal size={15} /> Más filtros</button>
        {hayFiltros && <button type="button" className="btn btn-ghost" onClick={limpiar}><X size={15} /> Limpiar filtros</button>}
        {masFiltros && <div id="rl-mas" className="reporte-lista-filtros-extra">
          <div className="campo"><label htmlFor="rl-placa">Placa exacta</label><input id="rl-placa" className="input placa-input" value={placa} maxLength={20}
            placeholder="ABC-1234" autoComplete="off" onChange={e => cambiar({ placa: normalizarPlaca(e.target.value) || undefined })} /></div>
          <div className="campo"><label htmlFor="rl-persona">Persona o cédula</label><input id="rl-persona" className="input" value={persona} maxLength={100}
            placeholder="Nombres, apellidos o cédula" autoComplete="off" onChange={e => cambiar({ persona: e.target.value || undefined })} /></div>
          <div className="campo"><label htmlFor="rl-movimiento">Movimiento</label>
            <select id="rl-movimiento" className="select" value={movimiento} onChange={e => cambiar({ movimiento: e.target.value || undefined,
              ...(e.target.value === 'salida' ? { cerrados: undefined, ...(estado && estado !== 'salidas' ? { estado: undefined } : {}) } : {}),
              ...(estado === 'salidas' && e.target.value !== 'salida' ? { estado: undefined } : {}) })}>
              {Object.entries(MOVIMIENTOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="campo"><label htmlFor="rl-cerrados">Salida del ingreso</label>
            <select id="rl-cerrados" className="select" value={cerrados} onChange={e => cambiar({ cerrados: e.target.value || undefined,
              ...(e.target.value ? { movimiento: 'ingreso', ...(estado === 'salidas' ? { estado: undefined } : {}) } : {}) })}>
              {Object.entries(SALIDAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>}
      </fieldset>
      {errorPeriodo && <p className="error reporte-lista-aviso" role="alert">{errorPeriodo}</p>}
      {camaras.error && <p className="texto-secundario reporte-lista-aviso">No se pudieron cargar los nombres de las cámaras. Puede continuar con los demás filtros.</p>}
      <div className="reporte-lista-generar">
        <div role="status" aria-live="polite"><strong>{errorPeriodo ? 'Revise el período' : lista.error ? 'No se pudo consultar la lista' : cargando ? 'Actualizando la lista…' : `${numero(total)} ${total === 1 ? 'registro coincide' : 'registros coinciden'}`}</strong>
          <p>El reporte incluirá todos los resultados de estos filtros, no solo la página visible.</p>
        </div>
        <div className="campo"><label htmlFor="rl-formato">Formato del reporte</label><select id="rl-formato" className="select" value={formato} disabled={generando}
          onChange={e => { setFormato(e.target.value as 'pdf' | 'csv'); setDescargado(null); }}>
          <option value="pdf" disabled={total > MAX_PDF}>PDF · para imprimir</option><option value="csv">CSV · abrir en Excel</option>
        </select></div>
        <button type="button" className="btn btn-navy" onClick={() => void generar()} disabled={!listo || limitePdf || generando}><Download size={15} /> {generando ? 'Generando…' : 'Generar reporte de esta lista'}</button>
      </div>
      {total > MAX_PDF && <p className="texto-secundario reporte-lista-aviso">Para más de {numero(MAX_PDF)} registros, descargue CSV o acote los filtros para generar un PDF.</p>}
      {errorDescarga && <p className="error reporte-lista-aviso" role="alert">{errorDescarga}</p>}
      {descargado && <p className="texto-exito reporte-lista-aviso" role="status">{descargado}</p>}
    </Tarjeta>
    <section className="tarjeta reporte-lista-resultados" aria-label="Registros del reporte">
      <header className="reporte-lista-cabecera"><div><h3>Registros incluidos</h3><p>Filtre desde la búsqueda o seleccione una placa o persona de la tabla.</p></div>
        <button type="button" className="btn btn-ghost btn-sm" disabled={cargando || generando || Boolean(errorPeriodo)} onClick={() => void lista.recargar()}><RefreshCw size={14} /> Actualizar</button></header>
      {lista.error && !errorPeriodo && <div className="reporte-lista-error"><Aviso tipo="error">{lista.error}</Aviso>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void lista.recargar()}>Reintentar consulta</button></div>}
      <div className="tabla-contenedor" role="region" aria-label="Lista filtrada de registros para el reporte" tabIndex={0} aria-busy={cargando && !errorPeriodo && !lista.error}>
        <table className="tabla reporte-lista-tabla">
          <thead><tr><th className="num">N.º</th><th>Fecha</th><th>Entrada</th><th>Salida</th><th>Placa</th><th>Persona / cédula</th><th>Vehículo</th><th>Motivo</th><th>Cámara</th><th>Estado</th></tr></thead>
          <tbody>{cargando && !errorPeriodo && !lista.error ? <FilasEsqueleto columnas={10} filas={5} /> : !errorPeriodo && !lista.error && rows.map((d, i) => {
            const tiempos = horasDelMovimiento(d), nombre = personaDe(d);
            return <tr key={d.id}>
              <td className="num">{numero((pagina - 1) * TAMANO + i + 1)}</td><td className="nowrap">{fecha(d.fecha_hora_ingreso)}</td>
              <td className="nowrap">{tiempos.entrada ? hora(tiempos.entrada) : '—'}</td><td className="nowrap">{tiempos.salida ? hora(tiempos.salida) : '—'}</td>
              <td className="nowrap">{d.placa ? <button type="button" className="reporte-lista-dato placa" disabled={generando}
                aria-label={`Filtrar por placa ${formatearPlaca(d.placa)}`} onClick={() => { cambiar({ placa: normalizarPlaca(d.placa) }); setMasFiltros(true); }}>{formatearPlaca(d.placa)}<ListFilter size={11} /></button> : 'Sin lectura'}</td>
              <td>{nombre ? <button type="button" className="reporte-lista-dato" disabled={generando} aria-label={`Filtrar por persona ${nombre}`}
                onClick={() => { cambiar({ persona: nombre }); setMasFiltros(true); }}>{nombre}</button> : '—'}
                {d.datos_permiso?.cedula && <small className="reporte-lista-secundario">C.I. {d.datos_permiso.cedula}</small>}</td>
              <td>{[d.vehiculo?.tipo ?? d.tipo_vehiculo, d.vehiculo?.marca, d.vehiculo?.modelo].filter(Boolean).join(' · ') || '—'}</td>
              <td>{d.motivo_ingreso || '—'}</td><td>{d.camara?.nombre ?? (d.fuente === 'manual' ? 'Registro manual' : '—')}</td>
              <td><InsigniaEstado estado={d.estado_validacion} procesando={d.estado_procesamiento === 'pendiente_ocr'} corta /></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {!cargando && !errorPeriodo && !lista.error && datos?.items.length === 0 && <Vacio titulo="No hay registros con estos filtros" texto="Ajuste la búsqueda, cambie el período o limpie los filtros para volver a ver todos los registros."
        accion={hayFiltros ? <button type="button" className="btn btn-secondary btn-sm" onClick={limpiar}>Limpiar filtros</button> : undefined} />}
      {datos && !cargando && !errorPeriodo && !lista.error && datos.total > 0 && <fieldset className="reporte-lista-paginacion" disabled={generando}>
        <Paginacion pagina={datos.pagina} tamano={datos.tamano} total={datos.total} onCambiar={p => cambiar({ pagina: String(p) })} />
      </fieldset>}
      {placa && !cargando && total > 0 && <button type="button" className="btn btn-ghost btn-sm reporte-lista-ficha" onClick={() => navigate(`/historial?placa=${encodeURIComponent(normalizarPlaca(placa))}`)}>Ver esta placa en el historial completo</button>}
    </section>
  </div>;
};
