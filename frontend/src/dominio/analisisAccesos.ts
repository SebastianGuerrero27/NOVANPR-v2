import type { AnalisisHistorial, ResumenHistorial } from './tipos';
import { fecha, fechaIsoLocal, numero, sumarDias } from './formato';
import { formatearPlaca } from './validacion';

/**
 * Lectura de los ingresos para los informes (GET /detecciones/historial/analisis): ingresos agrupados
 * por día, semana o mes y los hallazgos que se escriben en el informe (día y franja horaria
 * habituales, frecuencia, permanencia, ingresos sin salida o no autorizados…). Todo en días de Ecuador.
 */

export const DIAS_SEMANA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const;
export const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;
const DIAS_PLURAL = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'] as const;

export type Unidad = 'dia' | 'semana' | 'mes';
export type Sujeto = 'periodo' | 'vehiculo' | 'persona';

/** Una barra del gráfico de ingresos en el tiempo, con los ingresos de cada estado. */
export interface Barra {
  clave: string;
  /** Etiqueta corta del eje */
  etiqueta: string;
  /** Título del tooltip y de los hallazgos */
  titulo: string;
  ingresos: number;
  autorizados: number;
  no_registrados: number;
  alertas: number;
  pendientes: number;
}

const fDiaMes = new Intl.DateTimeFormat('es-EC', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const fMes = new Intl.DateTimeFormat('es-EC', { timeZone: 'UTC', month: 'short', year: 'numeric' });
const fMesLargo = new Intl.DateTimeFormat('es-EC', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const utc = (ymd: string) => new Date(`${ymd}T12:00:00Z`);
const diaMes = (ymd: string) => fDiaMes.format(utc(ymd)).replace('.', '');

/** Días entre dos fechas AAAA-MM-DD (0 si son el mismo día). */
export const diasEntre = (desde: string, hasta: string) => Math.round((utc(hasta).getTime() - utc(desde).getTime()) / 86_400_000);

/** Lunes (AAAA-MM-DD) de la semana de un día. */
export function lunesDe(ymd: string): string {
  return sumarDias(ymd, -((utc(ymd).getUTCDay() + 6) % 7));
}

/** Día de Ecuador (AAAA-MM-DD) de un instante de la API. */
export const diaLocal = (v: string | Date) => fechaIsoLocal(new Date(v));

/** Unidad del gráfico según el largo del período: días hasta un mes, semanas hasta medio año, meses después. */
export function unidadPara(desde: string, hasta: string): Unidad {
  const dias = diasEntre(desde, hasta);
  return dias <= 31 ? 'dia' : dias <= 182 ? 'semana' : 'mes';
}

/**
 * Ingresos por día, semana (de lunes a domingo) o mes entre `desde` y `hasta`, con ceros donde no hubo
 * ingresos: una semana sin ingresos también dice algo del vehículo.
 */
export function agrupar(porDia: AnalisisHistorial['por_dia'], unidad: Unidad, desde: string, hasta: string): Barra[] {
  if (!desde || !hasta || desde > hasta) return [];
  const clave = (ymd: string) => (unidad === 'dia' ? ymd : unidad === 'semana' ? lunesDe(ymd) : ymd.slice(0, 7));
  const barras = new Map<string, Barra>();
  const nueva = (k: string): Barra => {
    if (unidad === 'dia') return { clave: k, etiqueta: diaMes(k), titulo: fecha(k), ingresos: 0, autorizados: 0, no_registrados: 0, alertas: 0, pendientes: 0 };
    if (unidad === 'semana') {
      return { clave: k, etiqueta: diaMes(k), titulo: `Semana del ${diaMes(k)} al ${fecha(sumarDias(k, 6))}`,
        ingresos: 0, autorizados: 0, no_registrados: 0, alertas: 0, pendientes: 0 };
    }
    const d = `${k}-01`;
    return { clave: k, etiqueta: fMes.format(utc(d)).replace('.', ''), titulo: fMesLargo.format(utc(d)),
      ingresos: 0, autorizados: 0, no_registrados: 0, alertas: 0, pendientes: 0 };
  };
  // Todas las barras del período, en orden (como mucho unos 400 días)
  for (let d = desde, n = 0; d <= hasta && n < 400; d = sumarDias(d, 1), n++) {
    const k = clave(d);
    if (!barras.has(k)) barras.set(k, nueva(k));
  }
  for (const x of porDia) {
    const b = barras.get(clave(x.dia));
    if (!b) continue;
    b.ingresos += x.ingresos;
    b.autorizados += x.autorizados;
    b.no_registrados += x.no_registrados;
    b.alertas += x.alertas;
    b.pendientes += x.pendientes;
  }
  return [...barras.values()];
}

/** "45 min", "2 h 15 min", "1 d 3 h". */
export function duracion(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  if (m < 60) return `${m} min`;
  if (m < 24 * 60) return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
  const d = Math.floor(m / 1440);
  const h = Math.round((m % 1440) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}

const pct = (parte: number, total: number) => `${Math.round((parte / total) * 100)} %`;
const veces = (n: number) => `${numero(n)} ${n === 1 ? 'vez' : 'veces'}`;
const ingresos = (n: number) => `${numero(n)} ${n === 1 ? 'ingreso' : 'ingresos'}`;
const hh = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;
const lista = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

/** Índices del máximo (todos los empatados). */
const maximos = (v: number[]) => {
  const max = Math.max(...v);
  return max > 0 ? v.flatMap((x, i) => (x === max ? [i] : [])) : [];
};

/** Las dos horas seguidas con más ingresos: [hora inicial, ingresos]. */
export function franjaHabitual(porHora: number[]): [number, number] {
  let mejor: [number, number] = [0, -1];
  for (let h = 0; h < 24; h++) {
    const n = porHora[h] + porHora[(h + 1) % 24];
    if (n > mejor[1]) mejor = [h, n];
  }
  return mejor;
}

/** Ingresos por semana en promedio entre dos días (al menos una semana). */
export const promedioSemanal = (total: number, desde: string, hasta: string) => total / Math.max(1, (diasEntre(desde, hasta) + 1) / 7);

export interface Hallazgo {
  /** patron: costumbre que se repite; aviso: algo que revisar; dato: información útil */
  tipo: 'patron' | 'aviso' | 'dato';
  texto: string;
}

/**
 * Hallazgos del informe, del más útil al menos útil. Solo se afirma una costumbre con al menos 3
 * ingresos; los avisos (lista negra, no autorizados, sin salida) siempre que existan.
 */
export function hallazgos(a: AnalisisHistorial, r: ResumenHistorial, sujeto: Sujeto,
  periodo: { desde: string; hasta: string; barras: Barra[]; unidad: Unidad }, hoy = fechaIsoLocal()): Hallazgo[] {
  const total = a.por_dia_semana.reduce((s, v) => s + v, 0);
  if (!total) return [];
  const salida: Hallazgo[] = [];
  const individual = sujeto !== 'periodo';

  if (total >= 3) {
    const dias = maximos(a.por_dia_semana);
    const n = a.por_dia_semana[dias[0]];
    if (dias.length && dias.length < 7) {
      const nombres = lista(dias.map(i => DIAS_PLURAL[i]));
      salida.push({ tipo: 'patron', texto: individual
        ? `Ingresa con más frecuencia los ${nombres}: ${dias.length > 1 ? `${ingresos(n)} cada día, ${pct(n * dias.length, total)} entre ${dias.length === 2 ? 'ambos' : 'ellos'}` : `${numero(n)} de ${ingresos(total)} (${pct(n, total)})`}.`
        : `${dias.length > 1 ? `Los días con más ingresos son los ${nombres}` : `El día de la semana con más ingresos es el ${DIAS_SEMANA[dias[0]]}`}: ${dias.length > 1 ? `${ingresos(n)} cada uno` : `${numero(n)} de ${ingresos(total)} (${pct(n, total)})`}.` });
    }
    const [h, enFranja] = franjaHabitual(a.por_hora);
    salida.push({ tipo: 'patron', texto: individual
      ? `Suele ingresar entre las ${hh(h)} y las ${hh(h + 2)}: ${numero(enFranja)} de ${ingresos(total)} (${pct(enFranja, total)}).`
      : `Hora pico: de ${hh(h)} a ${hh(h + 2)} llegan ${numero(enFranja)} de ${ingresos(total)} (${pct(enFranja, total)}).` });
  }

  // Quién: con quién ingresa el vehículo, qué vehículos usa la persona o el más frecuente del período
  if (sujeto === 'persona' && a.frecuentes.length) {
    salida.push({ tipo: 'dato', texto: a.frecuentes.length === 1
      ? `Siempre ingresó con el vehículo ${formatearPlaca(a.frecuentes[0].placa)}.`
      : `Usó ${a.frecuentes.length} vehículos: ${lista(a.frecuentes.slice(0, 3).map(f => `${formatearPlaca(f.placa)} (${veces(f.ingresos)})`))}${a.frecuentes.length > 3 ? ' y otros' : ''}.` });
  }
  if (sujeto === 'vehiculo' && a.personas.length) {
    salida.push({ tipo: 'dato', texto: a.personas.length === 1
      ? `Siempre lo ingresó ${a.personas[0].nombre}.`
      : `Lo ingresaron ${a.personas.length} personas: ${lista(a.personas.slice(0, 3).map(p => `${p.nombre} (${veces(p.ingresos)})`))}${a.personas.length > 3 ? ' y otras' : ''}.` });
  }
  if (sujeto === 'periodo' && a.frecuentes.length) {
    const f = a.frecuentes[0];
    salida.push({ tipo: 'dato', texto: `Ingresaron ${numero(r.placas)} ${r.placas === 1 ? 'vehículo' : 'vehículos distintos'}; el más frecuente, ${formatearPlaca(f.placa)}, ${f.ingresos === 1 ? 'ingresó una vez' : `ingresó ${veces(f.ingresos)}`}.` });
  }

  const conDatos = periodo.barras.filter(b => b.ingresos > 0);
  if (conDatos.length > 1) {
    const mayor = conDatos.reduce((m, b) => (b.ingresos > m.ingresos ? b : m));
    const que = periodo.unidad === 'dia' ? `El día con más ingresos fue el ${mayor.titulo}`
      : periodo.unidad === 'semana' ? `La semana con más ingresos fue la del ${mayor.titulo.replace(/^Semana del /, '')}`
        : `El mes con más ingresos fue ${mayor.titulo}`;
    salida.push({ tipo: 'dato', texto: `${que}: ${ingresos(mayor.ingresos)}.` });
  }

  if (individual && total >= 2 && periodo.desde && periodo.hasta) {
    const diasConIngreso = a.por_dia.length;
    const promedio = promedioSemanal(total, periodo.desde, periodo.hasta);
    salida.push({ tipo: 'dato', texto: `Ingresó ${numero(diasConIngreso)} ${diasConIngreso === 1 ? 'día distinto' : 'días distintos'}; en promedio ${promedio.toLocaleString('es-EC', { maximumFractionDigits: 1 })} ${promedio === 1 ? 'vez' : 'veces'} por semana.` });
  }

  if (a.permanencia) {
    const p = a.permanencia;
    salida.push({ tipo: 'dato', texto: p.n >= 3
      ? `${individual ? 'Permanece' : 'Los vehículos permanecen'} en promedio ${duracion(p.media_min)} (mediana ${duracion(p.mediana_min)}); el 90 % sale antes de ${duracion(p.p90_min)}.`
      : `${individual ? 'Permaneció' : 'Los vehículos permanecieron'} en promedio ${duracion(p.media_min)} (${numero(p.n)} ${p.n === 1 ? 'ingreso' : 'ingresos'} con salida).` });
  }

  if (r.alertas > 0) salida.push({ tipo: 'aviso', texto: `${ingresos(r.alertas)} en lista negra (alerta).` });
  if (r.no_registrados > 0) salida.push({ tipo: 'aviso', texto: `${ingresos(r.no_registrados)} no ${r.no_registrados === 1 ? 'autorizado' : 'autorizados'}.` });
  const sinSalida = Math.max(0, r.ingresos - r.con_salida);
  if (sinSalida > 0) {
    salida.push({ tipo: 'aviso', texto: `${ingresos(sinSalida)} sin salida registrada${individual ? '' : ': pueden seguir dentro o faltar su registro de salida'}.` });
  }
  if (!individual && r.ingresos > 0) {
    salida.push({ tipo: 'dato', texto: `El ${pct(r.autorizados, r.ingresos)} de los ingresos fue autorizado (${numero(r.autorizados)} de ${numero(r.ingresos)}).` });
  }

  const nocturnos = [22, 23, 0, 1, 2, 3, 4, 5].reduce((s, h) => s + a.por_hora[h], 0);
  if (nocturnos > 0 && nocturnos < total) {
    salida.push({ tipo: individual && nocturnos / total < 0.2 ? 'aviso' : 'dato',
      texto: `${ingresos(nocturnos)} de noche (22:00 a 06:00)${individual && nocturnos / total < 0.2 ? ', fuera de su horario habitual' : ''}.` });
  }

  if (individual && r.ultimo) {
    const dias = diasEntre(diaLocal(r.ultimo), hoy);
    salida.push({ tipo: 'dato', texto: `Último ingreso: ${fecha(r.ultimo)} (${dias <= 0 ? 'hoy' : dias === 1 ? 'ayer' : `hace ${numero(dias)} días`}).` });
  }
  return salida;
}
