// ─── UI helpers ───────────────────────────────────────────────────────────────

function escHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Lucide icon as an SVG string, for markup built in JS ('mail-check' → MailCheck). Empty if the CDN didn't load.
function ic(name, cls = '') {
  const key = name.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
  const node = window.lucide?.icons?.[key];
  if (!node) return '';
  const svg = lucide.createElement(node);
  if (cls) svg.setAttribute('class', `${svg.getAttribute('class') || ''} ${cls}`);
  return svg.outerHTML;
}
function refreshIcons() {
  try { window.lucide?.createIcons(); } catch { /* icons are decoration only */ }
}

// Initials on a colour picked from the name, so the same business always gets the same one
const AVATAR_COLORS = ['bg-brand-50 text-brand-700', 'bg-violet-50 text-violet-700', 'bg-sky-50 text-sky-700', 'bg-emerald-50 text-emerald-700', 'bg-amber-50 text-amber-700', 'bg-rose-50 text-rose-700', 'bg-teal-50 text-teal-700', 'bg-fuchsia-50 text-fuchsia-700'];
function avatar(name) {
  const clean = String(name || '?').replace(/\b(llc|inc|corp|co)\b\.?/gi, '').trim();
  const initials = clean.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  let hash = 0;
  for (const ch of String(name || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `<span class="avatar ${AVATAR_COLORS[hash % AVATAR_COLORS.length]}">${escHtml(initials)}</span>`;
}
// wide: the name has the row to itself on a phone (the leads table), so it can use more room
const nameCell = (name, sub, wide = false) => `
  <div class="flex min-w-0 items-center gap-3">${avatar(name)}
    <div class="min-w-0"><div class="${wide ? 'max-w-[16rem]' : 'max-w-[8.5rem] sm:max-w-[16rem]'} truncate font-semibold text-slate-800">${escHtml(name || '—')}</div>${sub ? `<div class="mt-0.5 ${wide ? 'max-w-[16rem]' : 'max-w-[8.5rem] sm:max-w-[16rem]'} truncate text-xs text-slate-400">${escHtml(sub)}</div>` : ''}</div>
  </div>`;

// Swaps the button for a spinner + label while it works; returns a function that puts it back
function busy(btn, label) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `${ic('loader-circle', 'animate-spin')}<span>${escHtml(label)}</span>`;
  return () => { btn.innerHTML = original; btn.disabled = false; };
}

// ─── Sidebar, drawer and navigation ───────────────────────────────────────────

const navItems = document.querySelectorAll('[data-tab]');

function openDrawer(open) {
  document.body.classList.toggle('sidebar-open', open);
}

function showTab(tab) {
  const btn = document.querySelector(`[data-tab="${tab}"]`);
  if (!btn) return;
  navItems.forEach(b => b.classList.toggle('active', b === btn));
  document.querySelectorAll('main > section[id^="tab-"]').forEach(p => p.classList.add('tab-hidden'));
  const panel = document.getElementById('tab-' + tab);
  panel.classList.remove('tab-hidden', 'fade-in');
  void panel.offsetWidth;   // restart the entrance animation
  panel.classList.add('fade-in');

  // Breadcrumb: the group the item sits under + its label
  let group = btn.previousElementSibling;
  while (group && !group.classList.contains('nav-group')) group = group.previousElementSibling;
  document.getElementById('crumb-section').textContent = group?.textContent || '';
  document.getElementById('crumb-page').textContent = btn.querySelector('span')?.textContent || '';

  openDrawer(false);
  window.scrollTo({ top: 0 });
  try { history.replaceState(null, '', '#' + tab); } catch { /* file:// or sandboxed */ }
  loadSection(tab);
}

navItems.forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-goto]');
  if (link) showTab(link.dataset.goto);
});
document.getElementById('menu-btn').addEventListener('click', () => openDrawer(true));
document.getElementById('sidebar-close').addEventListener('click', () => openDrawer(false));
document.getElementById('sidebar-backdrop').addEventListener('click', () => openDrawer(false));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  openDrawer(false);
});

// ─── Toasts ───────────────────────────────────────────────────────────────────

const TOAST_STYLE = {
  success: { icon: 'circle-check', cls: 'border-emerald-100', tile: 'bg-emerald-50 text-emerald-600' },
  error:   { icon: 'circle-x',     cls: 'border-rose-100',    tile: 'bg-rose-50 text-rose-600' },
  info:    { icon: 'info',         cls: 'border-slate-200',   tile: 'bg-brand-50 text-brand-600' },
};

function toast(msg, type = 'success') {
  const style = TOAST_STYLE[type] || TOAST_STYLE.success;
  const el = document.createElement('div');
  el.className = `toast ${style.cls}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `
    <span class="grid h-8 w-8 shrink-0 place-items-center rounded-xl ${style.tile}">${ic(style.icon, 'h-4 w-4')}</span>
    <p class="flex-1 pt-1.5 font-medium leading-snug text-slate-700">${escHtml(msg)}</p>
    <button class="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Cerrar">${ic('x', 'h-4 w-4')}</button>`;
  const stack = document.getElementById('toast-stack');
  stack.appendChild(el);
  while (stack.children.length > 4) stack.firstElementChild.remove();
  const close = () => { el.classList.add('toast-out'); setTimeout(() => el.remove(), 200); };
  el.querySelector('button').addEventListener('click', close);
  setTimeout(close, type === 'error' ? 6000 : 4000);
}

// ─── Confirm dialog (replaces the browser's confirm()) ────────────────────────

function ask({ title, message, confirm: confirmLabel = 'Confirmar', icon = 'triangle-alert', danger = false }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <div class="modal-box" role="alertdialog" aria-modal="true">
        <div class="flex items-start gap-4">
          <span class="icon-tile ${danger ? 'bg-rose-50 text-rose-600' : 'bg-brand-50 text-brand-600'}">${ic(icon)}</span>
          <div><h2 class="text-base font-semibold text-slate-900">${escHtml(title)}</h2><p class="mt-1.5 text-sm leading-relaxed text-slate-500">${escHtml(message)}</p></div>
        </div>
        <div class="mt-7 flex gap-3">
          <button data-answer="no" class="btn-secondary flex-1">Cancelar</button>
          <button data-answer="yes" class="${danger ? 'btn-danger' : 'btn-primary'} flex-1">${escHtml(confirmLabel)}</button>
        </div>
      </div>`;
    const done = (answer) => {
      document.removeEventListener('keydown', onKey);
      wrap.classList.add('closing');
      setTimeout(() => wrap.remove(), 150);
      resolve(answer);
    };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) return done(false);
      const b = e.target.closest('[data-answer]');
      if (b) done(b.dataset.answer === 'yes');
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-answer="yes"]').focus();
  });
}

// ─── Health ───────────────────────────────────────────────────────────────────
async function checkHealth() {
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  try {
    const r = await fetch('/health');
    const d = await r.json();
    const ok = d.status === 'ok';
    dot.className = `pulse-dot ${ok ? 'online' : 'offline'}`;
    txt.textContent = ok ? 'En línea' : 'Error';
  } catch {
    dot.className = 'pulse-dot offline';
    txt.textContent = 'Sin conexión';
  }
}

function set(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = val ?? '—';
  if (el.classList.contains('nav-count')) el.classList.toggle('opacity-40', !Number(val));
}

// Placeholder rows the first time a tab's tables are shown
function showSkeleton(tab) {
  document.querySelectorAll(`#tab-${tab} tbody`).forEach(tbody => {
    if (tbody.children.length) return;
    const cols = tbody.closest('table').querySelectorAll('thead th');
    tbody.innerHTML = Array.from({ length: 4 }, () => `<tr>${[...cols].map((th, i) =>
      `<td class="${th.className}">${i === 0 ? '<div class="flex items-center gap-3"><div class="skeleton h-9 w-9 rounded-xl"></div><div class="flex-1 space-y-2"><div class="skeleton h-3 w-32"></div><div class="skeleton h-2.5 w-20"></div></div></div>' : '<div class="skeleton h-3 w-16"></div>'}</td>`).join('')}</tr>`).join('');
  });
}

// Every tab is part of the "LLCs nuevas" campaign (leads.js)
function loadSection(tab) {
  showSkeleton(tab);
  return loadLeadsSection(tab);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

// `icon` is a Lucide name ('inbox', 'users'…)
function emptyRow(cols, msg, icon = 'inbox') {
  return `<tr><td colspan="${cols}"><div class="empty-state"><div class="empty-icon">${ic(icon) || ic('inbox')}</div><p class="empty-title">${escHtml(msg)}</p></div></td></tr>`;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
refreshIcons();
checkHealth();
setInterval(checkHealth, 60_000);
// After leads.js has loaded too. Opens the tab in the URL (#leads-send…) so a bookmark or a refresh lands where you were.
document.addEventListener('DOMContentLoaded', () => {
  const start = location.hash.slice(1);
  showTab(start && document.querySelector(`[data-tab="${start}"]`) ? start : 'leads-list');
});
