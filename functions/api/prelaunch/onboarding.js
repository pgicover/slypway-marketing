// POST /api/prelaunch/onboarding
// Body: { phone, country, first, last, company?, role }
//
// Stores the onboarding form for a phone number that has already verified
// its code, records a durable admin_notifications row, and emails
// admin@slypway.com via Resend. This is the only pre-launch event that
// emails admin: a code request alone (functions/api/prelaunch/send-code.js)
// does not, so a completed signup produces one email, not two. A missing
// RESEND_API_KEY or a failed send never fails the request; the row in
// admin_notifications records what happened (see functions/_lib/prelaunch.js).

import {
  jsonResponse,
  markNotificationFailed,
  markNotificationSent,
  normalizeCountry,
  nowIso,
  recordAdminNotification,
  resendConfigured,
  sendAdminEmail,
  toE164,
} from "../../_lib/prelaunch.js";

function clean(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function buildOnboardingEmailText({ first, last, company, role, phone, verifiedAt }) {
  return [
    "A Slypway pre-launch signup just completed onboarding.",
    "",
    `Name: ${first} ${last}`,
    `Company: ${company || "(not provided)"}`,
    `Role: ${role}`,
    `Phone: ${phone}`,
    `Verified: ${verifiedAt}`,
  ].join("\n");
}

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

  const first = clean(body?.first, 120);
  const last = clean(body?.last, 120);
  const company = clean(body?.company, 200);
  const role = clean(body?.role, 1000);

  if (!first || !last || !role) {
    return jsonResponse(
      { error: "Fill in your first name, last name and what you do." },
      400
    );
  }

  try {
    const row = await env.DB.prepare(
      "SELECT verified_at FROM prelaunch_signups WHERE phone_e164 = ?1"
    )
      .bind(e164)
      .first();

    if (!row || !row.verified_at) {
      return jsonResponse({ error: "Verify your number again before continuing." }, 400);
    }

    const timestamp = nowIso();
    await env.DB.prepare(
      `UPDATE prelaunch_signups
       SET first_name = ?2, last_name = ?3, company = ?4, role = ?5, onboarding_completed_at = ?6, updated_at = ?6
       WHERE phone_e164 = ?1`
    )
      .bind(e164, first, last, company, role, timestamp)
      .run();

    const notificationId = await recordAdminNotification(
      env.DB,
      "onboarding_completed",
      e164,
      {
        first,
        last,
        company,
        role,
        country: normalizeCountry(body?.country),
      }
    );

    if (!resendConfigured(env)) {
      await markNotificationFailed(env.DB, notificationId, "resend_not_configured");
    } else {
      try {
        await sendAdminEmail(env, {
          subject: `Slypway onboarding completed: ${first} ${last}`,
          text: buildOnboardingEmailText({
            first,
            last,
            company,
            role,
            phone: e164,
            verifiedAt: row.verified_at,
          }),
        });
        await markNotificationSent(env.DB, notificationId);
      } catch (sendError) {
        await markNotificationFailed(
          env.DB,
          notificationId,
          sendError?.message || "send_failed"
        );
      }
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: "Something went wrong. Please try again." }, 500);
  }
}
