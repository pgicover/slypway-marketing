// POST /api/signup
// Body: { "email": "person@example.com" }
// Validates the email, then inserts it into the D1 signups table.
// A duplicate email is treated as success (idempotent) so a resubmit never errors.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return jsonResponse({ error: "Enter a valid email address." }, 400);
  }

  try {
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO signups (email, created_at) VALUES (?1, ?2) ON CONFLICT(email) DO NOTHING"
    )
      .bind(email, createdAt)
      .run();

    return jsonResponse({ success: true });
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
