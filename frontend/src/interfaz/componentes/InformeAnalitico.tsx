import React from 'react';
import { AlertTriangle, Info, TrendingUp } from 'lucide-react';
import api from '../../infraestructura/api';
import type { AnalisisHistorial, ResumenHistorial } from '../../dominio/tipos';
import { fecha, numero, SERIES_ESTADO } from '../../dominio/formato';
import { formatearPlaca } from '../../dominio/validacion';
import { type Barra, DIAS_CORTOS, DIAS_SEMANA, franjaHabitual, type Hallazgo, type Unidad } from '../../dominio/analisisAccesos';
import { BarrasApiladas, Leyenda } from './Graficos';

/**
 * Partes analíticas de los informes de Reportes (período, vehículo y persona): hallazgos escritos,
 * ingresos en el tiempo por estado, por día de la semana y por hora, el mapa día × hora y los
 * vehículos y personas más frecuentes. Se imprimen con el informe (SVG que se ajusta a la hoja).
 */

export interface DatosAnalisis { resumen: ResumenHistorial; analisis: AnalisisHistorial }

/** Totales y análisis con los mismos filtros (solo ingresos). */
export async function cargarAnalisis(params: Record<string, string | undefined>): Promise<DatosAnalisis> {
  const consulta = { ...params, movimiento: 'ingreso' };
  const [resumen, analisis] = await Promise.all([
    api.get<ResumenHistorial>('/detecciones/historial/resumen', { params: consulta }).then(r => r.data),
    api.get<AnalisisHistorial>('/detecciones/historial/analisis', { params: consulta }).then(r => r.data),
  ]);
  return { resumen, analisis };
}

/** Una sola tinta para los gráficos de una serie (la del encabezado del informe). */
const TINTA = '#14315c';
const SERIE_INGRESOS = [{ clave: 'ingresos', etiqueta: 'Ingresos', color: TINTA }] as const;
/** Escala secuencial de un solo tono, de claro a oscuro, para el mapa día × hora. */
const ESCALA_MAPA = ['#e3e9f2', '#b3c3db', '#7a94bb', '#14315c'] as const;

const ICONO: Record<Hallazgo['tipo'], React.ReactNode> = {
  patron: <TrendingUp size={15} aria-hidden="true" />,
  aviso: <AlertTriangle size={15} aria-hidden="true" />,
  dato: <Info size={15} aria-hidden="true" />,
};

const ORDEN: Record<Hallazgo['tipo'], number> = { aviso: 0, patron: 1, dato: 2 };

/** Puntos clave del informe: primero lo que hay que revisar, luego las costumbres y los datos; como mucho `max`. */
export const Hallazgos: React.FC<{ items: Hallazgo[]; max?: number }> = ({ items, max = 6 }) => {
  const elegidos = items.map((h, i) => ({ h, i })).sort((a, b) => ORDEN[a.h.tipo] - ORDEN[b.h.tipo] || a.i - b.i).slice(0, max).map(x => x.h);
  return elegidos.length ? (
    <section className="informe-hallazgos" aria-label="Puntos clave">
      <h2>Puntos clave</h2>
      <ul>{elegidos.map(h => <li key={h.texto} className={`hallazgo-${h.tipo}`}>{ICONO[h.tipo]}<span>{h.texto}</span></li>)}</ul>
    </section>
  ) : null;
};

const Figura: React.FC<{ titulo: string; detalle?: string; acciones?: React.ReactNode; ancho?: boolean; children: React.ReactNode }> =
  ({ titulo, detalle, acciones, ancho, children }) => (
    <figure className={`informe-grafico${ancho ? ' ancho' : ''}`}>
      <figcaption><div><strong>{titulo}</strong>{detalle && <span>{detalle}</span>}</div>{acciones}</figcaption>
      {children}
    </figure>
  );

const TITULO_UNIDAD: Record<Unidad, string> = { dia: 'Ingresos por día', semana: 'Ingresos por semana', mes: 'Ingresos por mes' };

/** Ingresos en el tiempo, apilados por estado. */
export const GraficoEnElTiempo: React.FC<{ barras: Barra[]; unidad: Unidad }> = ({ barras, unidad }) => {
  const series = SERIES_ESTADO.filter(s => barras.some(b => b[s.clave as keyof Barra] as number > 0));
  return (
    <Figura titulo={TITULO_UNIDAD[unidad]} detalle={unidad === 'semana' ? 'De lunes a domingo, por estado' : 'Por estado'}
      acciones={series.length > 1 ? <Leyenda series={series} /> : undefined}>
      <BarrasApiladas datos={barras} series={series.length ? series : SERIES_ESTADO.slice(0, 1)} etiquetaX={b => b.etiqueta} tituloTip={b => b.titulo}
        cadaEtiqueta={Math.max(1, Math.ceil(barras.length / 14))} alto={200} />
    </Figura>
  );
};

const indiceMayor = (v: number[]) => (Math.max(...v) > 0 ? v.indexOf(Math.max(...v)) : undefined);

export const GraficoDiasSemana: React.FC<{ valores: number[] }> = ({ valores }) => {
  const mayor = indiceMayor(valores);
  return (
    <Figura titulo="Por día de la semana" detalle={mayor !== undefined ? `Más ingresos: ${DIAS_SEMANA[mayor]}` : undefined}>
      <BarrasApiladas datos={DIAS_CORTOS.map((d, i) => ({ dia: d, ingresos: valores[i] ?? 0 }))} series={SERIE_INGRESOS}
        etiquetaX={d => d.dia} tituloTip={(_d, i) => DIAS_SEMANA[i]} resaltar={mayor} alto={180} />
    </Figura>
  );
};

export const GraficoHoras: React.FC<{ valores: number[] }> = ({ valores }) => {
  const [h, n] = franjaHabitual(valores);
  const hh = (x: number) => `${String(x % 24).padStart(2, '0')}:00`;
  return (
    <Figura titulo="Hora de ingreso" detalle={n > 0 ? `Franja con más ingresos: ${hh(h)}–${hh(h + 2)}` : undefined}>
      <BarrasApiladas datos={valores.map((v, i) => ({ hora: i, ingresos: v }))} series={SERIE_INGRESOS}
        etiquetaX={d => String(d.hora).padStart(2, '0')} tituloTip={d => `${hh(d.hora)}–${hh(d.hora + 1)}`}
        cadaEtiqueta={3} resaltar={indiceMayor(valores)} alto={180} />
    </Figura>
  );
};

/** Mapa de calor día de la semana × hora: cuándo se concentran los ingresos. */
export const MapaDiaHora: React.FC<{ matriz: number[][] }> = ({ matriz }) => {
  const max = Math.max(0, ...matriz.flat());
  const nivel = (v: number) => (v <= 0 || !max ? -1 : Math.min(ESCALA_MAPA.length - 1, Math.floor((v / max) * ESCALA_MAPA.length - 1e-9)));
  return (
    <Figura titulo="Día y hora de ingreso" detalle="Cada celda es una hora de un día de la semana; más oscura, más ingresos" ancho>
      <div className="mapa-calor" role="table" aria-label="Ingresos por día de la semana y hora">
        <div className="mapa-fila" role="row">
          <span role="columnheader" />
          {Array.from({ length: 24 }, (_, h) => <span key={h} className="mapa-hora" role="columnheader">{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span>)}
        </div>
        {matriz.map((horas, d) => (
          <div className="mapa-fila" role="row" key={d}>
            <span className="mapa-dia" role="rowheader">{DIAS_CORTOS[d]}</span>
            {horas.map((v, h) => {
              const k = nivel(v);
              return <span key={h} role="cell" className="mapa-celda" style={k >= 0 ? { background: ESCALA_MAPA[k] } : undefined}
                title={`${DIAS_SEMANA[d]} ${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00: ${numero(v)} ${v === 1 ? 'ingreso' : 'ingresos'}`}
                aria-label={`${DIAS_SEMANA[d]} ${h} h: ${v}`} />;
            })}
          </div>
        ))}
      </div>
      <div className="mapa-escala" aria-hidden="true">
        <span>Sin ingresos</span><i className="mapa-celda" />
        <span style={{ marginLeft: 10 }}>Menos</span>{ESCALA_MAPA.map(c => <i key={c} className="mapa-celda" style={{ background: c }} />)}<span>Más</span>
      </div>
    </Figura>
  );
};

/**
 * Gráficos del informe: dos a la vista (en el tiempo y, según el informe, por día de la semana o por
 * hora) y el resto en «Ver detalle» (el otro gráfico y el mapa día × hora; no se imprime cerrado).
 */
export const GraficosAnalisis: React.FC<{ analisis: AnalisisHistorial; barras: Barra[]; unidad: Unidad; principal: 'semana' | 'hora' }> =
  ({ analisis, barras, unidad, principal }) => (
    <section className="informe-seccion">
      <div className="informe-graficos">
        <GraficoEnElTiempo barras={barras} unidad={unidad} />
        {principal === 'semana' ? <GraficoDiasSemana valores={analisis.por_dia_semana} /> : <GraficoHoras valores={analisis.por_hora} />}
      </div>
      <details className="informe-detalle">
        <summary>Ver detalle por {principal === 'semana' ? 'hora' : 'día de la semana'} y el mapa día × hora</summary>
        <div className="informe-graficos">
          {principal === 'semana' ? <GraficoHoras valores={analisis.por_hora} /> : <GraficoDiasSemana valores={analisis.por_dia_semana} />}
          <MapaDiaHora matriz={analisis.dia_hora} />
        </div>
      </details>
    </section>
  );

export const TablaFrecuentes: React.FC<{ filas: AnalisisHistorial['frecuentes']; titulo?: string; max?: number; onAbrir?: (placa: string) => void }> =
  ({ filas: todas, titulo = 'Vehículos más frecuentes', max = 10, onAbrir }) => { const filas = todas.slice(0, max); return filas.length ? (
    <section className="informe-seccion">
      <h2>{titulo}</h2>
      <table className="informe-tabla" aria-label={titulo}>
        <thead><tr><th className="num">N.º</th><th>Placa</th><th className="num">Ingresos</th><th>Último ingreso</th><th>Persona</th></tr></thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={f.placa} className={onAbrir ? 'clic' : undefined} onClick={onAbrir ? () => onAbrir(f.placa) : undefined}
              title={onAbrir ? `Ver el reporte del vehículo ${formatearPlaca(f.placa)}` : undefined}>
              <td className="num">{i + 1}</td><td className="informe-placa">{formatearPlaca(f.placa)}</td>
              <td className="num">{numero(f.ingresos)}</td><td className="nowrap">{fecha(f.ultimo)}</td><td>{f.persona ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  ) : null; };

export const TablaPersonas: React.FC<{ filas: AnalisisHistorial['personas']; titulo?: string; max?: number; onAbrir?: (nombre: string) => void }> =
  ({ filas: todas, titulo = 'Personas más frecuentes', max = 10, onAbrir }) => { const filas = todas.slice(0, max); return filas.length ? (
    <section className="informe-seccion">
      <h2>{titulo}</h2>
      <table className="informe-tabla" aria-label={titulo}>
        <thead><tr><th className="num">N.º</th><th>Nombres y apellidos</th><th className="num">Ingresos</th><th className="num">Vehículos</th><th>Último ingreso</th></tr></thead>
        <tbody>
          {filas.map((p, i) => (
            <tr key={p.nombre} className={onAbrir ? 'clic' : undefined} onClick={onAbrir ? () => onAbrir(p.nombre) : undefined}
              title={onAbrir ? `Ver el reporte de ${p.nombre}` : undefined}>
              <td className="num">{i + 1}</td><td>{p.nombre}</td><td className="num">{numero(p.ingresos)}</td>
              <td className="num">{numero(p.placas)}</td><td className="nowrap">{fecha(p.ultimo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  ) : null; };
