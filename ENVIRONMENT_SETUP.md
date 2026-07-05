# Environment-Based Configuration

Configuration is driven by `.env` and `generate-config.js`, which produces `wrangler.json` (gitignored).

**Full setup instructions:** see **[SETUP.md](./SETUP.md)** (fresh install and migration from older versions).

## Quick workflow

```bash
cp .env.template .env    # fill in values — see SETUP.md
npm run generate-config  # writes wrangler.json
npm run dev              # local development
npm run deploy           # production
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_APPLICATION_ID` | Yes | Discord application ID |
| `DISCORD_BOT_TOKEN` | Yes | Bot token (also set as Worker secret) |
| `D1_DATABASE_NAME` | Yes | D1 database name (`stfc-db` or existing `stfc-officers`) |
| `D1_DATABASE_ID` | Yes | D1 database UUID from `wrangler d1 create` |
| `WORKER_URL` | Recommended | Deployed Worker URL |
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
