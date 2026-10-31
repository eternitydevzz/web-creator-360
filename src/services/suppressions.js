// email_suppressions: addresses we must never write to again (unsubscribes, bounces, …), whatever the source of the lead.
// Per user (multi-tenant). Emails are always compared in lowercase.

export const normEmail = (email) => String(email ?? '').trim().toLowerCase();

// Map(email → reason) for the given emails.
// Fails CLOSED (throws): if we can't tell, we don't send. failOpen: warn and go on unfiltered (only where that is harmless).
export async function getSuppressed(db, ownerId, emails, { failOpen = false } = {}) {
  const list = [...new Set(emails.map(normEmail).filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < list.length; i += 150) {
    const { data, error } = await db.from('email_suppressions').select('email, reason').eq('user_id', ownerId).in('email', list.slice(i, i + 150));
    if (error) {
      if (failOpen) { console.warn(`[suppressions] no se pudo consultar (${error.message}); se continúa sin filtrar`); return out; }
      throw new Error(`consultar supresiones: ${error.message}`);
    }
    (data || []).forEach(r => out.set(r.email, r.reason));
  }
  return out;
}

export async function suppress(db, ownerId, email, reason) {
  const { error } = await db.from('email_suppressions').upsert({ user_id: ownerId, email: normEmail(email), reason }, { onConflict: 'user_id,email' });
  if (error) throw new Error(`guardar supresión: ${error.message}`);
}
