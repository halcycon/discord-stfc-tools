# Migrating to a new Discord bot application

Checklist for publishing this codebase as a **new** Discord app (e.g. after quarantine / rename) while **reusing existing guild data** in D1. Slash commands and the Worker stay the same product; only Discord/Cloudflare identity changes.

Guild, role, channel, and user snowflakes **do not change** when you swap bots. Most of `guild_configs` / `verified_players` remains valid.

---

## Parallel Workers (recommended)

Deploy the **new** bot as a **separate Cloudflare Worker** (new name / new `*.workers.dev` URL) and **leave the existing Worker running** until cutover is done.

| Why | Detail |
|-----|--------|
| Zero downtime | Old bot keeps serving the live guild while you configure the new app |
| Safe rollback | If OAuth, intents, or overwrites fail, remove the new bot and keep the old Worker |
| Same D1 | Both Workers can bind the **same** `D1_DATABASE_ID` during migration — only **one** bot should be invited / active in the guild for day-to-day ops once you switch |
| Clean DNS | New `WORKER_URL` + Interactions endpoint point at the new Worker; old URL stays until you decommission it |

**During overlap:** prefer inviting the new bot to a **test guild** first, or briefly both in production only while smoke-testing (watch for duplicate DMs/cron if both stay in the same guild with verification/cron enabled). Safer: new Worker + test guild → then production invite → remove old bot → retire old Worker.

When finished: disable/delete the old Worker (or leave it idle with no guilds), revoke old bot token in Discord.

---

## What stays the same

- D1 database contents (or a full copy of it)
- Optional R2 verification screenshots (same bucket or copied objects)
- This repository / Worker code
- Discord server roles, categories, and channels you already configured

---

## 1. Discord Developer Portal (new application)

1. **Create application** — new name (slight rename is fine).
2. **Bot** tab — create bot; copy token → `DISCORD_BOT_TOKEN`.
3. **Privileged Gateway Intents** — enable:
   - Server Members Intent
   - Message Content Intent
4. **OAuth2** — copy Application ID → `DISCORD_APPLICATION_ID` (and `DISCORD_CLIENT_ID` if you set it separately).
5. **OAuth2 → Client Secret** → `DISCORD_CLIENT_SECRET` (admin web login).
6. **OAuth2 → Redirects** — add:
   - `{WORKER_URL}/api/admin/auth/callback`
7. **General → Public Key** → `DISCORD_PUBLIC_KEY`.
8. **Interactions Endpoint URL** (after Worker is live):
   - `https://<your-worker>/discord`
9. **Invite URL** — scopes `bot` + `applications.commands`; permissions: Manage Roles, Manage Channels, Manage Nicknames, Send Messages, Embed Links, Attach Files, Read Message History (and whatever else you use).

Do **not** reuse the old app’s token or public key.

---

## 2. Cloudflare Worker (new project, old stays up)

1. Deploy this repo as a **new** Worker (change `"name"` in `generate-config.js` / wrangler so you get a new `*.workers.dev` hostname). **Do not** overwrite the live Worker until cutover is complete.
2. Point **D1** at the existing database (`D1_DATABASE_ID`) **or** export/import D1 into a new DB, then bind that.
3. Bind **R2** if you use verification screenshots (same bucket is fine).
4. Set vars/secrets on the **new** Worker only (see `.env.template`):

| Key | Notes |
|-----|--------|
| `DISCORD_APPLICATION_ID` | New app |
| `DISCORD_PUBLIC_KEY` | Secret |
| `DISCORD_BOT_TOKEN` | Secret |
| `DISCORD_CLIENT_SECRET` | Secret (admin web OAuth) |
| `ADMIN_SESSION_SECRET` | New random secret |
| `WORKER_URL` | New Worker URL |
| `ADMIN_WEB_ORIGIN` | Pages URL(s), comma-separated |

5. `npm run push-env && npm run deploy`
6. `npm run register-commands` (registers against the **new** application id)
7. Confirm Interactions URL in the Developer Portal

Gateway Durable Object state is empty on first connect — that is expected; it reconnects with the new token.

---

## 3. Invite and hierarchy

1. Invite the **new** bot to each guild that already has rows in `guild_configs`.
2. Raise the bot’s role **above** every role it must assign (member/guest/rank/overlays).
3. Smoke-test: `/server status`, `/server gateway`, one `/verify` or manual verify, bot can post in a personal channel / survey log if you use those.
4. When stable, **remove the old bot** from the guild.

---

## 4. Channel overwrites (important)

Permission overwrites often allow the **old bot user id**. The new bot has a **different** user id.

After inviting the **new** bot (while the old one can still stay):

1. Raise the new bot in the role hierarchy.
2. Dry-run, then apply bot access on linked personal channels:

```
/channels permissions-apply target:bot scope:personal
/channels permissions-apply target:bot scope:personal dry_run:false
```

3. Optionally widen scope: `diplomacy`, `staff_logs`, `survey_logs`, or `all`.
4. Grant other roles the same way (does **not** wipe member overwrites — only adds/updates the chosen target):

```
/channels permissions-apply target:role role:@Leadership preset:member scope:personal dry_run:false
/channels permissions-apply target:extra_roles scope:personal dry_run:false
/channels permissions-apply target:template_roles scope:personal dry_run:false
```

5. Confirm with `/channels permissions-audit`.
6. If `personal_channel_perm_template` was locked under the old bot, **clear and re-lock** from a good sample channel so new creates include the new bot.

Default `only_missing:true` skips targets that already have **View**. Set `only_missing:false` to force-refresh bits.

You usually do **not** need to wipe `verified_players` or re-run full `/server setup`.

---

## 5. Admin web (Cloudflare Pages)

You can deploy Pages before or after the Worker; both need matching URLs.

1. Pages project → same Git repo → **Root directory:** `admin-web`
2. Build: `npm ci && npm run build` · Output: `dist`
3. Env: `VITE_API_BASE_URL=https://<new-worker>`
4. Fill operator contact via **Pages env** `VITE_LEGAL_*` (see [ADMIN_WEB.md](./ADMIN_WEB.md)); do not commit real names/emails in the repo
5. Public legal URLs (no login):

| Page | Path |
|------|------|
| Privacy Policy | `https://<pages>/privacy` |
| Terms of Service | `https://<pages>/terms` |

Use those URLs in the Discord Developer Portal (and in `/server consent` messaging if you link policies there).

6. Set Worker `ADMIN_WEB_ORIGIN` to the Pages origin(s); redeploy Worker.

Local: see [ADMIN_WEB.md](./ADMIN_WEB.md).

---

## 6. Cutover order (recommended)

1. New Discord app + intents + OAuth redirect (→ **new** Worker URL)  
2. **New** Worker deployed with new secrets, **same D1**; **old Worker left running**  
3. Register commands + set Interactions URL on the **new** app only  
4. Invite new bot (test guild first if possible); fix hierarchy; smoke-test  
5. Fix channel overwrites / perm template if needed  
6. Deploy Pages against the **new** Worker; confirm `/privacy` and `/terms`  
7. Remove **old** bot from guilds; retire/disable **old** Worker; revoke old token  

---

## 7. Optional branding

- Rename Worker in `generate-config.js` (`"name": "…"`)
- Update `package.json` / `VERSION_HISTORY` product name when you care
- Legal pages title uses `operator.productName` in `admin-web/src/legal/operator.ts`

None of that is required for a working cutover.

---

## What you do *not* need

- New `guild_id`s or rewriting Discord snowflakes in D1  
- Re-verifying every player from scratch (unless you choose a clean-slate policy)  
- Rebuilding category maps if channel IDs are unchanged  

If something fails after cutover, check **bot hierarchy** and **channel overwrites** first — those are the usual new-bot pitfalls.
