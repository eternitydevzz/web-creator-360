// Your own details, from the .env: they sign every email and fill its legal footer, and they name you in the consent a lead
// gives on its page. Nothing of anyone else ships in the copy.
//   BRAND_NAME    your brand ("Mi Marca")
//   SENDER_NAME   the name that signs the emails ("Ana")
//   LEGAL_FOOTER  your company and postal address: required by law (CAN-SPAM) in every commercial email to the US
export const BRAND_VARS = ['BRAND_NAME', 'SENDER_NAME', 'LEGAL_FOOTER'];

// → { BRAND_NAME, SENDER_NAME, LEGAL_FOOTER, missing: [names of the empty ones] }
export function loadBrand(env = process.env) {
  const values = Object.fromEntries(BRAND_VARS.map(k => [k, String(env[k] || '').trim()]));
  return { ...values, missing: BRAND_VARS.filter(k => !values[k]) };
}

// "Un abrazo,\n[[SENDER_NAME]]" → "Un abrazo,\nJose". A missing value keeps its [[TOKEN]], so the gap shows in the preview and
// the send refuses a campaign whose copy still has one (see checkCampaignCopy).
export const fillBrand = (text, env = process.env) => {
  const brand = loadBrand(env);
  return text.replace(/\[\[(BRAND_NAME|SENDER_NAME|LEGAL_FOOTER)\]\]/g, (token, key) => brand[key] || token);
};

export const BRAND_TOKEN_RE = /\[\[(BRAND_NAME|SENDER_NAME|LEGAL_FOOTER)\]\]/;
