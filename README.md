# Slypway Marketing - Coming Soon

Coming soon landing page for slypway.com with a video hero and an email
signup captured into Cloudflare D1.

## Local dev

```
npx wrangler pages dev . --port 3000
```

`wrangler pages dev` provisions a local D1 database automatically for the
`DB` binding declared in `wrangler.toml`, so signups work end to end without
touching production data.

## Deploy

Live on Craig's Cloudflare account as Pages project `slypway-marketing`
(D1 id already in `wrangler.toml`). Deploy only with explicit approval:

```
export CLOUDFLARE_ACCOUNT_ID=3fedbce63a575facfb0d89d8af9822b9
npx wrangler pages deploy . --project-name slypway-marketing --branch main --commit-dirty=true
```
