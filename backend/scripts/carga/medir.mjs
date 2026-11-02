// Pruebas de carga del backend, sin dependencias (fetch de Node 24).
//   node medir.mjs secuencial [--repeticiones 10]     latencia de cada ruta, una a la vez
//   node medir.mjs concurrente [--segundos 20]        operadores simultáneos sobre la mezcla de consultas
//   node medir.mjs ingesta [--segundos 15]            ritmo de POST /detecciones/ingreso del motor
//   node medir.mjs bloqueo --ruta /api/... [...]      latencia de /health mientras corre una ruta pesada
// Variables: CARGA_URL, CARGA_JWT_SECRET, CARGA_SERVICE_TOKEN, CARGA_USUARIO_ID. Imprime JSON al final.
import crypto from 'node:crypto';

const BASE = process.env.CARGA_URL || 'http://127.0.0.1:5055';
const args = process.argv.slice(2);
const opcion = (nombre, omision) => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 ? args[i + 1] : omision;
};

const b64 = valor => Buffer.from(valor).toString('base64url');
function firmar(id) {
  const cuerpo = b64(JSON.stringify({
    id, email: 'carga.admin@prueba.invalid', username: 'carga.admin@prueba.invalid', nombre: 'Admin de carga', rol: 'admin',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const base = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${cuerpo}`;
  return `${base}.${crypto.createHmac('sha256', process.env.CARGA_JWT_SECRET).update(base).digest('base64url')}`;
}
const encabezados = { Authorization: `Bearer ${firmar(Number(process.env.CARGA_USUARIO_ID || 1))}` };

const percentil = (ordenados, p) => ordenados.length ? ordenados[Math.min(ordenados.length - 1, Math.floor(ordenados.length * p))] : null;
const resumen = (ms, errores, segundos) => {
  const o = [...ms].sort((a, b) => a - b);
  const r = v => (v === null ? null : Math.round(v * 10) / 10);
  return { n: o.length, errores, rps: segundos ? Math.round(o.length / segundos * 10) / 10 : undefined,
    p50: r(percentil(o, 0.5)), p95: r(percentil(o, 0.95)), p99: r(percentil(o, 0.99)), max: r(o.at(-1) ?? null) };
};

async function pedir(ruta, opciones = {}) {
  const inicio = performance.now();
  const res = await fetch(BASE + ruta, { headers: encabezados, ...opciones });
  const cuerpo = await res.arrayBuffer();
  return { ms: performance.now() - inicio, estado: res.status, bytes: cuerpo.byteLength };
}

// Rutas que abre el personal; las placas y los textos son valores ficticios de sembrar.sql
const RUTAS = {
  'panel resumen': '/api/panel/resumen',
  'historial pág. 1': '/api/detecciones?pagina=1&tamano=25',
  'historial pág. 2000': '/api/detecciones?pagina=2000&tamano=25',
  'historial por placa': '/api/detecciones?placa=ZZA&pagina=1&tamano=25',
  'historial búsqueda texto': '/api/detecciones?buscar=Persona%20Ficticia%2012&pagina=1&tamano=25',
  'historial resumen': '/api/detecciones/historial/resumen',
  'recientes': '/api/detecciones/recientes?limite=20',
  'buscar placa': '/api/detecciones/buscar-placa/ZZB-0001',
  'notificaciones resumen': '/api/notificaciones/resumen',
  'notificaciones bandeja': '/api/notificaciones?pagina=1&tamano=20',
  'auditoría': '/api/auditoria?pagina=1&tamano=25',
  'lista blanca': '/api/vehiculos-autorizados?pagina=1&tamano=25',
  'lista negra': '/api/blacklist?pagina=1&tamano=25',
  'cámaras': '/api/camaras',
};

async function secuencial() {
  const repeticiones = Number(opcion('repeticiones', 10));
  const salida = {};
  for (const [nombre, ruta] of Object.entries(RUTAS)) {
    const ms = []; let errores = 0, ultimo = 0;
    // La primera vuelta calienta cachés y no cuenta
    await pedir(ruta).catch(() => null);
    for (let i = 0; i < repeticiones; i++) {
      const r = await pedir(ruta);
      if (r.estado >= 400) { errores++; ultimo = r.estado; }
      ms.push(r.ms);
    }
    salida[nombre] = { ...resumen(ms, errores), ...(ultimo ? { estado: ultimo } : {}) };
  }
  return salida;
}

const MEZCLA = [
  [RUTAS['panel resumen'], 2], [RUTAS['historial pág. 1'], 3], [RUTAS['notificaciones resumen'], 3],
  [RUTAS['recientes'], 2], [RUTAS['historial por placa'], 1], [RUTAS['buscar placa'], 1],
].flatMap(([ruta, peso]) => Array(peso).fill(ruta));

async function concurrente() {
  const segundos = Number(opcion('segundos', 20));
  const niveles = String(opcion('niveles', '1,5,10,25,50')).split(',').map(Number);
  const salida = {};
  for (const operadores of niveles) {
    const ms = []; let errores = 0;
    const fin = performance.now() + segundos * 1000;
    await Promise.all(Array.from({ length: operadores }, async (_, k) => {
      let i = k;
      while (performance.now() < fin) {
        try {
          const r = await pedir(MEZCLA[i++ % MEZCLA.length], { signal: AbortSignal.timeout(60_000) });
          if (r.estado >= 400) errores++;
          ms.push(r.ms);
        } catch { errores++; }
      }
    }));
    salida[`${operadores} operadores`] = resumen(ms, errores, segundos);
  }
  return salida;
}

async function ingesta() {
  const segundos = Number(opcion('segundos', 15));
  const salida = {};
  for (const concurrencia of String(opcion('niveles', '1,4,16')).split(',').map(Number)) {
    const ms = []; let errores = 0, secuencia = 0;
    const fin = performance.now() + segundos * 1000;
    const semilla = Date.now() % 1_000_000;
    await Promise.all(Array.from({ length: concurrencia }, async () => {
      while (performance.now() < fin) {
        const n = ++secuencia;
        const cuerpo = JSON.stringify({
          tracking_id: semilla + n, ruta_imagen_ingreso: `carga_${n}.jpg`, confianza_deteccion: 0.9, fuente: 'rtsp', camara_id: Number(opcion('camara', 1)),
          placa: `ZZX${String(n % 10000).padStart(4, '0')}`,
        });
        try {
          const r = await pedir('/api/detecciones/ingreso', {
            method: 'POST', body: cuerpo,
            headers: { 'Content-Type': 'application/json', 'X-Servicio-Token': process.env.CARGA_SERVICE_TOKEN },
            signal: AbortSignal.timeout(60_000),
          });
          if (r.estado >= 400) errores++;
          ms.push(r.ms);
        } catch { errores++; }
      }
    }));
    salida[`concurrencia ${concurrencia}`] = resumen(ms, errores, segundos);
  }
  return salida;
}

// ¿Una ruta pesada congela a los demás? Sondea /health cada 100 ms mientras la ruta corre
async function bloqueo() {
  const ruta = opcion('ruta');
  const metodo = opcion('metodo', 'GET');
  const cuerpo = opcion('cuerpo');
  const veces = Number(opcion('concurrencia', 1));
  const ms = []; let activos = true, fallas = 0;
  const sonda = (async () => {
    while (activos) {
      const inicio = performance.now();
      try { await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(30_000) }); ms.push(performance.now() - inicio); }
      catch { fallas++; }
      await new Promise(r => setTimeout(r, 100));
    }
  })();
  const inicio = performance.now();
  const opciones = {
    method: metodo, signal: AbortSignal.timeout(300_000),
    ...(cuerpo ? { body: cuerpo, headers: { ...encabezados, 'Content-Type': 'application/json' } } : {}),
  };
  const resultados = await Promise.all(Array.from({ length: veces }, () =>
    pedir(ruta, opciones).catch(e => ({ ms: performance.now() - inicio, estado: 0, bytes: 0, error: String(e.cause?.code ?? e.name) }))));
  activos = false;
  await sonda;
  return {
    ruta,
    resultados: resultados.map(r => ({ ms: Math.round(r.ms), estado: r.estado, MB: Math.round(r.bytes / 1e5) / 10, error: r.error })),
    health: resumen(ms, fallas),
  };
}

const pruebas = { secuencial, concurrente, ingesta, bloqueo };
const prueba = pruebas[args[0]];
if (!prueba) { console.error('Prueba desconocida. Use: secuencial, concurrente, ingesta o bloqueo.'); process.exit(2); }
console.log(JSON.stringify(await prueba(), null, 1));
