// Sends the newest leads that are still "new" to the Instantly campaign (Instantly then emails them on its own schedule).
//
//   npm run leads:push                 pushes up to 100 leads (with OUTREACH_DRY_RUN=true nothing is sent: it is only logged)
//   npm run leads:push -- --limit 300
import 'dotenv/config';
import supabase from '../src/db/supabase.js';
import { isDryRun } from '../src/lib/dryRun.js';
import { loadInstantlyConfig, pushLeads, whyNothingToPush } from '../src/services/instantly.js';

// What holds back a lead that was never sent, in plain words (statuses: see src/db/schema.sql)
const HELD_BACK = {
  engaged: 'abrieron su web o su enlace antes de enviarse (pasa si los abres tú): solo se envían los que están en «new»',
  requested: 'ya pidieron la llamada sin haberse enviado',
  rejected: 'Instantly no los aceptó (ya estaban en tu workspace, en la lista de bloqueo o el email no es válido)',
  invalid_email: 'tienen un email que no es válido',
};

async function explainNothingToPush(ownerId, config) {
  const why = await whyNothingToPush({ db: supabase, ownerId, config });
  const lines = [];
  if (why.waitingDemo) lines.push(`${why.waitingDemo} leads nuevos esperan su web de demo: créalas con «npm run leads:demo -- --limit ${why.waitingDemo}» (o deja que lo haga el autopilot).`);
  if (why.failedDemo) lines.push(`${why.failedDemo} leads nuevos tienen la web de demo fallida: rehazla con «npm run leads:demo -- <su email>».`);
  for (const [status, n] of Object.entries(why.byStatus)) lines.push(`${n} leads ${HELD_BACK[status] || `están en «${status}» y nunca se enviaron`}.`);
  console.log('No hay leads listos para enviar a esta campaña.');
  console.log(lines.length ? lines.map(l => `  · ${l}`).join('\n') : '  · No queda ningún lead sin enviar: importa más desde el panel (Fuentes).');
}

const args = process.argv.slice(2);
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 100;

async function main() {
  const ownerId = (process.env.NEW_LEADS_OWNER_USER_ID || '').trim();
  if (!ownerId) throw new Error('Falta NEW_LEADS_OWNER_USER_ID en tu .env');
  const dryRun = isDryRun();
  const config = loadInstantlyConfig(process.env, { dryRun });

  console.log(dryRun ? '🧪 DRY-RUN: no se envía nada a Instantly ni se cambia ningún estado.' : '📨 Enviando leads a Instantly…');
  if (dryRun) for (const w of config.warnings) console.log(`ℹ Para enviar de verdad falta: ${w}`);

  // Sending for real: first check that the campaign's text in Instantly matches what we send (no gaps, no unknown {{variables}})
  const r = await pushLeads({ db: supabase, ownerId, config, limit, dryRun, verifyCopy: !dryRun });
  if (!r.pushed && !r.rejected) return explainNothingToPush(ownerId, config);
  console.log(dryRun
    ? `\nSe enviarían ${r.pushed} leads.`
    : `\n✓ ${r.pushed} leads en cola en Instantly${r.rejected ? ` · ${r.rejected} rechazados por Instantly (ya estaban en tu workspace, lista de bloqueo o email inválido)` : ''}.`);
}

// Sin process.exit(): en Windows cerrar de golpe con conexiones abiertas hace fallar a Node al salir
main().catch((err) => { console.error(`\n✗ ${err.message}`); process.exitCode = 1; });
