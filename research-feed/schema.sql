-- Research Feed data model. SQLite here (node:sqlite, zero dependencies).
-- Written to port to Postgres: swap TEXT json for JSONB, INTEGER epoch for TIMESTAMPTZ.
-- NOT LEGAL ADVICE. Internal draft for one lawyer review.

-- One row per paper VERSION. License is per version, so the key is (arxiv_id, version).
CREATE TABLE IF NOT EXISTS paper_versions (
  arxiv_id        TEXT NOT NULL,
  version         TEXT NOT NULL,              -- 'v1', 'v2'
  title           TEXT NOT NULL,
  authors_json    TEXT NOT NULL,              -- ["Name", ...]
  institutions_json TEXT NOT NULL,
  submitted_on    TEXT NOT NULL,              -- ISO date of this version
  peer_reviewed   INTEGER NOT NULL DEFAULT 0, -- 0 = preprint
  license_code    TEXT NOT NULL,              -- CC_BY, CC_BY_NC_ND, ARXIV_DEFAULT, UNKNOWN ...
  license_url     TEXT,
  tier            TEXT NOT NULL,              -- FULL_REUSE_WITH_CREDIT | IDEAS_ONLY | BLOCK
  withdrawn       INTEGER NOT NULL DEFAULT 0,
  latest_version  TEXT,                       -- newest version seen on arXiv at last check
  facts_sha256    TEXT,                       -- hash of the facts index used by the checker
  source_sha256   TEXT,                       -- hash of the extracted paper text
  PRIMARY KEY (arxiv_id, version)
);

-- Append-only log. "No story published without a license in the log."
CREATE TABLE IF NOT EXISTS license_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  arxiv_id    TEXT NOT NULL,
  version     TEXT NOT NULL,
  license_code TEXT NOT NULL,
  tier        TEXT NOT NULL,
  decision    TEXT NOT NULL,                  -- ALLOW | BLOCK
  reason      TEXT NOT NULL,
  evidence    TEXT NOT NULL,                  -- the license URL read from the page
  checked_at  TEXT NOT NULL,
  gate_version TEXT NOT NULL
);

-- Source of every figure and photo used in a story.
CREATE TABLE IF NOT EXISTS asset_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id  INTEGER NOT NULL,
  kind      TEXT NOT NULL,                    -- chart | animation | photo | quote
  source    TEXT NOT NULL,                    -- 'rebuilt from Table 13' or photo URL
  author    TEXT,
  license   TEXT,
  url       TEXT,
  logged_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stories (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT NOT NULL UNIQUE,
  arxiv_id       TEXT NOT NULL,
  based_on_version TEXT NOT NULL,
  field          TEXT NOT NULL,
  status         TEXT NOT NULL,               -- draft | checked | approved | published | under_review | pulled
  flags_json     TEXT NOT NULL DEFAULT '[]',  -- based_on_old_version, withdrawn, quality_warning ...
  sponsored      INTEGER NOT NULL DEFAULT 0,  -- phase 3, behind a flag
  ai_assisted    INTEGER NOT NULL DEFAULT 1,
  draft_json     TEXT NOT NULL,
  cut_log_json   TEXT NOT NULL DEFAULT '[]',  -- claims cut for having no source
  checker_json   TEXT,
  score_json     TEXT,
  approved_by    TEXT,
  approved_at    TEXT,
  published_at   TEXT,
  created_at     TEXT NOT NULL,
  FOREIGN KEY (arxiv_id, based_on_version) REFERENCES paper_versions(arxiv_id, version)
);
CREATE INDEX IF NOT EXISTS stories_status ON stories(status, field);

-- Every generated claim maps to a source span.
CREATE TABLE IF NOT EXISTS claims (
  story_id  INTEGER NOT NULL,
  claim_id  TEXT NOT NULL,
  card_id   TEXT NOT NULL,
  kind      TEXT NOT NULL,                    -- quote | computed
  display   TEXT NOT NULL,
  locator   TEXT,                             -- 'Table 13', 'Sec. 3.1'
  row_label TEXT,
  formula   TEXT,
  verified  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (story_id, claim_id)
);

-- Prompts, model versions and outputs. Needed for audits and for the AI label.
CREATE TABLE IF NOT EXISTS llm_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id    INTEGER,
  provider    TEXT NOT NULL,                  -- anthropic | recorded
  model       TEXT NOT NULL,
  prompt_sha  TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  output_sha  TEXT NOT NULL,
  cost_usd    REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- Per-day cap on AI spend and calls (cost spikes).
CREATE TABLE IF NOT EXISTS ai_budget (
  day TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0, usd REAL NOT NULL DEFAULT 0
);

-- Reports from readers, authors, rights holders. Routed to a human.
CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id   INTEGER NOT NULL,
  kind       TEXT NOT NULL,                   -- error | dispute | takedown | dmca | counter_notice
  body       TEXT NOT NULL,
  contact    TEXT,
  created_at TEXT NOT NULL,
  due_at     TEXT NOT NULL,                   -- error: 24h fix, takedown: same day, dispute: 48h
  resolved_at TEXT,
  resolution TEXT
);

-- Readers need no login. Only Pro users exist as rows. Name and email only.
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  age_18_confirmed INTEGER NOT NULL,
  token_hash  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  plan           TEXT NOT NULL,               -- monthly | annual
  price_cents    INTEGER NOT NULL,
  status         TEXT NOT NULL,               -- active | cancelled
  started_at     TEXT NOT NULL,
  renews_at      TEXT NOT NULL,
  cancelled_at   TEXT,
  merchant_ref   TEXT NOT NULL,               -- id at the merchant of record
  renewal_reminder_sent INTEGER NOT NULL DEFAULT 0
);

-- Consent records are kept even after account deletion (legal basis: billing law). Email is hashed then.
CREATE TABLE IF NOT EXISTS consents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_ref     TEXT NOT NULL,
  kind         TEXT NOT NULL,                 -- auto_renewal | age_18 | privacy_notice
  text_shown   TEXT NOT NULL,                 -- exact words the user saw
  price_cents  INTEGER,
  renews_at    TEXT,
  given_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS follows (
  user_id INTEGER NOT NULL, field TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, field)
);

CREATE TABLE IF NOT EXISTS saves (
  user_id INTEGER NOT NULL, slug TEXT NOT NULL, list_name TEXT NOT NULL DEFAULT 'Saved', created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, slug, list_name)
);

-- Alerts: queued on publish, must be sent within 1 hour (assumption).
CREATE TABLE IF NOT EXISTS alerts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL,
  story_id  INTEGER NOT NULL,
  field     TEXT NOT NULL,
  queued_at TEXT NOT NULL,
  due_by    TEXT NOT NULL,
  sent_at   TEXT
);

-- Email outbox stub. Production: a transactional email provider.
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, to_ref TEXT NOT NULL, subject TEXT NOT NULL,
  body TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL,
  action TEXT NOT NULL, subject TEXT NOT NULL, detail TEXT
);
