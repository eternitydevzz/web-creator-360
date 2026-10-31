// Avisos por Telegram: el mensaje correcto, modo prueba, y que un fallo nunca rompa el flujo que avisa.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { sendTelegram, loadTelegramConfig, callRequestMessage, replyMessage, alertCallRequest, alertReply, waitForChats } from '../src/services/telegram.js';

const env = { TELEGRAM_BOT_TOKEN: '123:SECRET-TOKEN', TELEGRAM_CHAT_ID: '555' };
const noSleep = async () => {};
const lead = { name: 'EL SAMPLE GARAGE LLC', email: 'garage.sample.demo@gmail.com', city: 'Hartford', sector: 'auto' };
const contact = { phone: '+18605550100', name: 'Ana <b>', preferred_time: 'Lo antes posible' };

function fakeFetch(...responses) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), method: opts.method });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    return { ok: r.status < 400, status: r.status, statusText: 'x', json: async () => r.json };
  };
  return { fetchImpl, calls };
}

test('loadTelegramConfig: necesita token y chat; con espacios se limpia', () => {
  assert.equal(loadTelegramConfig({}), null);
  assert.equal(loadTelegramConfig({ TELEGRAM_BOT_TOKEN: 'x' }), null);
  assert.equal(loadTelegramConfig({ TELEGRAM_CHAT_ID: '1' }), null);
  assert.deepEqual(loadTelegramConfig({ TELEGRAM_BOT_TOKEN: ' t ', TELEGRAM_CHAT_ID: ' 9 ' }), { token: 't', chatId: '9' });
});

test('mensaje de solicitud de llamada: nombre legible, teléfono copiable, cuándo, y todo escapado', () => {
  const m = callRequestMessage(lead, contact);
  assert.equal(m, [
    '📞 <b>El Sample Garage LLC</b> quiere que la llames',
    'Tel: <code>+18605550100</code>',
    'Cuándo: Lo antes posible',
    'Nombre: Ana &lt;b&gt;',
    'Hartford · auto',
    'garage.sample.demo@gmail.com',
  ].join('\n'));
  assert.ok(!callRequestMessage(lead, { ...contact, name: null }).includes('Nombre:'));
  assert.ok(!callRequestMessage({ ...lead, city: null, sector: null }, contact).includes('·'));
});

test('mensaje de respuesta al email', () => {
  assert.equal(replyMessage(lead), '✉️ <b>El Sample Garage LLC</b> ha respondido a tu email\nHartford · auto\ngarage.sample.demo@gmail.com\nLéelo en Instantly.');
});

test('envía a la API de Telegram con el chat, HTML y sin previsualización de enlaces', async () => {
  const f = fakeFetch({ status: 200, json: { ok: true } });
  const r = await sendTelegram('hola <b>x</b>', { env, dryRun: false, fetchImpl: f.fetchImpl, sleep: noSleep });
  assert.deepEqual(r, { ok: true });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://api.telegram.org/bot123:SECRET-TOKEN/sendMessage');
  assert.equal(f.calls[0].method, 'POST');
  assert.deepEqual(f.calls[0].body, { chat_id: '555', text: 'hola <b>x</b>', parse_mode: 'HTML', disable_web_page_preview: true });
});

test('alertCallRequest y alertReply envían el mensaje correspondiente', async () => {
  const f = fakeFetch({ status: 200, json: { ok: true } });
  await alertCallRequest(lead, contact, { env, dryRun: false, fetchImpl: f.fetchImpl, sleep: noSleep });
  await alertReply(lead, { env, dryRun: false, fetchImpl: f.fetchImpl, sleep: noSleep });
  assert.match(f.calls[0].body.text, /quiere que la llames/);
  assert.match(f.calls[1].body.text, /ha respondido/);
});

test('con OUTREACH_DRY_RUN=true el aviso SÍ llega: el modo prueba frena Instantly, no tu móvil', async () => {
  const f = fakeFetch({ status: 200, json: { ok: true } });
  const before = process.env.OUTREACH_DRY_RUN;
  process.env.OUTREACH_DRY_RUN = 'true';
  try {
    assert.deepEqual(await sendTelegram('aviso', { env, fetchImpl: f.fetchImpl, sleep: noSleep }), { ok: true });
    await alertCallRequest(lead, contact, { env, fetchImpl: f.fetchImpl, sleep: noSleep });
    assert.equal(f.calls.length, 2);
  } finally { if (before === undefined) delete process.env.OUTREACH_DRY_RUN; else process.env.OUTREACH_DRY_RUN = before; }
});

test('dryRun explícito: lo escribe en el registro y NO llama a Telegram', async () => {
  const f = fakeFetch({ status: 200, json: {} });
  const log = mock.method(console, 'log', () => {});
  try {
    const r = await sendTelegram('aviso', { env, dryRun: true, fetchImpl: f.fetchImpl });
    assert.deepEqual(r, { ok: true, dryRun: true });
    assert.equal(f.calls.length, 0);
    assert.match(log.mock.calls[0].arguments[0], /^\[dry-run\] telegram .*aviso/);
  } finally { log.mock.restore(); }
});

test('sin configurar: avisa en el registro, no lanza error y no llama a Telegram', async () => {
  const f = fakeFetch({ status: 200, json: {} });
  const warn = mock.method(console, 'warn', () => {});
  try {
    const r = await sendTelegram('aviso', { env: {}, dryRun: false, fetchImpl: f.fetchImpl });
    assert.deepEqual(r, { ok: false, skipped: true });
    assert.equal(f.calls.length, 0);
    assert.equal(warn.mock.callCount(), 1);
  } finally { warn.mock.restore(); }
});

test('token incorrecto (401): no lanza error, devuelve el motivo y NO deja el token en el registro', async () => {
  const f = fakeFetch({ status: 401, json: { ok: false, error_code: 401, description: 'Unauthorized' } });
  const err = mock.method(console, 'error', () => {});
  try {
    const r = await sendTelegram('aviso', { env, dryRun: false, fetchImpl: f.fetchImpl, sleep: noSleep });
    assert.equal(r.ok, false);
    assert.match(r.error, /Telegram respondió 401: Unauthorized.*TELEGRAM_BOT_TOKEN/);
    assert.ok(!JSON.stringify([r, err.mock.calls.map(c => c.arguments)]).includes('SECRET-TOKEN'));
  } finally { err.mock.restore(); }
});

test('reintenta ante 429 y 5xx, y si Telegram cae del todo devuelve ok:false sin lanzar', async () => {
  const flaky = fakeFetch({ status: 429, json: {} }, { status: 200, json: { ok: true } });
  assert.deepEqual(await sendTelegram('a', { env, dryRun: false, fetchImpl: flaky.fetchImpl, sleep: noSleep }), { ok: true });
  assert.equal(flaky.calls.length, 2);

  const err = mock.method(console, 'error', () => {});
  try {
    const down = fakeFetch(new Error('ECONNRESET'));
    const r = await sendTelegram('a', { env, dryRun: false, fetchImpl: down.fetchImpl, sleep: noSleep });
    assert.equal(r.ok, false);
    assert.match(r.error, /No se pudo conectar con Telegram: ECONNRESET/);
    assert.equal(down.calls.length, 3);
  } finally { err.mock.restore(); }
});

// Buscar tu chat (npm run telegram:setup y la caja de claves): espera tu primer mensaje al bot
function fakeUpdates(...batches) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/getMe')) return { ok: true, status: 200, json: async () => ({ ok: true, result: { username: 'mi_bot' } }) };
    const result = batches.shift() ?? [];
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
  };
  return { fetchImpl, calls };
}

test('waitForChats: avisa cuando el bot está listo y devuelve tu chat en cuanto escribes', async () => {
  const { fetchImpl } = fakeUpdates([], [{ message: { chat: { id: 555, first_name: 'Ana', last_name: 'Ruiz', username: 'ana' } } }]);
  let ready = null;
  const r = await waitForChats('123:X', { fetchImpl, sleep: noSleep, onReady: (bot) => { ready = bot; } });
  assert.equal(ready, '@mi_bot');
  assert.deepEqual(r, { bot: '@mi_bot', chats: [{ id: '555', name: 'Ana Ruiz (@ana)' }] });
});

test('waitForChats: si nadie escribe a tiempo, vuelve sin chats (no se queda esperando para siempre)', async () => {
  let t = 0;
  const { fetchImpl } = fakeUpdates();
  const r = await waitForChats('123:X', { seconds: 3, fetchImpl, sleep: noSleep, now: () => (t += 1000) });
  assert.deepEqual(r.chats, []);
});

test('waitForChats: un token malo da un error claro y sin el token dentro', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, statusText: 'x', json: async () => ({ description: 'Unauthorized' }) });
  await assert.rejects(waitForChats('123:SECRET-TOKEN', { fetchImpl, sleep: noSleep }), (err) => /Telegram respondió 401/.test(err.message) && !err.message.includes('SECRET-TOKEN'));
});
