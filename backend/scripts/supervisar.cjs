const { spawn, execFile } = require('node:child_process');
const { request } = require('node:http');

function comprobarVida(url, timeout = 3000) {
  return new Promise(resolve => {
    const req = request(url, res => { res.resume(); resolve(res.statusCode === 200); });
    req.setTimeout(timeout, () => req.destroy());
    req.on('error', () => resolve(false));
    req.end();
  });
}

/** Supervisión en otro proceso: sigue funcionando aunque el bucle de eventos de la API se bloquee. */
function iniciarSupervisor({ args, url, intervalo = 10000, gracia = 180000, maxFallos = 3, pausa = 2000, onReinicio = console.warn, chequear = comprobarVida }) {
  let hijo, inicio, sano = false, fallos = 0, detenido = false, comprobando = false, reiniciando = false;
  let reintento, forzar;
  const terminarArbol = (signal, pid = hijo?.pid) => {
    if (!pid) return;
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      try { process.kill(-pid, signal); } catch (e) { if (e.code !== 'ESRCH') throw e; }
    }
  };
  const lanzar = () => {
    if (detenido) return;
    inicio = Date.now(); sano = false; fallos = 0; reiniciando = false;
    hijo = spawn(process.execPath, args, { stdio: 'inherit', detached: process.platform !== 'win32' });
    hijo.once('error', e => console.error('[SUPERVISOR] No se pudo iniciar la API:', e.message));
    const lanzado = hijo;
    hijo.once('close', (codigo, signal) => {
      clearTimeout(forzar);
      // Un vigilante puede terminar antes que su API bloqueada. No dejar nietos usando el puerto.
      if (process.platform !== 'win32') terminarArbol('SIGKILL', lanzado.pid);
      if (!detenido) {
        console.warn(`[SUPERVISOR] Proceso terminado (${codigo ?? signal}); se volverá a iniciar.`);
        reintento = setTimeout(lanzar, pausa);
      }
    });
  };
  const revisar = async () => {
    if (detenido || comprobando || reiniciando || !hijo || hijo.exitCode !== null || hijo.signalCode !== null) return;
    comprobando = true;
    const actual = hijo;
    try {
      const ok = await chequear(url);
      if (detenido || actual !== hijo) return;
      if (ok) { sano = true; fallos = 0; return; }
      if (!sano && Date.now() - inicio < gracia) return;
      if (++fallos < maxFallos) return;
      reiniciando = true;
      onReinicio(`[SUPERVISOR] API sin respuesta en ${fallos} comprobaciones; reiniciando el proceso completo.`);
      const pid = hijo.pid;
      terminarArbol('SIGTERM');
      forzar = setTimeout(() => terminarArbol('SIGKILL', pid), 5000);
    } finally { comprobando = false; }
  };
  lanzar();
  const timer = setInterval(() => void revisar(), intervalo);
  return () => {
    detenido = true;
    clearInterval(timer); clearTimeout(reintento); clearTimeout(forzar);
    const pid = hijo?.pid;
    terminarArbol('SIGTERM');
    forzar = setTimeout(() => terminarArbol('SIGKILL', pid), 5000);
    forzar.unref();
  };
}

if (require.main === module) {
  const desarrollo = process.argv.includes('--dev');
  const args = desarrollo
    ? ['--watch', '--require', require.resolve('ts-node/register/transpile-only'), 'src/index.ts']
    : ['dist/index.js'];
  const detener = iniciarSupervisor({ args, url: `http://127.0.0.1:${process.env.PORT || 5000}/health` });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { detener(); process.exitCode = 0; });
}
module.exports = { comprobarVida, iniciarSupervisor };
