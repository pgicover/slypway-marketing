// POST /api/contact
// Body: { name, email, company?, role?, message? }
//
// Stores a "Talk to us" submission from contact.html in D1. There is no
// outbound mail sender in this repo (see the handoff report), so this
// does not email hello@slypway.com or anyone else; it only persists the
// message so it can be reviewed or exported until a mail provider exists.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
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
