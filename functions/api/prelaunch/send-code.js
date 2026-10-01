// POST /api/prelaunch/send-code
// Body: { phone: "5551234567", country: "CA"|"US", idea?: string }
//
// Sends a 6-digit SMS verification code via Twilio and records the hash
// (never the code) in D1. Enforces a 10-request ceiling per phone number
// and a 10-minute code expiry. See functions/_lib/prelaunch.js for the
// shared crypto/db helpers and README notes on why these choices were made.
//
// Twilio credentials (TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID,
// TWILIO_API_KEY_SECRET, TWILIO_FROM_NUMBER) are Cloudflare secrets that
// do not exist yet. When they are missing this returns a clear 503 and
// never pretends a code was sent.

import {
  CODE_TTL_MINUTES,
  MAX_CODE_REQUESTS,
  hashCode,
  jsonResponse,
  minutesFromNow,
  normalizeCountry,
  nowIso,
  randomCode,
  randomSalt,
  recordAdminNotification,
  sendSms,
  toE164,
  twilioConfigured,
} from "../../_lib/prelaunch.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }

  const e164 = toE164(body?.phone);
  if (!e164) {
    return jsonResponse({ error: "Enter a valid 10-digit phone number." }, 400);
  }
  const country = normalizeCountry(body?.country);
  const idea = typeof body?.idea === "string" ? body.idea.trim().slice(0, 500) : "";

  // Fail loudly and early if SMS sending is not configured. Never fall
  // through to a fake success path.
  if (!twilioConfigured(env)) {
    return jsonResponse(
      { error: "SMS sending is not set up yet. Please try again later." },
      503
    );
  }

  try {
    const existing = await env.DB.prepare(
      "SELECT count FROM prelaunch_signups WHERE phone_e164 = ?1"
    )
      .bind(e164)
      .first();

    if (existing && existing.count >= MAX_CODE_REQUESTS) {
      return jsonResponse(
        {
          error:
            "This number has reached the limit of 10 code requests. Email hello@slypway.com for help.",
        },
        429
      );
    }

    const code = randomCode();
    const salt = randomSalt();
    const codeHash = await hashCode(code, salt);
    const expiresAt = minutesFromNow(CODE_TTL_MINUTES);
    const timestamp = nowIso();

    // Record the attempt (and consume one of the 10 requests) before the
    // network call, so a crash mid-send can never leave an unlimited
    // retry loop open for a single number.
    await env.DB.prepare(
      `INSERT INTO prelaunch_signups
        (phone_e164, country, idea, code_hash, code_salt, code_expires_at, code_sent_at, count, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 1, ?7, ?7)
       ON CONFLICT(phone_e164) DO UPDATE SET
        country = excluded.country,
        idea = COALESCE(NULLIF(excluded.idea, ''), prelaunch_signups.idea),
        code_hash = excluded.code_hash,
        code_salt = excluded.code_salt,
        code_expires_at = excluded.code_expires_at,
        code_sent_at = NULL,
        count = prelaunch_signups.count + 1,
        updated_at = excluded.updated_at`
    )
      .bind(e164, country, idea, codeHash, salt, expiresAt, timestamp)
      .run();

    try {
      await sendSms(
        env,
        e164,
        `Your Slypway verification code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.`
      );
    } catch (sendError) {
      // Invalidate the code we just stored so a failed send can never be
      // verified later, and tell the caller plainly that it failed.
      await env.DB.prepare(
        "UPDATE prelaunch_signups SET code_hash = NULL, code_salt = NULL, code_expires_at = NULL, updated_at = ?2 WHERE phone_e164 = ?1"
      )
        .bind(e164, nowIso())
        .run();
      return jsonResponse(
        { error: "We could not send the code. Try again shortly." },
        502
      );
    }

    await env.DB.prepare(
      "UPDATE prelaunch_signups SET code_sent_at = ?2 WHERE phone_e164 = ?1"
    )
      .bind(e164, nowIso())
      .run();

    await recordAdminNotification(env.DB, "code_sent", e164, { idea });

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: "Something went wrong. Please try again." }, 500);
  }
}
