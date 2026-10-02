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
//
// Once the local record is written, this also hands the signup to the
// Slypway app (POST /api/auth/waitlist/) so the person gets a User row
// there and shows up in Django admin. That handover is additional, never
// a replacement: the local write and the confirmation page always happen
// first and are never undone or blocked by the app being slow, down, or
// rejecting the call. Its outcome is recorded on the same
// admin_notifications row (app_sent_at / app_error) so a failed handover
// can be found and retried later.

import {
  isValidEmail,
  jsonResponse,
  markNotificationAppFailed,
  markNotificationAppSent,
  markNotificationFailed,
  markNotificationSent,
  normalizeCountry,
  nowIso,
  recordAdminNotification,
  resendConfigured,
  sendAdminEmail,
  sendWaitlistSignup,
  toE164,
  waitlistApiConfigured,
} from "../../_lib/prelaunch.js";

function clean(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function buildOnboardingEmailText({ first, last, email, company, role, phone, verifiedAt }) {
  return [
    "A Slypway pre-launch signup just completed onboarding.",
    "",
    `Name: ${first} ${last}`,
    `Email: ${email}`,
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
  const email = clean(body?.email, 200);
  const company = clean(body?.company, 200);
  const role = clean(body?.role, 1000);

  if (!first || !last || !email || !role) {
    return jsonResponse(
      { error: "Fill in your first name, last name, email and what you do." },
      400
    );
  }

  if (!isValidEmail(email)) {
    return jsonResponse(
      { error: "Fill in your first name, last name, email and what you do." },
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
       SET first_name = ?2, last_name = ?3, email = ?4, company = ?5, role = ?6, onboarding_completed_at = ?7, updated_at = ?7
       WHERE phone_e164 = ?1`
    )
      .bind(e164, first, last, email, company, role, timestamp)
      .run();

    const notificationId = await recordAdminNotification(
      env.DB,
      "onboarding_completed",
      e164,
      {
        first,
        last,
        email,
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
            email,
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

    // Best-effort handover to the app. Never throws past this point and
    // never affects the response below: the signup is already saved and
    // the person already gets their confirmation either way.
    if (!waitlistApiConfigured(env)) {
      await markNotificationAppFailed(env.DB, notificationId, "waitlist_secret_not_configured");
    } else {
      try {
        await sendWaitlistSignup(env, {
          mobile_number: e164,
          email,
          first_name: first,
          last_name: last,
        });
        await markNotificationAppSent(env.DB, notificationId);
      } catch (appError) {
        await markNotificationAppFailed(
          env.DB,
          notificationId,
          appError?.message || "app_handover_failed"
        );
      }
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: "Something went wrong. Please try again." }, 500);
  }
}
