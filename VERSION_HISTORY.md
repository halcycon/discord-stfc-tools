# Version history — discord-stfc-tools

Release log for the STFC Discord bot (Cloudflare Worker). Versions use **MAJOR.MINOR.INCREMENTAL** (SemVer-compatible: incremental = patch).

| Segment | When to bump |
|---------|----------------|
| **MAJOR** | Breaking change for operators (schema wipe, removed commands, incompatible config), or a new product era |
| **MINOR** | New user-facing capability (new slash area, cron product, admin workflow) |
| **INCREMENTAL** | Fixes, polish, docs, refactors, small command option tweaks |

**Current version:** **1.8.0**

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
