#!/usr/bin/env node
/**
 * Prueba de punta a punta de una cámara de prueba con un video cargado (Cámaras › Cargar video).
 * Corre dentro del contenedor anpr-backend (usa JWT_SECRET y la base de su entorno) y firma una
 * sesión de 20 minutos del primer administrador activo; el token nunca se imprime.
 *
 *   node prueba_video.js cargar <archivo> <nombre> <ubicacion>   sube el video por la API (como el botón)
 *   node prueba_video.js zonas <id> '<roi json>'                  guarda el área de detección
 *   node prueba_video.js asignar <id>                             el motor ANPR pasa a procesar la cámara
 *   node prueba_video.js alternar <id>                            deshabilita / habilita la cámara (el video vuelve a 0:00)
 *   node prueba_video.js estado <id>                              cámara, ruta en MediaMTX y motor
 *   node prueba_video.js detecciones <id>                         pasos registrados por esa cámara
 *
 * Copiar el video al contenedor antes de cargarlo:  docker cp <video> anpr-backend:/tmp/video.mp4
 */
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const B = 'http://localhost:5000/api';
let ADMIN = null;

async function sesionAdministrador() {
  const pool = new Pool({
    user: process.env.DB_USER || 'anpr', password: process.env.DB_PASSWORD, host: process.env.DB_SERVER || 'db',
    port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME || 'ANPR_ECU911',
  });
  try {
    const u = (await pool.query(`SELECT u.id, u.email, u.nombre_completo FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE r.codigo = 'ADMIN' AND u.estado = 'activo' ORDER BY u.id LIMIT 1`)).rows[0];
    if (!u) throw new Error('No hay un administrador activo en la base.');
    return jwt.sign({ id: u.id, email: u.email, username: u.email, nombre: u.nombre_completo, rol: 'Admin' }, process.env.JWT_SECRET, { expiresIn: '20m' });
  } finally {
    await pool.end();
  }
}

async function api(metodo, ruta, cuerpo) {
  const r = await fetch(B + ruta, {
    method: metodo, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN}` },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, data };
}

async function cargar(archivo, nombre, ubicacion) {
  const bytes = fs.statSync(archivo).size;
  const inicio = Date.now();
  const q = new URLSearchParams({ nombre, ubicacion, direccion: 'ingreso' });
  const r = await fetch(`${B}/camaras/video-prueba?${q}`, {
    method: 'POST', duplex: 'half', body: fs.createReadStream(archivo),
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes), Authorization: `Bearer ${ADMIN}` },
  });
  const data = await r.json().catch(() => null);
  console.log(JSON.stringify({ http: r.status, segundos: (Date.now() - inicio) / 1000, mb: +(bytes / 1048576).toFixed(1), ...data }, null, 1));
}

async function main() {
  const [accion, a, b, c] = process.argv.slice(2);
  ADMIN = await sesionAdministrador();
  if (accion === 'cargar') return cargar(a, b, c);
  if (accion === 'zonas') return console.log(JSON.stringify(await api('PUT', `/camaras/${a}/roi`, { roi: JSON.parse(b), exclusiones: [] })));
  if (accion === 'alternar') return console.log(JSON.stringify(await api('PATCH', `/camaras/${a}/toggle`)));
  if (accion === 'asignar') return console.log(JSON.stringify(await api('POST', '/monitoreo/camara-activa', { camara_id: Number(a) })));
  if (accion === 'estado') {
    const [camara, ruta, motor] = await Promise.all([api('GET', `/camaras/${a}`), api('GET', `/camaras/video/cam_${a}/estado`), api('GET', '/monitoreo/estado')]);
    return console.log(JSON.stringify({ camara: camara.data, ruta: ruta.data, motor: { en_linea: motor.data?.en_linea, camara_activa: motor.data?.camara_activa, fps_captura: motor.data?.fps_captura, enlace: motor.data?.enlace } }, null, 1));
  }
  if (accion === 'detecciones') {
    const r = await api('GET', `/detecciones?camara=${a}&tamano=50`);
    return console.log(JSON.stringify((r.data?.items ?? []).map(d => ({
      id: d.id, hora: d.fecha_hora_ingreso, placa: d.placa, estado: d.estado_validacion, procesamiento: d.estado_procesamiento,
      sin_placa: d.sin_placa, motivo: d.motivo_revision, confianza_ocr: d.confianza_ocr, vehiculo: d.vehiculo?.tipo,
    })), null, 1));
  }
  throw new Error(`acción desconocida: ${accion}`);
}

main().catch(e => { console.error(`✘ ${e.message}`); process.exit(1); });
