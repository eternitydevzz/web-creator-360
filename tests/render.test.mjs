// Your campaign server on Render, created through its API with the values of your .env (nobody types keys into Render).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCampaignServer, syncCampaignServer, renderEnvVars, missingForRender, RENDER_API, DEFAULT_REPO } from '../src/services/render.js';

const ENV = {
  BRAND_NAME: 'Mi Marca', SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_KEY: 'sb-secret', NEW_LEADS_OWNER_USER_ID: 'owner-1',
  INSTANTLY_API_KEY: 'inst', INSTANTLY_CAMPAIGN_ID: 'camp-1', ANTHROPIC_API_KEY: 'sk-ant-x', VERCEL_TOKEN: 'vt', VERCEL_SCOPE: 'mi-equipo',
  LEAD_DEMOS: 'true', OUTREACH_DRY_RUN: 'true', APIFY_TOKEN: '', RENDER_API_KEY: 'rnd-key', DASHBOARD_PASSWORD: 'no-va-a-render',
};

function fakeRender({ create = 201, owners = [{ owner: { id: 'own-1', name: 'Ana' } }], createBody } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers?.Authorization });
    const reply = (status, json) => ({ ok: status < 400, status, statusText: 'x', json: async () => json });
    if (url.endsWith('/owners')) return reply(200, owners);
    if (url.endsWith('/services') && opts.method === 'POST') return reply(create, createBody ?? { service: { id: 'srv-1', serviceDetails: { url: 'https://web-creator-360-campaign.onrender.com' } }, deployId: 'd1' });
    return reply(200, {});
  };
  return { fetchImpl, calls };
}

test('renderEnvVars: solo las variables del servidor que tienen valor, más NODE_ENV; nada del panel (contraseña) ni vacías', () => {
  const keys = renderEnvVars(ENV).map(v => v.key);
  assert.equal(keys[0], 'NODE_ENV');
  assert.ok(keys.includes('SUPABASE_SERVICE_KEY') && keys.includes('VERCEL_SCOPE'));
  assert.ok(!keys.includes('APIFY_TOKEN'));            // vacía
  assert.ok(!keys.includes('DASHBOARD_PASSWORD'));     // no es del servidor
  assert.ok(!keys.includes('RENDER_API_KEY'));         // la clave de Render no se guarda en Render
});

test('createCampaignServer: crea el servicio (plan starter, este repo, comandos de render.yaml), le pone su dirección y lo despliega', async () => {
  const { fetchImpl, calls } = fakeRender();
  assert.deepEqual(await createCampaignServer('rnd-key', { env: ENV, fetchImpl }), { serviceId: 'srv-1', url: 'https://web-creator-360-campaign.onrender.com' });
  const create = calls.find(c => c.url === `${RENDER_API}/services`);
  assert.equal(create.auth, 'Bearer rnd-key');
  assert.equal(create.body.ownerId, 'own-1');
  assert.equal(create.body.repo, DEFAULT_REPO);
  assert.equal(create.body.serviceDetails.plan, 'starter');
  assert.deepEqual(create.body.serviceDetails.envSpecificDetails, { buildCommand: 'npm install --omit=dev', startCommand: 'node src/campaign-server.js' });
  const put = calls.find(c => c.url.endsWith('/services/srv-1/env-vars/CAMPAIGN_PUBLIC_URL'));
  assert.deepEqual([put.method, put.body], ['PUT', { value: 'https://web-creator-360-campaign.onrender.com' }]);
  assert.ok(calls.some(c => c.url.endsWith('/services/srv-1/deploys') && c.method === 'POST'));
});

test('createCampaignServer: sin las claves básicas no crea nada y dice cuáles faltan', async () => {
  const { fetchImpl, calls } = fakeRender();
  assert.deepEqual(missingForRender({ ...ENV, VERCEL_SCOPE: '' }), ['VERCEL_SCOPE']);
  await assert.rejects(createCampaignServer('k', { env: { ...ENV, ANTHROPIC_API_KEY: '' }, fetchImpl }), /faltan en tu \.env: ANTHROPIC_API_KEY/);
  assert.equal(calls.length, 0);
});

test('createCampaignServer: clave mala → pista de la clave; sin tarjeta → pista de Billing', async () => {
  const bad = async () => ({ ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({ message: 'unauthorized' }) });
  await assert.rejects(createCampaignServer('k', { env: ENV, fetchImpl: bad }), /401.*RENDER_API_KEY/);
  const { fetchImpl } = fakeRender({ create: 402, createBody: { message: 'Payment information required' } });
  await assert.rejects(createCampaignServer('k', { env: ENV, fetchImpl }), /Billing/);
});

test('createCampaignServer: si el nombre ya está cogido en su Render, prueba con -2, -3…; otro error no se reintenta', async () => {
  const taken = new Set(['web-creator-360-campaign', 'web-creator-360-campaign-2']);
  const names = [];
  const fetchImpl = async (url, opts = {}) => {
    const reply = (status, json) => ({ ok: status < 400, status, statusText: 'x', json: async () => json });
    if (url.endsWith('/owners')) return reply(200, [{ owner: { id: 'own-1', name: 'Ana' } }]);
    if (url.endsWith('/services') && opts.method === 'POST') {
      const { name } = JSON.parse(opts.body);
      names.push(name);
      if (taken.has(name)) return reply(400, { message: `name: (${name}) already in use` });
      return reply(201, { service: { id: 'srv-3', serviceDetails: { url: `https://${name}.onrender.com` } } });
    }
    return reply(200, {});
  };
  assert.deepEqual(await createCampaignServer('k', { env: ENV, fetchImpl }), { serviceId: 'srv-3', url: 'https://web-creator-360-campaign-3.onrender.com' });
  assert.deepEqual(names, ['web-creator-360-campaign', 'web-creator-360-campaign-2', 'web-creator-360-campaign-3']);

  const { fetchImpl: other, calls } = fakeRender({ create: 400, createBody: { message: 'invalid repo' } });
  await assert.rejects(createCampaignServer('k', { env: ENV, fetchImpl: other }), /invalid repo/);
  assert.equal(calls.filter(c => c.url.endsWith('/services')).length, 1);
});

test('syncCampaignServer: vuelve a mandar cada valor al servidor que ya existe y lo reinicia', async () => {
  const { fetchImpl, calls } = fakeRender();
  await syncCampaignServer('k', 'srv-9', { env: ENV, fetchImpl });
  const puts = calls.filter(c => c.method === 'PUT').map(c => c.url.split('/').pop());
  assert.deepEqual(puts, renderEnvVars(ENV).map(v => v.key));
  assert.ok(calls.at(-1).url.endsWith('/services/srv-9/deploys'));
});
