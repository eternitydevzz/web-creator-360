// Arreglos pequeños de Vercel: el ejecutable según el sistema y un motivo de error legible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vercelBin } from '../src/services/vercel.js';

test('Vercel: vercel.cmd solo en Windows; en Linux (Render) el script normal', () => {
  assert.match(vercelBin('win32'), /[\\/]vercel\.cmd$/);
  assert.match(vercelBin('linux'), /[\\/]vercel$/);
});

import { vercelFailure } from '../src/services/vercel.js';
test('vercelFailure: motivo legible, sin la clave de Vercel y con la causa real (que va al final del log)', () => {
  const log = 'Vercel CLI 54.21.1\n\nLoading team…\n  No framework detected. Default Project Settings:\n  Build Command: `npm run build`\nError: The project x could not be created because this team has reached the 200 project Hobby limit. (400)\nLearn More: https://vercel.com';
  const err = { message: 'Command failed: "/opt/render/node_modules/.bin/vercel" --token vcp_SECRET123 --scope eq --yes --prod\n' + log };
  const msg = vercelFailure(log, err);
  assert.match(msg, /límite de 200 proyectos/);
  assert.doesNotMatch(msg + vercelFailure(err.message, err), /vcp_SECRET123/);
  assert.match(vercelFailure('Error: Something odd happened (500)', {}), /^Vercel: Something odd happened/);
  assert.match(vercelFailure('Error: The token provided is not valid', {}), /Token de Vercel inválido/);
  assert.match(vercelFailure('', { killed: true }), /más de 2 minutos/);
});
