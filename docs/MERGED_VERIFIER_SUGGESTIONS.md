# Suggestions for [Merged-Verifier](https://github.com/ComputerEndProgram/Merged-Verifier)

Feedback from a review of the merged STFC / Veil verifier bot (Python + discord.py + SQLite), written while comparing it to a Cloudflare Worker–based STFC Discord bot that uses the stfc.pro JSON API, D1, and R2.

These are optional improvements — not a demand to rewrite the project. Highest-impact items are listed first.

---

## 1. Stop scraping HTML; use the stfc.pro API

**Current:** `STFCProScraper` GETs `https://stfc.pro/players/{id}`, parses `<title>`, meta description, and a fragile regex on the HTML body for rank (`>(Agent|Operative|…)</span>`).

**Why it hurts:** Any UI/copy change on stfc.pro breaks verification. Rank extraction is especially brittle. You also pull BeautifulSoup + full page HTML for data that already exists as JSON.

**Suggestion:** Call the same player data API the site uses (compressed `player_data_power` / search endpoints), decompress (zlib), and map fields (`name`, `level`, `power`, `allianceTag`, `rank`, `server`, `region`). Keep HTML scrape only as a short-term fallback.

Benefits: stable rank/alliance fields, less bandwidth, easier unit tests with fixtures.

---

## 2. Deduplicate the three nearly identical scrapers

`bot/legacy_profiles/{stfc_verifier,stfc_verifier_alliance,veil_security}/stfc_scraper.py` are copies of the same module (veil omits rank). One shared `bot/core/stfc_client.py` would cut maintenance and drift.

Same idea for `get_rank_tier()` — it is duplicated in both STFC `bot_impl.py` files and in `RankConfirmationView`.

---

## 3. Finish (or delete) the unused “new” architecture

The tree has a clean-looking layer that runtime does **not** use:

| Path | Status |
|------|--------|
| `bot/profiles/*/profile.py` | Stub steps / finalize |
| `bot/core/verification/` | Thin placeholders |
| `bot/core/roles/assigner.py` | Unused by launcher |
| `bot/core/sessions/` | Parallel to `ProfileStore` wizard tables |
| `migrations/profiles/*/001_profile_schema.sql` | Not what `ProfileStore._init_db()` creates |

`bot/launcher.py` always loads `bot/legacy_profiles/...`. Docs say “merged implementation from `bot/legacy_profiles/`”, which is accurate — but the unused packages confuse contributors.

**Suggestion:** Either wire the new modules and delete legacy, or delete/archive the stubs until a real migration is planned. Half-migrated trees are costly.

---

## 4. Wire settings that are loaded but ignored

| Setting | Loaded? | Used? |
|---------|---------|-------|
| `UPDATE_CHECK_HOURS` | Yes | **No** — `@tasks.loop(hours=1)` is hardcoded |
| `UNVERIFIED_ROLE_ID` | Yes | **No** — never assigned/removed |
| `SESSION_TTL_HOURS` | Yes | Partially — confirm wizard expiry uses it everywhere |
| `opencv-python-headless` / `numpy` | In `pyproject.toml` | **Never imported** |

**Suggestions:**

- Drive the update loop from `update_check_hours` (or rename the env var to match reality).
- On join: assign unverified role; on verify: remove it and add verified/member roles.
- Drop unused deps from `pyproject.toml` (OpenCV/numpy add large install cost for nothing).

---

## 5. Don’t store screenshots as base64 in SQLite

Wizard sessions store `screenshot_data` as base64 TEXT. That bloats the DB, slows backups, and risks hitting Discord/SQLite practical limits.

**Suggestion:** Write files under `data/screenshots/{guild}/{user}/{ts}.png` (or object storage) and store only the path. Keep a short TTL for unverified sessions; archive verified screenshots separately if you need audit history.

---

## 6. Nickname patterns: make them configurable

Today nicknames are hardcoded per profile:

| Profile | Pattern |
|---------|---------|
| `stfc_verifier` | `[Tag] Username` |
| `stfc_verifier_alliance` | `[Tag] Username` (same) |
| `veil_security` | `[Server] Tag - Username` |

Neither STFC profile puts **rank** in the nick, even though Commodore/Admiral roles are a first-class feature.

**Suggestion:** Env or DB template, e.g.:

```text
NICKNAME_TEMPLATE={rank_prefix}{player_name}          # single-alliance
NICKNAME_TEMPLATE=[{alliance_tag}] ({rank}) {player_name}  # multi
```

With helpers:

- `rank_prefix` → `[Admiral] ` / `[Commodore] ` / `[Premier] ` / empty for Operative/Agent
- Truncate to Discord’s 32-char nick limit **after** substitution (you already truncate; keep that)
- Re-apply the same template on periodic update when name/rank/tag changes

Also consider: leadership ranks in nicknames should only appear after admin Accept (if you keep rank confirmation), so nick and roles stay consistent.

---

## 7. Rank role lifecycle

Good: on base-rank verify you remove Commodore/Admiral roles; admin confirmation gates leadership roles.

Gaps:

- Periodic update creates a new confirmation on **any** rank change, including Agent ↔ Operative ↔ Premier (all “base”). That can spam admins.
- Rejected leadership confirmation leaves the member on base roles with no clear “pending” state in the DB.
- Premier has no dedicated role ID (only Member / Commodore / Admiral) — fine if intentional; document it.

**Suggestion:** Only open `RankConfirmationView` when crossing into/out of commodore/admiral tiers. Store `pending_rank` on the player row until Accept/Reject.

---

## 8. Rate-limit the hourly player update loop

`update_stfc_players` walks every verified player and hits stfc.pro with no delay. On a large roster this will 429 or look like abuse.

**Suggestion:** Sleep 5–10s between fetches; backoff on 429; optionally stagger by `last_updated` so you only refresh players older than `UPDATE_CHECK_HOURS`.

---

## 9. Clarify profile semantics in the README

From behavior (not names alone):

| `BOT_PROFILE` | Behavior |
|---------------|----------|
| `stfc_verifier` | Multi-alliance style: auto-create Discord roles named after alliance tags (+ `N/A`) |
| `stfc_verifier_alliance` | Same rank/server checks, **no** alliance-tag roles |
| `veil_security` | OPS threshold + server-named roles; no alliance rank roles |

The README calls both STFC profiles “rank-based” without explaining the alliance-role difference. A short comparison table would save operators from picking the wrong profile.

Also: neither profile enforces a **configured home alliance tag** (guest gating). If `stfc_verifier_alliance` is meant for a single-alliance Discord, consider requiring `ALLIANCE_TAG` and assigning a guest/unverified path when the scraped tag does not match.

---

## 10. Schema / store consistency

- `ProfileStore._init_db()` creates `stfc_players`, `wizard_sessions`, etc. via `CREATE TABLE IF NOT EXISTS` + ad-hoc `ALTER TABLE`.
- `migrations/` define different table names (`stfc_verifier_records`, …) that the live store does not use.
- Tuple indexing (`old_data[4]` for rank) is fragile; use `sqlite3.Row` or named dataclasses everywhere.

**Suggestion:** One migration runner applied at startup; store methods return typed objects; drop dead SQL under `migrations/profiles/` or make it the source of truth.

---

## 11. Security / ops nits

- **Player ID uniqueness** (`is_player_id_taken`) is excellent — keep it; add a unique index on `player_id`.
- Wizard screenshots in DMs are good for privacy; posting them to a log channel is fine for audit — document that admins can see them.
- `on_member_remove` deleting verification is good; consider soft-delete + audit row instead of hard delete if you need dispute history.
- Global + guild `tree.sync()` on every startup can hit Discord rate limits; sync guild-only in production or only when command defs change.
- `post_admin_notification` sends to the first writable text channel — prefer a dedicated admin/log channel ID.

---

## 12. Testing gaps

Existing tests cover settings, i18n, launcher, migrations apply, session store. Missing high-value coverage:

- Scraper/API parsing with HTML/JSON fixtures (rank, no-alliance, wrong server)
- `get_rank_tier` / nickname builders
- Rank confirmation Accept/Reject role mutations (mock Member)
- `is_player_id_taken` edge cases

---

## What Merged-Verifier already does well

Worth keeping / highlighting:

- Interactive DM wizard with restart + session restore after bot restart
- Admin Accept/Reject for Commodore/Admiral
- Auto-create alliance tag roles (multi profile)
- `/recall verification` admin revoke + re-invite
- Verification action log table
- i18n (en/de/fr/…) with locale fallback
- `REQUIRE_SCREENSHOT` toggle
- Support channel mention via env (no hardcoded channel IDs in copy)

---

## Architecture note (Cloudflare Workers)

This bot is a long-lived discord.py process with Gateway intents. It will not run as a Cloudflare Worker as-is. That is fine for single-guild VPS/container deploys. If you ever need multi-tenant serverless, you would need Interactions webhooks + a separate Gateway (or polling) for DMs/joins — a different architecture, not a small port.

---

*Review date: 2026-07-10. Based on commit on `main` of ComputerEndProgram/Merged-Verifier at time of clone.*
