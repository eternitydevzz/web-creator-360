// What the "caja de claves" (routes/setup.js) does behind each button: writing the .env without losing what is already
// there, and creating what the app needs (the Supabase user, the Instantly campaigns).
import { API as INSTANTLY_API } from './instantly.js';
import { emailTemplate } from '../prompts/newBusinessEmails.js';
import { BRAND_TOKEN_RE } from '../lib/brand.js';

// ─── The .env file ──────────────────────────────────────────────────────────
// A value that dotenv would read differently unless it is quoted: a # starts a comment, quotes and spaces at the ends vanish
const needsQuotes = (v) => /[#"'`\n]/.test(v) || v !== v.trim();
export function formatEnvValue(value) {
  const v = String(value ?? '');
  if (!needsQuotes(v)) return v;
  const quote = ["'", '"', '`'].find(q => !v.includes(q));
  if (!quote || v.includes('\n')) throw new Error('Ese valor no se puede guardar en el .env (lleva saltos de línea o los tres tipos de comillas)');
  return `${quote}${v}${quote}`;
}

// The .env text with `updates` applied: each KEY=… line is replaced where it is (comments and order stay), and a key that
// is not there yet goes at the end. Nothing else changes.
export function mergeEnv(text, updates) {
  const lines = String(text ?? '').split(/\r?\n/);
  const pending = new Map(Object.entries(updates));
  const merged = lines.map(line => {
    const key = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (!key || !pending.has(key)) return line;
    const value = pending.get(key);
    pending.delete(key);
    return `${key}=${formatEnvValue(value)}`;
  });
  while (merged.length && merged[merged.length - 1] === '') merged.pop();
  for (const [key, value] of pending) merged.push(`${key}=${formatEnvValue(value)}`);
  return `${merged.join('\n')}\n`;
}

// ─── Supabase ───────────────────────────────────────────────────────────────
// "https://abcd.supabase.co" → "abcd": the project's id, for the link to its SQL editor
export const projectRefOf = (url) => String(url).match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? null;
export const sqlEditorUrl = (url) => (projectRefOf(url) ? `https://supabase.com/dashboard/project/${projectRefOf(url)}/sql/new` : 'https://supabase.com/dashboard');

// The user who owns every lead: the one with this email if it already exists, otherwise a new one (confirmed, no password:
// nobody logs in with it, the dashboard has its own password). → { id, created }
const USERS_PER_PAGE = 1000;
export async function ensureOwnerUser(db, email) {
  const wanted = String(email).trim().toLowerCase();
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
    if (error) throw new Error(`Supabase no deja leer los usuarios: ${error.message}`);
    const found = data.users.find(u => String(u.email).toLowerCase() === wanted);
    if (found) return { id: found.id, created: false };
    if (data.users.length < USERS_PER_PAGE) break;
  }
  const { data, error } = await db.auth.admin.createUser({ email: wanted, email_confirm: true });
  if (error) throw new Error(`Supabase no ha creado el usuario: ${error.message}`);
  return { id: data.user.id, created: true };
}

// ─── Instantly ──────────────────────────────────────────────────────────────
// Instantly keeps an email body as HTML: one <div> per line, <div><br /></div> for an empty one (read from a campaign
// made in its editor). {{variables}} stay as they are.
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const toInstantlyHtml = (text) => String(text).split(/\r?\n/).map(l => (l ? `<div>${escapeHtml(l)}</div>` : '<div><br /></div>')).join('');

export const CAMPAIGN_NAMES = { llc: 'Web Creator 360 · LLC (español)', maps: 'Web Creator 360 · Google Maps (inglés)' };
// Same settings as the campaigns that work in the original: Monday to Friday 9:00–17:00 Eastern time (Instantly has no
// America/New_York in its list; America/Detroit is the same time), stop when they reply, one email, 100 a day, links untouched
const SCHEDULE = { name: 'Lunes a viernes', timing: { from: '09:00', to: '17:00' }, days: { 0: false, 1: true, 2: true, 3: true, 4: true, 5: true, 6: false }, timezone: 'America/Detroit' };
const DAILY_LIMIT = 100;

// What to send to POST /campaigns. Refuses when your details are missing: the text would go out with gaps.
export function campaignPayload({ campaign, mailboxes, env = process.env }) {
  const demos = campaign === 'maps' || String(env.LEAD_DEMOS || '').trim().toLowerCase() === 'true';
  const { subject, body } = emailTemplate({ demos, campaign, env });
  if (BRAND_TOKEN_RE.test(`${subject}\n${body}`)) throw new Error('Faltan tus datos (BRAND_NAME, SENDER_NAME, LEGAL_FOOTER): sin ellos el email saldría con huecos');
  if (!mailboxes.length) throw new Error('No tienes ningún buzón activo en Instantly');
  return {
    name: CAMPAIGN_NAMES[campaign],
    campaign_schedule: { schedules: [SCHEDULE] },
    sequences: [{ steps: [{ type: 'email', delay: 0, variants: [{ subject, body: toInstantlyHtml(body) }] }] }],
    email_list: mailboxes,
    daily_limit: DAILY_LIMIT,
    stop_on_reply: true,
    link_tracking: false,
    open_tracking: true,
    text_only: false,
  };
}

async function instantly(apiKey, path, { method = 'GET', body, fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(`${INSTANTLY_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Instantly respondió ${res.status}: ${data?.message || data?.error || res.statusText}`);
  return data;
}

// The addresses of your active mailboxes (status 1): the new campaigns send from all of them
export async function activeMailboxes(apiKey, { fetchImpl } = {}) {
  const data = await instantly(apiKey, '/accounts?limit=100', { fetchImpl });
  return (data?.items || []).filter(a => a.status === 1).map(a => a.email);
}

// Creates the campaign with its text, mailboxes and schedule, and switches it on. → { id, active, activateError }
// A campaign that cannot be switched on stays as a draft: it is not an error, `npm run doctor` will show it.
export async function createCampaign(apiKey, { campaign, env = process.env, fetchImpl } = {}) {
  const mailboxes = await activeMailboxes(apiKey, { fetchImpl });
  const created = await instantly(apiKey, '/campaigns', { method: 'POST', body: campaignPayload({ campaign, mailboxes, env }), fetchImpl });
  try {
    await instantly(apiKey, `/campaigns/${created.id}/activate`, { method: 'POST', fetchImpl });
    return { id: created.id, active: true };
  } catch (err) {
    return { id: created.id, active: false, activateError: err.message };
  }
}
