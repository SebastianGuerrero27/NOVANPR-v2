// Escala del tiempo real: N sesiones de Socket.IO conectadas y latencia de la difusión de cada paso.
//   node sockets.mjs [--sesiones 100,500] [--pasos 20]
// t0 = envío de POST /detecciones/ingreso (como el motor); t1 = llegada de deteccion:nueva a cada sesión.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { io } = require('../../node_modules/socket.io-client');

const BASE = process.env.CARGA_URL || 'http://127.0.0.1:5055';
const args = process.argv.slice(2);
const opcion = (n, o) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : o);
const b64 = v => Buffer.from(v).toString('base64url');
const base = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(JSON.stringify({
  id: Number(process.env.CARGA_USUARIO_ID || 1), email: 'carga.admin@prueba.invalid', username: 'carga.admin@prueba.invalid',
  nombre: 'Admin de carga', rol: 'admin', exp: Math.floor(Date.now() / 1000) + 3600,
}))}`;
const token = `${base}.${crypto.createHmac('sha256', process.env.CARGA_JWT_SECRET).update(base).digest('base64url')}`;

const percentil = (o, p) => (o.length ? Math.round(o[Math.min(o.length - 1, Math.floor(o.length * p))] * 10) / 10 : null);
const pausa = ms => new Promise(r => setTimeout(r, ms));
const salida = {};

for (const n of String(opcion('sesiones', '100,500')).split(',').map(Number)) {
  const inicio = performance.now();
  const latencias = [];
  let t0 = 0, rechazadas = 0;
  const sesiones = await Promise.all(Array.from({ length: n }, () => new Promise(listo => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    s.on('deteccion:nueva', () => { if (t0) latencias.push(performance.now() - t0); });
    s.once('connect', () => listo(s));
    s.once('connect_error', () => { rechazadas++; listo(s); });
  })));
  const conexion = Math.round(performance.now() - inicio);
  const pasos = Number(opcion('pasos', 20));
  let errores = 0;
  const semilla = Date.now() % 1_000_000;
  for (let i = 0; i < pasos; i++) {
    await pausa(500);
    t0 = performance.now();
    const res = await fetch(`${BASE}/api/detecciones/ingreso`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Servicio-Token': process.env.CARGA_SERVICE_TOKEN },
      body: JSON.stringify({ tracking_id: semilla + i, ruta_imagen_ingreso: `socket_${i}.jpg`, confianza_deteccion: 0.9, fuente: 'rtsp', placa: `ZZS${String((semilla + i) % 10000).padStart(4, "0")}` }),
    });
    if (!res.ok) errores++;
    await res.arrayBuffer();
  }
  await pausa(1000);
  sesiones.forEach(s => s.disconnect());
  const o = latencias.sort((a, b) => a - b);
  salida[`${n} sesiones`] = {
    conexion_ms: conexion, rechazadas, entregas: `${o.length}/${(n - rechazadas) * pasos}`, errores_ingreso: errores,
    p50_ms: percentil(o, 0.5), p95_ms: percentil(o, 0.95), p99_ms: percentil(o, 0.99), max_ms: percentil(o, 1),
  };
  await pausa(2000);
}
console.log(JSON.stringify(salida, null, 1));
process.exit(0);
