// The caja de claves (routes/setup.js): you paste a key, it is checked and written to the .env; a key never comes back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { createSetupRouter, onlyThisComputer } from '../src/routes/setup.js';

const dir = mkdtempSync(join(tmpdir(), 'caja-'));
const envFile = join(dir, '.env');
const schemaFile = join(dir, 'schema.sql');
writeFileSync(schemaFile, 'CREATE TABLE x ();');
const processEnv = {};
let anthropicFails = null;
const claude = { messages: { create: async () => { if (anthropicFails) throw anthropicFails; return { content: [] }; } } };
const db = { from: () => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }), auth: { admin: {} } };

const calls = [];
async function fetchImpl(url, opts = {}) {
  calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
  const reply = (status, json) => ({ ok: status < 400, status, statusText: 'x', json: async () => json });
  if (url === 'https://api.vercel.com/v2/teams') return reply(200, { teams: [{ slug: 'mi-equipo' }] });
  if (url.endsWith('/accounts?limit=100')) return reply(200, { items: [{ email: 'a@x.com', status: 1 }] });
  if (url.endsWith('/campaigns') && opts.method === 'POST') return reply(200, { id: 'camp-nueva' });
  if (url.endsWith('/activate')) return reply(200, {});
  if (/\/campaigns\//.test(url)) return reply(404, {});
  if (url.endsWith('/owners')) return reply(200, [{ owner: { id: 'own-1', name: 'Ana' } }]);
  if (url.endsWith('/services') && opts.method === 'POST') return reply(201, { service: { id: 'srv-1', serviceDetails: { url: 'https://mi.onrender.com' } } });
  if (/api\.render\.com/.test(url)) return reply(200, {});
  throw new Error(`ruta inesperada ${url}`);
}

let server, base;
before(async () => {
  writeFileSync(envFile, '# Mi .env\nBRAND_NAME=\nSENDER_NAME=\nLEGAL_FOOTER=\nANTHROPIC_API_KEY=\nLEAD_DEMOS=true\n');
  const app = express();
  app.use(express.json());
  app.use('/api/setup', createSetupRouter({ envFile, schemaFile, fetchImpl, makeDb: () => db, makeAnthropic: () => claude, env: processEnv }));
  server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}/api/setup`;
});
after(() => { server.closeAllConnections?.(); server.close(); });

const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, ...(await r.json()) }));
const envNow = () => parse(readFileSync(envFile, 'utf8'));

test('guardar tus datos: se escriben en el .env sin tocar sus comentarios', async () => {
  const r = await post('/save', { section: 'brand', values: { BRAND_NAME: 'Mi Marca', SENDER_NAME: 'Ana', LEGAL_FOOTER: 'Mi Marca LLC · 1 Main St #5' } });
  assert.equal(r.saved, true);
  assert.equal(envNow().LEGAL_FOOTER, 'Mi Marca LLC · 1 Main St #5');
  assert.match(readFileSync(envFile, 'utf8'), /^# Mi \.env/);
});

test('una clave que no vale no se guarda, y la respuesta dice por qué', async () => {
  anthropicFails = Anthropic.APIError.generate(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'invalid x-api-key', new Headers());
  const r = await post('/save', { section: 'anthropic', values: { ANTHROPIC_API_KEY: 'sk-ant-mala' } });
  anthropicFails = null;
  assert.equal(r.saved, false);
  assert.match(r.items[0].text, /no vale/);
  assert.equal(envNow().ANTHROPIC_API_KEY, '');
});

test('una clave buena se guarda, también en la app que está corriendo, y NUNCA se devuelve', async () => {
  const r = await post('/save', { section: 'anthropic', values: { ANTHROPIC_API_KEY: 'sk-ant-buena-123' } });
  assert.equal(r.saved, true);
  assert.equal(envNow().ANTHROPIC_API_KEY, 'sk-ant-buena-123');
  assert.equal(processEnv.ANTHROPIC_API_KEY, 'sk-ant-buena-123');
  const status = await (await fetch(`${base}/status`)).json();
  assert.equal(status.set.ANTHROPIC_API_KEY, true);
  assert.ok(!JSON.stringify(status).includes('sk-ant-buena-123'));
  assert.equal(status.values.BRAND_NAME, 'Mi Marca');           // lo que no es secreto sí se ve
});

test('cada sección solo puede escribir sus claves: lo demás se ignora (no se puede colar LEAD_DEMOS ni otra variable)', async () => {
  const r = await post('/save', { section: 'brand', values: { LEAD_DEMOS: 'false', NODE_OPTIONS: '--require x' } });
  assert.equal(r.status, 400);
  assert.equal(envNow().LEAD_DEMOS, 'true');
  assert.equal(envNow().NODE_OPTIONS, undefined);
  assert.equal((await post('/save', { section: 'nada', values: { A: 1 } })).status, 400);
});

test('Vercel: el token bueno guarda también el equipo donde se publican las webs', async () => {
  const r = await post('/save', { section: 'vercel', values: { VERCEL_TOKEN: 'vt-123' } });
  assert.equal(r.saved, true);
  assert.equal(envNow().VERCEL_SCOPE, 'mi-equipo');
});

test('campañas: crea solo la de LLC si no pides Maps, guarda su id y la activa', async () => {
  writeFileSync(envFile, readFileSync(envFile, 'utf8') + 'INSTANTLY_API_KEY=inst-1\n');
  calls.length = 0;
  const r = await post('/campaigns', {});
  assert.match(r.items[0].text, /LLC.*creada y activada/);
  assert.equal(r.items.length, 1);
  assert.equal(envNow().INSTANTLY_CAMPAIGN_ID, 'camp-nueva');
  assert.equal(calls.filter(c => c.url.endsWith('/campaigns') && c.method === 'POST').length, 1);
});

test('Render: crea el servidor con tus valores y guarda su id y su dirección; la segunda vez solo le vuelve a mandar los valores', async () => {
  const add = 'SUPABASE_URL=https://abc.supabase.co\nSUPABASE_SERVICE_KEY=s\nNEW_LEADS_OWNER_USER_ID=o\nRENDER_API_KEY=rnd\n';
  writeFileSync(envFile, readFileSync(envFile, 'utf8') + add);
  const first = await post('/render', {});
  assert.match(first.items[0].text, /Servidor creado: https:\/\/mi\.onrender\.com/);
  assert.deepEqual([envNow().RENDER_SERVICE_ID, envNow().CAMPAIGN_PUBLIC_URL], ['srv-1', 'https://mi.onrender.com']);
  calls.length = 0;
  const second = await post('/render', {});
  assert.match(second.items[0].text, /ya existía/);
  assert.ok(!calls.some(c => c.url.endsWith('/services') && c.method === 'POST'));
});

test('el texto del SQL se puede copiar desde la caja', async () => {
  assert.equal(await (await fetch(`${base}/schema`)).text(), 'CREATE TABLE x ();');
});

// ─── Solo desde tu ordenador ────────────────────────────────────────────────
function guard(req) {
  let result = 'next';
  const res = { status: (code) => ({ json: () => { result = code; } }) };
  onlyThisComputer({ method: 'POST', is: () => true, socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:3001' }, ...req }, res, () => {});
  return result;
}

test('solo responde a este ordenador: otro equipo, otra web abierta en tu navegador o un Host raro → 403', () => {
  assert.equal(guard({}), 'next');
  assert.equal(guard({ headers: { host: '127.0.0.1:3001', origin: 'http://localhost:3001' } }), 'next');
  assert.equal(guard({ socket: { remoteAddress: '192.168.1.20' } }), 403);
  assert.equal(guard({ headers: { host: 'localhost:3001', origin: 'https://web-maliciosa.com' } }), 403);
  assert.equal(guard({ headers: { host: 'atacante.com' } }), 403);
  assert.equal(guard({ is: () => false }), 415);              // un formulario de otra web no puede mandar JSON sin permiso
});
