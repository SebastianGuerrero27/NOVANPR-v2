/**
 * Prueba funcional de punta a punta sobre docker-compose.multicamara.yml, con dos motores de 2 cámaras cada
 * uno: reparto, cámaras que no caben, cámara solo de video, caída y regreso de un motor, zonas, y salida
 * automática por la cámara de salida. Placas ficticias (prefijo ZZ).
 *
 * La lanza multicamara_funcional.sh, que levanta el sistema y crea el usuario administrador.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';

const BASE = 'http://127.0.0.1:15000/api';
const COMPOSE = ['compose', '-p', 'anpr-multicamara', '-f', path.join(import.meta.dirname, 'docker-compose.multicamara.yml'), '--profile', 'varios-motores'];
const b64 = v => Buffer.from(v).toString('base64url');
function firmar(id) {
  const c = b64(JSON.stringify({ id, email: 'carga.admin@prueba.invalid', username: 'carga.admin@prueba.invalid', nombre: 'Admin de carga', rol: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 }));
  const base = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${c}`;
  return `${base}.${crypto.createHmac('sha256', process.env.CARGA_JWT_SECRET).update(base).digest('base64url')}`;
}
const SESION = { Authorization: `Bearer ${firmar(Number(process.env.CARGA_USUARIO_ID))}` };
const SERVICIO = { 'X-Servicio-Token': process.env.CARGA_SERVICE_TOKEN };

async function api(metodo, ruta, cuerpo, encabezados = SESION) {
  const r = await fetch(BASE + ruta, {
    method: metodo, headers: { 'Content-Type': 'application/json', ...encabezados }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}

let fallas = 0;
const resumen = [];
function ok(condicion, texto) {
  console.log(`${condicion ? '✔' : '✘'} ${texto}`);
  resumen.push({ ok: Boolean(condicion), texto });
  if (!condicion) fallas++;
}
const espera = ms => new Promise(r => setTimeout(r, ms));
async function hasta(condicion, topeS = 60) {
  const limite = Date.now() + topeS * 1000;
  let valor;
  while (Date.now() < limite) {
    valor = await condicion();
    if (valor) return valor;
    await espera(1000);
  }
  return valor;
}
const estado = async () => (await api('GET', '/monitoreo/estado')).data;
const docker = (...args) => execFileSync('docker', [...COMPOSE, ...args], { stdio: 'pipe', env: process.env });

// ─── Varias cámaras ───────────────────────────────────────────────────────────

async function alta(i, direccion = 'ingreso') {
  const r = await api('POST', '/camaras', { nombre: `Camara ${i}`, ubicacion: 'Banco de pruebas', rtsp_url: `rtsp://camaras:8554/cam${i}`, direccion });
  if (r.status !== 201) throw new Error(`alta de la cámara ${i}: HTTP ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.camera;
}

const camaras = [await alta(1), await alta(2), await alta(3), await alta(4, 'salida')];
ok(camaras.every(c => c.analisis_anpr === true), 'por omisión una cámara nueva se analiza');
const ids = camaras.map(c => c.id);
const conVideo = e => (e?.camaras ?? []).filter(c => c.conectada && c.fps_captura >= 5).map(c => c.id);

let e = await hasta(async () => { const x = await estado(); return conVideo(x).length === 4 && x; }, 150);
ok(e && conVideo(e).length === 4, `4 cámaras analizándose a la vez: ${JSON.stringify(e?.camaras?.map(c => [c.id, c.motor, c.fps_captura]))}`);
ok(e?.motores?.every(m => m.camaras.length === 2), `repartidas entre 2 motores: ${JSON.stringify(e?.motores?.map(m => m.camaras))}`);
ok(e?.capacidad === 4 && e?.sin_capacidad?.length === 0, 'capacidad total informada y ninguna a la espera');

const delMotor = (x, i) => x.camaras.find(c => c.id === i)?.motor;
const urls = ['http://localhost:18000', 'http://localhost:18001'];
for (const i of ids) {
  const t = await api('POST', '/monitoreo/ticket', { alcance: 'stream', camara_id: i });
  ok(t.data?.url === urls[delMotor(e, i)], `el ticket de la cámara ${i} lleva al motor que la atiende (${t.data?.url})`);
}
// El navegador abre las pistas en ese motor; en el otro la cámara no existe
{
  const propio = delMotor(e, ids[0]);
  const t = await api('POST', '/monitoreo/ticket', { alcance: 'stream', camara_id: ids[0] });
  const abrir = url => new Promise(resolve => {
    const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/ws/pistas?ticket=${encodeURIComponent(t.data.ticket)}&camara_id=${ids[0]}`);
    const fin = v => { try { ws.close(); } catch { /* ya cerrado */ } resolve(v); };
    ws.onmessage = () => fin('mensaje');
    ws.onclose = ev => fin(`cierre ${ev.code}`);
    ws.onerror = () => undefined;
    setTimeout(() => fin('sin respuesta'), 8000);
  });
  ok(await abrir(urls[propio]) === 'mensaje', 'las pistas llegan desde el motor de la cámara');
  ok(String(await abrir(urls[1 - propio])).startsWith('cierre'), 'el otro motor rechaza esa cámara');
}

// Una quinta cámara no cabe: se avisa; marcada solo de video deja de pedir capacidad
const quinta = await alta(5);
e = await hasta(async () => { const x = await estado(); return x.sin_capacidad?.includes(quinta.id) && x; }, 30);
ok(e?.sin_capacidad?.includes(quinta.id), 'una cámara que no cabe queda a la espera y se informa');
ok(e?.camaras?.every(c => c.id !== quinta.id), 'los motores no se saturan: no la toman');
const solo = await api('PUT', `/camaras/${quinta.id}`, { nombre: 'Camara 5', ubicacion: 'Banco de pruebas', rtsp_url: 'rtsp://camaras:8554/cam5', analisis_anpr: false });
ok(solo.status === 200 && solo.data?.camera?.analisis_anpr === false, 'se puede dejar una cámara solo con video');
e = await hasta(async () => { const x = await estado(); return x.sin_capacidad?.length === 0 && x; }, 30);
ok(e?.sin_capacidad?.length === 0, 'una cámara solo de video no ocupa capacidad');

// Un motor cae: sus cámaras no se pierden si hay lugar; aquí no lo hay, así que quedan a la espera y vuelven
const camarasA = e.motores[0].camaras;
const camarasB = e.motores[1].camaras;
docker('stop', 'anpr2');
e = await hasta(async () => { const x = await estado(); return x.sin_capacidad?.length === 2 && x; }, 45);
ok(e?.motores?.[1]?.en_linea === false && e?.motores?.[0]?.camaras.join() === camarasA.join(), 'al caer un motor, el otro sigue con las suyas sin interrupción');
ok(e?.sin_capacidad?.join() === camarasB.join(), 'las cámaras del motor caído quedan a la espera (no caben en el otro)');
// Con lugar en el motor que queda, una cámara del motor caído pasa a él
await api('PATCH', `/camaras/${camarasA[0]}/toggle`);
e = await hasta(async () => { const x = await estado(); return x.motores?.[0]?.camaras.length === 2 && x.motores[0].camaras.some(i => camarasB.includes(i)) && x; }, 45);
ok(Boolean(e), `al liberarse un lugar, toma una cámara del motor caído: ${JSON.stringify(e?.motores?.[0]?.camaras)}`);
await api('PATCH', `/camaras/${camarasA[0]}/toggle`);
docker('start', 'anpr2');
e = await hasta(async () => { const x = await estado(); return conVideo(x).length === 4 && x.sin_capacidad?.length === 0 && x; }, 180);
ok(Boolean(e), `el motor vuelve y retoma las cámaras a la espera: ${JSON.stringify(e?.motores?.map(m => m.camaras))}`);

// Las zonas llegan al motor de la cámara
const roi = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9]];
const conRoi = await api('PUT', `/camaras/${ids[3]}/roi`, { roi });
ok(conRoi.status === 200, 'zona de interés guardada');
const motorZona = delMotor(await estado(), ids[3]);
const zona = await hasta(async () => {
  const s = await fetch(`${urls[motorZona]}/status`, { headers: SERVICIO }).then(r => r.json());
  return JSON.stringify(s.camaras.find(c => c.id === ids[3])?.roi) === JSON.stringify(roi);
}, 20);
ok(zona, 'la zona llega al motor que atiende la cámara');

// ─── Salida automática ────────────────────────────────────────────────────────

const [entrada, , , salidaCam] = camaras;
let pista = 500_000;
async function paso(placa, camara, lectura = true) {
  const i = await api('POST', '/detecciones/ingreso', { tracking_id: ++pista, ruta_imagen_ingreso: '/media/ficticia.jpg', confianza_deteccion: 0.9, fuente: 'rtsp', camara_id: camara.id, placa }, SERVICIO);
  const id = i.data?.ingreso_id;
  if (!id) throw new Error(`fase 1: HTTP ${i.status} ${JSON.stringify(i.data)}`);
  const o = await api('POST', '/detecciones/completar-ocr', { ingreso_id: id, placa_reconocida: placa, confianza_ocr: 0.95, ruta_imagen_placa: '/media/ficticia.jpg', lectura_valida: lectura }, SERVICIO);
  if (o.status !== 200) throw new Error(`fase 2: HTTP ${o.status} ${JSON.stringify(o.data)}`);
  return id;
}
const detalle = async id => (await api('GET', `/detecciones/${id}`)).data;
const parametros = valores => api('PUT', '/configuracion', { valores });

let cfg = (await api('GET', '/configuracion')).data?.parametros ?? [];
ok(cfg.find(p => p.clave === 'salida_automatica_habilitada')?.valor === 'false', 'la salida automática viene desactivada');

// Desactivada: la salida es un movimiento aparte
const i1 = await paso('ZZA-1001', entrada);
const s1 = await paso('ZZA-1001', salidaCam);
ok((await detalle(s1))?.tipo_movimiento === 'salida', 'la cámara de salida registra un movimiento de salida');
ok(!(await detalle(i1))?.fecha_hora_salida, 'desactivada: el ingreso sigue abierto');

// Activada, con el tiempo mínimo por omisión: un ingreso recién hecho no se cierra
ok((await parametros({ salida_automatica_habilitada: true })).status === 200, 'se activa en Configuración');
const i2 = await paso('ZZA-1002', entrada);
await paso('ZZA-1002', salidaCam);
ok(!(await detalle(i2))?.fecha_hora_salida, 'un vehículo que acaba de entrar no se cierra (tiempo mínimo de 60 s)');

ok((await parametros({ salida_automatica_minimo_segundos: 0 })).status === 200, 'tiempo mínimo ajustable');
const i3 = await paso('ZZA-1003', entrada);
await espera(1100);
const s3 = await paso('ZZA-1003', salidaCam);
let d3 = await detalle(i3);
ok(Boolean(d3?.fecha_hora_salida) && d3?.salida_automatica === true, 'la cámara de salida cierra sola el ingreso de esa placa');
ok(new Date(d3.fecha_hora_salida).getTime() === new Date((await detalle(s3)).fecha_hora_ingreso).getTime(), 'la hora de salida es la del paso por la cámara');
ok(d3?.auditoria?.some(a => a.accion === 'SALIDA_AUTOMATICA'), 'queda en la auditoría');

// Otras placas no se tocan; una placa parecida tampoco; lectura sin confirmar tampoco
const i4 = await paso('ZZA-1004', entrada);
await espera(1100);
await paso('ZZA-1005', salidaCam);
await paso('ZZA-1O04', salidaCam);
ok(!(await detalle(i4))?.fecha_hora_salida, 'una placa distinta o parecida (0 por O) no cierra el ingreso');
await paso('ZZA-1004', salidaCam, false);
ok(!(await detalle(i4))?.fecha_hora_salida, 'una lectura sin confirmar no cierra el ingreso');
await api('POST', '/detecciones/reevaluar', { ingreso_id: (await paso('ZZA-1004', salidaCam, false)), lectura_valida: true, placa_reconocida: 'ZZA-1004' }, SERVICIO);
ok(Boolean((await detalle(i4))?.fecha_hora_salida), 'la confirmación tardía del segundo OCR sí lo cierra');

// Corrección de la lectura: reabre el equivocado y cierra el correcto
const i5 = await paso('ZZA-1006', entrada);
const i6 = await paso('ZZA-1007', entrada);
await espera(1100);
const s5 = await paso('ZZA-1006', salidaCam);
ok(Boolean((await detalle(i5))?.fecha_hora_salida), 'cierra el ingreso que leyó');
const corregida = await api('POST', `/detecciones/validar/${s5}`, { placa_validada: 'ZZA-1007' });
ok(corregida.status === 200, `el guardia corrige la lectura de la salida (HTTP ${corregida.status})`);
ok(!(await detalle(i5))?.fecha_hora_salida, 'el ingreso equivocado se reabre');
ok((await detalle(i6))?.salida_automatica === true, 'el ingreso correcto se cierra');
// Eliminar la salida reabre el ingreso
const borrar = await api('DELETE', `/detecciones/${s5}`, { motivo: 'Lectura de prueba' });
ok(borrar.status === 200, 'se elimina la salida');
ok(!(await detalle(i6))?.fecha_hora_salida, 'al eliminarla, el ingreso que cerró se reabre');

// Vuelve a entrar: se cierra el ingreso abierto más reciente, una sola vez
const i7 = await paso('ZZA-1008', entrada);
await espera(1100);
await paso('ZZA-1008', salidaCam);
await espera(36000); // dentro de 35 s, la misma placa en la misma cámara es el mismo paso físico
const i8 = await paso('ZZA-1008', entrada);
ok(Boolean((await detalle(i7))?.fecha_hora_salida) && !(await detalle(i8))?.fecha_hora_salida, 'una segunda visita abre un ingreso nuevo y no reabre el anterior');
const salidaManual = await api('POST', `/detecciones/${i7}/salida`);
ok(salidaManual.status === 400, 'no se puede registrar a mano una salida que ya registró la cámara');

// Registro manual en la cámara de salida
await espera(1100);
const manual = await api('POST', '/detecciones/registro-manual', { placa: 'ZZA-1008', motivo: 'Cámara de salida sin lectura', camara_id: salidaCam.id });
ok(manual.status === 200 || manual.status === 201, `registro manual de salida (HTTP ${manual.status})`);
ok(Boolean((await detalle(i8))?.fecha_hora_salida), 'la salida manual del guardia también cierra el ingreso');

// Desactivada de nuevo: una corrección no cierra, pero no deja cierres huérfanos
ok((await parametros({ salida_automatica_habilitada: false })).status === 200, 'se desactiva');
const i9 = await paso('ZZA-1009', entrada);
await espera(1100);
await paso('ZZA-1009', salidaCam);
ok(!(await detalle(i9))?.fecha_hora_salida, 'desactivada de nuevo: no cierra');

console.log(JSON.stringify({ verificaciones: resumen.length, fallas }));
process.exit(fallas ? 1 : 0);
