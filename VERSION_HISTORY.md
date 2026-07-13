# Version history — discord-stfc-tools

Release log for the STFC Discord bot (Cloudflare Worker). Versions use **MAJOR.MINOR.INCREMENTAL** (SemVer-compatible: incremental = patch).

| Segment | When to bump |
|---------|----------------|
| **MAJOR** | Breaking change for operators (schema wipe, removed commands, incompatible config), or a new product era |
| **MINOR** | New user-facing capability (new slash area, cron product, admin workflow) |
| **INCREMENTAL** | Fixes, polish, docs, refactors, small command option tweaks |

**Current version:** **1.8.12**

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
