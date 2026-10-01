// POST /api/contact
// Body: { name, email, company?, role?, message? }
//
// Stores a "Talk to us" submission from contact.html in D1, records a
// durable admin_notifications row, and emails admin@slypway.com via Resend
// (see functions/_lib/prelaunch.js for sendAdminEmail). A missing
// RESEND_API_KEY or a failed send never fails the request: the row is
// already saved, the submitter still gets a success response, and the
// admin_notifications row records what happened instead.

import {
  markNotificationFailed,
  markNotificationSent,
  recordAdminNotification,
  resendConfigured,
  sendAdminEmail,
} from "../_lib/prelaunch.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function buildContactEmailText({ name, email, company, role, message }) {
  return [
    "A Slypway \"Talk to us\" contact form submission just came in.",
    "",
    `Name: ${name}`,
    `Email: ${email}`,
    `Company: ${company || "(not provided)"}`,
    `Role: ${role || "(not provided)"}`,
    "",
    "Message:",
    message || "(not provided)",
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

  const name = clean(body?.name, 200);
  const email = clean(body?.email, 254).toLowerCase();
  const company = clean(body?.company, 200);
  const role = clean(body?.role, 200);
  const message = clean(body?.message, 4000);

  if (!name || !EMAIL_RE.test(email)) {
    return jsonResponse({ error: "Enter your name and a valid work email." }, 400);
  }

  try {
    await env.DB.prepare(
      "INSERT INTO contact_messages (name, email, company, role, message, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
    )
      .bind(name, email, company, role, message, new Date().toISOString())
      .run();

    const notificationId = await recordAdminNotification(env.DB, "contact_message", null, {
      name,
      email,
      company,
      role,
      message,
    });

    if (!resendConfigured(env)) {
      await markNotificationFailed(env.DB, notificationId, "resend_not_configured");
    } else {
      try {
        await sendAdminEmail(env, {
          subject: `Slypway contact form: ${name}`,
          text: buildContactEmailText({ name, email, company, role, message }),
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

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
