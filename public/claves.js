// Caja de claves: one card per service, in the order Claude guides the install. Talks only to /api/setup (routes/setup.js).
// A saved secret is never shown again: the server only says whether it is there.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MARK = { ok: ['✓', 'text-emerald-600'], warn: ['!', 'text-amber-600'], fail: ['✗', 'text-rose-600'] };

// fields: [key, label, secret?]  ·  actions: extra buttons after the keys are saved
const SECTIONS = [
  { id: 'brand', title: 'Tus datos', help: 'Firman cada email. El pie legal (tu empresa y tu dirección postal) lo exige la ley de EE. UU. en cada email.',
    fields: [['BRAND_NAME', 'Nombre de tu marca o empresa'], ['SENDER_NAME', 'Tu nombre (firma los emails)'], ['LEGAL_FOOTER', 'Pie legal (ejemplo: Mi Empresa LLC · 123 Main St, Miami, FL 33101, USA)']] },
  { id: 'supabase', title: 'Supabase · la base de datos', help: 'Project Settings → API Keys: la URL del proyecto y la clave secreta "service_role".',
    fields: [['SUPABASE_URL', 'URL del proyecto (https://….supabase.co)'], ['SUPABASE_SERVICE_KEY', 'Clave "service_role"', true]],
    actions: ['tables', 'owner'] },
  { id: 'anthropic', title: 'Anthropic · Claude escribe cada web', help: 'console.anthropic.com → API Keys. Necesita saldo (Billing): cada web cuesta ≈ 0,02–0,14 $.',
    fields: [['ANTHROPIC_API_KEY', 'Clave (sk-ant-…)', true]] },
  { id: 'vercel', title: 'Vercel · publica cada web', help: 'vercel.com → Account Settings → Tokens. El equipo donde se publican se pone solo.',
    fields: [['VERCEL_TOKEN', 'Token', true]] },
  { id: 'instantly', title: 'Instantly · envía los emails', help: 'Settings → Integrations → API Keys: una clave API v2 con permiso para leads y campañas.',
    fields: [['INSTANTLY_API_KEY', 'Clave', true]], actions: ['campaigns'] },
  { id: 'telegram', title: 'Telegram · avisos al móvil (opcional)', help: 'Desde el móvil: habla con @BotFather → /newbot → te da un token.',
    fields: [['TELEGRAM_BOT_TOKEN', 'Token del bot', true]], actions: ['telegram'] },
  { id: 'apify', title: 'Apify · campaña de Google Maps (opcional)', help: 'Settings → API & Integrations. El plan gratis (5 $/mes) se gasta en un par de días con Maps.',
    fields: [['APIFY_TOKEN', 'Token', true]] },
  { id: 'render', title: 'Render · tu servidor de la campaña', help: 'Account Settings → API Keys. Lo creo en el plan Starter (de pago: pide tarjeta en Render → Billing), que no se duerme. Hazlo al final: lleva todas tus claves.',
    fields: [['RENDER_API_KEY', 'Clave de la API de Render', true]], actions: ['render'] },
];

let status = { set: {}, values: {} };

async function api(path, body) {
  const res = await fetch(`/api/setup${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

const itemsHtml = (items) => items.map(i => `<li class="flex gap-2"><span class="font-bold ${MARK[i.status][1]}">${MARK[i.status][0]}</span><span>${esc(i.text)}${i.fix && i.status !== 'ok' ? `<span class="block text-slate-500">→ ${esc(i.fix)}</span>` : ''}</span></li>`).join('');
function show(id, items) { document.getElementById(`out-${id}`).innerHTML = itemsHtml(items); }
function showError(id, err) { show(id, [{ status: 'fail', text: err.message }]); }

function fieldHtml([key, label, secret]) {
  const saved = status.set[key];
  const value = secret ? '' : status.values[key] || '';
  const placeholder = secret && saved ? '•••••••• guardada (pega otra para cambiarla)' : '';
  return `<label class="block text-[13px] font-semibold text-slate-600">${esc(label)}${saved ? ' <span class="text-emerald-600">✓ guardada</span>' : ''}
    <input data-key="${key}" type="${secret ? 'password' : 'text'}" autocomplete="off" spellcheck="false" value="${esc(value)}" placeholder="${esc(placeholder)}"
      class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[14px] font-normal outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" /></label>`;
}

const ACTIONS = {
  tables: () => `<div class="rounded-lg bg-slate-50 p-3 text-[13px]"><b>Tablas.</b> Claude las crea pegando el SQL en tu Supabase. Si lo haces tú:
    <button data-act="copySql" class="btn-light">Copiar el SQL</button> <a id="sql-link" target="_blank" rel="noopener" class="text-brand-600 underline">abrir el SQL Editor</a>, pega, pulsa Run y luego
    <button data-act="tables" class="btn-light">Comprobar tablas</button></div>`,
  owner: () => `<div class="flex flex-wrap items-end gap-2 text-[13px]"><label class="grow font-semibold text-slate-600">Tu email (tus leads se guardan a su nombre)
    <input id="owner-email" type="email" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
    <button data-act="owner" class="btn">${status.values.NEW_LEADS_OWNER_USER_ID ? 'Usuario listo ✓ · cambiar' : 'Crear mi usuario'}</button></div>`,
  campaigns: () => `<div class="flex flex-wrap items-center gap-3 text-[13px]"><button data-act="campaigns" class="btn">Crear mis campañas</button>
    <label><input id="with-maps" type="checkbox" /> también la de Google Maps (necesita Apify)</label>
    <span class="text-slate-500">${status.values.INSTANTLY_CAMPAIGN_ID ? 'LLC ✓' : ''} ${status.values.INSTANTLY_CAMPAIGN_ID_MAPS ? '· Maps ✓' : ''}</span></div>`,
  telegram: () => `<div class="text-[13px]">Abre tu bot en Telegram, pulsa <b>Start</b> y escríbele "hola". Luego:
    <button data-act="telegram" class="btn">Ya le he escrito</button> ${status.values.TELEGRAM_CHAT_ID ? '<span class="text-emerald-600">✓ conectado</span>' : ''}</div>`,
  render: () => `<div class="text-[13px]"><button data-act="render" class="btn">${status.values.RENDER_SERVICE_ID ? 'Mandar mis claves de nuevo al servidor' : 'Crear mi servidor'}</button>
    ${status.values.CAMPAIGN_PUBLIC_URL ? `<span class="ml-2 text-slate-500">${esc(status.values.CAMPAIGN_PUBLIC_URL)}</span>` : ''}</div>`,
};

function sectionHtml(s, n) {
  return `<section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-section="${s.id}">
    <h2 class="text-lg font-bold"><span class="mr-2 text-brand-600">${n}.</span>${esc(s.title)}</h2>
    <p class="mt-1 text-[13px] text-slate-500">${esc(s.help)}</p>
    <div class="mt-4 space-y-3">${s.fields.map(fieldHtml).join('')}</div>
    <button data-act="save" class="btn mt-4">Comprobar y guardar</button>
    <ul id="out-${s.id}" class="mt-3 space-y-1 text-[13px]"></ul>
    ${(s.actions || []).map(a => `<div class="mt-4 border-t border-slate-100 pt-4">${ACTIONS[a]()}</div>`).join('')}
  </section>`;
}

const finalHtml = () => `<section class="rounded-2xl border border-brand-100 bg-brand-50 p-5">
  <h2 class="text-lg font-bold">Comprobación final</h2>
  <p class="mt-1 text-[13px] text-slate-600">Prueba todos los servicios a la vez (lo mismo que <code>npm run doctor</code>).</p>
  <button data-act="doctor" class="btn mt-3">Comprobar todo</button><div id="out-doctor" class="mt-3 space-y-3 text-[13px]"></div></section>`;

async function render() {
  status = await api('/status');
  document.getElementById('sections').innerHTML = SECTIONS.map((s, i) => sectionHtml(s, i + 1)).join('') + finalHtml();
  const tables = await api('/tables').catch(() => null);
  if (tables) document.getElementById('sql-link').href = tables.sqlEditor;
}

async function act(button) {
  const section = button.closest('[data-section]')?.dataset.section;
  const act = button.dataset.act;
  button.disabled = true;
  const label = button.textContent;
  button.textContent = act === 'telegram' ? 'Esperando tu mensaje (hasta 1 minuto)…' : act === 'render' ? 'Creando (puede tardar)…' : 'Comprobando…';
  try {
    if (act === 'save') {
      const values = Object.fromEntries([...document.querySelectorAll(`[data-section="${section}"] input[data-key]`)].map(i => [i.dataset.key, i.value]).filter(([, v]) => v.trim()));
      const r = await api('/save', { section, values });
      if (r.saved) await render();
      show(section, r.items);
    } else if (act === 'tables') {
      const t = await api('/tables');
      show(section, [t.ready ? { status: 'ok', text: 'Las 5 tablas están listas' } : { status: 'fail', text: t.fatal || `Faltan tablas: ${[...t.missing, ...t.problems].join(', ')}`, fix: 'Pega el SQL en el SQL Editor y pulsa Run.' }]);
    } else if (act === 'copySql') {
      await navigator.clipboard.writeText(await (await fetch('/api/setup/schema')).text());
      show(section, [{ status: 'ok', text: 'SQL copiado: pégalo en el SQL Editor y pulsa Run' }]);
    } else if (act === 'owner') {
      show(section, (await api('/owner', { email: document.getElementById('owner-email').value })).items);
      await render();
    } else if (act === 'campaigns') {
      const r = await api('/campaigns', { maps: document.getElementById('with-maps').checked });
      await render();
      show(section, r.items);
    } else if (['telegram', 'render'].includes(act)) {
      const r = await api(act === 'telegram' ? '/telegram/wait' : '/render', {});
      await render();
      show(section, r.items);
    } else if (act === 'doctor') {
      const { results } = await api('/doctor');
      document.getElementById('out-doctor').innerHTML = results.map(r => `<div><b>${esc(r.service)}</b><ul class="mt-1 space-y-1">${itemsHtml(r.items)}</ul></div>`).join('');
    }
  } catch (err) {
    showError(section || 'doctor', err);
  } finally {
    if (document.body.contains(button)) { button.disabled = false; button.textContent = label; }
  }
}

document.addEventListener('click', (e) => { const b = e.target.closest('button[data-act]'); if (b) act(b); });
const style = document.createElement('style');
style.textContent = '.btn{border-radius:.6rem;background:#4F46E5;color:#fff;font-weight:600;font-size:13px;padding:.5rem .9rem}.btn:disabled{opacity:.6}.btn-light{border-radius:.5rem;border:1px solid #CBD5E1;background:#fff;font-weight:600;padding:.15rem .5rem}';
document.head.appendChild(style);
render().catch(err => { document.getElementById('sections').innerHTML = `<p class="text-rose-600">${esc(err.message)}</p>`; });
