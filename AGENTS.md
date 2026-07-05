# AGENTS.md — discord-stfc-tools

Context for AI agents and contributors working on this repository. Read this before making changes.

---

## What this project is

**discord-stfc-tools** is a Cloudflare Worker Discord bot for [Star Trek Fleet Command (STFC)](https://www.startrekfleetcommand.com/). Primary focus: **alliance/server management** — player verification, role automation, personal channels, stfc.pro sync. Secondary utilities: coordinate lookup and CSV tables.

**Officer lookup was removed** (Jul 2026) and archived under `archive/officers/` — incomplete, ~14 MB assets, unrelated to verification.

**Production URL:** `https://stfc-tools.adam-57b.workers.dev`

**Sister project:** `/home/adam/workspace/discord-stfc-tracker/discord-stfc-tracker/` — alliance snapshot tracker with stfc.pro integration. Reuse code from there; do not duplicate its full multi-tenant snapshot system unless explicitly needed.

---

## Architecture (current)

```
Discord Client
      │ POST /discord (Ed25519-signed Interactions webhook)
      ▼
Cloudflare Worker (src/index.ts)
      ├── discord-gateway/           → Gateway DO (DMs, GUILD_MEMBER_ADD)
      ├── verification.ts          → stfc.pro verify + roles
      ├── guild-db.ts              → STFC_DB queries
      ├── stfc-utils.ts            → stfc.pro API client
      ├── systemUtils.ts + systemData.ts → ~2,041 bundled star systems
      └── tableUtils.ts            → CSV → Unicode tables

Bindings:
  STFC_DB          → D1 "stfc-officers" (guild/player tables; binding renamed from OFFICERS_DB)
  DISCORD_GATEWAY  → Durable Object (Discord Gateway WebSocket)
  VERIFICATION_ASSETS → R2 (optional screenshot archive)
  SYSTEM_DATA      → KV (configured but NOT used at runtime)
  DISCORD_PUBLIC_KEY / DISCORD_BOT_TOKEN → secrets
```

**Interaction model:** Stateless webhook for slash commands. **Discord Gateway** via `DiscordGateway` Durable Object (singleton WebSocket) receives `MESSAGE_CREATE` (DMs) and `GUILD_MEMBER_ADD`. **Bot REST API** (`DISCORD_BOT_TOKEN`) for sending DMs, roles, nicknames, channels. Member REST polling every 5 min remains as fallback.

**Gateway architecture:**
```
Discord Gateway (wss://gateway.discord.gg)
        ↓ WebSocket (outbound, held by DO)
DiscordGateway Durable Object (id: "main")
        ↓ MESSAGE_CREATE (DM) → dm verification state machine
        ↓ GUILD_MEMBER_ADD → verification invite DM
Worker (src/index.ts) — wakes DO on fetch + cron
```

**Cron schedules:**
- `*/5 * * * *` — wake Gateway + member poll fallback
- `0 */6 * * *` — re-check guest players (alliance tag polling)
- `0 6 * * *` — daily ops/power/alliance sync for verified players

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Runtime | Cloudflare Workers (`compatibility_date: 2025-07-26`) |
| Language | TypeScript (strict) |
| Discord | `discord-interactions` (signature verify); raw Interactions API responses |
| Guild/player state | Cloudflare D1 (`STFC_DB`) |
| System data | Bundled `src/systemData.ts` (~16K lines, from `system-data.csv`) |
| stfc.pro | `src/stfc-utils.ts` + `pako` |
| CLI | Wrangler 4.x, `generate-config.js` |
| Tests | Vitest + `@cloudflare/vitest-pool-workers` |

**Dependencies:** `discord-interactions`, `pako`. Optional: R2 for verification screenshots.

---

## Current features

### Verification & guild management
- `/verify` — stfc.pro link + optional screenshot
- `/server setup|status` — per-guild configuration (admin)
- `/player` — live stfc.pro lookup
- Gateway DM flow: screenshot → link → roles/nickname/channels
- Cron: member poll, guest alliance re-check, daily ops/power sync

### `/lookup`
Parses STFC share strings like `[[RONE] Player S:73559 X:628.7432 Y:43.3874]`. Supports multiple coordinates per message. Returns Unicode box-drawing table with Alliance, System, Warp, Faction, Player. Uses in-memory `SYSTEM_DATA_MAP` — **not KV**.

### `/table` and `/tablehelp`
Renders CSV as ASCII tables. Accepts inline `csv_data` or `.csv` attachment (max 1MB).

### HTTP endpoints
| Path | Purpose |
|------|---------|
| `POST /discord` | Discord interactions |
| `GET/POST /lookup` | Coordinate lookup API |
| `POST /table` | CSV table API |
| `GET /gateway/status` | Gateway DO connection state |
| `GET /systems` | First 10 bundled systems |

---

## Codebase map

```
src/
  index.ts                 # Worker entry
  discord-handlers.ts      # Slash command routing
  discord-gateway/         # Gateway DO + DM verification
  verification.ts          # Verify flow + roles
  guild-db.ts              # STFC_DB access
  stfc-utils.ts            # stfc.pro client
  systemUtils.ts           # Coordinate lookup
  systemData.ts            # Bundled systems (generated — do not hand-edit)
  tableUtils.ts            # CSV tables
  cron.ts                  # Scheduled jobs

migrations/
  001_guild_schema.sql     # Guild/player tables

archive/officers/          # REMOVED officer feature (scripts, SQL, assets, docs)

generate-config.js         # .env → wrangler.json
register-command.js        # Register slash commands (PUT — replaces all)
```

---

## Configuration

### Environment (`.env` from `.env.template`)

| Variable | Purpose |
|----------|---------|
| `KV_NAMESPACE_ID` | Production KV (optional; worker doesn't read it yet) |
| `KV_NAMESPACE_PREVIEW_ID` | Preview KV |
| `DISCORD_APPLICATION_ID` | Command registration |
| `DISCORD_BOT_TOKEN` | Command registration; **will also be needed for REST API calls** (roles, DMs, channels) |
| `DISCORD_PUBLIC_KEY` | Worker secret: `wrangler secret put DISCORD_PUBLIC_KEY` |

`wrangler.json` is **gitignored** and generated by `npm run generate-config`.

### npm scripts

| Script | Action |
|--------|--------|
| `npm run dev` | generate-config + wrangler dev |
| `npm run deploy` | generate-config + wrangler deploy |
| `npm test` | vitest |
| `npm run register-commands` | Register Discord slash commands |
| `npm run db:migrate` | Apply guild schema to remote D1 |
| `npm run db:migrate-local` | Apply guild schema to local D1 |
| `npm run migrate-kv` / `kv:upload` | KV bulk upload (systems — not wired) |

---

## D1 database (`STFC_DB` / Cloudflare name `stfc-officers`)

Binding in code: **`STFC_DB`**. Cloudflare D1 database name remains `stfc-officers` (historical).

### Guild / player tables (authoritative — `migrations/001_guild_schema.sql`)

| Table | Purpose |
|-------|---------|
| `guild_configs` | Per-Discord-server mode, STFC server/region, roles, categories |
| `guild_members` | Known members + verification invite tracking |
| `verified_players` | Discord ↔ STFC player link, ops/power/grade, status |
| `verification_screenshots` | Archived profile screenshots (R2 key + Discord URL) |
| `player_stats_history` | Daily ops/power/alliance snapshots |
| `surveys` / `survey_responses` | Grade-targeted feedback (future) |

Apply migration: `npm run db:migrate` (remote) or `npm run db:migrate-local`

Legacy officer tables may still exist in this D1 database from earlier work; they are **unused**. Officer feature code lives in `archive/officers/`.

---

## Known technical debt

1. **KV migration incomplete** — `SYSTEM_DATA` binding exists; worker reads bundled `systemData.ts` instead.
2. **Stale root docs** — `README.md`, `CHANGES_SUMMARY.md` may not reflect current scope.
3. **No CI/CD** — no GitHub Actions.
4. **Member poll fallback** — REST member list poll every 5 min when Gateway disconnected.

---

## Sister project: discord-stfc-tracker

**Path:** `/home/adam/workspace/discord-stfc-tracker/discord-stfc-tracker/`

**Purpose:** Multi-tenant alliance roster snapshotter. Periodically fetches stfc.pro data, stores in D1, detects player movements across alliances.

### What to port (high value)

| Source | Reuse for |
|--------|-----------|
| `src/stfc-utils.ts` | stfc.pro API client — decompression, pagination, rate limiting, `PlayerData` type |
| `findPlayerByIdOrName()` | Parse stfc.pro player page / search API |
| `fetchAllianceByTag()` | Verify alliance membership |
| `src/discord-commands.json` pattern | Single source of truth for slash command definitions |
| Deferred response pattern (`type: 5` + followup PATCH) | Long-running stfc.pro fetches |
| `ctx.waitUntil()` | Background verification polling |
| `src/webhook-service.ts` | Channel notifications (lighter than DMs) |
| `src/alliance-analysis-service.ts` | G1–G6 tier breakdown |

### What NOT to port wholesale

- Full multi-tenant snapshot system (`multi-tenant-database-service.ts`, 2000+ lines)
- Batch processor Worker (`stfc-batch-processor`) — only if full-server daily scans are needed
- Movement detection cron — different purpose than member verification (but daily player checks reuse similar fetch logic)

### stfc.pro API essentials (from tracker)

**Base URL:** `https://stfc.pro`

**Key endpoint:**
```
GET /api/players?type=player_data_power&page={n}&pageCount=250
    &region={US|EU}&server={n}&tag={tag}&search={term}&searchMatch=true
```

**Response format:** JSON with base64+zlib-compressed `data` or `players` field → `atob()` → `pako.inflate()` → JSON array.

**Required headers:**
```typescript
{
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': 'https://stfc.pro/',
  'Accept': 'application/json',
  'Sec-Fetch-Mode': 'cors'
}
```

**Normalized player shape (`PlayerData`):**
```typescript
interface PlayerData {
  playerId: number;
  name: string;
  rank: string;        // alliance rank in-game
  level: number;       // Ops level
  helps: string;
  rss: string;
  power: number;
  max_power?: number;
  iso: string;
  joinDate: string;
  allianceId: string;
  allianceTag: string;
  server: number;
  region: string;
}
```

**Rate limiting:** 10–20s between pages; 5–10s for light ops; 30s backoff on 429.

**Player page URLs:** Users will submit links like `https://stfc.pro/...` — parse player ID/name + server/region from URL, then call `findPlayerByIdOrName()` to validate alliance membership and pull ops/power.

### Tracker gaps relevant to our roadmap

Tracker has **no** Discord-user ↔ STFC-player verification, **no** role management, **no** DMs, **no** member-join handling. Those are entirely new work in discord-stfc-tools.

---

## Planned expansion (roadmap)

This section captures the product direction. Implement incrementally; each phase should be independently deployable.

### Phase 0 — Foundation (prerequisites)

Before verification/roles work:

1. **Add `src/stfc-utils.ts`** (ported/adapted from tracker) + `pako` dependency.
2. **Add `scheduled()` handler** and cron triggers in wrangler config.
3. **Add second D1 binding** (e.g. `GUILD_DB`) for guild config + player records.
4. **Add R2 binding** (e.g. `VERIFICATION_ASSETS`) for profile screenshots.
5. **Store `DISCORD_BOT_TOKEN` as Worker secret** — required for REST API (DMs, roles, nicknames, channel creation).
6. **Architectural decision: member-join events.**

   Current webhook-only model cannot receive `GUILD_MEMBER_ADD`. Options:
   - **A) Hybrid:** Small Gateway process (or Cloudflare Container) for events → calls Worker API.
   - **B) Discord Events webhook** (if applicable to bot type).
   - **C) Polling** (not recommended).

   Role assignment, nickname changes, channel creation, and DMs all require **Discord REST API** with bot token regardless of event source.

7. **Privileged intents:** `GUILD_MEMBERS`, `GUILD_MESSAGES` (for DM verification flow) — enable in Discord Developer Portal.
8. **Consolidate command definitions** into `src/discord-commands.json` (tracker pattern).

### Phase 1 — Player verification onboarding

**Trigger:** New member joins Discord server.

**Flow:**
1. Bot sends DM inviting verification.
2. Member sends **screenshot of in-game profile** → store in R2 (archive permanently for troubleshooting); record metadata in D1 (`verification_screenshots`: discord_user_id, r2_key, uploaded_at, guild_id).
3. Member sends **stfc.pro player page link** in follow-up DM.
4. Parse link → fetch player via stfc.pro API → confirm player exists and has alliance membership.
5. Store verified link: D1 `verified_players` (discord_user_id, player_id, player_name, alliance_tag, ops_level, power, stfc_server, stfc_region, verified_at, stfc_pro_url).

**State machine:** `pending_screenshot` → `pending_link` → `verified` → `active` | `guest` | `failed`

**Configurable per guild** (see Configuration model below).

### Phase 2 — Single-alliance server mode

When `guild_config.mode = 'single_alliance'`:

| Condition | Action |
|-----------|--------|
| Alliance tag ≠ configured tag | Assign **guest role**; poll stfc.pro every N hours until tag matches |
| Alliance tag matches | Auto-assign **member roles** (configurable list); remove guest role |
| Tag matches | Set server **nickname** to in-game player name |
| Tag matches | Create **personal channel** in member category |

**Personal channel rules (configurable):**
- Category split by first letter of player name (default; configurable alphabet buckets).
- Channel permissions: player + configurable additional roles (officers, admins, etc.).
- Channel naming convention (e.g. `player-name` or `#a-adam`).

**Tag change detected (daily check):** Revoke member roles, assign guest role, optionally archive/disable personal channel, notify admins.

### Phase 3 — Multi-alliance server mode

When `guild_config.mode = 'multi_alliance'`:

| Condition | Action |
|-----------|--------|
| stfc.pro page parsed successfully | Assign **member role** (configurable) |
| Alliance identified | Assign **alliance role/tag** (Discord role per alliance tag, or a single role with nickname prefix) |
| Alliance tag changes (daily check) | Update alliance role/tag |

No guest-role gating; no personal channel requirement (unless optionally enabled).

### Phase 4 — Daily player sync

**Cron:** Once per day (configurable), for all `verified_players` in each guild:

1. Re-fetch player from stfc.pro.
2. Update D1: `ops_level`, `power`, `alliance_tag`, `player_name`, `last_synced_at`.
3. Detect changes → trigger mode-specific actions (Phase 2/3 rules).
4. Append to `player_stats_history` for trend queries.

### Phase 5 — Ops grade targeting & surveys

**Grade mapping (in-game Ops level → grade):**

| Grade | Ops level range |
|-------|-----------------|
| G3 | ≤ 39 |
| G4 | 40–50 |
| G5 | 51–60 |
| G6 | 61–70 |
| G7 | 71–80 |

Store computed `grade` on each sync (derived column or view).

**Queryable:** "How many verified players at G5?" → D1 query on `verified_players` where `grade = 5`.

**Survey/feedback commands (admin):**
- Configurable: target grade(s), target alliance(s), all verified members.
- Configurable button layout: yes/no, 2–5 option multiple choice.
- Send via DM or designated channel.
- Store responses in D1 `survey_responses`.
- Use Discord message components (buttons); handle `type: 3` interactions.

**Example admin command:** `/survey create grade:5 buttons:3 question:"..." options:"A|B|C"`

---

## Proposed D1 schema (guild/player — new)

Add as `migrations/001_guild_schema.sql` on a new D1 database (`GUILD_DB`):

```sql
-- Per-Discord-guild configuration
CREATE TABLE guild_configs (
  guild_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('single_alliance', 'multi_alliance')),
  stfc_server INTEGER NOT NULL,
  stfc_region TEXT NOT NULL CHECK (stfc_region IN ('US', 'EU')),
  alliance_tag TEXT,              -- required for single_alliance mode
  guest_role_id TEXT,
  member_role_ids TEXT,           -- JSON array of Discord role IDs
  alliance_role_prefix TEXT,      -- multi_alliance: optional nickname prefix pattern
  channel_category_map TEXT,      -- JSON: {"A-F": "category_id", ...}
  personal_channel_extra_roles TEXT, -- JSON array of role IDs with access
  poll_interval_hours INTEGER DEFAULT 6,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Discord user ↔ STFC player link
CREATE TABLE verified_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  player_id INTEGER,
  player_name TEXT,
  alliance_tag TEXT,
  ops_level INTEGER,
  power INTEGER,
  grade INTEGER,                  -- computed 3-7
  stfc_pro_url TEXT,
  verification_status TEXT,       -- pending_screenshot|pending_link|verified|guest|active|failed
  personal_channel_id TEXT,
  verified_at TEXT,
  last_synced_at TEXT,
  UNIQUE (guild_id, discord_user_id)
);

-- Archived profile screenshots (binary in R2)
CREATE TABLE verification_screenshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  discord_message_id TEXT,
  uploaded_at TEXT DEFAULT (datetime('now'))
);

-- Historical ops/power for queries
CREATE TABLE player_stats_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  verified_player_id INTEGER NOT NULL,
  ops_level INTEGER,
  power INTEGER,
  alliance_tag TEXT,
  recorded_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (verified_player_id) REFERENCES verified_players (id)
);

-- Surveys
CREATE TABLE surveys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  question TEXT NOT NULL,
  button_type TEXT,               -- yes_no | multi_choice
  options TEXT,                   -- JSON array
  target_grades TEXT,             -- JSON array e.g. [4,5]
  target_alliance_tags TEXT,      -- JSON array or null = all
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE survey_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id INTEGER NOT NULL,
  discord_user_id TEXT NOT NULL,
  response TEXT NOT NULL,
  responded_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (survey_id) REFERENCES surveys (id)
);
```

**R2 layout:** `verifications/{guild_id}/{discord_user_id}/{timestamp}.png`

---

## Configuration model (per guild)

Stored in `guild_configs`. Admin setup command: `/server setup` (to be implemented).

| Setting | Description |
|---------|-------------|
| `mode` | `single_alliance` or `multi_alliance` |
| `stfc_server` / `stfc_region` | Which STFC server to validate against |
| `alliance_tag` | Expected tag (single-alliance mode) |
| `guest_role_id` | Role for non-matching alliance members |
| `member_role_ids` | Roles granted on successful verification |
| `channel_category_map` | First-letter → category ID mapping for personal channels |
| `personal_channel_extra_roles` | Roles that can see all personal channels |
| `poll_interval_hours` | How often to re-check alliance tag before match (default 6) |
| Feature flags (future) | `enable_personal_channels`, `enable_surveys`, `enable_daily_sync` |

Use a service layer (e.g. `src/guild-config-service.ts`) — do not embed raw SQL in handlers.

---

## Discord API patterns for new features

### REST calls (need `DISCORD_BOT_TOKEN` secret)

| Action | Endpoint |
|--------|----------|
| Send DM | `POST /users/@me/channels` then `POST /channels/{id}/messages` |
| Assign role | `PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id}` |
| Remove role | `DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id}` |
| Set nickname | `PATCH /guilds/{guild_id}/members/{user_id}` `{ "nick": "..." }` |
| Create channel | `POST /guilds/{guild_id}/channels` |
| Set permissions | `PUT /channels/{id}/permissions/{overwrite_id}` |

### Interaction patterns (existing + new)

- Fast replies: `type: 4` (channel message) or `type: 4` + `flags: 64` (ephemeral).
- Slow stfc.pro fetches: `type: 5` (deferred) → edit via webhook URL from interaction token.
- Background work: `ctx.waitUntil(promise)` in `fetch()` handler.
- Button/survey responses: `interaction.type === 3`, route by `custom_id` prefix (e.g. `survey_{id}_{option}`).

### Cron (to add in wrangler config)

| Schedule | Purpose |
|----------|---------|
| `0 */6 * * *` | Re-check pending verifications (alliance tag polling) |
| `0 6 * * *` | Daily full player sync (ops, power, alliance) |
| `*/5 * * * *` | Process queued DM / channel creation jobs (if using job table) |

---

## Development workflow

```bash
cp .env.template .env          # fill Discord + KV IDs
npm install
npm run generate-config        # creates wrangler.json
npm run dev                    # local worker on :8787

# Secrets (production)
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_BOT_TOKEN   # needed for REST API expansion

# Register slash commands
npm run register-commands

# D1 (guild schema)
npm run db:migrate

# Tests
npm test
```

**When adding slash commands:** Update handler in `src/index.ts` AND command definition (move to `src/discord-commands.json` when created) AND `register-command.js` / deploy script.

**When changing wrangler bindings:** Update `generate-config.js`, run `npm run cf-typegen`, update `worker-configuration.d.ts`.

---

## Coding guidelines

1. **Minimize scope** — Focused diffs; don't refactor unrelated code.
2. **Match existing style** — TypeScript strict, Web APIs (`fetch`, `Request`, `Response`), service layers for D1.
3. **Use `STFC_DB` binding** — all guild/player queries go through `guild-db.ts`.
4. **Respect Worker limits** — Batch D1 writes (25–100 rows), use `waitUntil` for slow work, defer Discord responses for stfc.pro calls.
5. **Rate-limit stfc.pro** — Port delay/backoff from tracker; never hammer the API.
6. **Archive verification screenshots** — Never delete from R2; soft-delete in D1 only if needed.
7. **Configurable behavior** — Feature flags in `guild_configs`, not hardcoded guild IDs.
8. **No new storage systems** unless requested — D1 + R2 + existing KV/assets are sufficient.
9. **Update this file** when architecture or roadmap changes materially.

---

## Testing priorities

Current coverage: basic `/lookup` and `/table` integration tests only.

**Add tests for:**
- stfc.pro payload decompression (fixture-based unit test)
- Player URL parsing
- Grade calculation from ops level
- Guild config CRUD
- Verification state machine transitions
- Single vs multi-alliance role logic (pure functions, no Discord API)
- Survey targeting filters

Mock Discord REST and stfc.pro in Worker tests; use D1 local binding for integration tests.

---

## Documentation index

| File | Status |
|------|--------|
| `SETUP.md` | **Fresh install and migration guide** |
| `AGENTS.md` | Architecture, roadmap, coding guidelines |
| `ENVIRONMENT_SETUP.md` | `.env` and `generate-config.js` overview |
| `FACTION_MAPPING.md` | System faction IDs (for `/lookup`) |
| `KV_MIGRATION_GUIDE.md` | KV migration (incomplete) |
| `archive/officers/README.md` | Archived officer feature |

**Tracker docs** (sibling project): `COMMANDS.md`, `MULTI_TENANT_ARCHITECTURE.md`, `WEBHOOK_INTEGRATION.md`, `.github/copilot-instructions.md`

---

## Suggested implementation order

1. ~~Port `stfc-utils.ts` + `/player`~~ — done
2. ~~Guild schema + `/server setup`~~ — done
3. ~~Gateway DM verification~~ — done
4. Multi-alliance role tagging
5. Personal channel category configuration command
6. Daily sync + grade-based surveys
7. Optional: drop legacy officer tables from D1
