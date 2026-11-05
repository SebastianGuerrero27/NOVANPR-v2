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

async function api(metodo, ruta, cuerpo, encabezados = SESION, reintento = true) {
  let r;
  try {
    r = await fetch(BASE + ruta, {
      method: metodo, headers: { 'Content-Type': 'application/json', ...encabezados }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    // Tras un `docker stop` (varios segundos sin pedidos) el servidor cierra la conexión que el cliente
    // reutiliza: el pedido no llegó a la API y se repite una vez
    if (reintento && e?.cause?.code === 'UND_ERR_SOCKET') return api(metodo, ruta, cuerpo, encabezados, false);
    throw e;
  }
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

// Otras placas no se tocan; una placa parecida tampoco; sin ninguna lectura confirmada tampoco
const i4 = await paso('ZZA-1004', entrada, false);
await espera(1100);
await paso('ZZA-1005', salidaCam);
await paso('ZZA-1O04', salidaCam);
ok(!(await detalle(i4))?.fecha_hora_salida, 'una placa distinta o parecida (0 por O) no cierra el ingreso');
await paso('ZZA-1004', salidaCam, false);
ok(!(await detalle(i4))?.fecha_hora_salida, 'con el ingreso y la salida sin confirmar no se cierra');
await api('POST', '/detecciones/reevaluar', { ingreso_id: (await paso('ZZA-1004', salidaCam, false)), lectura_valida: true, placa_reconocida: 'ZZA-1004' }, SERVICIO);
ok(Boolean((await detalle(i4))?.fecha_hora_salida), 'la confirmación tardía del segundo OCR sí lo cierra');
const i11 = await paso('ZZA-1011', entrada);
await espera(1100);
const s11 = await paso('ZZA-1011', salidaCam, false);
ok(Boolean((await detalle(i11))?.fecha_hora_salida), 'una salida sin confirmar cierra el ingreso confirmado de esa misma placa');
const tabla = (await api('GET', '/detecciones?unir_salidas=si&tamano=200')).data?.items ?? [];
ok(!tabla.some(x => x.id === s11) && tabla.some(x => x.id === i11), 'en la tabla, la salida queda en la fila de su ingreso');
ok((await api('GET', '/detecciones?tamano=200')).data?.items?.some(x => x.id === s11), 'sin unir, el paso de salida sigue consultable');

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

// ─── Salida manual, según Configuración ─────────────────────────────────────────────────────
const bloqueo = await parametros({ salida_manual_habilitada: 'false', salida_automatica_habilitada: 'false' });
ok(bloqueo.status === 400, 'no se pueden apagar a la vez la salida manual y la automática');
ok((await parametros({ salida_automatica_habilitada: 'true', salida_automatica_minimo_segundos: '1', salida_manual_habilitada: 'false' })).status === 200, 'se desactiva la salida manual');
ok((await api('GET', '/monitoreo/estado')).data?.salida_manual === false, 'la pantalla sabe que está desactivada');
const i10 = await paso('ZZA-1010', entrada);
ok((await api('POST', `/detecciones/${i10}/salida`)).status === 403, 'desactivada: la salida manual de un ingreso se rechaza');
ok((await api('POST', '/detecciones/registro-manual', { placa: 'ZZA-1010', motivo: 'Cámara fuera de servicio', camara_id: salidaCam.id })).status === 403, 'desactivada: tampoco por el registro manual');
await espera(1100);
await paso('ZZA-1010', salidaCam);
ok(Boolean((await detalle(i10))?.fecha_hora_salida), 'la cámara de salida sí registra la salida');
ok((await parametros({ salida_manual_habilitada: 'true', salida_automatica_habilitada: 'false' })).status === 200, 'se vuelve a activar la salida manual');

// ─── Registro manual ante fallos (RNF05) y conservación de fotos (RNF06) ─────────────────────
const ingresoManual = n => api('POST', '/detecciones/registro-manual', { placa: `ZZC-000${n}`, motivo: 'Cámara fuera de servicio', tipo_vehiculo: 'Automóvil', persona_ingreso: 'Persona De Prueba', motivo_ingreso: 'Visita', camara_id: ids[0] });
docker('stop', 'camaras');
let m = await ingresoManual(1);
ok(m.status === 201, `ingreso manual con la cámara caída (HTTP ${m.status})`);
ok(m.data?.deteccion?.validado_manualmente === true, 'queda como validado por una persona');
docker('stop', 'anpr', 'anpr2');
m = await ingresoManual(2);
ok(m.status === 201, `ingreso manual con los motores caídos (HTTP ${m.status})`);
const d4 = await detalle(m.data?.deteccion?.id);
ok(d4?.auditoria?.some(a => a.accion === 'REGISTRO_MANUAL'), 'el ingreso manual queda en la auditoría');
docker('start', 'camaras', 'anpr', 'anpr2');

const sql = q => docker('exec', '-T', 'db', 'psql', '-U', 'anpr', '-d', 'ANPR_ECU911', '-qAt', '-c', q).toString().trim();
docker('exec', '-T', 'backend', 'sh', '-c', 'cd /app/media && echo x > zz_vencida.jpg && echo x > zz_reciente.jpg && echo x > zz_alerta.jpg && echo x > zz_huerfana.jpg && touch -d "2020-01-01" zz_huerfana.jpg');
const paso_foto = (ruta, dias, estado) => `INSERT INTO deteccionvehiculo (placa_validada, tipo_movimiento, fuente, fecha_hora_ingreso, estado_procesamiento, estado_validacion, ruta_imagen_ingreso)
  VALUES ('ZZD0001', 'ingreso', 'manual', CURRENT_TIMESTAMP - INTERVAL '${dias} days', 'procesado', '${estado}', '${ruta}') RETURNING id`;
const vencida = sql(paso_foto('/media/zz_vencida.jpg', 120, 'autorizado'));
const reciente = sql(paso_foto('/media/zz_reciente.jpg', 5, 'autorizado'));
const alerta = sql(paso_foto('/media/zz_alerta.jpg', 400, 'alerta'));
docker('restart', 'backend');
await hasta(() => api('GET', '/monitoreo/estado').then(r => r.status === 200, () => false), 90);
const fotoExiste = f => docker('exec', '-T', 'backend', 'sh', '-c', `test -f /app/media/${f} && echo si || echo no`).toString().trim() === 'si';
await hasta(() => !fotoExiste('zz_vencida.jpg'), 60);
ok(!fotoExiste('zz_vencida.jpg'), 'la foto de un paso de 120 días se borra sola');
ok(sql(`SELECT ruta_imagen_ingreso IS NULL FROM deteccionvehiculo WHERE id = ${vencida}`) === 't', 'el registro del paso se conserva, sin la foto');
ok(fotoExiste('zz_reciente.jpg') && sql(`SELECT ruta_imagen_ingreso FROM deteccionvehiculo WHERE id = ${reciente}`) !== '', 'la foto de un paso reciente sigue');
ok(fotoExiste('zz_alerta.jpg') && sql(`SELECT ruta_imagen_ingreso FROM deteccionvehiculo WHERE id = ${alerta}`) !== '', 'la foto de una alerta no se borra sola');
ok(!fotoExiste('zz_huerfana.jpg'), 'la foto vieja sin registro se borra');
ok(Number(sql("SELECT count(*) FROM auditoriaoperaciones WHERE accion = 'EVIDENCIA_DEPURADA'")) >= 1, 'la depuración queda en la auditoría');

console.log(JSON.stringify({ verificaciones: resumen.length, fallas }));
process.exit(fallas ? 1 : 0);
