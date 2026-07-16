# Environment-Based Configuration

Configuration is driven by `.env` and `generate-config.js`, which produces `wrangler.json` (gitignored).

**Full setup instructions:** see **[SETUP.md](./SETUP.md)** (fresh install and migration from older versions).

## Quick workflow

```bash
cp .env.template .env    # fill in values — see SETUP.md
npm run push-env         # secrets → Cloudflare, wrangler.json from .env
npm run dev              # local development (reads .dev.vars)
npm run deploy           # production
```

**After any `.env` change:** `npm run push-env && npm run deploy`

See [SETUP.md — Pushing .env to Cloudflare](./SETUP.md#pushing-env-to-cloudflare) for what goes where.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_APPLICATION_ID` | Yes | Discord application ID |
| `DISCORD_BOT_TOKEN` | Yes | Bot token (also set as Worker secret) |
| `D1_DATABASE_NAME` | Yes | D1 database name (`stfc-db` or existing `stfc-officers`) |
| `D1_DATABASE_ID` | Yes | D1 database UUID from `wrangler d1 create` |
| `WORKER_NAME` | No | Cloudflare Worker script name (default `stfc-tools`). Set if you already deploy under another name — changing it creates a new Worker |
| `WORKER_URL` | Recommended | Deployed Worker URL |
| `WORKERS_PLAN` | No | `free` (default) or `paid` — Approve-all chunk size + Paid `cpu_ms` limit |
| `ALLIANCE_APPROVE_CHUNK` | No | Override links per Approve-all click (1–10; hard max) |
| `KV_NAMESPACE_ID` | No | Optional; runtime uses bundled system data |
| `R2_BUCKET_NAME` | No | Optional verification screenshot archive |

## Worker secrets

Set on Cloudflare (not in `.env` for production):

```bash
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
```

## Generated files

| File | Committed? | Purpose |
|------|------------|---------|
| `.env` | No (gitignored) | Your local configuration |
| `.env.template` | Yes | Template for new setups |
| `wrangler.json` | No (gitignored) | Generated Wrangler config |
