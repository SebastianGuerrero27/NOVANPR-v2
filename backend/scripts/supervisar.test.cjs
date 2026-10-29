const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { comprobarVida, iniciarSupervisor } = require('./supervisar.cjs');

test('la comprobación acepta 200, rechaza 503 y limita una conexión colgada', async () => {
  let codigo = 200;
  const server = http.createServer((_req, res) => { if (codigo) { res.writeHead(codigo); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/health`;
    assert.equal(await comprobarVida(url, 1000), true);
    codigo = 503;
    assert.equal(await comprobarVida(url, 1000), false);
    codigo = 0;
    assert.equal(await comprobarVida(url, 50), false);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('detecta un hijo vivo pero sin API y termina su árbol para volver a arrancarlo', async () => {
  let detener;
  await new Promise((resolve, reject) => {
    const limite = setTimeout(() => { detener(); reject(new Error('No se detectó el bloqueo')); }, 3000);
    detener = iniciarSupervisor({
      args: ['-e', 'setTimeout(()=>process.exit(0),500)'], intervalo: 20, gracia: 0, maxFallos: 2,
      chequear: async () => false,
      onReinicio: mensaje => {
        assert.match(mensaje, /reiniciando/);
        setImmediate(() => { detener(); clearTimeout(limite); resolve(); });
      },
    });
  });
});

test('respeta la gracia de arranque sin reiniciar la API mientras inicia', async () => {
  let reinicios = 0;
  const detener = iniciarSupervisor({ args: ['-e', 'setTimeout(()=>process.exit(0),500)'], intervalo: 10, gracia: 60000,
    chequear: async () => false, onReinicio: () => reinicios++ });
  await new Promise(resolve => setTimeout(resolve, 75));
  detener();
  assert.equal(reinicios, 0);
});
