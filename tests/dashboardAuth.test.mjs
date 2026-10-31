// Candado de todo el sitio (usuario y clave compartidos) cuando está desplegado en internet: sin login propio por ruta,
// esta es la única barrera entre "cualquiera con la URL" y tus leads y negocios reales.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { dashboardAuth, isOpenPath } from '../src/middleware/dashboardAuth.js';

let server, base;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const get = (path, auth) => fetch(`${base}${path}`, { headers: auth ? { Authorization: `Basic ${b64(auth)}` } : {} });

before(async () => {
  const app = express();
  app.use(dashboardAuth);
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/leads/stats', (req, res) => res.json({ total: 370 }));
  app.get('/', (req, res) => res.send('dashboard'));
  server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections?.(); server.close(); });
beforeEach(() => { delete process.env.DASHBOARD_USER; delete process.env.DASHBOARD_PASSWORD; });

test('sin DASHBOARD_USER/DASHBOARD_PASSWORD configurados: no pide nada (como hasta ahora)', async () => {
  const r = await get('/api/leads/stats');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { total: 370 });
});

test('con usuario y clave configurados: sin credenciales, 401 y no enseña los datos', async () => {
  process.env.DASHBOARD_USER = 'jose';
  process.env.DASHBOARD_PASSWORD = 's3cret';
  const r = await get('/api/leads/stats');
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate'), /^Basic realm=/);
  assert.doesNotMatch(await r.text(), /370/);
});

test('con las credenciales correctas: entra', async () => {
  process.env.DASHBOARD_USER = 'jose';
  process.env.DASHBOARD_PASSWORD = 's3cret';
  const r = await get('/api/leads/stats', 'jose:s3cret');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { total: 370 });
});

test('con la clave equivocada, con el usuario equivocado, o con las credenciales cambiadas de sitio: 401', async () => {
  process.env.DASHBOARD_USER = 'jose';
  process.env.DASHBOARD_PASSWORD = 's3cret';
  for (const wrong of ['jose:mala', 'otro:s3cret', 's3cret:jose', 'jose:s3cret ', ':']) {
    assert.equal((await get('/api/leads/stats', wrong)).status, 401, wrong);
  }
});

test('protege la página principal igual que la API', async () => {
  process.env.DASHBOARD_USER = 'jose';
  process.env.DASHBOARD_PASSWORD = 's3cret';
  assert.equal((await get('/')).status, 401);
  assert.equal((await get('/', 'jose:s3cret')).status, 200);
});

test('deja pasar siempre el health check de Render (sin credenciales)', async () => {
  process.env.DASHBOARD_USER = 'jose';
  process.env.DASHBOARD_PASSWORD = 's3cret';
  const r = await get('/health');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: 'ok' });
});


test('una contraseña con caracteres especiales (:, tildes) también funciona', async () => {
  process.env.DASHBOARD_USER = 'josé';
  process.env.DASHBOARD_PASSWORD = 'a:b:ñ!';
  assert.equal((await get('/api/leads/stats', 'josé:a:b:ñ!')).status, 200);
  assert.equal((await get('/api/leads/stats', 'jose:a:b:ñ!')).status, 401);
});

test('solo configurar el usuario, o solo la clave, deja el sitio abierto (hace falta configurar las dos)', async () => {
  process.env.DASHBOARD_USER = 'jose';
  assert.equal((await get('/api/leads/stats')).status, 200);
  delete process.env.DASHBOARD_USER;
  process.env.DASHBOARD_PASSWORD = 's3cret';
  assert.equal((await get('/api/leads/stats')).status, 200);
});

test('solo /health queda abierto: las rutas de antes (pagos, Stripe, webs de prueba) ya no existen y piden la clave', async () => {
  process.env.DASHBOARD_USER = 'jose';
  process.env.DASHBOARD_PASSWORD = 's3cret';
  for (const path of ['/preview/bricoandpool', '/checkout/7b1c2d3e-0000-4000-8000-000000000001', '/payment/success', '/webhooks/stripe', '/api/billing/webhook', '/health/x']) {
    assert.equal(isOpenPath(path), false, path);
    assert.equal((await get(path)).status, 401, path);
  }
  assert.equal(isOpenPath('/health'), true);
});
