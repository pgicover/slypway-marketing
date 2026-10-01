// POST /api/prelaunch/verify-code
// Body: { phone: "5551234567", country: "CA"|"US", code: "123456" }
//
// Verifies the 6-digit code against the stored salted hash in constant
// time and marks the phone as verified. Always returns the same generic
// error for an unknown phone, an expired code, or a wrong code, so the
// response never reveals whether a number is already known.

import {
  hashCode,
  isExpired,
  jsonResponse,
  nowIso,
  timingSafeEqual,
  toE164,
} from "../../_lib/prelaunch.js";

const GENERIC_ERROR = "That code is incorrect or has expired.";

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }

  const e164 = toE164(body?.phone);
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (!e164 || !/^\d{6}$/.test(code)) {
    return jsonResponse({ error: GENERIC_ERROR }, 400);
  }

  try {
    const row = await env.DB.prepare(
      "SELECT code_hash, code_salt, code_expires_at FROM prelaunch_signups WHERE phone_e164 = ?1"
    )
      .bind(e164)
      .first();

    if (!row || !row.code_hash || !row.code_salt || isExpired(row.code_expires_at)) {
      return jsonResponse({ error: GENERIC_ERROR }, 400);
    }

    const candidateHash = await hashCode(code, row.code_salt);
    const matches = timingSafeEqual(candidateHash, row.code_hash);

    if (!matches) {
      return jsonResponse({ error: GENERIC_ERROR }, 400);
    }

    await env.DB.prepare(
      `UPDATE prelaunch_signups
       SET verified_at = ?2, code_hash = NULL, code_salt = NULL, code_expires_at = NULL, updated_at = ?2
       WHERE phone_e164 = ?1`
    )
      .bind(e164, nowIso())
      .run();

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: "Something went wrong. Please try again." }, 500);
  }
}
