# CLAUDE.md - Slypway Marketing Site

This repo is the public marketing site for **Slypway** (slypway.com), the white-label insurance platform from InsureCert Systems Inc. It is a separate company and product from PGI (PGI-v2 repo). Never mix the two: no PGI branding, business rules, or GCP resources.

The application itself (app.slypway.com, Django API, storefront worker) lives in `~/Projects/insurecert-v2/`. That repo's `CLAUDE.md`, `STYLE_GUIDE.md`, and `.claude/insurecert_copywriter_brief.md` are the authoritative brand, voice, and design rules; read them before writing copy or UI here.

## Brand

- The product is **Slypway**, capital S, spelled with a y. Never Slipway, never Canvas.
- The company is **InsureCert Systems Inc.**, used only in lockup small print and legal contexts.
- Never use em dashes or quotation marks in any copy.
- Palette, type, radii and motion follow `~/Projects/insurecert-v2/STYLE_GUIDE.md`. The Slypway wordmark artwork is pending; do not invent one.

## Stack

Plain static HTML, CSS and JS with Cloudflare Pages Functions. No build step. Email signups post to `functions/api/signup.js` and land in Cloudflare D1 (`slypway-marketing-signups`). The pre-launch site is archived under `archive/`.

## Local development

Port 3000 is reserved for this site (the app uses 3001, the API 3002, the storefront 3003).

```bash
npx wrangler pages dev . --port 3000
# one time, so local signups work:
npx wrangler d1 execute slypway-marketing-signups --local --file=./schema.sql
```

Check: `curl -s http://localhost:3000 -o /dev/null -w "%{http_code}"` must return 200.

## Production

| Item | Value |
|------|-------|
| Domain | slypway.com, www.slypway.com |
| Cloudflare account | 3fedbce63a575facfb0d89d8af9822b9 (Craig). Export `CLOUDFLARE_ACCOUNT_ID` before wrangler runs. |
| Pages project | `slypway-marketing` (slypway-marketing.pages.dev) |
| D1 | `slypway-marketing-signups` (id in `wrangler.toml`) |
| DNS zone | Currently in Andrew's Cloudflare account; moving it to Craig's is a standing task. DNS edits need a scoped token via `CLOUDFLARE_API_TOKEN`, never the browser. |
| GitHub | `pgicover/slypway-marketing` (canonical) |

Deploy, only when Craig explicitly says commit, push, ship, or deploy in the current turn:

```bash
git push origin main
export CLOUDFLARE_ACCOUNT_ID=3fedbce63a575facfb0d89d8af9822b9
npx wrangler pages deploy . --project-name slypway-marketing --branch main --commit-dirty=true
curl -s https://slypway.com -o /dev/null -w "%{http_code}\n"   # expect 200
```

## Rules

- Never commit, push, or deploy without explicit approval in the current turn. Never `git add -A`; stage by path.
- Never add screens, sections, buttons, or flows beyond what was explicitly asked.
- No credentials in this repo. `.dev.vars` is local only and git-ignored.
- Never touch production D1 data from a local session.
