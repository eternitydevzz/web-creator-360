// Connects your Telegram bot: finds your chat id and sends a test message.  Usage: npm run telegram:setup
//   1. Create a bot with @BotFather in Telegram and put its token in .env as TELEGRAM_BOT_TOKEN
//   2. Open the bot in Telegram and press Start (or send it any message)
//   3. Run this: it waits up to 2 minutes for your message, prints the TELEGRAM_CHAT_ID line to add to .env and sends a test message
import 'dotenv/config';
import { sendTelegram, waitForChats } from '../src/services/telegram.js';

const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const WAIT_SECONDS = 120;

try {
  if (!token) throw new Error('Falta TELEGRAM_BOT_TOKEN en tu .env: créalo hablando con @BotFather en Telegram (/newbot).');
  let chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!chatId) {
    const { bot, chats } = await waitForChats(token, {
      seconds: WAIT_SECONDS,
      onReady: (name) => console.log(`Bot conectado: ${name}\nAhora abre ${name} en Telegram y pulsa Start (o escríbele "hola"). Espero hasta ${WAIT_SECONDS} segundos...`),
    });
    if (!chats.length) throw new Error(`No me ha llegado ningún mensaje a ${bot}. Comprueba que abres ESE bot (no BotFather), pulsa Start y vuelve a ejecutar esto.`);
    for (const c of chats) console.log(`  chat ${c.id} — ${c.name}`);
    if (chats.length > 1) throw new Error('Hay varios chats: copia en tu .env la línea TELEGRAM_CHAT_ID=<número> del tuyo y vuelve a ejecutar esto.');
    chatId = chats[0].id;
    console.log(`\nAñade esta línea a tu .env:\nTELEGRAM_CHAT_ID=${chatId}\n`);
  }

  const r = await sendTelegram('✅ Telegram conectado: aquí recibirás los avisos de Web Creator 360.', { env: { ...process.env, TELEGRAM_CHAT_ID: chatId }, dryRun: false });
  if (!r.ok) throw new Error(`No se pudo enviar el mensaje de prueba: ${r.error || 'revisa el token y el chat'}`);
  console.log('Mensaje de prueba enviado: míralo en Telegram.');
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
