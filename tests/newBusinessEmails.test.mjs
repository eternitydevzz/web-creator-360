// El único email de la campaña: texto exacto, variables por lead y coherencia con lo que se sube a Instantly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMAIL_SUBJECT, EMAIL_BODY, leadVariables, templateVariables, renderEmail, displayName, sectorLabel } from '../src/prompts/newBusinessEmails.js';
import { fillBrand } from '../src/lib/brand.js';

// Los datos del alumno (BRAND_NAME, SENDER_NAME, LEGAL_FOOTER) salen de su .env: aquí, unos inventados
const BRAND = { BRAND_NAME: 'Mi Marca', SENDER_NAME: 'Ana', LEGAL_FOOTER: 'Mi Marca LLC · 1 Test St, Miami, FL 33101, USA' };
Object.assign(process.env, BRAND);

const URL_ = 'https://campana.example.com/c/TOKEN123';
const lead = (o = {}) => ({ name: 'Limpieza Rivera LLC', city: 'Hartford', sector: 'limpieza', latino_strong: true, ...o });

test('el texto es exactamente el aprobado (versión latina, sector conocido)', () => {
  const e = renderEmail(lead(), URL_);
  assert.equal(e.subject, 'Enhorabuena por Limpieza Rivera LLC 🎉');
  assert.equal(e.body, `Hola:

Vimos que acabas de registrar Limpieza Rivera LLC en Hartford. ¡Enhorabuena por crear tu empresa en Estados Unidos y por aportar a nuestra comunidad latina!

Nos tomamos la libertad de diseñarte una web para Limpieza Rivera LLC, totalmente gratis y sin compromiso. Ya está hecha, pensada para tu negocio de limpieza.

¿Por qué? Porque hoy tus clientes te buscan en Google antes de contratarte. Si apareces en Google Maps y tienes una web profesional, confían en ti y te eligen antes que a la competencia. Y cuando quieras pedir financiamiento, los bancos también se fijan en si tu empresa se ve seria en internet.

Me encantaría enseñártela. Agenda una llamada de 15 minutos aquí y te la muestro en directo: https://campana.example.com/c/TOKEN123

Un abrazo,
Ana — Mi Marca

Mi Marca LLC · 1 Test St, Miami, FL 33101, USA`);
});

test('lleva la firma y el pie legal del alumno (razón social y dirección: obligatorio por ley en un email comercial en EE. UU.)', () => {
  assert.match(EMAIL_BODY, /\[\[SENDER_NAME\]\] — \[\[BRAND_NAME\]\]\n\n\[\[LEGAL_FOOTER\]\]$/);   // el texto guardado no lleva datos de nadie
  for (const demos of [false, true]) assert.ok(renderEmail(lead(), URL_, { demos }).body.endsWith(BRAND.LEGAL_FOOTER));
  assert.ok(renderEmail(lead({ source: 'gmaps' }), URL_, { campaign: 'maps' }).body.endsWith(`Best,\nAna\nMi Marca\n\n\n${BRAND.LEGAL_FOOTER}`));
});

test('versión no latina: sin la frase de la comunidad latina', () => {
  const e = renderEmail(lead({ latino_strong: false }), URL_);
  assert.ok(e.body.includes('¡Enhorabuena por crear tu empresa en Estados Unidos!'));
  assert.ok(!e.body.includes('comunidad latina'));
});

test('sector "otro" o desconocido: dice "tu negocio" sin inventar un sector', () => {
  for (const sector of ['otro', undefined, 'inexistente']) {
    const e = renderEmail(lead({ sector }), URL_);
    assert.ok(e.body.includes('pensada para tu negocio.'), String(sector));
    assert.ok(!/ de otro|de undefined|de null/.test(e.body));
  }
  assert.equal(sectorLabel('construccion'), 'construcción');
  assert.equal(sectorLabel('otro'), null);
});

test('ciudad ausente → "tu zona"; nombre TODO en mayúsculas → título', () => {
  assert.ok(renderEmail(lead({ city: '' }), URL_).body.includes('en tu zona.'));
  assert.equal(renderEmail(lead({ name: 'EL SAMPLE GARAGE LLC' }), URL_).subject, 'Enhorabuena por El Sample Garage LLC 🎉');
  assert.equal(displayName('MARIA DE LA CRUZ CLEANING LLC'), 'Maria de la Cruz Cleaning LLC');
  assert.equal(displayName('G&N transportation llc'), 'G&N transportation llc');   // mezcla de mayúsculas: se respeta
  assert.equal(displayName('  Enzo   Towing  '), 'Enzo Towing');
});

test('las variables del texto y las que se suben a Instantly coinciden: las dos versiones se rellenan con los mismos valores', () => {
  const provided = Object.keys(leadVariables(lead(), URL_)).sort();
  assert.deepEqual(provided, ['calendario', 'ciudad', 'empresa', 'latina', 'nombre', 'sector_de', 'web']);
  assert.deepEqual(templateVariables().sort(), ['calendario', 'ciudad', 'empresa', 'latina', 'sector_de']);
  assert.deepEqual(templateVariables({ demos: true }).sort(), ['ciudad', 'empresa', 'nombre', 'sector_de', 'web']);
  for (const demos of [false, true]) for (const v of templateVariables({ demos })) assert.ok(provided.includes(v), v);
});

test('leadVariables: valores para Instantly', () => {
  assert.deepEqual(leadVariables(lead(), URL_), {
    empresa: 'Limpieza Rivera LLC', ciudad: 'Hartford', latina: ' y por aportar a nuestra comunidad latina', sector_de: ' de limpieza', calendario: URL_, web: '', nombre: 'equipo de Limpieza Rivera LLC',
  });
  assert.equal(leadVariables(lead({ demo_url: 'https://limpieza-rivera-ab12.vercel.app' }), URL_).web, 'https://limpieza-rivera-ab12.vercel.app/?lang=es');
  const v = leadVariables(lead({ latino_strong: false, sector: 'otro', city: null }), URL_);
  assert.deepEqual([v.latina, v.sector_de, v.ciudad], ['', '', 'tu zona']);
  assert.ok(Object.values(v).every(x => typeof x === 'string'), 'Instantly solo admite texto/números/booleanos');
});

test('un solo email: sin seguimientos, sin precio y sin WhatsApp; un único enlace (su página para pedir la llamada)', () => {
  const text = `${EMAIL_SUBJECT}\n${EMAIL_BODY}`;
  assert.ok(!/\$|USD|€|497|precio|whatsapp|wa\.me/i.test(text));
  assert.equal((EMAIL_BODY.match(/\{\{calendario\}\}/g) || []).length, 1);
  assert.equal((renderEmail(lead(), URL_).body.match(/https?:\/\//g) || []).length, 1);
});

test('versión DEMO: un solo enlace, el de su web (en español); saluda por el nombre; sin precio ni WhatsApp', () => {
  const e = renderEmail(lead({ demo_url: 'https://limpieza-rivera-ab12.vercel.app' }), URL_, { demos: true });
  assert.equal(e.subject, 'Enhorabuena por Limpieza Rivera LLC 🎉');
  assert.match(e.body, /^Buenas equipo de Limpieza Rivera LLC!/, 'sin nombre del dueño, saluda al equipo');
  assert.match(renderEmail(lead({ demo_url: 'https://x.vercel.app', contact_name: 'María Pérez' }), URL_, { demos: true }).body, /^Buenas María!/);
  assert.match(e.body, /Vi que acabas de registrar Limpieza Rivera LLC en Hartford./);
  assert.match(e.body, /pensada para tu negocio de limpieza, en inglés y en español. Puedes verla aquí/);
  assert.match(e.body, /clientes de Hartford./);
  assert.deepEqual(e.body.match(/https?:\/\/\S+/g), ['https://limpieza-rivera-ab12.vercel.app/?lang=es']);
  assert.ok(!/\$|USD|€|497|precio|whatsapp|wa\.me/i.test(e.body));
  assert.match(e.body, /La mantengo online 7 días/);
  assert.ok(e.body.endsWith(`Un abrazo,\nAna\nMi Marca\n\n\n${BRAND.LEGAL_FOOTER}`));
  assert.equal(renderEmail(lead(), URL_).body, fillBrand(EMAIL_BODY).replace(/\{\{(\w+)\}\}/g, (_, k) => leadVariables(lead(), URL_)[k]), 'la versión clásica no cambia');
});
