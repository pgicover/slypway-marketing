CREATE TABLE IF NOT EXISTS signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL
);

-- Pre-launch waitlist: one row per phone number, covering the whole
-- phone -> code -> verify -> onboarding flow in functions/api/prelaunch/*.
-- The code itself is never stored; only a salted SHA-256 hash of it.
CREATE TABLE IF NOT EXISTS prelaunch_signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_e164 TEXT UNIQUE NOT NULL,
  country TEXT NOT NULL,
  idea TEXT,
  code_hash TEXT,
  code_salt TEXT,
  code_expires_at TEXT,
  code_sent_at TEXT,
  count INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  company TEXT,
  role TEXT,
  onboarding_completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Existing databases created before this column existed need:
--   ALTER TABLE prelaunch_signups ADD COLUMN email TEXT;

-- Record of events that should (or did) trigger an email to
-- admin@slypway.com via Resend (see functions/_lib/prelaunch.js). This
-- table is the durable record regardless of whether the email send
-- succeeds; sent_at is set on a confirmed Resend accept, email_error is
-- set when the key is missing or the send fails, so a failure is always
-- visible here instead of silent. Never store the verification code or
-- API key here; phone is truncated to last 4.
--
-- app_sent_at / app_error cover the separate handover of a completed
-- onboarding signup to the Slypway app (POST /api/auth/waitlist/, see
-- functions/api/prelaunch/onboarding.js and sendWaitlistSignup in
-- functions/_lib/prelaunch.js), so the same row shows whether the admin
-- email went out AND whether the person actually landed in the app's
-- database. Never store the shared secret here.
--
-- Existing databases created before these columns existed need (each
-- ALTER is safe to run once; D1/SQLite errors on a duplicate ADD COLUMN
-- rather than corrupting anything, so just run it once per database):
--   ALTER TABLE admin_notifications ADD COLUMN email_error TEXT;
--   ALTER TABLE admin_notifications ADD COLUMN app_sent_at TEXT;
--   ALTER TABLE admin_notifications ADD COLUMN app_error TEXT;
CREATE TABLE IF NOT EXISTS admin_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  phone_last4 TEXT,
  payload TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  email_error TEXT,
  app_sent_at TEXT,
  app_error TEXT
);

-- Contact page (functions/api/contact.js) submissions from existing MGAs
-- and carriers. Each submission also records an admin_notifications row
-- and emails admin@slypway.com via Resend; see functions/_lib/prelaunch.js.
CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  role TEXT,
  message TEXT,
  created_at TEXT NOT NULL
);
