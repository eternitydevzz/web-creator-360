// Lista de supresiones: nunca escribir a estos emails. Por usuario, en minúsculas, y fallando "cerrado" en el flujo en frío.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryDb } from './helpers/memoryDb.mjs';
import { normEmail, getSuppressed, suppress } from '../src/services/suppressions.js';

const A = 'user-a', B = 'user-b';

test('normEmail: minúsculas y sin espacios', () => {
  assert.equal(normEmail('  Juan@Gmail.COM '), 'juan@gmail.com');
  assert.equal(normEmail(null), '');
});

test('suppress guarda el email en minúsculas, y repetirlo no duplica (mantiene una fila)', async () => {
  const db = createMemoryDb();
  await suppress(db, A, 'Juan@Gmail.com', 'unsubscribed');
  await suppress(db, A, 'juan@gmail.com', 'bounced');
  assert.equal(db.rows('email_suppressions').length, 1);
  assert.deepEqual(db.rows('email_suppressions')[0], { id: db.rows('email_suppressions')[0].id, user_id: A, email: 'juan@gmail.com', reason: 'bounced' });
});

test('getSuppressed: encuentra por email sin importar mayúsculas', async () => {
  const db = createMemoryDb({ email_suppressions: [{ user_id: A, email: 'juan@gmail.com', reason: 'unsubscribed' }] });
  assert.equal((await getSuppressed(db, A, ['JUAN@gmail.com'])).get('juan@gmail.com'), 'unsubscribed');
  assert.equal((await getSuppressed(db, A, ['otro@gmail.com'])).size, 0);
  const map = await getSuppressed(db, A, ['juan@gmail.com', 'otro@gmail.com', '', null]);
  assert.deepEqual([...map], [['juan@gmail.com', 'unsubscribed']]);
});

test('es por usuario: la baja de un usuario no bloquea a otro', async () => {
  const db = createMemoryDb({ email_suppressions: [{ user_id: A, email: 'juan@gmail.com', reason: 'unsubscribed' }] });
  assert.equal((await getSuppressed(db, B, ['juan@gmail.com'])).size, 0);
});

test('trocea las consultas largas (más de 150 emails)', async () => {
  const emails = Array.from({ length: 400 }, (_, i) => `e${i}@x.com`);
  const db = createMemoryDb({ email_suppressions: [{ user_id: A, email: 'e399@x.com', reason: 'bounced' }] });
  const map = await getSuppressed(db, A, emails);
  assert.equal(map.get('e399@x.com'), 'bounced');
  assert.equal(db.log.filter(l => l.table === 'email_suppressions').length, 3);
});

test('flujo en frío: si la consulta falla, LANZA (no se envía si no se sabe)', async () => {
  const db = createMemoryDb();
  db.failNext('email_suppressions', 'select', 'tabla inexistente');
  await assert.rejects(() => getSuppressed(db, A, ['a@b.com']), /consultar supresiones: tabla inexistente/);
});

test('failOpen: si falla, avisa y sigue sin filtrar', async () => {
  const db = createMemoryDb();
  db.failNext('email_suppressions', 'select', 'tabla inexistente');
  const warns = [];
  const orig = console.warn; console.warn = (m) => warns.push(m);
  try { assert.equal((await getSuppressed(db, A, ['a@b.com'], { failOpen: true })).size, 0); } finally { console.warn = orig; }
  assert.equal(warns.length, 1);
});

test('suppress propaga los errores de la base de datos', async () => {
  const db = createMemoryDb();
  db.failNext('email_suppressions', 'upsert', 'boom');
  await assert.rejects(() => suppress(db, A, 'a@b.com', 'x'), /guardar supresión: boom/);
});
