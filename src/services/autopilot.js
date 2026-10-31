// On/off switch (and batch size) for the campaign server's unattended cycle: daily ingest from the CT registry + sending
// new leads to Instantly every 3 hours. One row per user; read fresh on every cron tick (see campaign-server.js), so
// toggling from the dashboard takes effect within one cycle — no redeploy.
//   demoAll: "all" mode — make the demo site of EVERY pending lead and send EVERY lead that is ready, instead of a
//            small batch (3 sites per cycle, up to pushLimit sent per send). Only matters with LEAD_DEMOS=true.
const TABLE = 'campaign_autopilot';
// OFF until you turn it on in the dashboard (Envío → Autopilot): a new install never fetches, builds or sends by itself before
// you have tried it with your own email
const DEFAULTS = { enabled: false, pushLimit: 20, demoAll: false };
// The most one send can carry in "all" mode (Instantly itself paces the actual sending with the campaign's daily limit)
export const ALL_MODE_SEND_LIMIT = 1000;

// In a database made before the demo_all column existed, everything works as before, with it off
const missingColumn = (err) => /column|schema cache/i.test(String(err?.message || err));

export async function getAutopilotSettings(db, ownerId) {
  let { data, error } = await db.from(TABLE).select('enabled, push_limit, demo_all').eq('user_id', ownerId).maybeSingle();
  if (error && missingColumn(error)) ({ data, error } = await db.from(TABLE).select('enabled, push_limit').eq('user_id', ownerId).maybeSingle());
  if (error) throw new Error(error.message);
  return data ? { enabled: data.enabled, pushLimit: data.push_limit, demoAll: data.demo_all === true } : { ...DEFAULTS };
}

// patch: { enabled?, pushLimit?, demoAll? } — only the given fields change; the others keep their current (or default) value.
// Always writes every column (never relies on the database's own column default, so behaviour doesn't depend on which
// database is behind `db`), so this is also the source of truth for what the row ends up as — no need to read it back.
export async function setAutopilotSettings(db, ownerId, patch) {
  const current = await getAutopilotSettings(db, ownerId);
  const next = {
    enabled: patch.enabled ?? current.enabled,
    pushLimit: patch.pushLimit ?? current.pushLimit,
    demoAll: patch.demoAll ?? current.demoAll,
  };
  const row = { user_id: ownerId, enabled: next.enabled, push_limit: next.pushLimit, updated_at: new Date().toISOString() };
  let { error } = await db.from(TABLE).upsert({ ...row, demo_all: next.demoAll }, { onConflict: 'user_id' });
  if (error && missingColumn(error)) {
    // Running src/db/schema.sql again would not add it: CREATE TABLE IF NOT EXISTS leaves an existing table as it is
    if (patch.demoAll !== undefined) throw new Error('Falta la columna demo_all (tu base de datos es de una versión anterior). Añádela en Supabase → SQL Editor con: ALTER TABLE campaign_autopilot ADD COLUMN IF NOT EXISTS demo_all BOOLEAN NOT NULL DEFAULT FALSE;');
    ({ error } = await db.from(TABLE).upsert(row, { onConflict: 'user_id' }));
  }
  if (error) throw new Error(error.message);
  return next;
}
