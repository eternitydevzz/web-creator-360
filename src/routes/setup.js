// The "caja de claves" (public/claves.html): you paste each key in your own browser, it is checked on the spot and written
// to your .env. Claude, guiding the install, never sees a key: the page never sends a saved key back, only "guardada".
// It only answers requests made from this same computer, from a page of this same app (not from another device on your
// network, nor from another website open in your browser), because it writes your .env.
//   GET  /status          what is already there (secrets only as set / not set)
//   POST /save            { values: { KEY: value } } one section: checked first, written only when nothing is red
//   POST /owner           { email } creates (or reuses) the Supabase user that owns your leads
//   GET  /tables          are the 5 tables there? + the link to your SQL editor
//   POST /campaigns       { maps? } creates the Instantly campaigns that are missing (text, mailboxes, schedule) and starts them
//   POST /telegram/wait   waits up to a minute for your "hola" to the bot, saves your chat id and sends you a test message
//   POST /render          creates your campaign server on Render with your values (or, if it exists, sends them again)
//   GET  /schema          the text of src/db/schema.sql (to copy it)
//   GET  /doctor          npm run doctor, for the end of the page
import { Router } from 'express';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { parse } from 'dotenv';
import { mergeEnv, ensureOwnerUser, activeMailboxes, createCampaign, sqlEditorUrl } from '../services/setup.js';
import { checkYourData, checkAnthropic, checkApify, checkTelegram, readTables, runDoctor, OK, WARN, FAIL } from '../services/doctor.js';
import { waitForChats, sendTelegram } from '../services/telegram.js';
import { renderOwner, createCampaignServer, syncCampaignServer } from '../services/render.js';
import { API as INSTANTLY_API } from '../services/instantly.js';

// What each section may write. Anything else is refused.
const SECTIONS = {
  brand: ['BRAND_NAME', 'SENDER_NAME', 'LEGAL_FOOTER'],
  supabase: ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  vercel: ['VERCEL_TOKEN'],
  instantly: ['INSTANTLY_API_KEY'],
  telegram: ['TELEGRAM_BOT_TOKEN'],
  apify: ['APIFY_TOKEN'],
  render: ['RENDER_API_KEY'],
};
const SECRET = new Set(['SUPABASE_SERVICE_KEY', 'ANTHROPIC_API_KEY', 'VERCEL_TOKEN', 'INSTANTLY_API_KEY', 'TELEGRAM_BOT_TOKEN', 'APIFY_TOKEN', 'RENDER_API_KEY']);
const SHOWN = ['BRAND_NAME', 'SENDER_NAME', 'LEGAL_FOOTER', 'SUPABASE_URL', 'NEW_LEADS_OWNER_USER_ID', 'VERCEL_SCOPE', 'INSTANTLY_CAMPAIGN_ID', 'INSTANTLY_CAMPAIGN_ID_MAPS', 'TELEGRAM_CHAT_ID', 'CAMPAIGN_PUBLIC_URL', 'RENDER_SERVICE_ID'];
const LOCAL_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const TELEGRAM_WAIT_SECONDS = 60;

const item = (status, text, fix = '') => ({ status, text, fix });
const failed = (items) => items.some(i => i.status === FAIL);
const dbOf = (env) => createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// Same machine, and a page of this app: blocks other devices, other websites (their Origin) and DNS rebinding (their Host)
export function onlyThisComputer(req, res, next) {
  const local = (h) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(String(h || ''));
  const origin = req.headers.origin;
  const fromHere = LOCAL_IPS.has(req.socket?.remoteAddress) && local(req.headers.host) && (!origin || local(String(origin).replace(/^https?:\/\//, '')));
  if (!fromHere) return res.status(403).json({ error: 'La caja de claves solo funciona desde tu propio ordenador (http://localhost).' });
  if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ error: 'Formato no válido' });
  next();
}

export function createSetupRouter({ envFile, exampleFile, schemaFile, fetchImpl = globalThis.fetch, makeDb = dbOf, makeAnthropic, env: processEnv = process.env } = {}) {
  const router = Router();
  router.use(onlyThisComputer);

  const read = () => {
    if (!existsSync(envFile) && exampleFile && existsSync(exampleFile)) copyFileSync(exampleFile, envFile);
    return existsSync(envFile) ? parse(readFileSync(envFile, 'utf8')) : {};
  };
  // Written to the .env and to the running app (so the next checks see it without a restart)
  const save = (updates) => {
    writeFileSync(envFile, mergeEnv(existsSync(envFile) ? readFileSync(envFile, 'utf8') : '', updates));
    Object.assign(processEnv, updates);
  };
  const guard = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (err) { res.status(500).json({ error: err.message }); }
  };

  router.get('/status', (req, res) => {
    const env = read();
    res.json({
      set: Object.fromEntries(Object.values(SECTIONS).flat().map(k => [k, !!String(env[k] || '').trim()])),
      values: Object.fromEntries(SHOWN.map(k => [k, String(env[k] || '')])),
    });
  });

  router.post('/save', guard(async (req, res) => {
    const section = String(req.body?.section || '');
    const allowed = SECTIONS[section];
    if (!allowed) return res.status(400).json({ error: 'Sección desconocida' });
    const values = Object.fromEntries(Object.entries(req.body?.values || {}).filter(([k]) => allowed.includes(k)).map(([k, v]) => [k, String(v ?? '').trim()]));
    if (!Object.keys(values).length) return res.status(400).json({ error: 'No hay nada que guardar' });
    const env = { ...read(), ...values };
    const { items, extra = {} } = await checkSection(section, env, { fetchImpl, makeDb, makeAnthropic });
    if (!failed(items)) save({ ...values, ...extra });
    res.json({ saved: !failed(items), items });
  }));

  router.post('/owner', guard(async (req, res) => {
    const email = String(req.body?.email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Escribe un email válido' });
    const { id, created } = await ensureOwnerUser(makeDb(read()), email);
    save({ NEW_LEADS_OWNER_USER_ID: id });
    res.json({ items: [item(OK, created ? 'Usuario creado: tus leads se guardan a su nombre' : 'Ese usuario ya existía: lo uso')] });
  }));

  router.get('/tables', guard(async (req, res) => {
    const env = read();
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
      return res.json({ ready: false, missing: [], problems: [], fatal: 'Primero guarda la URL y la clave de Supabase', sqlEditor: sqlEditorUrl(env.SUPABASE_URL || '') });
    }
    const tables = await readTables(makeDb(env));
    const ready = !tables.fatal && !tables.missing.length && !tables.problems.length;
    res.json({ ready, missing: tables.missing || [], problems: tables.problems || [], fatal: tables.fatal || null, sqlEditor: sqlEditorUrl(env.SUPABASE_URL || '') });
  }));

  router.post('/campaigns', guard(async (req, res) => {
    const env = read();
    const items = [];
    for (const [campaign, variable, label] of [['llc', 'INSTANTLY_CAMPAIGN_ID', 'LLC (español)'], ['maps', 'INSTANTLY_CAMPAIGN_ID_MAPS', 'Google Maps (inglés)']]) {
      if (campaign === 'maps' && !req.body?.maps) continue;
      if (await campaignExists(env.INSTANTLY_API_KEY, env[variable], fetchImpl)) { items.push(item(OK, `La campaña ${label} ya existe`)); continue; }
      const { id, active, activateError } = await createCampaign(env.INSTANTLY_API_KEY, { campaign, env, fetchImpl });
      save({ [variable]: id });
      items.push(active ? item(OK, `Campaña ${label} creada y activada (lunes a viernes, 9–17 h de Nueva York)`)
        : item(WARN, `Campaña ${label} creada, pero quedó en borrador: ${activateError}`, 'Actívala en Instantly cuando quieras enviar.'));
    }
    res.json({ items });
  }));

  router.post('/telegram/wait', guard(async (req, res) => {
    const env = read();
    const { bot, chats } = await waitForChats(env.TELEGRAM_BOT_TOKEN, { seconds: TELEGRAM_WAIT_SECONDS, fetchImpl });
    if (chats.length !== 1) {
      return res.json({ items: [item(FAIL, chats.length ? `Han escrito ${chats.length} personas a ${bot}: escríbele solo tú y vuelve a probar` : `No ha llegado ningún mensaje a ${bot}`, `Abre ${bot} en Telegram (no BotFather), pulsa Start, escribe "hola" y vuelve a pulsar el botón.`)] });
    }
    save({ TELEGRAM_CHAT_ID: chats[0].id });
    const sent = await sendTelegram('✅ Telegram conectado: aquí recibirás los avisos de Web Creator 360.', { env: { ...env, TELEGRAM_CHAT_ID: chats[0].id }, fetchImpl });
    res.json({ items: [sent.ok ? item(OK, `Conectado con ${chats[0].name}: te he mandado un mensaje de prueba`) : item(FAIL, `Chat guardado, pero no se pudo mandar el mensaje de prueba: ${sent.error}`)] });
  }));

  router.post('/render', guard(async (req, res) => {
    const env = read();
    if (env.RENDER_SERVICE_ID) {
      await syncCampaignServer(env.RENDER_API_KEY, env.RENDER_SERVICE_ID, { env, fetchImpl });
      return res.json({ items: [item(OK, 'Tu servidor ya existía: le he mandado tus valores de ahora y se está reiniciando (tarda unos minutos)')] });
    }
    const { serviceId, url } = await createCampaignServer(env.RENDER_API_KEY, { env, fetchImpl });
    save({ RENDER_SERVICE_ID: serviceId, CAMPAIGN_PUBLIC_URL: url });
    res.json({ items: [item(OK, `Servidor creado: ${url}. Render tarda unos minutos en ponerlo en marcha`)] });
  }));

  // The text of src/db/schema.sql, for the "copy" button (Claude usually pastes it in Supabase for you)
  router.get('/schema', (req, res) => res.type('text/plain').send(schemaFile && existsSync(schemaFile) ? readFileSync(schemaFile, 'utf8') : ''));

  router.get('/doctor', guard(async (req, res) => {
    res.json({ results: await runDoctor(read(), { fetchImpl, makeDb, makeAnthropic }) });
  }));

  return router;
}

async function campaignExists(apiKey, id, fetchImpl) {
  if (!id) return false;
  const r = await fetchImpl(`${INSTANTLY_API}/campaigns/${id}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  return r.ok;
}

// Each section's check before saving → { items, extra } (extra: values worked out from the key, saved with it)
async function checkSection(section, env, { fetchImpl, makeDb, makeAnthropic }) {
  switch (section) {
    case 'brand': return { items: checkYourData(env).filter(i => /tus datos|Marca/.test(i.text)) };
    case 'supabase': {
      if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/i.test(env.SUPABASE_URL || '')) return { items: [item(FAIL, 'Esa no es la URL de un proyecto de Supabase', 'Es como https://abcdefgh.supabase.co')] };
      const { fatal } = await readTables(makeDb(env));
      return { items: [fatal ? item(FAIL, /invalid api key|jwt/i.test(fatal) ? 'La clave no vale' : `No se pudo conectar: ${fatal}`, 'Copia la clave "service_role" (secreta), no la "anon".') : item(OK, 'Conectado a tu base de datos')] };
    }
    case 'anthropic': return { items: await checkAnthropic(env, makeAnthropic ? { makeAnthropic } : {}) };
    case 'vercel': return vercelScope(env, fetchImpl);
    case 'instantly': {
      try {
        const boxes = await activeMailboxes(env.INSTANTLY_API_KEY, { fetchImpl });
        return { items: [boxes.length ? item(OK, `Clave válida: ${boxes.length} buzones activos`) : item(FAIL, 'Clave válida, pero no tienes ningún buzón activo', 'Instantly → Email Accounts: conecta al menos uno.')] };
      } catch (err) {
        return { items: [item(FAIL, `La clave no vale: ${err.message}`, 'Crea una clave API v2 con permiso para leads y campañas.')] };
      }
    }
    case 'telegram': return { items: (await checkTelegram({ ...env, TELEGRAM_CHAT_ID: '' }, { fetchImpl })).map(i => (i.status === WARN ? item(OK, i.text.replace(/, pero falta.*$/, '')) : i)) };
    case 'apify': return { items: await checkApify(env, { fetchImpl }) };
    case 'render': {
      try {
        const owner = await renderOwner(env.RENDER_API_KEY, { fetchImpl });
        return { items: [item(OK, `Clave válida (workspace ${owner.name || owner.id})`)] };
      } catch (err) {
        return { items: [item(FAIL, err.message, 'Render → Account Settings → API Keys → Create API Key.')] };
      }
    }
    default: return { items: [item(FAIL, 'Sección desconocida')] };
  }
}

// A valid token also tells which team the websites go to: the first one, or the one already chosen if it is still yours
async function vercelScope(env, fetchImpl) {
  const res = await fetchImpl('https://api.vercel.com/v2/teams', { headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` } });
  if (!res.ok) return { items: [item(FAIL, `El token no vale (HTTP ${res.status})`, 'vercel.com → Account Settings → Tokens: crea otro.')] };
  const slugs = ((await res.json()).teams || []).map(t => t.slug);
  const scope = slugs.includes(env.VERCEL_SCOPE) ? env.VERCEL_SCOPE : slugs[0];
  if (!scope) return { items: [item(FAIL, 'Tu cuenta de Vercel no tiene ningún equipo', 'Entra una vez en vercel.com para que lo cree.')] };
  return { items: [item(OK, `Token válido; las webs se publicarán en el equipo ${scope}`)], extra: { VERCEL_SCOPE: scope } };
}
