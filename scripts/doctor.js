// Checks every service in your .env, reading only, and says what to do about each problem.  Usage: npm run doctor
//   green ✓ fine · yellow ! it works, but look at this · red ✗ the app will not work until you fix it
// Nothing is created, changed or sent. Claude is asked for one word (≈ $0.00003): the only way to see if you have credit.
import 'dotenv/config';
import { existsSync } from 'fs';
import { runDoctor, OK, WARN, FAIL } from '../src/services/doctor.js';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const MARK = { [OK]: paint(32, '✓'), [WARN]: paint(33, '!'), [FAIL]: paint(31, '✗') };

if (!existsSync('.env')) {
  console.error(paint(31, 'No hay archivo .env en esta carpeta.'));
  console.error('Arranca el panel (npm start) y pon tus claves en http://localhost:3001/claves.html.');
  process.exit(1);
}

console.log('Comprobando tus servicios (solo se lee; a Claude se le pide 1 palabra para ver tu saldo)…\n');
const results = await runDoctor();
const count = { [OK]: 0, [WARN]: 0, [FAIL]: 0 };
for (const { service, items } of results) {
  console.log(paint(1, service));
  for (const { status, text, fix } of items) {
    count[status]++;
    console.log(`  ${MARK[status]} ${text}`);
    if (fix && status !== OK) console.log(`      → ${fix}`);
  }
  console.log('');
}

const summary = `${count[OK]} bien · ${count[WARN]} avisos · ${count[FAIL]} por arreglar`;
if (count[FAIL]) console.log(paint(31, `✗ ${summary}. Arregla lo rojo y vuelve a ejecutar npm run doctor.`));
else if (count[WARN]) console.log(paint(33, `! ${summary}. La app funciona; mira los avisos.`));
else console.log(paint(32, `✓ ${summary}. Todo listo.`));
process.exitCode = count[FAIL] ? 1 : 0;
