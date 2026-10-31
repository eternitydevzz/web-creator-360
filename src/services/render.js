// Creates your campaign server on Render through its API (api-docs.render.com), with the values of your .env already in
// it, so no key is ever typed into Render by hand. Same service as render.yaml: same commands, plan and variables.
//   GET  /owners                                  your workspace id
//   POST /services                                the web service, from this repo, with its variables
//   PUT  /services/{id}/env-vars/CAMPAIGN_PUBLIC_URL   its own address, known only once it exists
//   POST /services/{id}/deploys                   start again with that address
export const RENDER_API = 'https://api.render.com/v1';
export const DEFAULT_REPO = 'https://github.com/eternitydevzz/web-creator-360';
const SERVICE = {
  name: 'web-creator-360-campaign',
  region: 'frankfurt',
  plan: 'starter',          // the free plan sleeps after a few minutes and its crons stop (see render.yaml)
  buildCommand: 'npm install --omit=dev',
  startCommand: 'node src/campaign-server.js',
  healthCheckPath: '/health',
};
// The variables the campaign server reads (the list in render.yaml). Only the ones with a value are sent.
export const RENDER_VARS = [
  'BRAND_NAME', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'NEW_LEADS_OWNER_USER_ID', 'INSTANTLY_API_KEY', 'INSTANTLY_CAMPAIGN_ID',
  'INSTANTLY_CAMPAIGN_ID_MAPS', 'LEAD_DEMOS', 'OUTREACH_DRY_RUN', 'ANTHROPIC_API_KEY', 'VERCEL_TOKEN', 'VERCEL_SCOPE', 'APIFY_TOKEN',
  'MAPS_RUNS_PER_DAY', 'MAPS_MAX_PER_SEARCH', 'MAPS_LOOKUPS_PER_RUN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'SOCRATA_APP_TOKEN',
  'CAMPAIGN_PUBLIC_URL',
];
// Without them the server starts but cannot do its job
const NEEDED = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'NEW_LEADS_OWNER_USER_ID', 'INSTANTLY_API_KEY', 'ANTHROPIC_API_KEY', 'VERCEL_TOKEN', 'VERCEL_SCOPE', 'BRAND_NAME'];

const val = (env, key) => String(env[key] ?? '').trim();
export const renderEnvVars = (env) => [{ key: 'NODE_ENV', value: 'production' }, ...RENDER_VARS.filter(k => val(env, k)).map(k => ({ key: k, value: val(env, k) }))];
export const missingForRender = (env) => NEEDED.filter(k => !val(env, k));

async function render(apiKey, path, { method = 'GET', body, fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(`${RENDER_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.message || data?.error || res.statusText;
    const hint = res.status === 401 ? ' (¿RENDER_API_KEY correcta?)' : /payment|card|billing/i.test(detail) ? ' (el plan starter es de pago: añade una tarjeta en Render → Billing)' : '';
    throw new Error(`Render respondió ${res.status}: ${detail}${hint}`);
  }
  return data;
}

// Your workspace on Render (the first one, which is the only one on a personal account) → { id, name }
export async function renderOwner(apiKey, { fetchImpl } = {}) {
  const list = await render(apiKey, '/owners', { fetchImpl });
  const owner = list?.[0]?.owner;
  if (!owner?.id) throw new Error('Tu cuenta de Render no tiene ningún workspace');
  return { id: owner.id, name: owner.name };
}

// The name may already be taken in your workspace (an earlier install): then it tries -2, -3… up to this many names
const MAX_NAME_TRIES = 5;
async function createWithFreeName(apiKey, body, { fetchImpl }) {
  for (let n = 1; ; n++) {
    const name = n === 1 ? SERVICE.name : `${SERVICE.name}-${n}`;
    try {
      return await render(apiKey, '/services', { method: 'POST', body: { ...body, name }, fetchImpl });
    } catch (err) {
      if (n >= MAX_NAME_TRIES || !/already in use/i.test(err.message)) throw err;
    }
  }
}

// The service from this repo, already with your values, and then its own address. → { serviceId, url }
export async function createCampaignServer(apiKey, { env = process.env, repo = DEFAULT_REPO, branch = 'main', fetchImpl } = {}) {
  const missing = missingForRender(env);
  if (missing.length) throw new Error(`Antes de crear el servidor faltan en tu .env: ${missing.join(', ')}`);
  const owner = await renderOwner(apiKey, { fetchImpl });
  const created = await createWithFreeName(apiKey, {
    type: 'web_service', ownerId: owner.id, repo, branch, autoDeploy: 'yes', envVars: renderEnvVars(env),
    serviceDetails: {
      runtime: 'node', plan: SERVICE.plan, region: SERVICE.region, healthCheckPath: SERVICE.healthCheckPath,
      envSpecificDetails: { buildCommand: SERVICE.buildCommand, startCommand: SERVICE.startCommand },
    },
  }, { fetchImpl });
  const serviceId = created?.service?.id;
  const url = String(created?.service?.serviceDetails?.url || '').replace(/\/+$/, '');
  if (!serviceId || !url) throw new Error('Render creó el servidor pero no devolvió su id o su dirección: míralo en dashboard.render.com');
  await render(apiKey, `/services/${serviceId}/env-vars/CAMPAIGN_PUBLIC_URL`, { method: 'PUT', body: { value: url }, fetchImpl });
  await render(apiKey, `/services/${serviceId}/deploys`, { method: 'POST', body: {}, fetchImpl });
  return { serviceId, url };
}

// Sends the current values of your .env again to a server that already exists (after you change a key), and restarts it
export async function syncCampaignServer(apiKey, serviceId, { env = process.env, fetchImpl } = {}) {
  for (const { key, value } of renderEnvVars(env)) {
    await render(apiKey, `/services/${serviceId}/env-vars/${key}`, { method: 'PUT', body: { value }, fetchImpl });
  }
  await render(apiKey, `/services/${serviceId}/deploys`, { method: 'POST', body: {}, fetchImpl });
}
