// The caja de claves, behind its buttons: what it writes in the .env and what it creates (the Supabase user, the Instantly campaigns).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'dotenv';
import {
  formatEnvValue, mergeEnv, projectRefOf, sqlEditorUrl, ensureOwnerUser, toInstantlyHtml, campaignPayload, createCampaign, CAMPAIGN_NAMES,
} from '../src/services/setup.js';

const BRAND = { BRAND_NAME: 'Mi Marca', SENDER_NAME: 'Ana', LEGAL_FOOTER: 'Mi Marca LLC · 1 Main St #5, Miami, FL', LEAD_DEMOS: 'true' };

// ─── .env ───────────────────────────────────────────────────────────────────
test('mergeEnv: cambia solo las claves pedidas, en su sitio; comentarios, orden y el resto quedan igual', () => {
  const before = '# Supabase\nSUPABASE_URL=\nSUPABASE_SERVICE_KEY=vieja\n\n# Otro\nPORT=3001\n';
  const after = mergeEnv(before, { SUPABASE_SERVICE_KEY: 'nueva', SUPABASE_URL: 'https://abc.supabase.co' });
  assert.equal(after, '# Supabase\nSUPABASE_URL=https://abc.supabase.co\nSUPABASE_SERVICE_KEY=nueva\n\n# Otro\nPORT=3001\n');
});

test('mergeEnv: una clave que no estaba va al final; un .env vacío también vale', () => {
  assert.equal(mergeEnv('PORT=3001\n\n', { VERCEL_SCOPE: 'mi-equipo' }), 'PORT=3001\nVERCEL_SCOPE=mi-equipo\n');
  assert.equal(mergeEnv('', { A: '1' }), 'A=1\n');
});

test('mergeEnv: los valores con # o comillas se leen igual al volver a cargarlos (el pie legal suele llevar "#5")', () => {
  const values = { LEGAL_FOOTER: 'Mi Marca LLC · 1 Main St #5, Miami', BRAND_NAME: "Rivera's Web", SENDER_NAME: 'Ana "la de las webs"', X: ' con espacios ' };
  assert.deepEqual(parse(mergeEnv('', values)), values);
  assert.equal(formatEnvValue('simple-valor_123'), 'simple-valor_123');
  assert.throws(() => formatEnvValue('dos\nlíneas'), /saltos de línea/);
});

test('mergeEnv: con CRLF de Windows también encuentra la clave (no la duplica)', () => {
  assert.equal(mergeEnv('PORT=3001\r\nAPIFY_TOKEN=\r\n', { APIFY_TOKEN: 't' }), 'PORT=3001\nAPIFY_TOKEN=t\n');
});

// ─── Supabase ───────────────────────────────────────────────────────────────
test('sqlEditorUrl: el enlace al SQL Editor de tu proyecto', () => {
  assert.equal(projectRefOf('https://abcdefgh.supabase.co/'), 'abcdefgh');
  assert.equal(sqlEditorUrl('https://abcdefgh.supabase.co'), 'https://supabase.com/dashboard/project/abcdefgh/sql/new');
  assert.equal(sqlEditorUrl('https://otra-cosa.com'), 'https://supabase.com/dashboard');
});

function fakeAuth(users = []) {
  const created = [];
  return {
    created,
    auth: { admin: {
      listUsers: async ({ page }) => ({ data: { users: page === 1 ? users : [] }, error: null }),
      createUser: async (attrs) => { created.push(attrs); return { data: { user: { id: 'nuevo-id', email: attrs.email } }, error: null }; },
    } },
  };
}

test('ensureOwnerUser: si ya hay un usuario con ese email lo reutiliza (sin mayúsculas ni espacios); si no, lo crea confirmado', async () => {
  const db = fakeAuth([{ id: 'existe-id', email: 'ana@ejemplo.com' }]);
  assert.deepEqual(await ensureOwnerUser(db, '  Ana@Ejemplo.com '), { id: 'existe-id', created: false });
  assert.equal(db.created.length, 0);
  const empty = fakeAuth();
  assert.deepEqual(await ensureOwnerUser(empty, 'nueva@ejemplo.com'), { id: 'nuevo-id', created: true });
  assert.deepEqual(empty.created, [{ email: 'nueva@ejemplo.com', email_confirm: true }]);
});

test('ensureOwnerUser: un error de Supabase sale con un mensaje claro', async () => {
  const db = { auth: { admin: { listUsers: async () => ({ data: null, error: { message: 'not allowed' } }) } } };
  await assert.rejects(ensureOwnerUser(db, 'a@b.com'), /no deja leer los usuarios: not allowed/);
});

// ─── Instantly ──────────────────────────────────────────────────────────────
test('toInstantlyHtml: una línea por <div>, las vacías como <div><br /></div>, escapa < & > y deja las {{variables}}', () => {
  assert.equal(toInstantlyHtml('Hola {{empresa}}\n\nA & B <c>'), '<div>Hola {{empresa}}</div><div><br /></div><div>A &amp; B &lt;c&gt;</div>');
});

test('campaignPayload: texto con tus datos, tus buzones, lunes a viernes 9–17 hora del Este, parar al responder, un solo email', () => {
  const p = campaignPayload({ campaign: 'maps', mailboxes: ['a@x.com', 'b@x.com'], env: BRAND });
  assert.equal(p.name, CAMPAIGN_NAMES.maps);
  assert.deepEqual(p.email_list, ['a@x.com', 'b@x.com']);
  assert.deepEqual(p.campaign_schedule.schedules[0].timing, { from: '09:00', to: '17:00' });
  assert.equal(p.campaign_schedule.schedules[0].timezone, 'America/Detroit');
  assert.deepEqual(Object.entries(p.campaign_schedule.schedules[0].days).filter(([, on]) => on).map(([d]) => d), ['1', '2', '3', '4', '5']);
  assert.equal(p.stop_on_reply, true);
  assert.equal(p.link_tracking, false);
  assert.equal(p.sequences[0].steps.length, 1);
  const v = p.sequences[0].steps[0].variants[0];
  assert.equal(v.subject, 'A website for {{business}}');
  assert.match(v.body, /\{\{site\}\}/);
  assert.match(v.body, /Mi Marca LLC · 1 Main St #5, Miami, FL/);
  assert.doesNotMatch(v.body, /\[\[/);
});

test('campaignPayload: la de LLC usa el texto con demo si LEAD_DEMOS=true, y el clásico si no', () => {
  const demo = campaignPayload({ campaign: 'llc', mailboxes: ['a@x.com'], env: BRAND }).sequences[0].steps[0].variants[0].body;
  const classic = campaignPayload({ campaign: 'llc', mailboxes: ['a@x.com'], env: { ...BRAND, LEAD_DEMOS: 'false' } }).sequences[0].steps[0].variants[0].body;
  assert.match(demo, /\{\{web\}\}/);
  assert.match(classic, /\{\{calendario\}\}/);
});

test('campaignPayload: sin tus datos o sin buzones no crea nada (el email saldría con huecos o no saldría)', () => {
  assert.throws(() => campaignPayload({ campaign: 'llc', mailboxes: ['a@x.com'], env: { ...BRAND, LEGAL_FOOTER: '' } }), /Faltan tus datos/);
  assert.throws(() => campaignPayload({ campaign: 'llc', mailboxes: [], env: BRAND }), /ningún buzón activo/);
});

function fakeInstantly({ activate = 200, create = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const reply = (status, json) => ({ ok: status < 400, status, statusText: 'x', json: async () => json });
    if (url.endsWith('/accounts?limit=100')) return reply(200, { items: [{ email: 'a@x.com', status: 1 }, { email: 'roto@x.com', status: -1 }, { email: 'pausado@x.com', status: 2 }] });
    if (url.endsWith('/activate')) return reply(activate, { message: 'no se puede activar' });
    if (url.endsWith('/campaigns')) return reply(create, create < 400 ? { id: 'camp-1' } : { message: 'sin permiso' });
    throw new Error(`ruta inesperada ${url}`);
  };
  return { fetchImpl, calls };
}

test('createCampaign: crea la campaña solo con los buzones activos y la activa', async () => {
  const { fetchImpl, calls } = fakeInstantly();
  assert.deepEqual(await createCampaign('k', { campaign: 'llc', env: BRAND, fetchImpl }), { id: 'camp-1', active: true });
  const post = calls.find(c => c.url.endsWith('/campaigns'));
  assert.equal(post.method, 'POST');
  assert.deepEqual(post.body.email_list, ['a@x.com']);
  assert.ok(calls.some(c => c.url.endsWith('/campaigns/camp-1/activate') && c.method === 'POST'));
});

test('createCampaign: si Instantly no deja activarla, queda creada en borrador (no es un error); si no deja crearla, sí', async () => {
  const draft = await createCampaign('k', { campaign: 'maps', env: BRAND, fetchImpl: fakeInstantly({ activate: 400 }).fetchImpl });
  assert.equal(draft.id, 'camp-1');
  assert.equal(draft.active, false);
  assert.match(draft.activateError, /no se puede activar/);
  await assert.rejects(createCampaign('k', { campaign: 'maps', env: BRAND, fetchImpl: fakeInstantly({ create: 403 }).fetchImpl }), /Instantly respondió 403: sin permiso/);
});
