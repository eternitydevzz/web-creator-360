import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { createLeadsRouter } from './routes/leads.js';
import { createSetupRouter } from './routes/setup.js';
import { alertReply } from './services/telegram.js';
import { dashboardAuth } from './middleware/dashboardAuth.js';
import supabase from './db/supabase.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// This app has no per-route login: everything (dashboard, imports, sending real leads) is open to whoever can reach it.
// Set DASHBOARD_USER + DASHBOARD_PASSWORD (whenever it is reachable from the internet) to lock it behind one shared login.
app.use(dashboardAuth);

// A CSV travels inside the JSON body: give the import routes room before the default 100 kb parser sees them
app.use('/api/leads/import', express.json({ limit: '10mb' }));
app.use(express.json());

app.use(express.static(join(__dirname, '../public')));

// The "caja de claves" (claves.html): where you paste your keys during the install. Only answers from this same computer.
app.use('/api/setup', createSetupRouter({ envFile: join(__dirname, '../.env'), exampleFile: join(__dirname, '../.env.example'), schemaFile: join(__dirname, 'db/schema.sql') }));

app.use('/api/leads', createLeadsRouter({ db: supabase, ownerId: (process.env.NEW_LEADS_OWNER_USER_ID || '').trim(), onReply: (lead) => alertReply(lead) }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Web Creator 360 running at http://localhost:${PORT}`);
});
