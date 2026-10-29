import { formatearPlacaParcial } from '../../dominio/validacion';
import { tipificarPlaca } from '../../dominio/tipificacion';

/**
 * HUD de detección sobre el video, al estilo Rekor Scout / OpenALPR:
 *  - zona de movimiento MOG2 (verde translúcido) cuando el motor confirma un vehículo en ella;
 *  - región de interés (fuera de ella, oscurecido) y zonas de exclusión (rojo translúcido): ahí el
 *    motor no cuenta el movimiento ni busca placas;
 *  - caja fina de cada placa (1 px sobre un contorno oscuro, sin resplandor), con el
 *    cuadrilátero ajustado a la inclinación de la placa;
 *  - insignia con la lectura: "◌ ESCANEANDO OCR" o el texto parcial mientras el OCR lee, la placa
 *    por consenso al leerla y el estado decidido por el backend; barra de escaneo mientras lee.
 *
 * Dibuja con requestAnimationFrame. El motor mueve la caja en cada cuadro con flujo óptico y la
 * envía con su edad (cuánto hace que se midió); el navegador la adelanta con su velocidad hasta el
 * instante en que dibuja (edad + tiempo desde que llegó, máx. 250 ms) para que no quede detrás de
 * la placa, y desvanece las pistas que dejan de llegar. Sin pistas ni movimiento no vuelve a
 * dibujar hasta el próximo envío.
 *
 * Coordenadas normalizadas 0–1 respecto del cuadro de la fuente.
 */

export type Punto = [number, number];
type Caja = [number, number, number, number];

export interface PistaHud {
  id: number;
  caja: Caja;
  puntos: Punto[] | null;
  /** Fracción del cuadro por segundo */
  velocidad: [number, number];
  /** Segundos desde el cuadro en que vale la caja hasta que el motor la envió */
  edad: number;
  /** Confianza del detector (0–1) */
  confianza: number;
  /** Placa por consenso (formato ANT), o null mientras se lee */
  placa: string | null;
  /** Lectura cruda del OCR que aún no forma una placa */
  parcial: string | null;
  confianzaPlaca: number;
  estado: string | null;
}

export interface MovimientoHud { caja: Caja; porcentaje: number }

/** Rectángulo de la imagen dentro del elemento (object-fit: contain), en píxeles CSS. */
export interface AreaDibujo { ancho: number; alto: number; x: number; y: number; w: number; h: number }

/** Con `aspecto` (ancho/alto), la imagen se muestra estirada a esa proporción (object-fit: fill). */
/**
 * Coordenada normalizada (0–1 respecto del cuadro que analizó el motor) → píxeles del lienzo,
 * dentro del área donde se ve la imagen. Es lo que mantiene alineados los recuadros con el video
 * al cambiar el tamaño del reproductor o la proporción del flujo.
 */
export const aPantalla = (a: AreaDibujo, x: number, y: number): Punto => [a.x + x * a.w, a.y + y * a.h];

export function areaVideo(v: HTMLVideoElement, aspecto?: number | null): AreaDibujo {
  const r = v.getBoundingClientRect();
  const vw = aspecto || v.videoWidth || 16;
  const vh = aspecto ? 1 : v.videoHeight || 9;
  const esc = Math.min(r.width / vw, r.height / vh);
  return { ancho: r.width, alto: r.height, x: (r.width - vw * esc) / 2, y: (r.height - vh * esc) / 2, w: vw * esc, h: vh * esc };
}

// Colores iguales a los del motor y del sistema web
const COLOR_ESTADO: Record<string, string> = {
  autorizado: '#15803d', pendiente_revision: '#2563eb', no_reconocido: '#d97706', alerta: '#b91c1c',
};
const TEXTO_ESTADO: Record<string, string> = {
  autorizado: 'AUTORIZADO', pendiente_revision: 'POR CONFIRMAR', no_reconocido: 'NO REGISTRADO', alerta: 'ALERTA',
};
const COLOR_ESCANEANDO = '#f59e0b';
const COLOR_LEIDA = '#16a34a';

// Caja y etiqueta (ver dibujarPista)
const GROSOR_CAJA = 1;
const CONTORNO = 'rgba(0, 0, 0, 0.55)';
const SEPARADOR = '  •  ';
const ALTO_ETIQUETA = 20;
const BARRA_ETIQUETA = 3;
const FONDO_ETIQUETA = 'rgba(9, 13, 22, 0.86)';
const TEXTO_DETALLE = 'rgba(203, 213, 225, 0.92)';
const FUENTE_PLACA = '600 12px ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace';
const FUENTE_DETALLE = '500 11px Inter, system-ui, sans-serif';

const DESVANECER_PISTA_MS = 300;
const VIDA_MOVIMIENTO_MS = 600;
const ANTICIPACION_MAX_S = 0.25;
// El video del navegador va detrás del motor (búfer de reproducción y red): la caja se lleva hacia
// atrás con su velocidad hasta el cuadro que se está mostrando, como máximo este tiempo
const RETRASO_MAX_S = 0.6;

function conAlfa(hex: string, alfa: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alfa})`;
}

/** Placa leída, su tipificación (particular, gobierno…) y el estado decidido por el backend. */
export function textoInsignia(p: PistaHud): string {
  if (p.placa) {
    const estado = p.estado ? TEXTO_ESTADO[p.estado] : undefined;
    const tipo = tipificarPlaca(p.placa);
    return [formatearPlacaParcial(p.placa), tipo?.corta, estado ?? `${Math.round(p.confianzaPlaca * 100)}%`].filter(Boolean).join('  •  ');
  }
  const pct = `${Math.round(p.confianza * 100)}%`;
  return p.parcial && p.parcial.length >= 3 ? `◌ ${formatearPlacaParcial(p.parcial)}  •  ${pct}` : `◌ ESCANEANDO OCR  •  ${pct}`;
}

function colorPista(p: PistaHud): string {
  if (p.estado && COLOR_ESTADO[p.estado]) return COLOR_ESTADO[p.estado];
  return p.placa ? COLOR_LEIDA : COLOR_ESCANEANDO;
}

function dibujarRoi(ctx: CanvasRenderingContext2D, a: AreaDibujo, roi: Punto[]) {
  const X = (x: number) => aPantalla(a, x, 0)[0];
  const Y = (y: number) => aPantalla(a, 0, y)[1];
  ctx.beginPath();
  ctx.rect(a.x, a.y, a.w, a.h);
  roi.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
  ctx.closePath();
  ctx.fillStyle = 'rgba(2,6,23,0.38)';
  ctx.fill('evenodd');
  ctx.beginPath();
  roi.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
  ctx.closePath();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = 'rgba(125,211,252,0.9)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Zonas de exclusión: rojo translúcido con borde discontinuo. */
export function dibujarExclusiones(ctx: CanvasRenderingContext2D, a: AreaDibujo, zonas: Punto[][]) {
  for (const z of zonas) {
    if (z.length < 3) continue;
    ctx.beginPath();
    z.forEach(([x, y], i) => {
      const [px, py] = aPantalla(a, x, y);
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(239,68,68,0.16)';
    ctx.fill();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(248,113,113,0.85)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function dibujarMovimiento(ctx: CanvasRenderingContext2D, a: AreaDibujo, m: MovimientoHud, edadMs: number) {
  const [x1, y1] = aPantalla(a, m.caja[0], m.caja[1]);
  const w = Math.max(12, (m.caja[2] - m.caja[0]) * a.w);
  const h = Math.max(12, (m.caja[3] - m.caja[1]) * a.h);
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - edadMs / VIDA_MOVIMIENTO_MS) * 0.7;
  ctx.fillStyle = 'rgba(34, 197, 94, 0.10)';
  ctx.fillRect(x1, y1, w, h);
  ctx.strokeStyle = 'rgba(74, 222, 128, 0.65)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.strokeRect(x1, y1, w, h);
  ctx.setLineDash([]);
  const texto = `VEHÍCULO • MOV ${m.porcentaje}%`;
  ctx.font = 'bold 10px Inter, system-ui, monospace';
  const by = Math.max(a.y + 4, y1 - 18);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.fillRect(x1, by, ctx.measureText(texto).width + 14, 16);
  ctx.fillStyle = '#4ade80';
  ctx.fillText(texto, x1 + 7, by + 11.5);
  ctx.restore();
}

/**
 * Caja de la placa al estilo de los sistemas ANPR profesionales (OpenALPR, Rekor Scout): línea
 * continua fina (1 px, redondeada a píxeles físicos) en el color del estado, sobre un contorno oscuro que la hace legible
 * en cualquier fondo, sin resplandor ni relleno. La etiqueta va pegada a la esquina superior
 * izquierda de la caja (debajo si no cabe arriba): barra del color del estado, la placa en
 * monoespaciada y, más tenue, la tipificación y el estado.
 */
function dibujarPista(ctx: CanvasRenderingContext2D, a: AreaDibujo, p: PistaHud, dx: number, dy: number, opacidad: number, ahora: number) {
  // Desplazamiento (dx, dy) estimado por la velocidad de la pista entre envíos del motor
  const X = (x: number) => aPantalla(a, x + dx, 0)[0];
  const Y = (y: number) => aPantalla(a, 0, y + dy)[1];
  const color = colorPista(p);
  const dpr = window.devicePixelRatio || 1;
  const fisicos = Math.max(1, Math.round(GROSOR_CAJA * dpr));
  // Las líneas de ancho impar en píxeles físicos van al centro del píxel para que no se vean borrosas
  const ajustar = (v: number) => (Math.round(v * dpr) + (fisicos % 2 ? 0.5 : 0)) / dpr;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, opacidad));
  ctx.lineJoin = 'miter';

  let izquierda: number, arriba: number, abajo: number;
  ctx.beginPath();
  if (p.puntos && p.puntos.length === 4) {
    // Cuadrilátero ajustado a la inclinación de la placa
    const pts = p.puntos.map(([x, y]) => [X(x), Y(y)] as Punto);
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    izquierda = Math.min(...pts.map(q => q[0]));
    arriba = Math.min(...pts.map(q => q[1]));
    abajo = Math.max(...pts.map(q => q[1]));
  } else {
    const x1 = ajustar(X(p.caja[0])), y1 = ajustar(Y(p.caja[1]));
    const x2 = ajustar(Math.max(X(p.caja[0]) + 16, X(p.caja[2]))), y2 = ajustar(Math.max(Y(p.caja[1]) + 8, Y(p.caja[3])));
    ctx.rect(x1, y1, x2 - x1, y2 - y1);
    [izquierda, arriba, abajo] = [x1, y1, y2];
  }
  ctx.strokeStyle = CONTORNO;
  ctx.lineWidth = (fisicos + 2) / dpr;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = fisicos / dpr;
  ctx.stroke();

  // Etiqueta: placa y, separado, el resto de la lectura (tipificación, estado o confianza)
  const [placa, ...resto] = textoInsignia(p).split(SEPARADOR);
  const detalle = resto.join(' · ');
  ctx.font = FUENTE_PLACA;
  const anchoPlaca = ctx.measureText(placa).width;
  ctx.font = FUENTE_DETALLE;
  const anchoDetalle = detalle ? ctx.measureText(detalle).width : 0;
  const ancho = Math.ceil(BARRA_ETIQUETA + 7 + anchoPlaca + (detalle ? 8 + anchoDetalle : 0) + 7);
  const ex = Math.round(Math.max(a.x + 2, Math.min(a.x + a.w - ancho - 2, izquierda)));
  const ey = Math.round(arriba - ALTO_ETIQUETA - 2 >= a.y + 2 ? arriba - ALTO_ETIQUETA - 2 : abajo + 2);
  ctx.fillStyle = FONDO_ETIQUETA;
  ctx.fillRect(ex, ey, ancho, ALTO_ETIQUETA);
  ctx.fillStyle = color;
  ctx.fillRect(ex, ey, BARRA_ETIQUETA, ALTO_ETIQUETA);
  ctx.textBaseline = 'middle';
  ctx.font = FUENTE_PLACA;
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(placa, ex + BARRA_ETIQUETA + 7, ey + ALTO_ETIQUETA / 2 + 0.5);
  if (detalle) {
    ctx.font = FUENTE_DETALLE;
    ctx.fillStyle = TEXTO_DETALLE;
    ctx.fillText(detalle, ex + BARRA_ETIQUETA + 7 + anchoPlaca + 8, ey + ALTO_ETIQUETA / 2 + 0.5);
  }

  // Mientras el OCR todavía no tiene la placa: una línea fina de progreso bajo la etiqueta
  if (!p.placa) {
    ctx.fillStyle = conAlfa(COLOR_ESCANEANDO, 0.9);
    ctx.fillRect(ex, ey + ALTO_ETIQUETA, ancho * ((ahora / 800) % 1), 1.5);
  }
  ctx.restore();
}

/**
 * Segundos que hay que mover la caja con su velocidad para dibujarla en el cuadro que muestra el
 * video: desde que el motor la midió (edad al enviarla + tiempo desde que llegó) hasta ahora menos
 * el retardo del video. Positivo la adelanta; negativo la lleva hacia atrás, cuando el video va más
 * atrasado que la medición. Así no queda ni detrás de la placa ni por delante de ella.
 */
export function anticipoCaja(edad: number, desdeRecibida: number, retardoVideo: number): number {
  return Math.max(-RETRASO_MAX_S, Math.min(ANTICIPACION_MAX_S, edad + desdeRecibida - retardoVideo));
}

export interface Hud {
  /** Pistas y zona de movimiento del último envío del motor (y la región de interés y las zonas de exclusión, si se conocen). */
  actualizar: (pistas: PistaHud[], movimiento: MovimientoHud | null, roi?: Punto[] | null, exclusiones?: Punto[][]) => void;
  /** Retardo del video del navegador respecto del motor (segundos, de las estadísticas WebRTC) */
  fijarRetardoVideo: (segundos: number | null) => void;
  limpiar: () => void;
  detener: () => void;
}

export function crearHud(lienzo: HTMLCanvasElement, area: () => AreaDibujo | null): Hud {
  const pistas = new Map<number, { p: PistaHud; recibida: number; opacidad: number }>();
  let movimiento: { m: MovimientoHud; recibido: number } | null = null;
  let roi: Punto[] | null = null;
  let exclusiones: Punto[][] = [];
  let retardoVideo = 0;
  let pendiente = true;
  let ultimaArea = '';
  let previo = performance.now();
  let raf = 0;

  const cuadro = () => {
    raf = requestAnimationFrame(cuadro);
    const ahora = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (ahora - previo) / 1000));
    previo = ahora;
    const a = area();
    const claveArea = a ? `${a.ancho}x${a.alto}:${a.x},${a.y},${a.w},${a.h}` : '';
    if (!pendiente && pistas.size === 0 && !movimiento && claveArea === ultimaArea) return;
    pendiente = false;
    ultimaArea = claveArea;

    const ctx = lienzo.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (!a) { ctx.clearRect(0, 0, lienzo.width, lienzo.height); return; }
    if (lienzo.width !== Math.round(a.ancho * dpr) || lienzo.height !== Math.round(a.alto * dpr)) {
      lienzo.width = Math.round(a.ancho * dpr);
      lienzo.height = Math.round(a.alto * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, a.ancho, a.alto);

    if (roi && roi.length >= 3) dibujarRoi(ctx, a, roi);
    if (exclusiones.length) dibujarExclusiones(ctx, a, exclusiones);
    if (movimiento) {
      const edad = ahora - movimiento.recibido;
      if (edad >= VIDA_MOVIMIENTO_MS) movimiento = null;
      else dibujarMovimiento(ctx, a, movimiento.m, edad);
    }
    for (const [id, t] of pistas) {
      if (ahora - t.recibida > DESVANECER_PISTA_MS) {
        t.opacidad -= dt * 5;
        if (t.opacidad <= 0) { pistas.delete(id); continue; }
      }
      const anticipo = anticipoCaja(t.p.edad || 0, (ahora - t.recibida) / 1000, retardoVideo);
      dibujarPista(ctx, a, t.p, t.p.velocidad[0] * anticipo, t.p.velocidad[1] * anticipo, t.opacidad, ahora);
    }
  };
  raf = requestAnimationFrame(cuadro);

  return {
    actualizar(nuevas, mov, nuevoRoi, nuevasExclusiones) {
      const ahora = performance.now();
      for (const p of nuevas) pistas.set(p.id, { p, recibida: ahora, opacidad: 1 });
      if (mov) movimiento = { m: mov, recibido: ahora };
      if (nuevoRoi !== undefined) roi = nuevoRoi;
      if (nuevasExclusiones !== undefined) exclusiones = nuevasExclusiones;
      pendiente = true;
    },
    fijarRetardoVideo(segundos) {
      retardoVideo = segundos !== null && Number.isFinite(segundos) ? Math.max(0, Math.min(RETRASO_MAX_S, segundos)) : 0;
    },
    limpiar() {
      pistas.clear();
      movimiento = null;
      roi = null;
      exclusiones = [];
      pendiente = true;
    },
    detener() { cancelAnimationFrame(raf); },
  };
}
