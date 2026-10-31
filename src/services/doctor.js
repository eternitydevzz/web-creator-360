// npm run doctor: checks every service the app uses by READING only (nothing is created, changed or sent) and says what
// to do about each problem. Three levels: ok (green), warn (yellow: it works, but look at this) and fail (red: the app
// will not work until you fix it). One exception costs money: Anthropic has no free way to see your credit, so Claude is
// asked for a 1-token answer (≈ $0.00003). The setup wizard reuses these checks. A key is never shown.
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { WRITER_MODEL } from '../lib/claude.js';
import { loadBrand } from '../lib/brand.js';
import { API as INSTANTLY_API, checkCampaignCopy, loadInstantlyConfig } from './instantly.js';
import { MAPS_SOURCE } from './audience.js';

export const OK = 'ok';
export const WARN = 'warn';
export const FAIL = 'fail';
const item = (status, text, fix = '') => ({ status, text, fix });

const TIMEOUT_MS = 20_000;
const RENDER_TIMEOUT_MS = 90_000;          // a free Render server that is asleep takes a while to wake up
const APIFY_WARN_SHARE = 0.8;
const APIFY_FREE_USD = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A value copied from an example instead of a real one: your_key, tu-clave, <token>, vck_..., xxx, changeme
const PLACEHOLDER_RE = /^(your[_-]|tu[_-]|<|xxx)|\.\.\.$|changeme/i;
const SECRET_VARS = ['SUPABASE_SERVICE_KEY', 'ANTHROPIC_API_KEY', 'VERCEL_TOKEN', 'INSTANTLY_API_KEY', 'TELEGRAM_BOT_TOKEN', 'APIFY_TOKEN', 'RENDER_API_KEY', 'DASHBOARD_PASSWORD', 'SOCRATA_APP_TOKEN', 'EMAIL_VERIFIER_API_KEY'];
const CHECKED_VARS = [...SECRET_VARS, 'SUPABASE_URL', 'NEW_LEADS_OWNER_USER_ID', 'VERCEL_SCOPE', 'INSTANTLY_CAMPAIGN_ID', 'INSTANTLY_CAMPAIGN_ID_MAPS', 'CAMPAIGN_PUBLIC_URL', 'TELEGRAM_CHAT_ID', 'BRAND_NAME', 'SENDER_NAME', 'LEGAL_FOOTER'];

const val = (env, key) => String(env[key] ?? '').trim();
const why = (err) => (err?.name === 'TimeoutError' ? 'no respondió a tiempo' : err?.message || String(err));

async function getJson(url, { headers = {}, timeoutMs = TIMEOUT_MS, fetchImpl }) {
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
}

// ─── Your own details ───────────────────────────────────────────────────────
export function checkYourData(env) {
  const items = [];
  const brand = loadBrand(env);
  if (brand.missing.length) {
    items.push(item(FAIL, `Faltan tus datos: ${brand.missing.join(', ')}`, 'Ponlos en tu .env: firman cada email, y LEGAL_FOOTER (tu empresa y dirección postal) lo exige la ley en EE. UU. Sin ellos la app no envía.'));
  } else {
    items.push(item(OK, `Marca «${brand.BRAND_NAME}», firma «${brand.SENDER_NAME}» y pie legal puestos`));
  }
  const placeholders = CHECKED_VARS.filter(k => PLACEHOLDER_RE.test(val(env, k)));
  if (placeholders.length) items.push(item(FAIL, `Valores de ejemplo, no reales: ${placeholders.join(', ')}`, 'Pon el valor de verdad en tu .env (o déjalo vacío).'));
  if (val(env, 'OUTREACH_DRY_RUN').toLowerCase() === 'true') {
    items.push(item(WARN, 'Modo prueba (OUTREACH_DRY_RUN=true): no se envía nada a Instantly', 'Cuando lo hayas probado con tu propio email, ponlo en false en tu .env y en Render.'));
  }
  return items;
}

// ─── Supabase ───────────────────────────────────────────────────────────────
// One real row is read from each table: counting rows ({ head: true }) of a table that does not exist gives NO error.
const TABLE_COLUMNS = {
  generated_sites: 'id, slug, html_content, preview_url, status',
  new_business_leads: 'id, user_id, source, status, link_token, demo_status, demo_template, consent_ip, import_batch, maps_url, business_phone',
  email_suppressions: 'user_id, email, reason',
  lead_ingest_runs: 'id, source, ran_at, newest_registration, stats',
  campaign_autopilot: 'user_id, enabled, push_limit, demo_all',
};
const SQL_FIX = 'Pega src/db/schema.sql entero en Supabase → SQL Editor → Run.';
const defaultDb = (url, key) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// → { missing: [tables], problems: [..] }, or { fatal } when the key or the address is wrong. Also used by the caja de claves.
export async function readTables(db) {
  const missing = [];
  const problems = [];
  for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
    const { error } = await db.from(table).select(columns).limit(1);
    if (!error) continue;
    if (/invalid api key|jwt|fetch failed|ENOTFOUND|getaddrinfo/i.test(error.message)) return { fatal: error.message };
    if (error.code === 'PGRST205') missing.push(table);
    else problems.push(`${table}: ${error.message}`);
  }
  return { missing, problems };
}

export async function checkSupabase(env, { makeDb = defaultDb } = {}) {
  const url = val(env, 'SUPABASE_URL');
  const key = val(env, 'SUPABASE_SERVICE_KEY');
  if (!/^https:\/\//i.test(url) || !key) {
    return [item(FAIL, 'Faltan SUPABASE_URL (https://…supabase.co) o SUPABASE_SERVICE_KEY', 'Supabase → Project Settings → API Keys: copia la URL y la clave "service_role" (secreta).')];
  }
  const db = makeDb(url, key);
  const tables = await readTables(db);
  if (tables.fatal) {
    const badKey = /invalid api key|jwt/i.test(tables.fatal);
    return [item(FAIL, badKey ? 'La clave SUPABASE_SERVICE_KEY no vale' : 'No se pudo conectar con SUPABASE_URL', badKey ? 'Copia otra vez la clave "service_role" (no la "anon").' : 'Revisa que la URL sea la de tu proyecto.')];
  }
  const items = [];
  if (tables.missing.length) items.push(item(FAIL, `Faltan tablas: ${tables.missing.join(', ')}`, SQL_FIX));
  for (const p of tables.problems) items.push(item(FAIL, `Tabla de una versión anterior (${p})`, 'Lo más fácil: un proyecto de Supabase nuevo y pegar ahí src/db/schema.sql (volver a pegarlo no añade columnas a tablas que ya existen).'));
  if (!items.length) items.push(item(OK, `Las ${Object.keys(TABLE_COLUMNS).length} tablas están listas`));
  items.push(await checkOwner(db, val(env, 'NEW_LEADS_OWNER_USER_ID')));
  return items;
}

async function checkOwner(db, ownerId) {
  const fix = 'Supabase → Authentication → Users: crea un usuario y copia su "User UID" en NEW_LEADS_OWNER_USER_ID.';
  if (!UUID_RE.test(ownerId)) return item(FAIL, ownerId ? 'NEW_LEADS_OWNER_USER_ID no es un UID válido' : 'Falta NEW_LEADS_OWNER_USER_ID (el usuario dueño de tus leads)', fix);
  const { data, error } = await db.auth.admin.getUserById(ownerId);
  if (error || !data?.user) return item(FAIL, 'El usuario de NEW_LEADS_OWNER_USER_ID no existe en tu proyecto', fix);
  return item(OK, 'El usuario dueño de los leads existe');
}

// ─── Anthropic ──────────────────────────────────────────────────────────────
const defaultAnthropic = (apiKey) => new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });
const BILLING_FIX = 'console.anthropic.com → Settings → Billing: añade crédito (cada web cuesta ≈ 0,02–0,14 $).';

export async function checkAnthropic(env, { makeAnthropic = defaultAnthropic } = {}) {
  const key = val(env, 'ANTHROPIC_API_KEY');
  const keyFix = 'console.anthropic.com → API Keys: crea una clave y pégala en ANTHROPIC_API_KEY.';
  if (!key) return [item(FAIL, 'Falta ANTHROPIC_API_KEY: sin ella no se hace ninguna web', keyFix)];
  if (!key.startsWith('sk-ant-')) return [item(FAIL, 'ANTHROPIC_API_KEY no parece una clave de Anthropic (empiezan por sk-ant-)', keyFix)];
  try {
    await makeAnthropic(key).messages.create({ model: WRITER_MODEL, max_tokens: 1, messages: [{ role: 'user', content: 'Responde solo: ok' }] });
    return [item(OK, `Clave válida y con saldo (modelo ${WRITER_MODEL})`)];
  } catch (err) {
    return [anthropicProblem(err, keyFix)];
  }
}

function anthropicProblem(err, keyFix) {
  // Without credit the API answers 402 billing_error (older accounts: 400 "Your credit balance is too low")
  if (err?.status === 402 || /credit balance/i.test(err?.message || '')) return item(FAIL, 'Tu cuenta de Anthropic no tiene saldo: sin él falla cada web de demo', BILLING_FIX);
  if (err instanceof Anthropic.AuthenticationError) return item(FAIL, 'La clave ANTHROPIC_API_KEY no vale', keyFix);
  if (err instanceof Anthropic.PermissionDeniedError) return item(FAIL, 'Tu clave no tiene permiso para usar Claude', keyFix);
  if (err instanceof Anthropic.NotFoundError) return item(FAIL, `Tu cuenta no tiene acceso al modelo ${WRITER_MODEL}`, 'Escribe al soporte de Anthropic.');
  if (err instanceof Anthropic.RateLimitError || err?.status === 529) return item(WARN, 'Anthropic está saturado ahora mismo (la clave parece buena)', 'Vuelve a ejecutar npm run doctor en unos minutos.');
  if (err instanceof Anthropic.APIConnectionError) return item(FAIL, 'No se pudo conectar con Anthropic', 'Revisa tu conexión a internet.');
  return item(FAIL, `Anthropic respondió con un error: ${why(err)}`, keyFix);
}

// ─── Vercel ─────────────────────────────────────────────────────────────────
export async function checkVercel(env, { fetchImpl = globalThis.fetch } = {}) {
  const token = val(env, 'VERCEL_TOKEN');
  const tokenFix = 'vercel.com → Account Settings → Tokens: crea uno y pégalo en VERCEL_TOKEN.';
  if (!token) return [item(FAIL, 'Falta VERCEL_TOKEN: sin él no se publica ninguna web', tokenFix)];
  const headers = { Authorization: `Bearer ${token}` };
  const user = await getJson('https://api.vercel.com/v2/user', { headers, fetchImpl });
  if (!user.ok) return [item(FAIL, `El token VERCEL_TOKEN no vale o caducó (HTTP ${user.status})`, tokenFix)];
  const teams = await getJson('https://api.vercel.com/v2/teams', { headers, fetchImpl });
  const slugs = (teams.body?.teams || []).map(t => t.slug);
  const scope = val(env, 'VERCEL_SCOPE');
  const listFix = slugs.length ? `Tus equipos: ${slugs.join(', ')}. Pon VERCEL_SCOPE=${slugs[0]}` : 'Vercel → Settings: copia el "slug" de tu equipo.';
  if (!scope) return [item(FAIL, 'Falta VERCEL_SCOPE (el equipo donde se publican las webs)', listFix)];
  if (!slugs.includes(scope) && user.body?.user?.username !== scope) return [item(FAIL, `VERCEL_SCOPE="${scope}" no es ninguno de tus equipos`, listFix)];
  return [item(OK, `Token válido; las webs se publican en el equipo ${scope}`)];
}

// ─── Instantly ──────────────────────────────────────────────────────────────
// Campaign status, from the Instantly API reference (developer.instantly.ai → Get campaign)
const CAMPAIGN_STATUS = {
  0: [WARN, 'en borrador', 'Actívala en Instantly (Resume/Launch) cuando quieras empezar a enviar.'],
  1: [OK, 'activa'],
  2: [WARN, 'pausada', 'Reactívala en Instantly cuando quieras que envíe.'],
  3: [OK, 'terminada (la app la reactiva sola al añadir leads)'],
  4: [OK, 'activa (enviando subsecuencias)'],
  '-1': [FAIL, 'parada: sus buzones tienen problemas', 'Instantly → Email Accounts: revisa los buzones.'],
  '-2': [WARN, 'frenada por la protección de rebotes de Instantly', 'Instantly: revisa los rebotes de la campaña.'],
  '-99': [FAIL, 'tu cuenta de Instantly está suspendida', 'Escribe al soporte de Instantly.'],
};
const CAMPAIGNS = [
  { campaign: 'llc', variable: 'INSTANTLY_CAMPAIGN_ID', label: 'LLC de Connecticut (español)', source: 'ct_registry', template: 'npm run leads:email-template' },
  { campaign: 'maps', variable: 'INSTANTLY_CAMPAIGN_ID_MAPS', label: 'Google Maps (inglés)', source: MAPS_SOURCE, template: 'npm run leads:email-template -- --maps' },
];
const sampleLead = (source) => ({ name: 'Ejemplo LLC', email: 'ejemplo@example.com', city: 'Hartford', sector: 'otro', source, link_token: 'ejemplo', demo_url: 'https://ejemplo.vercel.app', rating: 4.8, reviews: 20 });

export async function checkInstantly(env, { fetchImpl = globalThis.fetch } = {}) {
  const key = val(env, 'INSTANTLY_API_KEY');
  const keyFix = 'Instantly → Settings → Integrations → API Keys: crea una (API v2) y pégala en INSTANTLY_API_KEY.';
  if (!key) return [item(FAIL, 'Falta INSTANTLY_API_KEY: sin ella no se envía ningún email', keyFix)];
  const headers = { Authorization: `Bearer ${key}` };
  const accounts = await getJson(`${INSTANTLY_API}/accounts?limit=100`, { headers, fetchImpl });
  if (!accounts.ok) return [item(FAIL, `La clave INSTANTLY_API_KEY no vale o no tiene permisos (HTTP ${accounts.status})`, keyFix)];
  const items = [mailboxesItem(accounts.body?.items || [])];
  const set = CAMPAIGNS.filter(c => val(env, c.variable));
  if (!set.length) return [...items, item(FAIL, 'No tienes ninguna campaña puesta', 'Crea la campaña en Instantly y pega su UUID en INSTANTLY_CAMPAIGN_ID (y en INSTANTLY_CAMPAIGN_ID_MAPS si usas Maps).')];
  for (const c of CAMPAIGNS.filter(x => !set.includes(x))) items.push(item(WARN, `Sin campaña ${c.label}: esa campaña no enviará`, `Solo si la vas a usar: pega su UUID en ${c.variable}.`));
  for (const c of set) items.push(...await campaignItems(env, c, { headers, fetchImpl }));
  return items;
}

function mailboxesItem(accounts) {
  const active = accounts.filter(a => a.status === 1).length;
  const broken = accounts.filter(a => a.status < 0).length;
  if (!active) return item(FAIL, 'No tienes ningún buzón activo en Instantly', 'Instantly → Email Accounts: conecta y activa al menos uno.');
  if (broken) return item(WARN, `${active} buzones activos y ${broken} con error de conexión o envío`, 'Instantly → Email Accounts: revisa los que tienen error.');
  return item(OK, `${active} buzones activos`);
}

async function campaignItems(env, c, { headers, fetchImpl }) {
  const id = val(env, c.variable);
  if (!UUID_RE.test(id)) return [item(FAIL, `${c.variable} no es un UUID de campaña`, 'Instantly → la campaña: el UUID sale en la dirección de la página.')];
  const res = await getJson(`${INSTANTLY_API}/campaigns/${id}`, { headers, fetchImpl });
  if (!res.ok) return [item(FAIL, `Campaña ${c.label}: no existe en tu Instantly (HTTP ${res.status})`, `Revisa el UUID de ${c.variable}.`)];
  const [status, text, fix] = CAMPAIGN_STATUS[res.body?.status] || [WARN, `en un estado desconocido (${res.body?.status})`, 'Mírala en Instantly.'];
  const items = [item(status, `Campaña ${c.label}: ${text}`, fix)];
  if (!(res.body?.email_list || []).length) items.push(item(FAIL, `Campaña ${c.label}: no tiene buzones para enviar`, 'Instantly → la campaña → Options: elige tus buzones.'));
  const config = loadInstantlyConfig(env, { dryRun: true, campaign: c.campaign });
  const copy = await checkCampaignCopy(config, sampleLead(c.source), { fetchImpl });
  items.push(copy.ok ? item(OK, `Campaña ${c.label}: el texto encaja con lo que envía la app`)
    : item(FAIL, `Campaña ${c.label}: ${copy.problems.join('; ')}`, `Copia el texto de «${c.template}» y pégalo en la campaña.`));
  return items;
}

// ─── The campaign server (Render) ───────────────────────────────────────────
export async function checkRender(env, { fetchImpl = globalThis.fetch } = {}) {
  const url = val(env, 'CAMPAIGN_PUBLIC_URL').replace(/\/+$/, '');
  if (!/^https:\/\//i.test(url) || /^https?:\/\/(localhost|127\.|0\.0\.0\.0)/i.test(url)) {
    return [item(FAIL, 'Falta CAMPAIGN_PUBLIC_URL (la dirección https de tu servidor en Render): los enlaces de los emails van ahí', 'Render → tu servicio: copia su dirección https://….onrender.com.')];
  }
  const asleep = 'Render → tu servicio → Logs: mira que esté desplegado. En el plan gratis se duerme y tarda en despertar: vuelve a probar.';
  let res;
  try {
    res = await getJson(`${url}/health`, { fetchImpl, timeoutMs: RENDER_TIMEOUT_MS });
  } catch (err) {
    return [item(FAIL, `El servidor de la campaña no responde (${why(err)})`, asleep)];
  }
  if (!res.ok || res.body?.status !== 'ok') return [item(FAIL, `El servidor de la campaña responde mal (HTTP ${res.status})`, asleep)];
  if (!res.body.autopilot) return [item(FAIL, 'Esa dirección responde, pero no es el servidor de la campaña', 'En Render, el comando de arranque es npm run start:campaign.')];
  return [item(OK, 'El servidor de la campaña está en marcha'), ...(res.body.autopilot.notes || []).map(n => item(WARN, `El servidor dice: ${n}`))];
}

// ─── Telegram ───────────────────────────────────────────────────────────────
export async function checkTelegram(env, { fetchImpl = globalThis.fetch } = {}) {
  const token = val(env, 'TELEGRAM_BOT_TOKEN');
  const chatId = val(env, 'TELEGRAM_CHAT_ID');
  if (!token && !chatId) return [item(WARN, 'Sin Telegram: no te llegarán avisos al móvil cuando alguien pida llamada', 'Opcional: crea un bot con @BotFather, pon su token en TELEGRAM_BOT_TOKEN y ejecuta npm run telegram:setup.')];
  if (!token) return [item(FAIL, 'Falta TELEGRAM_BOT_TOKEN', 'Copia el token que te dio @BotFather.')];
  const api = (method) => getJson(`https://api.telegram.org/bot${token}/${method}`, { fetchImpl });
  const me = await api('getMe');
  if (!me.ok) return [item(FAIL, 'El token TELEGRAM_BOT_TOKEN no vale', 'Pide el token otra vez a @BotFather (/mybots → tu bot → API Token).')];
  const bot = `@${me.body?.result?.username}`;
  const setupFix = `Abre ${bot} en Telegram, pulsa Start y ejecuta npm run telegram:setup.`;
  if (!chatId) return [item(WARN, `Bot ${bot} conectado, pero falta TELEGRAM_CHAT_ID: no te llegarán avisos`, setupFix)];
  const chat = await api(`getChat?chat_id=${encodeURIComponent(chatId)}`);
  if (!chat.ok) return [item(FAIL, `El bot ${bot} no puede escribirte en el chat de TELEGRAM_CHAT_ID`, setupFix)];
  return [item(OK, `Bot ${bot} listo para avisarte`)];
}

// ─── Apify ──────────────────────────────────────────────────────────────────
export async function checkApify(env, { fetchImpl = globalThis.fetch } = {}) {
  const token = val(env, 'APIFY_TOKEN');
  if (!token) return [item(WARN, 'Sin Apify: la campaña de Google Maps no puede buscar negocios', 'Solo si vas a usar Maps: Apify → Settings → API & Integrations, y pega el token en APIFY_TOKEN.')];
  const res = await getJson('https://api.apify.com/v2/users/me/limits', { headers: { Authorization: `Bearer ${token}` }, fetchImpl });
  if (!res.ok) return [item(FAIL, `El token APIFY_TOKEN no vale (HTTP ${res.status})`, 'Apify → Settings → API & Integrations: copia el token otra vez.')];
  const used = Number(res.body?.data?.current?.monthlyUsageUsd) || 0;
  const max = Number(res.body?.data?.limits?.maxMonthlyUsageUsd) || 0;
  const renews = String(res.body?.data?.monthlyUsageCycle?.endAt || '').slice(0, 10);
  const usage = `${used.toFixed(2)} $ de ${max} $ este mes (se renueva el ${renews})`;
  const items = [];
  if (max && used >= max) items.push(item(FAIL, `Cupo de Apify agotado: ${usage}`, 'Apify bloquea todo hasta que se renueve; para buscar en Maps cada día hace falta un plan de pago.'));
  else if (max && used >= max * APIFY_WARN_SHARE) items.push(item(WARN, `Cupo de Apify casi agotado: ${usage}`, 'Cuando se acabe, Apify bloquea todo hasta que se renueve.'));
  else items.push(item(OK, `Token válido; usado ${usage}`));
  if (max && max <= APIFY_FREE_USD) items.push(item(WARN, `Plan gratis (${max} $ al mes): la campaña de Maps lo gasta en un par de días`, 'Para usar Maps a diario necesitas un plan de pago de Apify.'));
  return items;
}

// ─── All of them ────────────────────────────────────────────────────────────
export const CHECKS = [
  ['Tus datos', checkYourData],
  ['Supabase (base de datos)', checkSupabase],
  ['Anthropic (Claude escribe las webs)', checkAnthropic],
  ['Vercel (publica las webs)', checkVercel],
  ['Instantly (envía los emails)', checkInstantly],
  ['Servidor de la campaña (Render)', checkRender],
  ['Telegram (avisos al móvil)', checkTelegram],
  ['Apify (campaña de Google Maps)', checkApify],
];

// Any key that slipped into a message (a service echoing it back) is blanked out before it is shown
const redact = (text, env) => SECRET_VARS.map(k => val(env, k)).filter(s => s.length >= 8).reduce((t, s) => t.split(s).join('•••'), text);

// → [{ service, items: [{ status, text, fix }] }] in the order of CHECKS. The services are checked at the same time.
export async function runDoctor(env = process.env, deps = {}) {
  return Promise.all(CHECKS.map(async ([service, check]) => {
    let items;
    try {
      items = await check(env, deps);
    } catch (err) {
      items = [item(FAIL, `No se pudo comprobar: ${why(err)}`, 'Revisa tu conexión y vuelve a ejecutar npm run doctor.')];
    }
    return { service, items: items.map(i => ({ ...i, text: redact(i.text, env), fix: redact(i.fix, env) })) };
  }));
}
