// Pruebas de seguridad de caja negra, básicas y no destructivas, contra el banco de pruebas.
//   node seguridad_basica.mjs     (CARGA_URL, CARGA_JWT_SECRET, CARGA_USUARIO_ID)
// Cada comprobación imprime OK o REVISAR con lo observado; termina con código 1 si alguna falla.
import crypto from 'node:crypto';

const BASE = process.env.CARGA_URL || 'http://127.0.0.1:5055';
const b64 = v => Buffer.from(v).toString('base64url');
const firmar = (carga, secreto = process.env.CARGA_JWT_SECRET, alg = 'HS256') => {
  const base = `${b64(JSON.stringify({ alg, typ: 'JWT' }))}.${b64(JSON.stringify(carga))}`;
  if (alg === 'none') return `${base}.`;
  return `${base}.${crypto.createHmac('sha256', secreto).update(base).digest('base64url')}`;
};
const usuario = Number(process.env.CARGA_USUARIO_ID || 1);
const carga = { id: usuario, email: 'carga.admin@prueba.invalid', username: 'carga.admin@prueba.invalid', nombre: 'Admin de carga', rol: 'admin' };
const vigente = firmar({ ...carga, exp: Math.floor(Date.now() / 1000) + 600 });
const sesion = { Authorization: `Bearer ${vigente}` };

const pedir = async (ruta, opciones = {}) => {
  const res = await fetch(BASE + ruta, { redirect: 'manual', signal: AbortSignal.timeout(60_000), ...opciones });
  return { estado: res.status, h: res.headers, texto: await res.text() };
};

let fallas = 0;
const comprobar = (nombre, ok, detalle = '') => {
  if (!ok) fallas++;
  console.log(`${ok ? 'OK     ' : 'REVISAR'} ${nombre}${detalle ? ` · ${detalle}` : ''}`);
};

// ─── Sesión ──────────────────────────────────────────────────────────────────
for (const [nombre, token] of [
  ['JWT alg=none', firmar({ ...carga, exp: Math.floor(Date.now() / 1000) + 600 }, '', 'none')],
  ['JWT con otro secreto', firmar({ ...carga, exp: Math.floor(Date.now() / 1000) + 600 }, 'secreto-equivocado')],
  ['JWT vencido', firmar({ ...carga, exp: Math.floor(Date.now() / 1000) - 60 })],
]) {
  const r = await pedir('/api/usuarios', { headers: { Authorization: `Bearer ${token}` } });
  comprobar(`${nombre} se rechaza`, r.estado === 401, `HTTP ${r.estado}`);
}
comprobar('API sin sesión se rechaza', (await pedir('/api/detecciones')).estado === 401);

// Un token con rol inflado: manda el rol de la base, no el del token
const inflado = firmar({ ...carga, id: 999999, rol: 'admin', exp: Math.floor(Date.now() / 1000) + 600 });
const rInflado = await pedir('/api/usuarios', { headers: { Authorization: `Bearer ${inflado}` } });
comprobar('Token firmado de una cuenta inexistente se rechaza', rInflado.estado === 401, `HTTP ${rInflado.estado}`);

// ─── Inyección ───────────────────────────────────────────────────────────────
for (const valor of ["' OR '1'='1", "'; DROP TABLE usuarios;--", '%27%3B SELECT pg_sleep(5)--']) {
  const inicio = performance.now();
  const r = await pedir(`/api/detecciones?buscar=${encodeURIComponent(valor)}&pagina=1&tamano=5`, { headers: sesion });
  const ms = performance.now() - inicio;
  comprobar(`SQLi en buscar (${valor.slice(0, 18)})`, r.estado < 500 && !/syntax error|pg_|postgres/i.test(r.texto), `HTTP ${r.estado}, ${Math.round(ms)} ms`);
}
const rOrden = await pedir('/api/detecciones?orden=fecha;DROP%20TABLE%20usuarios&pagina=1&tamano=5', { headers: sesion });
comprobar('SQLi en orden', rOrden.estado < 500, `HTTP ${rOrden.estado}`);

// ─── Rutas y archivos ────────────────────────────────────────────────────────
for (const ruta of ['/media/..%2f..%2fetc%2fpasswd', '/media/%2e%2e%2fpackage.json', '/media/ingreso_1.jpg']) {
  const r = await pedir(ruta);
  comprobar(`Evidencia sin firma: ${ruta}`, r.estado === 403 || r.estado === 404, `HTTP ${r.estado}`);
}

// ─── Cabeceras y exposición ──────────────────────────────────────────────────
const rSalud = await pedir('/health');
comprobar('Sin x-powered-by', !rSalud.h.get('x-powered-by'));
comprobar('nosniff', rSalud.h.get('x-content-type-options') === 'nosniff');
comprobar('CSP presente', !!rSalud.h.get('content-security-policy'));
const rMetricas = await pedir('/metrics');
comprobar('/metrics no es público', rMetricas.estado === 401 || rMetricas.estado === 403 || rMetricas.estado === 404, `HTTP ${rMetricas.estado}`);
const rDocs = await pedir('/api/docs.json');
comprobar('Swagger cerrado en producción', rDocs.estado === 404, `HTTP ${rDocs.estado}`);
const rCors = await pedir('/api/auth/estado', { headers: { Origin: 'https://atacante.invalid' } });
comprobar('CORS no refleja orígenes ajenos', rCors.h.get('access-control-allow-origin') !== 'https://atacante.invalid', `ACAO=${rCors.h.get('access-control-allow-origin')}`);

// ─── Tamaño y formato del cuerpo ─────────────────────────────────────────────
const json = { 'Content-Type': 'application/json' };
const rGrande = await pedir('/api/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ email: 'x'.repeat(2_000_000), password: 'y' }) });
comprobar('Cuerpo de 2 MB se rechaza', rGrande.estado === 413, `HTTP ${rGrande.estado}`);
const rRoto = await pedir('/api/auth/login', { method: 'POST', headers: json, body: '{"email":' });
comprobar('JSON roto no filtra la pila', rRoto.estado === 400 && !/at .*\.js|node_modules|SyntaxError/.test(rRoto.texto), `HTTP ${rRoto.estado} ${rRoto.texto.slice(0, 80)}`);
const rProto = await pedir('/api/auth/login', { method: 'POST', headers: json, body: '{"__proto__":{"admin":true},"email":"a@b.c","password":"x"}' });
comprobar('__proto__ no provoca error interno', rProto.estado < 500, `HTTP ${rProto.estado}`);

// ─── Cuentas ─────────────────────────────────────────────────────────────────
const intento = email => pedir('/api/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ email, password: 'ClaveEquivocada-1' }) });
const existente = await intento('otra.cuenta@prueba.invalid');
const ajena = await intento('no.existe@prueba.invalid');
comprobar('El login no revela si la cuenta existe', existente.estado === ajena.estado && existente.texto === ajena.texto, `HTTP ${ajena.estado}`);

// ─── Rate limit (requiere un backend con los límites por omisión: CARGA_LIMITES=1) ───────────
if (process.env.CARGA_LIMITES === '1') {
  const estados = [];
  for (let i = 0; i < 30; i++) estados.push((await intento('fuerza.bruta@prueba.invalid')).estado);
  comprobar('Fuerza bruta frenada por IP', estados.includes(429), `primer 429 en el intento ${estados.indexOf(429) + 1}`);
}

console.log(fallas ? `\n${fallas} comprobaciones por revisar.` : '\nTodas las comprobaciones pasaron.');
process.exit(fallas ? 1 : 0);
