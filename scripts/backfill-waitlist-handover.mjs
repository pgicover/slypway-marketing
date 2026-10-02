// One-off backfill: copies people who finished the pre-launch waitlist
// form BEFORE the app handover existed into the Slypway app, so they get
// a User row and show up in Django admin same as anyone who signs up
// from now on.
//
// Do NOT run this automatically. Craig runs it deliberately, once, after
// the live handover (functions/api/prelaunch/onboarding.js) is deployed
// and confirmed working. Running it twice is harmless -- the app's
// POST /api/auth/waitlist/ is idempotent on the phone number -- but there
// is no reason to run it more than once.
//
// What it does:
//   1. Reads every prelaunch_signups row that completed onboarding
//      (onboarding_completed_at is set), from the REAL production D1
//      database (--remote), via `wrangler d1 execute`.
//   2. Sends each one to POST https://api.slypway.com/api/auth/waitlist/
//      with the same shared-secret header the live handover uses.
//   3. Prints a line per person: ok, already on the waitlist, or failed
//      (with the reason). Nothing here is silent.
//
// How to run it:
//   cd "~/Projects/Slypway Marketing"
//   WAITLIST_SHARED_SECRET=<the real value, from the app's secret store> \
//     node scripts/backfill-waitlist-handover.mjs
//
// Optional: DRY_RUN=true to print who would be sent without calling the
// app at all.
//
// The app throttles this endpoint to 60 requests/hour per caller
// (apps/customauth/throttling.py, scope waitlist_signup), so this script
// waits just over a second between each call by default. Override with
// DELAY_MS if there turn out to be very few legacy rows and Craig wants
// it faster, but never go under 1000ms or later rows will start failing
// with a 429 instead of actually being backfilled.

import { execFileSync } from "node:child_process";

const DELAY_MS = Number(process.env.DELAY_MS || 1100);
const DRY_RUN = process.env.DRY_RUN === "true";
const WAITLIST_API_URL = "https://api.slypway.com/api/auth/waitlist/";

function exportCompletedSignups() {
  const sql =
    "SELECT phone_e164, email, first_name, last_name FROM prelaunch_signups " +
    "WHERE onboarding_completed_at IS NOT NULL ORDER BY onboarding_completed_at ASC;";

  const raw = execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "slypway-marketing-signups",
      "--remote",
      "--json",
      "--command",
      sql,
    ],
    { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }
  );

  const parsed = JSON.parse(raw);
  const rows = parsed?.[0]?.results;
  if (!Array.isArray(rows)) {
    throw new Error("Unexpected wrangler output shape; nothing was sent.");
  }
  return rows;
}

async function sendOne(secret, row) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(WAITLIST_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Waitlist-Secret": secret,
      },
      body: JSON.stringify({
        mobile_number: row.phone_e164,
        email: row.email || "",
        first_name: row.first_name || "",
        last_name: row.last_name || "",
      }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, detail: data?.detail };
  } catch (err) {
    return { ok: false, status: null, detail: err?.name === "AbortError" ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const secret = process.env.WAITLIST_SHARED_SECRET;
  if (!DRY_RUN && !secret) {
    console.error("Set WAITLIST_SHARED_SECRET (the real value) before running, or set DRY_RUN=true.");
    process.exit(1);
  }

  console.log("Reading completed pre-launch signups from the production database...");
  const rows = exportCompletedSignups();
  console.log(`Found ${rows.length} completed signup(s) to send.`);

  let sent = 0;
  let already = 0;
  let failed = 0;

  for (const row of rows) {
    const last4 = (row.phone_e164 || "").slice(-4);
    if (DRY_RUN) {
      console.log(`DRY RUN would send: ...${last4} (${row.email || "no email"})`);
      continue;
    }

    const result = await sendOne(secret, row);
    if (result.ok) {
      if (result.detail === "Already on the waitlist.") {
        already += 1;
        console.log(`...${last4}: already in the app, skipped.`);
      } else {
        sent += 1;
        console.log(`...${last4}: sent.`);
      }
    } else {
      failed += 1;
      console.error(`...${last4}: FAILED (${result.status ?? "no response"}: ${result.detail || "unknown"})`);
    }

    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  if (!DRY_RUN) {
    console.log(`\nDone. Sent: ${sent}. Already there: ${already}. Failed: ${failed}.`);
    if (failed > 0) {
      console.log("Re-run the script; it is safe to run again and will skip anyone already sent.");
    }
  }
}

main().catch((err) => {
  console.error("Backfill aborted:", err?.message || err);
  process.exit(1);
});
