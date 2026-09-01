# Slypway Marketing - Coming Soon

Coming soon landing page for slypway.com with a video hero and an email
signup captured into Cloudflare D1.

## Local dev

```
npx wrangler pages dev . --port 3010
```

`wrangler pages dev` provisions a local D1 database automatically for the
`DB` binding declared in `wrangler.toml`, so signups work end to end without
touching production data.

## Deploy

Production deploy pending Cloudflare account decision. Do not run
`wrangler pages deploy` until that decision is made and the production D1
database has been created and its id filled into `wrangler.toml` (see the
comment above the `d1_databases` block).
