# Version history — discord-stfc-tools

Release log for the STFC Discord bot (Cloudflare Worker). Versions use **MAJOR.MINOR.INCREMENTAL** (SemVer-compatible: incremental = patch).

| Segment | When to bump |
|---------|----------------|
| **MAJOR** | Breaking change for operators (schema wipe, removed commands, incompatible config), or a new product era |
| **MINOR** | New user-facing capability (new slash area, cron product, admin workflow) |
| **INCREMENTAL** | Fixes, polish, docs, refactors, small command option tweaks |

**Current version:** **1.17.3**

**Sources of truth**

| Location | Role |
|----------|------|
| `package.json` → `version` | npm / packaging |
| `src/version.ts` → `BOT_VERSION` | Runtime (shown in `/server status`) |
| This file | Human changelog |

Bump all three together when cutting a release. Prefer a short entry under the new version *before* deploy.

---

## How versions map to history

Versions below **1.0.0** are retrospective labels for the Aug 2025 utility era. **1.0.0** marks the alliance-management product that was prepared for public use. Later **1.x** minors track feature areas shipped in Jul 2026 (git history + migrations `001`–`027`).

---

## 1.17.3 — Exchange: remove Need role on complete (2026-07-19)

**Completed** now removes the recipient’s Need role (cancel already did). Donor unregister still removes the Donor role, and failures (usually bot role hierarchy) are shown in the ephemeral reply instead of failing silently.

## 1.17.2 — Tag rename: D1 remap in testing + alias history (2026-07-19)

Root cause of “scraped under old tag but skipped”: meta only stores the **current** tag, and **testing** skipped all remap (including D1 diplomacy keys), so the old tag stayed on the diplomacy map after meta moved to the new tag. Now testing always remaps D1 (Discord channel rename still needs `apply_discord:true`). Alias table `044` remembers every tag→id; planner also reads the previous server directory before overwrite. Chunked resync no longer drops overflow preserve ids; scrape failures keep cache (retry before vanish).

## 1.17.1 — Resync by alliance id: renames + vanished archive (2026-07-19)

Planning always resolves tracked tags to a stored **alliance id** (directory / roster meta / members), then scrapes `/alliances/{id}`. Tag missing from the server list but id known → still scrape (rename) or mark **vanished** (untrack + unmap + archive diplomacy). Tags with **no id on file** stay skipped — recover renames with `/alliance track tag:NEW from_tag:OLD`.

## 1.17.0 — Chunked `/alliance resync` (Continue) (2026-07-19)

Multi-alliance `/alliance resync` scrapes in chunks of **5** with a **Continue resync** button. Discord allows deferred edits for **15 minutes**; the real cliff is Cloudflare **`waitUntil` ~30s** after the deferred reply (not a Discord 30s command timeout). Morning cron still does a full one-shot scrape (~15 min wall). Requires migration `043_alliance_resync_sessions.sql`.

## 1.16.4 — Progress edits no longer stall bulk jobs (2026-07-19)

Root cause of “hangs after ~12–13” on resync / diplomacy sync: progress awaited Discord interaction webhook PATCHes with **no timeout / weak 429 handling**, so rate limits blocked the scrape/move loop. Webhook edits now use a 12s timeout + capped 429 retries; progress is **non-blocking** (coalesced + throttled) for alliance resync and diplomacy sync_all. stfc.pro 25s fetch timeouts from 1.16.3 remain.

## 1.16.3 — stfc.pro scrape timeout (cron + resync) (2026-07-19)

HTML/API fetches to stfc.pro now use a **25s** `AbortSignal.timeout`. A hung alliance page no longer stalls `/alliance resync` or the morning multi-roster cron forever; that alliance is marked failed and prior cache is kept. Resync progress reports per-scrape ✅/❌ with elapsed ms.

## 1.16.2 — `/alliance resync apply_discord` testing override (2026-07-19)

`/alliance resync apply_discord:true` applies diplomacy tag remaps / rebalance even when deploy mode is **testing** (roster scrape always runs either way).

## 1.16.1 — `/alliance resync` progress updates (2026-07-19)

Deferred reply now updates per alliance scrape (`1/N [TAG]`), then remap/rebalance steps, then the final summary. Testing mode notes when Discord tag remaps are skipped.

## 1.16.0 — `/alliance resync` (mid-day roster + tag rename remap) (2026-07-19)

Admin `/alliance resync` re-scrapes tracked alliance pages (same as morning), remaps diplomacy/DB when an alliance id’s tag changed, and rebalances buckets. `/alliance track` also remaps when the scraped tag differs from the prior cache. Duplicate new-tag diplomacy rooms are unmapped in favour of the original channel. Diagnostic `persist=1` uses the same path.

## 1.15.2 — Diplomacy sync_all no longer hangs (2026-07-18)

`sync_all` was re-sorting the whole category and rewriting permissions after **every** channel (often twice), so progress stuck on `1/35` under Discord rate limits. Bulk sync now defers A–Z sort to the end, skips permission rewrites by default (`apply_permissions:true` to force), and updates progress after each tag.

## 1.15.1 — Category name template `{RANGE}` (2026-07-18)

`category_name_template` accepts `{range}` in any case (`{RANGE}`, `{Range}`, …). Previously only lowercase `{range}` was substituted, so templates like `DIPLOMACY ROOMS {RANGE}` created literal names.

## 1.15.0 — Diplomacy soft limit persist + tag rename remap (2026-07-18)

Persisted `diplomacy_soft_limit` (migration `042`; default 45). `/diplomacy soft_limit:` on sync_all/archive_sync saves it; auto-rebalance on track/verify overflow and morning multi sync. Morning scrape detects alliance **tag renames** (same stfc.pro alliance id) → remap diplomacy map, rename/move channel, update tracked + verified tags, rebalance buckets. Sticky planner: raising soft limit does not merge existing letter buckets.

## 1.14.0 — Diplomacy archive sync (letter-bucket cleanup) (2026-07-18)

`/diplomacy archive_sync:true archive_category:#pile` rebalances unlinked rooms from existing archive piles into letter-bucket archive categories (no `link_tag` required). Migration `041_diplomacy_archive_category_map.sql`.

## 1.13.0 — Diplomacy gaps report + special channel (2026-07-18)

`/diplomacy gaps:true` diffs tracked/verified tags vs the channel map. Optional non-listed alliances room via `special:create|link|clear` with `special_placement:special_category` (dedicated category) or `top_of_first` (pinned in first letter-bucket). Migration `040_diplomacy_special_channel.sql`.

## 1.12.0 — Diplomacy preferred languages (flag suffixes) (2026-07-18)

Optional `languages:` on `/diplomacy create_tag` / `link_tag` stores preferred locales per alliance tag and appends country flag emojis to the channel name (e.g. `abcd-diplomacy┃🇬🇧🇫🇷`). Use `languages:none` to clear. Auto-created channels can be updated afterwards with the same command. Migration `039_diplomacy_preferred_locales.sql`.

## 1.11.4 — Generic placeholders in command examples (2026-07-18)

Replace real alliance/player names in `/diplomacy` help, setup wizard copy, slash option descriptions, and admin docs with fictional placeholders (`ABCD`, `ExamplePlayer`).

## 1.11.3 — Exchange: notify donor on completed (2026-07-18)

When a recipient marks a claimed request **Completed**, the claiming donor is DMed (same pattern as cancel).

## 1.11.2 — Verify panel stfc.pro link uses server/region (2026-07-18)

Pinned verify panel links to `https://stfc.pro/power?region=…&server=…` from guild config (e.g. EU 108).

## 1.11.1 — Clarify Invite DM vs welcome DM (2026-07-18)

`/server verify-panel` toggles the join-time **Invite DM** (`dm` / `channel_panel`). Docs and status copy distinguish that from `/server welcome` (post-verify welcome).

## 1.11.0 — Verification channel panel + demotion notify (2026-07-18)

- `/server verify-panel` — post a pinned **Start verification** panel; invite mode `dm` (default) or `channel_panel` (no auto join Invite DMs)
- Demotion notify: `dm` | `channel` (`@mention` in verify panel channel) | `none`
- Start button opens the existing DM verification flow; migration `038_verify_panel.sql`

## 1.10.14 — Exchange queue + pin counts (2026-07-18)

- Recipients can open a need request with **no donors** yet (FIFO queue); new donors are DMed about open requests oldest-first
- Pinned exchange post shows **Registered donors** and **Active requests** totals; bot edits the pin as they change

## 1.10.13 — Fix verify reassign FOREIGN KEY (2026-07-18)

`/server verify` Approve reassign cleared the prior Discord link via `DELETE verified_players`, which failed when `player_stats_history` rows existed. History rows are removed first.

## 1.10.12 — Admin guide: multi scrape vs track vs diplomacy (2026-07-18)

Documented caveats in `docs/ADMIN_GUIDE.md`: morning scrape set ≠ explicit `/alliance track` list; left tracked roster → live profile (no demote); diplomacy auto-create on verify/sync is intentional; `defer-untracked-admirals` implications.

## 1.10.11 — Roster rename table includes Tag (2026-07-18)

Morning alliance roster audit **Renames** table includes the alliance **Tag** column (same as joins/ops/rank).

## 1.10.10 — Defer untracked Admiral roles (multi) (2026-07-17)

- `/alliance defer-untracked-admirals enabled:true|false` — when on, Admirals of untracked alliances get member roles only (no Admiral/overlay roles); diplomacy for untracked tags waits until track
- Audit: **Admiral of untracked alliance** on verify
- `/alliance track` creates diplomacy (if enabled) and applies deferred Admiral roles to verified Admirals of that tag

## 1.10.9 — Duplicate player link Approve/Reject (2026-07-17)

- `/server verify` shows the existing Discord user and **Approve new link** / **Reject** buttons when the STFC player ID is already linked
- Approve clears the prior owner(s) (guest roles + verify reset) then applies the new link; Reject leaves the existing link unchanged

## 1.10.8 — Warn on duplicate player ID verify (2026-07-17)

- `/server verify` (and alliance Approve) blocks linking an STFC player ID already tied to another Discord user, with an admin warning naming the existing link
- `/verify` and DM verify tell the member the issue is flagged for admins; audit + urgent notify staff

## 1.10.7 — Fix roster Prev/Next timeout in public mode (2026-07-16)

Defer component ACK (Discord 3s) before D1 page render so public (and private) table buttons no longer show “didn’t respond in time”.

## 1.10.6 — Multi-alliance verify without alliance (2026-07-16)

- On **`multi_alliance`**, players with no alliance tag can verify (member roles/nick/channel; no diplomacy channel)
- **`single_alliance`** still requires a matching home-alliance tag
- Unaffiliated players get **no alliance-rank role** (ignores stale/mis-parsed Premier etc. from stfc.pro)

## 1.10.5 — Paginated `/roster unverified` table (2026-07-16)

- `/roster unverified` uses the same ASCII table + Prev/Next / Table / Full list buttons as other roster lists (fixes 2000-char overflow)
- Options: `format:`, `visibility:`, `page:`; `set_guest:true` still bulk-assigns guest

## 1.10.4 — Fix `/roster unverified` timeout (2026-07-16)

- Defer before listing guild members so large servers no longer hit Discord’s 3s “didn’t respond in time”

## 1.10.3 — Suggest table + Approve by confidence (2026-07-16)

- `/alliance suggest` lists matches in a compact ASCII table (all rows, H/M/L; **Nick** + **User** columns)
- **Approve 🟢 / 🟡 / 🟠** batch each confidence tier (same chunk + Continue as before)
- Individual **#** buttons under the table (first 20); group Approve for the rest

## 1.10.2 — Approve-all chunking for Workers Free (2026-07-16)

- `/alliance suggest` **Approve all 🟢** always chunks + **Continue** (Free **2**, Paid **6**, hard max **10** — Paid also stalls ~10/interaction)
- Live progress while each batch runs; `WORKERS_PLAN` / `ALLIANCE_APPROVE_CHUNK` in `.env`
- Docs: ADMIN_GUIDE, COMMANDS, SETUP, ENVIRONMENT_SETUP

## 1.10.1 — Link suggest Approve buttons (2026-07-16)

- `/alliance suggest` includes per-match **Approve** buttons and **Approve all 🟢** for high-confidence matches
- Buttons run the same path as `/server verify` (no welcome DM unless you use that command)

## 1.10.0 — Multi-alliance track + link suggest (2026-07-16)

- `/alliance track tag:` — scrape alliance roster now into D1 and keep it in morning sync (`tracked_alliance_tags`)
- `/alliance suggest [tag:]` — match unverified Discord members to unlinked roster (esp. `[TAG] Name` nicks)
- `/alliance list` / `untrack` — manage explicit track list
- Migration `035_tracked_alliance_tags.sql`

## 1.9.7 — Diagnostic pings require explicit params (2026-07-16)

- `/stfc-session/ping` and `/alliance-roster/ping` no longer bake in guild defaults, KWSN alliance id, or a hardcoded player id

## 1.9.6 — Configurable nickname display ranks (2026-07-16)

- `/server setup nickname_ranks:Commodore,Admiral` (and admin web) controls which ranks appear in nick placeholders
- Migration `034_nickname_display_ranks.sql`

## 1.9.5 — Abbreviated ranks in nicknames (2026-07-16)

- Nickname placeholders `{rank}` / `{rank_prefix}` / `{rank_paren}` use **Adm / Com / Pr / Op / Ag**

## 1.9.4 — Welcome DMs on member poll (2026-07-16)

- Pending welcome DMs flush on the ≤5 min member poll (same as invites), not only morning sync
- Large backlogs send in batches of 40 per poll; morning sync remains a safety-net retry

## 1.9.3 — Go-live DM litmus test (2026-07-16)

- `/server deploy` shows pending verification-invite + welcome DM backlog from D1
- `/server deploy preview:true` for litmus-only; `mode:live` confirmation includes the same preview

## 1.9.2 — Skip already-demoted guests in daily demotion pass (2026-07-16)

- Daily sync / testing dry-run no longer re-queues or lists players already `verification_status=guest`
- Guest re-promote poll unchanged (still restores members who rejoin the alliance)

## 1.9.1 — Multi-alliance dashboard chart scope (2026-07-16)

- Dashboard charts: multi-alliance defaults to **by alliance** (membership polar, grades stacked by alliance, power lines per tag)
- Toggle **by players** for guild-total grade polar + collective power; checkboxes to show/hide each chart

## 1.9.0 — Admin web staff pages + config gate (2026-07-16)

- **Access split:** `web_admin_role_ids` = Dashboard / Reports / Surveys; Discord Administrator required for Config / Permissions / Exchange PATCH
- Guild SPA nav: Dashboard, Reports (sortable), Surveys (read-only), Server Config, Permissions, Exchange (multi only)
- Dashboard: unlinked roster count, grade polar chart, collective power timeline (by alliance in multi mode)
- `/roster` queries also accept `web_admin_role_ids` (union with `dm_query_role_ids`)
- **Hardening:** web-staff roles can no longer Save Config via the web UI

## 1.8.19 — Mobile admin OAuth session (2026-07-15)

- Fix: after Discord login on mobile, SPA bounced to `/login` because Worker session cookie is third-party to Pages (Safari ITP)
- OAuth callback hands signed session to `/auth/callback`; SPA stores it and sends `Authorization: Bearer`

## 1.8.18 — Web admin role picker (2026-07-15)

- Clarify default: empty `web_admin_role_ids` = Discord Administrators only (not all members)
- Guild config: **List roles** via bot (`GET /api/admin/guilds/:id/roles`) + checkbox picker; **Suggest leadership** from Premier/Commodore/Admiral setup roles

## 1.8.17 — Admin web grade roster + nickname default (2026-07-15)

- Guild dashboard shows **effective** nickname template when DB is unset (mode default), with placeholder hint — was showing misleading `{name}` empty placeholder
- Click **By grade** rows (G3–G7) to load a player table (name, rank, ops, power, streak, inactive, status)
- API: `GET /api/admin/guilds/:id/players?grade=N`

## 1.8.16 — Bulk channel permissions-apply (2026-07-14)

- `/channels permissions-apply` — dry-run by default; add bot / role / extra-roles / template roles across personal, diplomacy, staff logs, survey logs
- Docs: ADMIN_GUIDE + BOT_MIGRATION cutover steps

---

## 1.8.15 — Admin legal pages + bot migration doc (2026-07-14)

- Public `/privacy` and `/terms` on `admin-web` (no login); landing at `/`; console at `/app`
- Operator placeholders: `admin-web/src/legal/operator.ts`
- `docs/BOT_MIGRATION.md` — new Discord app cutover while reusing D1

---

## 1.8.14 — Admin web foundation (2026-07-14)

**Migration:** `033_web_admin_roles.sql`

- Additive **admin web UI** in `admin-web/` (Cloudflare Pages root directory)
- Worker `/api/admin/*` — Discord OAuth login, guild picker, at-a-glance stats, config PATCH
- Access: Discord Administrator or `web_admin_role_ids`
- Docs: `docs/ADMIN_WEB.md`, `admin-web/README.md`
- Diagnostic writes (`/gateway/wake`, roster `persist=1`) require Bot or Bearer `ADMIN_SESSION_SECRET`

---

## 1.8.13 — Survey log title + auto-close (2026-07-13)

**Migration:** `032_survey_closes_at.sql`

- New survey log channels default to `{id}-{title}` (slugified); `{title}` supported in `/survey creators log_name`
- Optional `/survey create closes_in:` (`30m` / `12h` / `7d`) soft-closes after Approve & send; null deadline = manual close only (existing surveys unchanged)

---

## 1.8.12 — Survey personal-channel mention (2026-07-13)

- Personal-channel survey delivery prefixes `<@user>` so the member gets a mention notification

---

## 1.8.11 — Survey delivery title (2026-07-13)

**Migration:** `031_survey_title.sql`

- `/survey create title:…` sets the player-facing heading in DM / personal-channel delivery (default remains localized `Survey #id`)

---

## 1.8.10 — Survey test respects personal_channel delivery (2026-07-13)

- **Test to me** uses the survey’s `delivery` setting (personal channel when selected) instead of always DMing

---

## 1.8.9 — Batch daily sync audit tables (2026-07-13)

- Morning cron no longer posts one “Player sync update” embed per player for streak bumps / welcome DM notes
- Batched audit: **Player activity — streak / inactive** (as before) + **Player sync — daily updates** (welcome sent/failed + other material changes as ASCII tables)

---

## 1.8.8 — Welcome DM controls + onboarding path (2026-07-13)

**Migration:** `030_welcome_dm_attempts.sql`

- `/server verify send_welcome:` (default **false**) — opt-in welcome on manual verify
- Welcome DM auto-retries capped at **2** attempts; admin force via `/server welcome send_user: force:true`
- `/server onboarding` shows consent / CoC / welcome step order

---

## 1.8.7 — Command reference: single vs multi (2026-07-12)

- Added `docs/COMMANDS.md` — full slash catalogue with single_alliance vs multi_alliance behaviour
- ADMIN_GUIDE + AGENTS docs index link; clarified `/roster missing-verify` for multi

---

## 1.8.6 — Activity backfill by player name (2026-07-12)

- `/roster set-streak` / `set-inactive` / `activity` accept `player:` (in-game name or STFC id) as well as `user:`
- Updates both `verified_players` and `alliance_roster_members` when linked
- Near-miss names show **Did you mean?** with Yes / No buttons

---

## 1.8.5 — Alliance-roster days_inactive for unlinked (2026-07-12)

**Migration:** `029_alliance_roster_days_inactive.sql`

- Morning alliance scrape increments `alliance_roster_members.days_inactive` when streak is 0 (same rules as verified players)
- Unlinked members support multi-day `/roster inactive` filters

---

## 1.8.4 — Unlinked alliance members in roster lists (2026-07-12)

- `/roster` ops / grade / rank / inactive include alliance-cache players not on Discord by default
- Flag column **DC** (`yes` / `no`) and status `unlinked`; dense list shows `no Discord`
- `include_unlinked:false` to hide them; inactive `min_days>1` was Discord-linked only until 1.8.5

---

## 1.8.3 — Roster visibility public / Post to channel (2026-07-12)

- `visibility:private|public` on list `/roster` commands (default private)
- Public reports: anyone can use Prev/Next / Full list / Table
- Private reports: **Post to channel** button publishes a public copy (buttons intact)

---

## 1.8.2 — Roster list pagination & formats (2026-07-12)

**Migration:** `028_roster_list_sessions.sql`

- `/roster` list replies (ops / grade / rank / inactive / missing-verify): **Previous** / **Next** / **Full list** / **Table** buttons
- Slash options `sort:`, `format:table|list`, optional `page:`
- Dense list mode packs more players per message; streak still from alliance-page `consecutive_days_active`

---

## 1.8.1 — ASCII report tables (2026-07-12)

- Compact mode for `generateAsciiTable` (no per-row separators) for Discord-sized reports
- Morning alliance roster + player activity audits use fenced ASCII tables
- `/roster` lists and breakdowns use the same tables (player names; mentions still on `/roster unverified` / `activity`)

---

## 1.8.0 — Player activity (2026-07-12)

**Migration:** `027_player_activity.sql`

- Track stfc.pro `consecutive_days_active` as **activity streak**
- When streak is `0`, increment **days inactive**; when streak `> 0`, clear inactive
- `/roster inactive`, `/roster activity`, `/roster set-streak`, `/roster set-inactive`
- Morning audit: **Player activity — streak / inactive** (became / returned / still ≥3d)
- Streak/inactive bits on roster list lines

---

## 1.7.0 — Deploy mode (2026-07-12)

**Migration:** `026_deploy_mode.sql`

- `/server deploy mode:testing|live` — new guilds start in **testing**
- Testing: `[TESTING]` slash prefixes; demotions dry-run; outbound DMs gated (except `/test-dm`)
- Safe setup / go-live workflow for production alliances

---

## 1.6.0 — Multi-alliance roster sync (2026-07-12)

**Migration:** `025_multi_alliance_roster.sql`

- Server directory scrape → track tags (verified ∪ diplomacy map)
- Batch alliance-page scrapes with rate limits; day-over-day alliance moves / joins / leaves
- Live player-page fallback for untracked or empty tags

---

## 1.5.0 — Alliance roster cache + STFC session (2026-07-12)

**Migration:** `024_alliance_roster.sql`

- Durable Object **STFC session** for authenticated / resilient stfc.pro access
- Single-alliance morning HTML scrape of `/alliances/{id}`
- Day-over-day audit (joins, leaves, ops, rank, renames)
- Verify + daily sync prefer roster cache over live hits
- `/roster` enhancements (ranks, missing-verify, alliances, …)

---

## 1.4.0 — Demotion, welcome, consent (2026-07-11 → 2026-07-12)

**Migrations:** `021`–`023`

- Demotion policy (`auto` / `approval`) + leave queue / recheck
- Welcome DM after onboarding
- `/test-dm` for admin previews without status changes
- GDPR **data-processing consent** gate + CoC agreement backfill / accept options
- Diplomacy letter-bucket categories; channel sort / rate-limit polish

---

## 1.3.0 — Ops hardening (2026-07-11)

**Migrations:** `017`–`020`

- `/channels urgent` — high-signal staff alerts (e.g. DM blocked)
- `/server exclude-add|remove|list` — skip bots / never-verify accounts
- Personal channel **permissions-audit** + lockable **permissions-template**
- Link/rename/rebalance polish; bot overwrite always applied first for surveys

---

## 1.2.0 — Discord agreement (2026-07-11)

**Migration:** `016_agreement.sql`

- Optional Code of Conduct gate (`/server agreement`)
- DM Agree button; timing before/after verify
- Role overlays / verification logging improvements

---

## 1.1.0 — DM assistant (2026-07-11)

**Migration:** `015_dm_assistant.sql`

- HAL-style refusal for unknown DM asks; Badgey admin menu wizards
- Roster Q&A gated by `/server assistant` / DM query roles
- Optional AI opt-in

---

## 1.0.0 — Alliance management platform (2026-07-05 → 2026-07-11)

Public-ready verification bot (through `chore: prepare repo for public release`).

**Core (migrations `001`–`014`, Gateway DO)**

- Guild config: `/server setup|status` — single- / multi-alliance modes
- Player verification: Gateway DM flow + `/verify` + `/server verify`
- Roles, nicknames, personal channels, verification log
- Diplomacy channels (multi-alliance)
- Button surveys (`/survey`)
- Cross-alliance resource exchange (`/exchange`)
- Audit log channel; player language preferences (`/language`, multi-locale)
- Officer lookup **removed** and archived under `archive/officers/`

**Utility carry-over from 0.x:** `/lookup`, `/table`, `/tablehelp`, `/player`

---

## 0.3.0 — Officer lookup (2025-08-16) — archived

- Officer data + ability descriptions (later removed from the live bot; see `archive/officers/`)

---

## 0.2.0 — CSV tables (2025-08-10)

- `/table` / `/tablehelp` — Unicode box-drawing tables from inline CSV or attachment
- `POST /table` HTTP API; column limits, quoted fields, multi-line cells

---

## 0.1.0 — Coordinate lookup (2025-08-10)

- First Cloudflare Worker Discord bot
- `/lookup` for STFC share-string coordinates
- Bundled / KV-oriented system data experiments

---

## Unreleased / next

Track upcoming work here before bumping the version:

- _(none staged)_

---

## Maintenance checklist

When shipping a version:

1. Add a section at the top of this file (under the current-version line).
2. Set `package.json` `"version"` and `src/version.ts` `BOT_VERSION` to the same string.
3. Apply any new D1 migrations (`npm run db:migrate`).
4. `npm run register-commands` if slash definitions changed.
5. `npm run deploy`.
6. Optionally tag: `git tag v1.8.0 && git push origin v1.8.0` (when you want git tags).
