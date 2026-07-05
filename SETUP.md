# Setup Guide

How to deploy **discord-stfc-tools** — a Cloudflare Worker Discord bot for STFC alliance verification, coordinate lookup, and tables.

For architecture and development context, see [AGENTS.md](./AGENTS.md).

---

## What you are deploying

| Component | Purpose |
|-----------|---------|
| **Worker** (`src/index.ts`) | Slash commands, HTTP API, cron triggers |
| **Durable Object** (`DiscordGateway`) | Persistent Discord Gateway WebSocket (DM verification, member joins) |
| **D1** (`STFC_DB`) | Guild config, verified players, stats history |
| **R2** (optional) | Archived verification screenshots |
| **Workers Assets** (`public/`) | Static files only (`index.html` today) |

**Slash commands:** `/lookup`, `/table`, `/tablehelp`, `/player`, `/verify`, `/server setup`, `/server status`

**Removed (Jul 2026):** `/officer` and officer portrait assets — archived in `archive/officers/`.

---

## Prerequisites

- Node.js 18+ and npm
- [Cloudflare account](https://dash.cloudflare.com/) with Workers enabled
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (installed via `npm install`)
- Discord application at [Discord Developer Portal](https://discord.com/developers/applications)
- Bot invited to your Discord server with permissions to:
  - Manage roles
  - Manage channels
  - Manage nicknames
  - Send messages (including DMs)

---

# Part 1 — Fresh setup from scratch

### Step 1: Clone and install

```bash
git clone <your-repo-url> discord-stfc-tools
cd discord-stfc-tools
npm install
```

### Step 2: Create Discord application

1. Open [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **Bot** tab → **Add Bot** → copy the **Bot Token** (keep secret).
3. **General Information** → copy **Application ID**.
4. **General Information** → copy **Public Key**.
5. **Bot** tab → **Privileged Gateway Intents** — enable:
   - **Server Members Intent**
   - **Message Content Intent**
6. **OAuth2 → URL Generator** — scopes: `bot`, `applications.commands`. Bot permissions: Manage Roles, Manage Channels, Manage Nicknames, Send Messages. Use the generated URL to invite the bot to your server.

### Step 3: Create Cloudflare D1 database

```bash
npx wrangler d1 create stfc-db
```

Copy the `database_id` from the output.

### Step 4: Configure environment

```bash
cp .env.template .env
```

Edit `.env`:

```env
DISCORD_APPLICATION_ID=your-application-id
DISCORD_BOT_TOKEN=your-bot-token

D1_DATABASE_NAME=stfc-db
D1_DATABASE_ID=your-d1-database-id-from-step-3

WORKER_URL=https://stfc-tools.your-subdomain.workers.dev
```

KV and R2 are optional (see [Optional components](#optional-components) below).

### Step 5: Log in to Cloudflare

```bash
npx wrangler login
```

### Step 6: Set Worker secrets

Secrets are not stored in `.env` for production — set them on Cloudflare:

```bash
npx wrangler secret put DISCORD_PUBLIC_KEY
# Paste the Public Key from Discord Developer Portal

npx wrangler secret put DISCORD_BOT_TOKEN
# Paste the Bot Token (same value as in .env — needed at runtime for REST API + Gateway)
```

### Step 7: Generate config and apply database schema

```bash
npm run generate-config
npm run db:migrate
```

`db:migrate` runs `migrations/001_guild_schema.sql` against your remote D1 database. This creates guild/player tables (`guild_configs`, `verified_players`, etc.).

For local development only:

```bash
npm run db:migrate-local
```

### Step 8: Deploy

```bash
npm run deploy
```

First deploy registers the **Durable Object** migration (`v1` / `DiscordGateway`). This is automatic via `wrangler.json`.

Note your Worker URL from the deploy output (e.g. `https://stfc-tools.your-name.workers.dev`). Update `WORKER_URL` in `.env` if needed, then `npm run generate-config` again before future deploys.

### Step 9: Configure Discord interactions endpoint

1. Discord Developer Portal → your application → **General Information**.
2. Set **Interactions Endpoint URL** to:
   ```
   https://stfc-tools.your-subdomain.workers.dev/discord
   ```
3. Discord will send a verification ping — the Worker must already be deployed. Save when verification succeeds.

### Step 10: Register slash commands

```bash
npm run register-commands
```

This uses `PUT` to replace all global commands (removes any stale commands like `/officer` if they existed elsewhere).

### Step 11: Configure your Discord server

In Discord, as an administrator:

```
/server setup server:42 mode:single_alliance region:US alliance_tag:YOURTAG guest_role:123456789 member_roles:111,222
```

| Option | Description |
|--------|-------------|
| `server` | STFC server number (required) |
| `mode` | `single_alliance` or `multi_alliance` |
| `region` | `US` or `EU` |
| `alliance_tag` | Required for single-alliance mode |
| `guest_role` | Role ID for unverified / wrong-alliance members |
| `member_roles` | Comma-separated role IDs granted on verification |

Check configuration:

```
/server status
```

### Step 12: Verify it works

1. **Gateway:** `curl https://your-worker.workers.dev/gateway/status` — should show connection state after a minute.
2. **Coordinates:** `/lookup [[TAG] Player S:73559 X:628.7 Y:43.3]` in Discord.
3. **Verification:** Have a test user join the server → they should receive a verification DM. They can reply with a profile screenshot, then their stfc.pro link, or use `/verify link:https://stfc.pro/...`.

### Step 13: Run tests (optional)

```bash
npm test
```

---

# Part 2 — Migrating from an existing setup

Use this if you already run an older version of this bot (coordinate lookup, `/officer`, `OFFICERS_DB`, KV migration, etc.).

## What changed

| Before | After |
|--------|-------|
| `OFFICERS_DB` binding | `STFC_DB` binding (same Cloudflare D1 database) |
| `/officer` command | **Removed** — code in `archive/officers/` |
| `public/officers/`, `public/abilities/` | **Removed** from deploy (~14 MB) |
| Webhook-only bot | Webhook + **Gateway Durable Object** (DMs, member joins) |
| No verification | `/verify`, `/server`, `/player`, guild tables in D1 |
| `DISCORD_PUBLIC_KEY` only | Also requires `DISCORD_BOT_TOKEN` secret |
| No cron | Three cron triggers (member poll, guest re-check, daily sync) |
| KV for systems (documented) | Still optional; lookup uses bundled `systemData.ts` |

**Your existing D1 database** (`stfc-officers` or custom name) is reused. Legacy officer tables (`officers`, `officer_translations`, etc.) are harmless if left in place — the bot no longer queries them.

## Migration checklist

### 1. Pull latest code

```bash
git pull
npm install
```

### 2. Update `.env`

Add any missing variables (compare with `.env.template`):

```env
DISCORD_APPLICATION_ID=...    # already had this
DISCORD_BOT_TOKEN=...         # required for command registration AND runtime

D1_DATABASE_NAME=stfc-officers   # keep your existing database name
D1_DATABASE_ID=your-existing-id  # keep your existing ID

WORKER_URL=https://stfc-tools.adam-57b.workers.dev   # your deployed URL
```

If you were only using `DISCORD_PUBLIC_KEY` as a secret before, you must now also set `DISCORD_BOT_TOKEN` as a Worker secret (Step 4 below).

### 3. Enable Discord privileged intents

Discord Developer Portal → Bot → enable:

- **Server Members Intent**
- **Message Content Intent**

Without these, Gateway DM verification and `GUILD_MEMBER_ADD` will not work.

### 4. Set the bot token secret

```bash
npx wrangler secret put DISCORD_BOT_TOKEN
```

### 5. Regenerate config and apply new schema

```bash
npm run generate-config
npm run db:migrate
```

`001_guild_schema.sql` uses `CREATE TABLE IF NOT EXISTS` — safe to run on a database that already has officer tables. It only adds guild/player tables.

### 6. Deploy (applies Durable Object migration)

```bash
npm run deploy
```

First deploy after this upgrade creates the `DiscordGateway` Durable Object class. Watch deploy output for migration errors.

**Important:** Only one Gateway connection per bot token. Do not run `wrangler dev` and production simultaneously with the same token.

### 7. Re-register slash commands

```bash
npm run register-commands
```

This **removes** `/officer` from Discord and registers the new commands (`/verify`, `/server`, `/player`, etc.).

### 8. Re-verify interactions endpoint

Confirm **Interactions Endpoint URL** still points to:

```
https://your-worker.workers.dev/discord
```

Discord may re-verify after deploy — check the Developer Portal shows a green checkmark.

### 9. Configure guild(s)

Existing servers have no guild config until you run setup:

```
/server setup server:42 mode:single_alliance region:US alliance_tag:YOURTAG guest_role:... member_roles:...
```

### 10. Smoke test

```bash
curl https://your-worker.workers.dev/gateway/status
```

| Test | Expected |
|------|----------|
| `/lookup` | Still works (bundled system data) |
| `/table` | Still works |
| `/officer` | **Gone** — command should not appear in Discord |
| New member joins | Verification DM within ~5 minutes |
| DM screenshot + stfc.pro link | Roles assigned per `/server setup` |
| `/verify` | Still works as fallback |

### 11. Optional cleanup

These are **not required** for the new bot to work:

| Item | Action |
|------|--------|
| Officer tables in D1 | Leave or drop manually (`officers`, `officer_abilities`, etc.) |
| KV `SYSTEM_DATA` namespace | Unused by runtime; can decommission |
| `archive/officers/` | Keep in repo for reference or delete locally |
| Old docs (`KV_MIGRATION_GUIDE.md`, etc.) | Historical only |

To drop officer tables from D1 (irreversible):

```bash
npx wrangler d1 execute stfc-officers --remote --command \
  "DROP TABLE IF EXISTS ability_values; DROP TABLE IF EXISTS officer_abilities; ..."
```

Only do this if you are certain you will not revive officer lookup from `archive/officers/`.

---

## Optional components

### R2 — verification screenshot archive

Without R2, screenshot Discord URLs are stored in D1 but not permanently archived.

```bash
npx wrangler r2 bucket create stfc-verification-assets
```

Add to `.env`:

```env
R2_BUCKET_NAME=stfc-verification-assets
```

Then `npm run generate-config && npm run deploy`.

### KV — system data (not used at runtime)

Coordinate lookup reads from bundled `src/systemData.ts`. KV setup (`npm run kv:create`, `migrate-kv`, `kv:upload`) is optional and does not affect current behaviour. See `KV_MIGRATION_GUIDE.md` for historical context.

### Local development

```bash
npm run dev
```

- Worker: `http://localhost:8787`
- Discord interactions require a public URL (use `wrangler dev --remote` or deploy to a preview worker for webhook testing).
- Gateway in local dev will compete with production if using the same bot token — use a separate Discord test application for local Gateway work.

---

## Environment reference

### `.env` file (local / config generation)

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_APPLICATION_ID` | Yes | For `register-commands` |
| `DISCORD_BOT_TOKEN` | Yes | For `register-commands`; also set as Worker secret |
| `D1_DATABASE_NAME` | Yes (fresh) | Wrangler D1 database name |
| `D1_DATABASE_ID` | Yes (fresh) | Wrangler D1 database UUID |
| `WORKER_URL` | Recommended | Deployed Worker URL |
| `KV_NAMESPACE_ID` | No | Optional KV binding |
| `KV_NAMESPACE_PREVIEW_ID` | No | Optional KV preview binding |
| `R2_BUCKET_NAME` | No | Screenshot archive bucket |

### Worker secrets (`wrangler secret put`)

| Secret | Required | Description |
|--------|----------|-------------|
| `DISCORD_PUBLIC_KEY` | Yes | Verifies interaction signatures |
| `DISCORD_BOT_TOKEN` | Yes | REST API (roles, DMs, channels) + Gateway |

### Wrangler bindings (generated in `wrangler.json`)

| Binding | Type | Purpose |
|---------|------|---------|
| `STFC_DB` | D1 | Guild and player state |
| `DISCORD_GATEWAY` | Durable Object | Discord Gateway WebSocket |
| `VERIFICATION_ASSETS` | R2 | Optional screenshot storage |
| `SYSTEM_DATA` | KV | Optional; unused at runtime |

---

## Cron schedules

Configured in `generate-config.js` → `wrangler.json`:

| Schedule | Purpose |
|----------|---------|
| `*/5 * * * *` | Wake Gateway; member poll fallback |
| `0 */6 * * *` | Re-check guest players (alliance tag polling) |
| `0 6 * * *` | Daily ops/power/alliance sync |

---

## Troubleshooting

### Interactions endpoint verification fails

- Worker must be deployed before saving the URL in Discord.
- `DISCORD_PUBLIC_KEY` secret must match the application's Public Key exactly.

### Bot does not respond to slash commands

- Run `npm run register-commands` after deploy.
- Confirm interactions URL is correct and verified.
- Check Worker logs in Cloudflare dashboard.

### No verification DMs

- `DISCORD_BOT_TOKEN` secret must be set on the Worker (not just in `.env`).
- Privileged intents enabled in Discord portal.
- Run `/server setup` on the guild.
- Check `GET /gateway/status` — Gateway should connect within a few minutes of deploy.
- Users must allow DMs from server members (Discord privacy setting).

### Gateway keeps disconnecting

- Only one Gateway per bot token — stop local `wrangler dev` if production is running.
- Check Cloudflare Worker logs for `DiscordGateway` errors.

### `db:migrate` fails

- Confirm `D1_DATABASE_ID` in `.env` matches your database.
- Run `npx wrangler d1 list` to verify database exists and you are logged into the correct account.

### `/player` or `/verify` says server not configured

- Admin must run `/server setup` with the STFC server number and region.

---

## Quick reference — command summary

```bash
# One-time / occasional
cp .env.template .env
npm install
npx wrangler login
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
npm run generate-config
npm run db:migrate
npm run deploy
npm run register-commands

# Development
npm run dev
npm test
```

---

## Related documentation

| File | Contents |
|------|----------|
| [AGENTS.md](./AGENTS.md) | Architecture, roadmap, coding guidelines |
| [ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md) | `.env` and `generate-config.js` overview |
| [FACTION_MAPPING.md](./FACTION_MAPPING.md) | System faction IDs for `/lookup` |
| [archive/officers/README.md](./archive/officers/README.md) | Removed officer feature |
