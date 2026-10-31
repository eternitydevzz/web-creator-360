-- ─── Web Creator 360 · the whole database, in one go ─────────────────────────
-- Paste ALL of this in Supabase → SQL Editor → Run. Once is enough; running it again changes nothing.
-- Row Level Security is on in every table: the public (anon) key sees nothing. The app uses the service key, which
-- bypasses RLS, so it keeps working.

-- 1. The demo websites made for the leads (their HTML is kept: if publishing fails, it is published again without paying Claude twice)
CREATE TABLE IF NOT EXISTS generated_sites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT UNIQUE NOT NULL,              -- also the name of its Vercel project
  html_content  TEXT NOT NULL,
  preview_url   TEXT,                              -- its address on Vercel (empty until published)
  status        TEXT NOT NULL DEFAULT 'demo',      -- demo | expired
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. The leads: one row per company, from the Connecticut registry, Google Maps or a CSV
--    Funnel: new → queued (sent to Instantly) → emailed → engaged (opened their demo site or their link) → requested (asked
--    for a call) → called → won | lost. Exits: replied | unsubscribed | bounced | invalid_email | rejected (Instantly didn't take it)
CREATE TABLE IF NOT EXISTS new_business_leads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source            TEXT NOT NULL DEFAULT 'ct_registry',   -- ct_registry | csv_import | gmaps
  external_id       TEXT NOT NULL,                         -- registry account number, Maps place id, or an id from the CSV
  name              TEXT NOT NULL,
  email             TEXT NOT NULL,                         -- always lowercase
  city              TEXT,
  zip               TEXT,
  address           TEXT,
  registered_at     DATE,
  naics_code        TEXT,
  sector            TEXT,                                  -- construccion | limpieza | jardineria | belleza | comida | … | otro
  priority          TEXT,                                  -- A = known sector, B = "otro"
  latino_signal     BOOLEAN NOT NULL DEFAULT FALSE,
  latino_strong     BOOLEAN NOT NULL DEFAULT FALSE,        -- Spanish words in the business name
  minority_owned    BOOLEAN NOT NULL DEFAULT FALSE,
  import_batch      TEXT,                                  -- which CSV import it came from (file name + when)

  status            TEXT NOT NULL DEFAULT 'new',
  instantly_lead_id TEXT,
  pushed_at         TIMESTAMPTZ,
  emailed_at        TIMESTAMPTZ,
  engaged_at        TIMESTAMPTZ,
  replied_at        TIMESTAMPTZ,
  requested_at      TIMESTAMPTZ,

  -- What the lead typed on its page, and its consent to be called (exact wording, moment and IP: the proof)
  phone             TEXT,
  contact_name      TEXT,
  preferred_time    TEXT,
  consent_at        TIMESTAMPTZ,
  consent_text      TEXT,
  consent_ip        TEXT,

  link_token        TEXT NOT NULL UNIQUE,                  -- unguessable token of the lead's own link in the email

  -- Its demo website
  site_id           UUID REFERENCES generated_sites(id) ON DELETE SET NULL,
  demo_url          TEXT,
  demo_status       TEXT,                                  -- generating | ready | failed | expired (empty = not made yet)
  demo_template     TEXT,
  demo_error        TEXT,
  demo_at           TIMESTAMPTZ,

  -- Google Maps leads only
  state             TEXT,
  business_phone    TEXT,
  rating            NUMERIC,
  reviews           INT,
  maps_url          TEXT,
  category          TEXT,

  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_nbl_push       ON new_business_leads (user_id, status, registered_at DESC);
CREATE INDEX IF NOT EXISTS idx_nbl_batch      ON new_business_leads (user_id, source, import_batch);
CREATE INDEX IF NOT EXISTS idx_nbl_email      ON new_business_leads (user_id, email);
CREATE INDEX IF NOT EXISTS idx_nbl_registered ON new_business_leads (user_id, registered_at DESC);
CREATE INDEX IF NOT EXISTS idx_nbl_demo       ON new_business_leads (user_id, status, demo_status);

-- 3. Emails never to write to again (unsubscribes, bounces…), whatever the source
CREATE TABLE IF NOT EXISTS email_suppressions (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,                       -- always lowercase
  reason      TEXT NOT NULL,                       -- unsubscribed | bounced | complaint | manual | …
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, email)
);

-- 4. One row per download (registry or Maps): the next one resumes from the last date read
CREATE TABLE IF NOT EXISTS lead_ingest_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source               TEXT NOT NULL DEFAULT 'ct_registry',
  ran_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  from_date            DATE,
  newest_registration  DATE,
  fetched              INT NOT NULL DEFAULT 0,
  inserted             INT NOT NULL DEFAULT 0,
  ok                   BOOLEAN NOT NULL DEFAULT TRUE,
  stats                JSONB,
  error                TEXT
);
CREATE INDEX IF NOT EXISTS idx_lead_ingest_runs ON lead_ingest_runs (user_id, source, ran_at DESC);

-- 5. The autopilot switch (dashboard → Envío). OFF until you turn it on: nothing runs by itself before you are ready.
CREATE TABLE IF NOT EXISTS campaign_autopilot (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  push_limit  INT NOT NULL DEFAULT 20,             -- leads sent to Instantly per send cycle
  demo_all    BOOLEAN NOT NULL DEFAULT FALSE,      -- "all" mode: make every pending demo and send every ready lead
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Personal data: block the public key in every table
ALTER TABLE generated_sites     ENABLE ROW LEVEL SECURITY;
ALTER TABLE new_business_leads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_suppressions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_ingest_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_autopilot  ENABLE ROW LEVEL SECURITY;
