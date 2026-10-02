// Shared helpers for the pre-launch waitlist functions
// (functions/api/prelaunch/send-code.js, verify-code.js, onboarding.js).
//
// Anything in a functions/_lib/ directory is excluded from Pages Functions
// routing (the leading underscore), so this file is safe to import from
// the route handlers without creating an extra route.

export const CODE_TTL_MINUTES = 10;
export const MAX_CODE_REQUESTS = 10;

export function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Accepts raw digits (already stripped of formatting by the client) or a
// formatted string; always returns null or a clean NANP E.164 number.
// Country is CA or US, both +1, kept only for display/record-keeping.
export function toE164(rawPhone) {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  if (digits.length !== 10) return null;
  return "+1" + digits;
}

export function normalizeCountry(rawCountry) {
  return rawCountry === "US" ? "US" : "CA";
}

// Simple, deliberately permissive shape check (one @, something on each
// side, a dot in the domain part). Not a full RFC 5322 validator; it only
// needs to catch missing/malformed input before it is stored and emailed.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(rawEmail) {
  return typeof rawEmail === "string" && EMAIL_PATTERN.test(rawEmail.trim());
}

export function nowIso() {
  return new Date().toISOString();
}

export function minutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

export function isExpired(isoString) {
  if (!isoString) return true;
  return new Date(isoString).getTime() <= Date.now();
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomCode() {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  // 0-999999, zero padded to 6 digits. getRandomValues is CSPRNG.
  const code = (array[0] % 1000000).toString().padStart(6, "0");
  return code;
}

export function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function hashCode(code, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + ":" + code);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

// Constant-time-ish comparison of two equal-length hex strings. Both
// inputs are fixed-length SHA-256 hex digests, so this never short
// circuits on a length mismatch between real values, only on the
// (irrelevant) case where one side is malformed.
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function phoneLast4(e164) {
  return e164 ? e164.slice(-4) : "";
}

// Inserts the durable admin_notifications row and returns its id, so the
// caller can later mark it sent or failed once an email attempt (if any)
// resolves. The row is written whether or not an email ever goes out.
export async function recordAdminNotification(db, kind, phoneE164, payload) {
  const result = await db
    .prepare(
      "INSERT INTO admin_notifications (kind, phone_last4, payload, created_at) VALUES (?1, ?2, ?3, ?4)"
    )
    .bind(kind, phoneLast4(phoneE164), JSON.stringify(payload || {}), nowIso())
    .run();
  return result?.meta?.last_row_id ?? null;
}

export async function markNotificationSent(db, id) {
  if (!id) return;
  await db
    .prepare("UPDATE admin_notifications SET sent_at = ?2 WHERE id = ?1")
    .bind(id, nowIso())
    .run();
}

// Records why the email did not go out (missing key, Resend error, etc).
// The reason is a short internal label only, never the API key, the code,
// or the phone number.
export async function markNotificationFailed(db, id, reason) {
  if (!id) return;
  await db
    .prepare("UPDATE admin_notifications SET email_error = ?2 WHERE id = ?1")
    .bind(id, String(reason || "unknown_error").slice(0, 200))
    .run();
}

// Same bookkeeping as markNotificationSent/markNotificationFailed above,
// but for the separate handover of the signup to the Slypway app (see
// sendWaitlistSignup below). Kept as its own pair of columns on the same
// admin_notifications row so one row shows both outcomes: did the admin
// email go out, and did the person actually land in the app's database.
export async function markNotificationAppSent(db, id) {
  if (!id) return;
  await db
    .prepare("UPDATE admin_notifications SET app_sent_at = ?2 WHERE id = ?1")
    .bind(id, nowIso())
    .run();
}

// The reason is a short internal label only (http status, timeout,
// network error) -- never the shared secret, never the response body.
export async function markNotificationAppFailed(db, id, reason) {
  if (!id) return;
  await db
    .prepare("UPDATE admin_notifications SET app_error = ?2 WHERE id = ?1")
    .bind(id, String(reason || "unknown_error").slice(0, 200))
    .run();
}

const ADMIN_NOTIFICATION_EMAIL = "admin@slypway.com";
const NOTIFICATION_FROM_EMAIL = "do-not-reply@slypway.com";

export function resendConfigured(env) {
  return Boolean(env.RESEND_API_KEY);
}

// Sends a plain-text email to admin@slypway.com via the Resend HTTP API.
// Throws on any non-2xx response. Deliberately never logs the request
// body, response body, or the API key; a caller that wants a failure
// visible should record it via markNotificationFailed instead.
export async function sendAdminEmail(env, { subject, text }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: NOTIFICATION_FROM_EMAIL,
      to: ADMIN_NOTIFICATION_EMAIL,
      subject,
      text,
    }),
  });

  if (!response.ok) {
    throw new Error(`resend_http_${response.status}`);
  }
}

export function twilioConfigured(env) {
  return Boolean(
    env.TWILIO_ACCOUNT_SID &&
      env.TWILIO_API_KEY_SID &&
      env.TWILIO_API_KEY_SECRET &&
      env.TWILIO_FROM_NUMBER
  );
}

// Sends the SMS via the Twilio REST API using an API Key (SID + secret),
// scoped to the account SID in the URL. Throws on any non-2xx response;
// never logs the message body (which contains the code) or the response.
export async function sendSms(env, toE164Number, body) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const credentials = btoa(`${env.TWILIO_API_KEY_SID}:${env.TWILIO_API_KEY_SECRET}`);
  const form = new URLSearchParams();
  form.set("To", toE164Number);
  form.set("From", env.TWILIO_FROM_NUMBER);
  form.set("Body", body);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!response.ok) {
    // Deliberately do not read/log the response body: it can echo the
    // message text back, and we never want the code anywhere near a log.
    throw new Error("sms_send_failed");
  }
}

// The Slypway app's API. One constant so the address only ever needs to
// change in one place, instead of being copied into every caller.
const WAITLIST_API_BASE_URL = "https://api.slypway.com";
const WAITLIST_API_TIMEOUT_MS = 8000;

export function waitlistApiConfigured(env) {
  return Boolean(env.WAITLIST_SHARED_SECRET);
}

// Hands a completed waitlist signup to the Slypway app so the person gets
// a User row there (POST /api/auth/waitlist/, see
// apps/customauth/api.py::WaitlistSignupView in the app repo). The call
// is authenticated with a shared secret header, never logged and never
// echoed back. A hard timeout (AbortController) means a slow or hanging
// app can never leave the person staring at a spinner here -- the caller
// always treats this as best-effort and records the outcome rather than
// letting it block or fail the signup. Throws on timeout, network error,
// or a non-2xx response; the caller is expected to catch it and record
// the failure via markNotificationAppFailed.
export async function sendWaitlistSignup(env, { mobile_number, email, first_name, last_name }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WAITLIST_API_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${WAITLIST_API_BASE_URL}/api/auth/waitlist/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Waitlist-Secret": env.WAITLIST_SHARED_SECRET,
      },
      body: JSON.stringify({ mobile_number, email, first_name, last_name }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("app_handover_timeout");
    }
    throw new Error("app_handover_network_error");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`app_handover_http_${response.status}`);
  }
}
