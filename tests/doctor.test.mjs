// npm run doctor: each service is checked by reading only, and every problem comes out red (fail) or yellow (warn) with
// what to do. Here the services are fakes: a world where everything is right, and each test breaks one thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import {
  runDoctor, checkYourData, checkSupabase, checkAnthropic, checkVercel, checkInstantly, checkRender, checkTelegram, checkApify, OK, WARN, FAIL,
} from '../src/services/doctor.js';

const LLC = '11111111-1111-1111-1111-111111111111';
const MAPS = '22222222-2222-2222-2222-222222222222';
const OWNER = '33333333-3333-3333-3333-333333333333';
const ENV = {
  BRAND_NAME: 'Mi Marca', SENDER_NAME: 'Ana', LEGAL_FOOTER: 'Mi Marca LLC · 1 Main St, Miami, FL',
  SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_KEY: 'supabase-secret-key', NEW_LEADS_OWNER_USER_ID: OWNER,
  ANTHROPIC_API_KEY: 'sk-ant-secret-key', VERCEL_TOKEN: 'vercel-secret-token', VERCEL_SCOPE: 'mi-equipo',
  INSTANTLY_API_KEY: 'instantly-secret-key', INSTANTLY_CAMPAIGN_ID: LLC, INSTANTLY_CAMPAIGN_ID_MAPS: MAPS,
  CAMPAIGN_PUBLIC_URL: 'https://mi-campana.onrender.com', TELEGRAM_BOT_TOKEN: 'telegram-secret-token', TELEGRAM_CHAT_ID: '42',
  APIFY_TOKEN: 'apify-secret-token', OUTREACH_DRY_RUN: 'false',
};
const env = (changes = {}) => ({ ...ENV, ...changes });

const copy = (body) => ({ sequences: [{ steps: [{ variants: [{ subject: body.startsWith('Hi') ? 'A site for {{business}}' : 'Hola {{empresa}}', body }] }] }] });
const LLC_BODY = 'Hola {{empresa}}, mira {{web}} y pide llamada en {{calendario}}';
const MAPS_BODY = 'Hi {{greeting}}, see {{site}} and {{link}}';
const APIFY = 'apify.com/v2/users/me/limits';

// Answers of a world where everything is fine, by URL. Each test overrides the ones it breaks.
function world(overrides = {}) {
  const routes = {
    'api.vercel.com/v2/user': [200, { user: { username: 'ana' } }],
    'api.vercel.com/v2/teams': [200, { teams: [{ slug: 'mi-equipo' }, { slug: 'otro-equipo' }] }],
    '/api/v2/accounts': [200, { items: [{ status: 1 }, { status: 1 }] }],
    [`/campaigns/${LLC}`]: [200, { status: 1, email_list: ['a@x.com'], ...copy(LLC_BODY) }],
    [`/campaigns/${MAPS}`]: [200, { status: 1, email_list: ['a@x.com'], ...copy(MAPS_BODY) }],
    '/health': [200, { status: 'ok', autopilot: { notes: [] } }],
    '/getMe': [200, { ok: true, result: { username: 'mi_bot' } }],
    '/getChat': [200, { ok: true, result: { id: 42 } }],
    'apify.com/v2/users/me/limits': [200, { data: { current: { monthlyUsageUsd: 10 }, limits: { maxMonthlyUsageUsd: 49 }, monthlyUsageCycle: { endAt: '2026-11-28T23:59:59.999Z' } } }],
    ...overrides,
  };
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' });
    const key = Object.keys(routes).find(k => url.includes(k));
    if (!key) throw new Error(`ruta sin respuesta en el test: ${url}`);
    const answer = routes[key];
    if (answer instanceof Error) throw answer;
    const [status, body] = answer;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetchImpl, calls };
}

// Supabase: every table answers fine unless `tables[name]` says which error it gives
function fakeDb({ tables = {}, user = { id: OWNER } } = {}) {
  const reads = [];
  return {
    reads,
    from: (table) => ({ select: (columns) => ({ limit: async () => { reads.push({ table, columns }); return { data: [], error: tables[table] ?? null }; } }) }),
    auth: { admin: { getUserById: async () => (user ? { data: { user }, error: null } : { data: { user: null }, error: { status: 404, message: 'User not found' } }) } },
  };
}
const claude = (fail = null) => ({ messages: { create: async (params) => { if (fail) throw fail; claude.last = params; return { content: [] }; } } });
const apiError = (status, message) => Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x', message } }, message, new Headers());

const statuses = (items) => items.map(i => i.status);
const find = (items, re) => items.find(i => re.test(i.text));

// ─── Tus datos ──────────────────────────────────────────────────────────────
test('tus datos: sin marca, firma o pie legal sale en rojo y dice cuáles faltan', () => {
  const items = checkYourData(env({ SENDER_NAME: '', LEGAL_FOOTER: ' ' }));
  const miss = find(items, /Faltan tus datos/);
  assert.equal(miss.status, FAIL);
  assert.match(miss.text, /SENDER_NAME, LEGAL_FOOTER/);
});

test('tus datos: un valor copiado de un ejemplo (your_…, vck_..., <token>) sale en rojo; el modo prueba, en amarillo', () => {
  const items = checkYourData(env({ ANTHROPIC_API_KEY: 'your_anthropic_key', VERCEL_TOKEN: 'vck_...', APIFY_TOKEN: '<token>', OUTREACH_DRY_RUN: 'true' }));
  assert.match(find(items, /Valores de ejemplo/).text, /ANTHROPIC_API_KEY, VERCEL_TOKEN, APIFY_TOKEN/);
  assert.equal(find(items, /Modo prueba/).status, WARN);
  assert.deepEqual(statuses(checkYourData(env())), [OK]);
});

// ─── Supabase ───────────────────────────────────────────────────────────────
test('supabase: todo bien → las 5 tablas y el usuario, leyendo una fila de verdad (contar filas no avisa si falta la tabla)', async () => {
  const db = fakeDb();
  const items = await checkSupabase(env(), { makeDb: () => db });
  assert.deepEqual(statuses(items), [OK, OK]);
  assert.equal(db.reads.length, 5);
  assert.ok(db.reads.every(r => r.columns !== '*' && r.columns.length));
});

test('supabase: falta una tabla → rojo con "pega src/db/schema.sql"; falta una columna → rojo de versión anterior', async () => {
  const missing = await checkSupabase(env(), { makeDb: () => fakeDb({ tables: { email_suppressions: { code: 'PGRST205', message: "Could not find the table 'public.email_suppressions'" } } }) });
  assert.equal(missing[0].status, FAIL);
  assert.match(missing[0].text, /Faltan tablas: email_suppressions/);
  assert.match(missing[0].fix, /src\/db\/schema\.sql/);
  const column = await checkSupabase(env(), { makeDb: () => fakeDb({ tables: { campaign_autopilot: { code: '42703', message: 'column campaign_autopilot.demo_all does not exist' } } }) });
  assert.equal(column[0].status, FAIL);
  assert.match(column[0].text, /versión anterior.*demo_all/);
});

test('supabase: clave mala → un solo rojo (no sigue preguntando tabla por tabla)', async () => {
  const items = await checkSupabase(env(), { makeDb: () => fakeDb({ tables: { generated_sites: { message: 'Invalid API key' } } }) });
  assert.equal(items.length, 1);
  assert.match(items[0].text, /SUPABASE_SERVICE_KEY no vale/);
});

test('supabase: el usuario dueño no existe o no es un UID → rojo con dónde crearlo', async () => {
  const gone = await checkSupabase(env(), { makeDb: () => fakeDb({ user: null }) });
  assert.equal(find(gone, /no existe en tu proyecto/).status, FAIL);
  const bad = await checkSupabase(env({ NEW_LEADS_OWNER_USER_ID: 'jose' }), { makeDb: () => fakeDb() });
  assert.match(find(bad, /no es un UID/).fix, /Authentication → Users/);
  const none = await checkSupabase(env({ SUPABASE_URL: '' }), { makeDb: () => assert.fail('no debe conectar sin URL') });
  assert.equal(none[0].status, FAIL);
});

// ─── Anthropic ──────────────────────────────────────────────────────────────
test('anthropic: pide 1 sola palabra al modelo que hace las webs; con respuesta → verde', async () => {
  const items = await checkAnthropic(env(), { makeAnthropic: () => claude() });
  assert.deepEqual(statuses(items), [OK]);
  assert.equal(claude.last.max_tokens, 1);
  assert.equal(claude.last.model, 'claude-sonnet-5-5');
});

test('anthropic: sin saldo (402, o el 400 "credit balance is too low") → rojo con dónde recargar', async () => {
  for (const err of [apiError(402, 'billing'), apiError(400, 'Your credit balance is too low to access the Anthropic API')]) {
    const [it] = await checkAnthropic(env(), { makeAnthropic: () => claude(err) });
    assert.equal(it.status, FAIL);
    assert.match(it.text, /no tiene saldo/);
    assert.match(it.fix, /Billing/);
  }
});

test('anthropic: clave mala → rojo; saturado → amarillo; clave que no es de Anthropic → rojo sin llamar', async () => {
  assert.match((await checkAnthropic(env(), { makeAnthropic: () => claude(apiError(401, 'invalid x-api-key')) }))[0].text, /no vale/);
  assert.equal((await checkAnthropic(env(), { makeAnthropic: () => claude(apiError(429, 'rate')) }))[0].status, WARN);
  const [it] = await checkAnthropic(env({ ANTHROPIC_API_KEY: 'abc123' }), { makeAnthropic: () => assert.fail('no debe llamar') });
  assert.match(it.text, /sk-ant-/);
});

// ─── Vercel ─────────────────────────────────────────────────────────────────
test('vercel: VERCEL_SCOPE que no es tuyo o vacío → rojo que dice tus equipos y cuál poner', async () => {
  const { fetchImpl } = world();
  assert.deepEqual(statuses(await checkVercel(env(), { fetchImpl })), [OK]);
  const wrong = await checkVercel(env({ VERCEL_SCOPE: 'nada' }), { fetchImpl });
  assert.match(wrong[0].fix, /mi-equipo, otro-equipo/);
  const empty = await checkVercel(env({ VERCEL_SCOPE: '' }), { fetchImpl });
  assert.match(empty[0].fix, /VERCEL_SCOPE=mi-equipo/);
  const bad = await checkVercel(env(), { fetchImpl: world({ 'api.vercel.com/v2/user': [403, {}] }).fetchImpl });
  assert.match(bad[0].text, /no vale o caducó/);
});

// ─── Instantly ──────────────────────────────────────────────────────────────
test('instantly: todo bien → buzones, las 2 campañas activas y su texto encaja', async () => {
  const items = await checkInstantly(env(), { fetchImpl: world().fetchImpl });
  assert.deepEqual(statuses(items), [OK, OK, OK, OK, OK]);
});

test('instantly: campaña en borrador o pausada → amarillo; suspendida → rojo', async () => {
  const fetchImpl = world({ [`/campaigns/${LLC}`]: [200, { status: 0, email_list: ['a'], ...copy(LLC_BODY) }], [`/campaigns/${MAPS}`]: [200, { status: -99, email_list: ['a'], ...copy(MAPS_BODY) }] }).fetchImpl;
  const items = await checkInstantly(env(), { fetchImpl });
  assert.equal(find(items, /LLC.*borrador/).status, WARN);
  assert.equal(find(items, /suspendida/).status, FAIL);
});

test('instantly: el texto de la campaña con huecos de tus datos → rojo con el comando que da el texto bueno', async () => {
  const fetchImpl = world({ [`/campaigns/${MAPS}`]: [200, { status: 1, email_list: ['a'], ...copy(`${MAPS_BODY}\n[[LEGAL_FOOTER]]`) }] }).fetchImpl;
  const items = await checkInstantly(env(), { fetchImpl });
  const gap = find(items, /Google Maps.*huecos/);
  assert.equal(gap.status, FAIL);
  assert.match(gap.fix, /leads:email-template -- --maps/);
});

test('instantly: ningún buzón activo, campaña sin buzones, o sin ninguna campaña → rojo; falta solo una → amarillo', async () => {
  const noBoxes = await checkInstantly(env(), { fetchImpl: world({ '/api/v2/accounts': [200, { items: [{ status: -1 }] }] }).fetchImpl });
  assert.equal(find(noBoxes, /ningún buzón activo/).status, FAIL);
  const emptyList = await checkInstantly(env(), { fetchImpl: world({ [`/campaigns/${LLC}`]: [200, { status: 1, email_list: [], ...copy(LLC_BODY) }] }).fetchImpl });
  assert.equal(find(emptyList, /no tiene buzones/).status, FAIL);
  const onlyLlc = await checkInstantly(env({ INSTANTLY_CAMPAIGN_ID_MAPS: '' }), { fetchImpl: world().fetchImpl });
  assert.equal(find(onlyLlc, /Sin campaña Google Maps/).status, WARN);
  const none = await checkInstantly(env({ INSTANTLY_CAMPAIGN_ID: '', INSTANTLY_CAMPAIGN_ID_MAPS: '' }), { fetchImpl: world().fetchImpl });
  assert.equal(find(none, /ninguna campaña/).status, FAIL);
});

// ─── Render ─────────────────────────────────────────────────────────────────
test('render: responde → verde, y lo que el servidor avisa sale en amarillo', async () => {
  const items = await checkRender(env(), { fetchImpl: world({ '/health': [200, { status: 'ok', autopilot: { notes: ['Falta VERCEL_SCOPE'] } }] }).fetchImpl });
  assert.deepEqual(statuses(items), [OK, WARN]);
  assert.match(items[1].text, /Falta VERCEL_SCOPE/);
});

test('render: no responde, responde otro servidor (el panel local) o la URL es localhost → rojo', async () => {
  const down = await checkRender(env(), { fetchImpl: world({ '/health': Object.assign(new Error('timeout'), { name: 'TimeoutError' }) }).fetchImpl });
  assert.match(down[0].text, /no responde \(no respondió a tiempo\)/);
  const other = await checkRender(env(), { fetchImpl: world({ '/health': [200, { status: 'ok' }] }).fetchImpl });
  assert.match(other[0].text, /no es el servidor de la campaña/);
  const local = await checkRender(env({ CAMPAIGN_PUBLIC_URL: 'http://localhost:3002' }), { fetchImpl: () => assert.fail('no debe llamar') });
  assert.equal(local[0].status, FAIL);
});

// ─── Telegram ───────────────────────────────────────────────────────────────
test('telegram: sin nada → amarillo (es opcional); sin chat → amarillo; el bot no ve tu chat → rojo', async () => {
  assert.deepEqual(statuses(await checkTelegram(env({ TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' }), { fetchImpl: () => assert.fail() })), [WARN]);
  const noChat = await checkTelegram(env({ TELEGRAM_CHAT_ID: '' }), { fetchImpl: world().fetchImpl });
  assert.match(noChat[0].fix, /@mi_bot.*telegram:setup/);
  const blind = await checkTelegram(env(), { fetchImpl: world({ '/getChat': [400, { ok: false }] }).fetchImpl });
  assert.equal(blind[0].status, FAIL);
  assert.deepEqual(statuses(await checkTelegram(env(), { fetchImpl: world().fetchImpl })), [OK]);
});

// ─── Apify ──────────────────────────────────────────────────────────────────
const apifyUse = (used, max) => world({ 'apify.com/v2/users/me/limits': [200, { data: { current: { monthlyUsageUsd: used }, limits: { maxMonthlyUsageUsd: max }, monthlyUsageCycle: { endAt: '2026-11-28T00:00:00Z' } } }] }).fetchImpl;

test('apify: cupo al 80 % → amarillo; agotado → rojo con la fecha en que se renueva; plan gratis → aviso del coste de Maps', async () => {
  assert.deepEqual(statuses(await checkApify(env(), { fetchImpl: apifyUse(10, 49) })), [OK]);
  assert.equal((await checkApify(env(), { fetchImpl: apifyUse(40, 49) }))[0].status, WARN);
  const spent = await checkApify(env(), { fetchImpl: apifyUse(5.01, 5) });
  assert.equal(spent[0].status, FAIL);
  assert.match(spent[0].text, /2026-11-28/);
  assert.match(find(spent, /Plan gratis/).fix, /plan de pago/);
  assert.equal((await checkApify(env({ APIFY_TOKEN: '' }), { fetchImpl: () => assert.fail() }))[0].status, WARN);
});

// ─── Todo junto ─────────────────────────────────────────────────────────────
test('runDoctor: todo bien → nada en rojo, en el orden de siempre, y solo se lee (todas las peticiones son GET)', async () => {
  const { fetchImpl, calls } = world();
  const results = await runDoctor(env(), { fetchImpl, makeDb: () => fakeDb(), makeAnthropic: () => claude() });
  assert.deepEqual(results.map(r => r.service.split(' ')[0]), ['Tus', 'Supabase', 'Anthropic', 'Vercel', 'Instantly', 'Servidor', 'Telegram', 'Apify']);
  assert.ok(results.every(r => r.items.every(i => i.status === OK)), JSON.stringify(results.flatMap(r => r.items.filter(i => i.status !== OK))));
  assert.ok(calls.length > 0 && calls.every(c => c.method === 'GET'));
});

test('runDoctor: un servicio que revienta sale en rojo y los demás se comprueban igual; nunca se muestra una clave', async () => {
  const { fetchImpl } = world({ [APIFY]: new Error('boom con apify-secret-token dentro') });
  const results = await runDoctor(env(), { fetchImpl, makeDb: () => fakeDb(), makeAnthropic: () => claude(apiError(500, 'error con sk-ant-secret-key')) });
  const apify = results.find(r => r.service.startsWith('Apify'));
  assert.match(apify.items[0].text, /No se pudo comprobar/);
  assert.equal(results.find(r => r.service.startsWith('Vercel')).items[0].status, OK);
  const shown = JSON.stringify(results);
  for (const k of ['SUPABASE_SERVICE_KEY', 'ANTHROPIC_API_KEY', 'VERCEL_TOKEN', 'INSTANTLY_API_KEY', 'TELEGRAM_BOT_TOKEN', 'APIFY_TOKEN']) assert.ok(!shown.includes(ENV[k]), `se ve ${k}`);
  assert.match(shown, /•••/);
});
