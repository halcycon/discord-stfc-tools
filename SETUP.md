# Setup Guide

How to deploy **discord-stfc-tools** — a Cloudflare Worker Discord bot for STFC alliance verification, coordinate lookup, and tables.

- **Discord admins (configure the bot in-server):** see **[docs/ADMIN_GUIDE.md](./docs/ADMIN_GUIDE.md)** — nicknames, roles, personal channels, verification log, linking existing channels.
- **Command list (single vs multi-alliance):** **[docs/COMMANDS.md](./docs/COMMANDS.md)**
- **Architecture / development:** see [AGENTS.md](./AGENTS.md).

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
DISCORD_PUBLIC_KEY=your-public-key
DISCORD_BOT_TOKEN=your-bot-token

D1_DATABASE_NAME=stfc-db
D1_DATABASE_ID=your-d1-database-id-from-step-3

# Optional: override Worker script name (default stfc-tools). Set this if you
# already deployed under a different name — changing it creates a NEW worker.
# WORKER_NAME=stfc-tools

WORKER_URL=https://stfc-tools.your-subdomain.workers.dev
```

KV and R2 are optional (see [Optional components](#optional-components) below).

### Step 5: Log in to Cloudflare

```bash
npx wrangler login
```

### Step 6: Push `.env` to Cloudflare

Your `.env` is the local source of truth. One command pushes **secrets** to Cloudflare and regenerates **wrangler.json** (vars + bindings):

```bash
npm run push-env
```

This script:

| What | Where it goes |
|------|----------------|
| `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN` | Encrypted Worker **secrets** (`wrangler secret bulk`) |
| `DISCORD_APPLICATION_ID`, `WORKER_URL` | Worker **vars** in `wrangler.json` |
| `WORKER_NAME` | Worker script `name` in `wrangler.json` (default `stfc-tools`) |
| `D1_DATABASE_*`, `KV_*`, `R2_*` | **Bindings** in `wrangler.json` |
| Same secrets | `.dev.vars` (for `wrangler dev` locally) |

**Manual alternative** (if you prefer not to use the script):

```bash
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
npm run generate-config
```

See [Pushing .env to Cloudflare](#pushing-env-to-cloudflare) for details on what goes where.

### Step 7: Apply database schema

`db:migrate` applies pending files under `migrations/` to remote D1 (tracked in `_schema_migrations`). That includes the base guild/player schema plus later migrations (surveys, urgent channel, excluded users, personal-channel permission template, **alliance roster** `024_alliance_roster.sql`, etc.).

For local development only:

```bash
npm run db:migrate-local
```

### Step 8: Deploy

```bash
npm run deploy
```

First deploy registers **Durable Object** migrations (`DiscordGateway`, `StfcSession`). This is automatic via `wrangler.json` / `generate-config.js`.

Note your Worker URL from the deploy output (e.g. `https://stfc-tools.your-name.workers.dev`). Update `WORKER_URL` in `.env`, then `npm run push-env && npm run deploy` again.

### Step 9: Configure Discord interactions endpoint

1. Discord Developer Portal → your application → **General Information**.
2. Set **Interactions Endpoint URL** to:
   ```
   https://stfc-tools.your-subdomain.workers.dev/discord
   ```
3. Discord will send a verification ping — the Worker must already be deployed. Save when verification succeeds.

**Not a separate webhook URL.** Discord only has one application URL field for the bot:

| Discord portal field | Set to? | Purpose |
|---------------------|---------|---------|
| **Interactions Endpoint URL** | `https://…/discord` | **Yes — required** for slash commands (`/verify`, `/server`, etc.) |
| Webhook URL (elsewhere) | — | **No** — channel webhooks are unrelated; this bot does not use them |
| Gateway URL | — | **No** — Gateway connects outbound via the Durable Object automatically |

Member joins and DM verification use the **Gateway** (WebSocket), not a second URL in the portal. Ensure **Server Members** and **Message Content** intents are enabled on the Bot tab.

### Step 10: Register slash commands

```bash
npm run register-commands
```

This uses `PUT` to replace all global commands (removes any stale commands like `/officer` if they existed elsewhere).

### Step 11: Configure your Discord server

In Discord, as an administrator, run `/server setup` then follow the full admin checklist in **[docs/ADMIN_GUIDE.md](./docs/ADMIN_GUIDE.md)** (nicknames, rank roles, personal channels, verification log, linking existing member channels).

Minimal example:

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
| `nickname_template` | Optional nick pattern (see admin guide) |
| `operative_roles` … `admiral_roles` | Optional rank roles |

Typical follow-ups:

```
/channels extra-roles roles:@Officer
/channels map category_map:A-F=…,G-M=…
/channels log create:true
/channels link channel:#existing-member player:PlayerName apply_permissions:false
/server status
```

Check configuration:

```
/server status
```
### Step 12: Verify it works

1. **Gateway:** `curl https://your-worker.workers.dev/gateway/status` — should show connection state after a minute.
2. **Coordinates:** `/lookup [[TAG] Player S:73559 X:628.7 Y:43.3]` in Discord.
3. **Verification:** Have a test user join the server → they should receive a verification DM. They can reply with a profile screenshot, then their stfc.pro link, or use `/verify link:https://stfc.pro/...`.

### Admin testing (without a new member)

You do **not** need someone to join to test verification. As a server administrator:

```
/server test-invite          # sends verification DM to you (simulates join)
/server gateway              # check Gateway WebSocket is connected
/verify link:https://stfc.pro/player/...   # full verify flow in-channel
/server test-reset           # clear your verification record and try again
```

**Recommended test loop:**

1. `/server setup` — configure guild once
2. `/server test-invite` — bot DMs you with instructions
3. Reply in DM with screenshot → stfc.pro link **or** run `/verify` in the server
4. `/server status` — confirm config; check roles/nickname updated
5. `/server test-reset` — wipe your record to re-test

Optional: `/server test-invite user:@Someone` to test another admin's DMs.

**DM not arriving?** User must allow DMs from server members (Discord privacy). Bot needs `DISCORD_BOT_TOKEN` secret on the Worker. Check `/server gateway` shows `Ready: yes`.

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
| No cron | Four cron triggers (member poll, guest re-check, daily roster+sync, demotion recheck) |
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
DISCORD_PUBLIC_KEY=...        # add if only set as Cloudflare secret before
DISCORD_BOT_TOKEN=...         # required for command registration AND runtime

D1_DATABASE_NAME=stfc-officers   # keep your existing database name
D1_DATABASE_ID=your-existing-id  # keep your existing ID

# WORKER_NAME=stfc-tools         # set if your deployed Worker name differs from default
WORKER_URL=https://stfc-tools.your-subdomain.workers.dev   # your deployed URL
```

### 3. Enable Discord privileged intents

Discord Developer Portal → Bot → enable:

- **Server Members Intent**
- **Message Content Intent**

Without these, Gateway DM verification and `GUILD_MEMBER_ADD` will not work.

### 4. Push `.env` to Cloudflare

```bash
npm run push-env
npm run db:migrate
```

This uploads secrets and regenerates `wrangler.json`. If you already had secrets set manually on Cloudflare, this overwrites them with values from `.env`.

### 5. Deploy (applies Durable Object migration)

```bash
npm run deploy
```

First deploy after this upgrade creates the `DiscordGateway` Durable Object class. Watch deploy output for migration errors.

**Important:** Only one Gateway connection per bot token. Do not run `wrangler dev` and production simultaneously with the same token.

### 6. Re-register slash commands

```bash
npm run register-commands
```

This **removes** `/officer` from Discord and registers the new commands (`/verify`, `/server`, `/player`, etc.).

### 7. Re-verify interactions endpoint

Confirm **Interactions Endpoint URL** still points to:

```
https://your-worker.workers.dev/discord
```

Discord may re-verify after deploy — check the Developer Portal shows a green checkmark.

### 8. Configure guild(s)

Existing servers have no guild config until you run setup:

```
/server setup server:42 mode:single_alliance region:US alliance_tag:YOURTAG guest_role:... member_roles:...
```

### 9. Smoke test

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

### 10. Optional cleanup

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

Then `npm run push-env && npm run deploy`.

### KV — system data (not used at runtime)

Coordinate lookup reads from bundled `src/systemData.ts`. KV setup (`npm run kv:create`, `migrate-kv`, `kv:upload`) is optional and does not affect current behaviour. See `KV_MIGRATION_GUIDE.md` for historical context.

### Local development

```bash
npm run dev
```

- Worker: `http://localhost:8787`
- Discord interactions require a public URL (use `wrangler dev --remote` or deploy to a preview worker for webhook testing).
- Gateway in local dev will compete with production if using the same bot token — use a separate Discord test application for local Gateway work.

- Gateway in local dev will compete with production if using the same bot token — use a separate Discord test application for local Gateway work.
- `npm run push-env` writes `.dev.vars` so `wrangler dev` picks up secrets automatically.

---

## Pushing .env to Cloudflare

Cloudflare Workers split configuration into three layers:

| Layer | Examples | How to set |
|-------|----------|------------|
| **Secrets** | `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN` | Encrypted; `npm run push-env` or `wrangler secret put` |
| **Vars** | `DISCORD_APPLICATION_ID`, `WORKER_URL` | Plaintext in `wrangler.json`; `generate-config` from `.env` |
| **Bindings** | D1, KV, R2, Durable Objects | `wrangler.json`; `generate-config` from `.env` |

**`.env` is only on your machine** (gitignored). Production does not read it automatically — you push values explicitly:

```bash
npm run push-env    # secrets → Cloudflare, vars/bindings → wrangler.json
npm run deploy      # apply wrangler.json to production
```

After changing any value in `.env`:

```bash
npm run push-env && npm run deploy
```

`register-commands` reads `DISCORD_*` directly from `.env` (local only) — no push needed for that script.

### What `push-env` does

1. Validates `DISCORD_PUBLIC_KEY` and `DISCORD_BOT_TOKEN` exist in `.env`
2. Writes `.dev.vars` (for `npm run dev`)
3. Runs `generate-config` → updates `wrangler.json`
4. Runs `wrangler secret bulk` with those two secrets

### Security notes

- Never commit `.env` or `.dev.vars`
- Secrets in `.env` are convenient for development; production copies are encrypted on Cloudflare
- Rotating a token: update `.env`, then `npm run push-env`

---

## Environment reference

### `.env` file (local source of truth)

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_APPLICATION_ID` | Yes | Vars in wrangler.json; also used by `register-commands` |
| `DISCORD_PUBLIC_KEY` | Yes | Worker secret (via `push-env`) |
| `DISCORD_BOT_TOKEN` | Yes | Worker secret + `register-commands` |
| `D1_DATABASE_NAME` | Yes (fresh) | Wrangler D1 database name |
| `D1_DATABASE_ID` | Yes (fresh) | Wrangler D1 database UUID |
| `WORKER_NAME` | No | Cloudflare Worker script name (default `stfc-tools`). Keep stable once deployed |
| `WORKER_URL` | Recommended | Deployed Worker URL |
| `KV_NAMESPACE_ID` | No | Optional KV binding |
| `KV_NAMESPACE_PREVIEW_ID` | No | Optional KV preview binding |
| `R2_BUCKET_NAME` | No | Screenshot archive bucket |

### Worker secrets (pushed by `npm run push-env`)

| Secret | Required | Description |
|--------|----------|-------------|
| `DISCORD_PUBLIC_KEY` | Yes | Verifies interaction signatures |
| `DISCORD_BOT_TOKEN` | Yes | REST API (roles, DMs, channels) + Gateway |

### Worker vars (in `wrangler.json` via `generate-config`)

| Var | Purpose |
|-----|---------|
| `DISCORD_APPLICATION_ID` | Deferred interaction follow-ups |
| `WORKER_URL` | Public Worker URL |
| `ENVIRONMENT` | `development` (default) |

### Wrangler bindings (generated in `wrangler.json`)

| Binding | Type | Purpose |
|---------|------|---------|
| `STFC_DB` | D1 | Guild and player state |
| `DISCORD_GATEWAY` | Durable Object | Discord Gateway WebSocket |
| `STFC_SESSION` | Durable Object | Anonymous stfc.pro session / token cache |
| `VERIFICATION_ASSETS` | R2 | Optional screenshot storage |
| `SYSTEM_DATA` | KV | Optional; unused at runtime |

---

## Cron schedules

Configured in `generate-config.js` → `wrangler.json`:

| Schedule | Purpose |
|----------|---------|
| `*/5 * * * *` | Wake Gateway; member poll fallback |
| `0 */6 * * *` | Re-check guest players (alliance roster cache first, else live lookup) |
| `0 6 * * *` | Alliance roster sync + day-over-day audit report + daily player sync |
| `30 * * * *` | Leave-detection recheck queue (auto policy missing-player delay) |

**Single-alliance morning job:** one HTML fetch of `https://stfc.pro/alliances/{stfc_alliance_id}` (full roster embedded in the page). Diff vs previous D1 snapshot → post to audit channel → sync verified players from cache. See `docs/ADMIN_GUIDE.md` § Daily alliance roster and `AGENTS.md` § Alliance roster sync.

**Multi-alliance:** no alliance roster sync; daily sync uses per-player lookups only.

### Diagnostic endpoints (ops)

| Path | Purpose |
|------|---------|
| `GET /alliance-roster/ping` | Scrape alliance HTML — **requires** `?alliance_id=&server=&region=` |
| `GET /alliance-roster/ping?persist=1&guild_id=` | Scrape + write D1 roster for that guild (auth required) |
| `GET /stfc-session/ping` | HTML player lookup — **requires** `?server=&region=&search=` |
| `GET /gateway/status` | Discord Gateway DO status |

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
cp .env.template .env    # fill in all values
npm install
npx wrangler login
npm run push-env         # secrets → Cloudflare, wrangler.json from .env
npm run db:migrate
npm run deploy
npm run register-commands

# After .env changes
npm run push-env && npm run deploy

# Development
npm run dev              # uses .dev.vars for secrets
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
