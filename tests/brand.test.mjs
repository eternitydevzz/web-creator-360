// Los datos del alumno (marca, firma y pie legal) salen de su .env: nada de otra persona va en los emails ni en el consentimiento,
// y un email con un hueco de esos datos (sin pie legal, que exige la ley CAN-SPAM) nunca se envía.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBrand, fillBrand } from '../src/lib/brand.js';
import { emailTemplate } from '../src/prompts/newBusinessEmails.js';
import { consentText } from '../src/services/callRequests.js';
import { checkCampaignCopy } from '../src/services/instantly.js';

const BRAND = { BRAND_NAME: 'Mi Marca', SENDER_NAME: 'Ana', LEGAL_FOOTER: 'Mi Marca LLC · 1 Test St, Miami, FL 33101, USA' };

test('loadBrand: lee los tres datos (sin espacios de más) y dice cuáles faltan', () => {
  assert.deepEqual(loadBrand({ ...BRAND, BRAND_NAME: '  Mi Marca  ' }), { ...BRAND, missing: [] });
  assert.deepEqual(loadBrand({ SENDER_NAME: 'Ana' }).missing, ['BRAND_NAME', 'LEGAL_FOOTER']);
  assert.deepEqual(loadBrand({}).missing, ['BRAND_NAME', 'SENDER_NAME', 'LEGAL_FOOTER']);
});

test('fillBrand: rellena lo que hay y deja a la vista el hueco de lo que falta', () => {
  assert.equal(fillBrand('[[SENDER_NAME]] — [[BRAND_NAME]]\n[[LEGAL_FOOTER]]', BRAND), 'Ana — Mi Marca\nMi Marca LLC · 1 Test St, Miami, FL 33101, USA');
  assert.equal(fillBrand('[[SENDER_NAME]] — [[BRAND_NAME]]', { SENDER_NAME: 'Ana' }), 'Ana — [[BRAND_NAME]]');
  assert.equal(fillBrand('{{empresa}} [[OTRA_COSA]]', BRAND), '{{empresa}} [[OTRA_COSA]]');   // las variables de Instantly no se tocan
});

test('emailTemplate: los tres emails llevan los datos del alumno, y ninguno los de nadie más', () => {
  for (const opts of [{}, { demos: true }, { campaign: 'maps' }]) {
    const { body } = emailTemplate({ ...opts, env: BRAND });
    assert.ok(body.endsWith(BRAND.LEGAL_FOOTER), JSON.stringify(opts));
    assert.ok(body.includes('Ana') && body.includes('Mi Marca'), JSON.stringify(opts));
    assert.ok(!/\[\[/.test(body), JSON.stringify(opts));
    const empty = emailTemplate({ ...opts, env: {} }).body;
    assert.ok(empty.includes('[[SENDER_NAME]]') && empty.endsWith('[[LEGAL_FOOTER]]'), JSON.stringify(opts));
  }
});

test('consentText: nombra la marca del alumno; sin marca sigue siendo una frase correcta', () => {
  assert.equal(consentText({ env: BRAND }), 'Acepto que Mi Marca me llame por teléfono al número indicado para enseñarme la web. Puedo pedir que no me contacten más.');
  assert.equal(consentText({ english: true, env: BRAND }), 'I agree that Mi Marca may call me at the number provided to show me my website. I can ask not to be contacted again.');
  assert.equal(consentText({ env: {} }), 'Acepto que me llamen por teléfono al número indicado para enseñarme la web. Puedo pedir que no me contacten más.');
  assert.equal(consentText({ english: true, env: {} }), 'I agree to be called at the number provided to show me my website. I can ask not to be contacted again.');
});

test('antes de enviar: si el texto pegado en Instantly aún tiene un hueco de los datos del alumno, no se envía', async () => {
  const config = { apiKey: 'k', campaignId: 'c', publicUrl: 'https://campana.example.com' };
  const sample = { name: 'Uno LLC', city: 'Hartford', sector: 'limpieza', source: 'ct_registry', link_token: 'T' };
  const campaignWith = (body) => async () => ({ ok: true, json: async () => ({ sequences: [{ steps: [{ variants: [{ subject: 'Hola {{empresa}}', body }] }] }] }) });

  const filled = await checkCampaignCopy(config, sample, { fetchImpl: campaignWith('Hola {{empresa}}\n\nAna — Mi Marca\n\nMi Marca LLC · 1 Test St') });
  assert.deepEqual(filled, { ok: true, problems: [] });

  const gap = await checkCampaignCopy(config, sample, { fetchImpl: campaignWith('Hola {{empresa}}\n\nAna — Mi Marca\n\n[[LEGAL_FOOTER]]') });
  assert.equal(gap.ok, false);
  assert.match(gap.problems.join(' '), /huecos de tus datos/);
});
