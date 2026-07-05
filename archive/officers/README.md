# Archived officer lookup feature

This directory holds the **incomplete officer lookup** feature removed from the main bot (Jul 2026). It was never finished (stale D1 data, unused rank option, ~14 MB of portrait assets) and is unrelated to alliance verification.

## Contents

| Path | Description |
|------|-------------|
| `src/` | `officerUtilsD1.ts`, legacy `officerUtils.ts`, `officerData.ts`, `abilityDescriptions.ts` |
| `public/` | Officer portrait and ability icon PNGs (~14 MB) |
| `scripts/` | Spocks Club fetch scripts, D1 migration generator, `load-d1-data.sh` |
| `sql/` | Officer D1 schema and 18 bulk migration batches |
| `docs/` | `SYSTEM_COMPLETE.md`, `DATA_STRUCTURE_SUMMARY.md`, `ABILITY_ICONS_REPORT.md` |
| `data/` | Ability analysis JSON |
| `tests/` | Ad-hoc officer test scripts |

## Reviving as a separate worker

1. Create a new Cloudflare Worker project (e.g. `stfc-officer-tools`).
2. Copy `src/officerUtilsD1.ts` and register `/officer` command.
3. Use a dedicated D1 database for officer reference tables.
4. Deploy `public/officers` and `public/abilities` as Workers Assets.
5. Run scripts from `scripts/` to refresh data from [api.spocks.club](https://api.spocks.club).

The main bot (`discord-stfc-tools`) uses D1 binding **`STFC_DB`** (Cloudflare database name `stfc-officers`) for **guild/player state only**. Legacy officer tables may still exist in that database but are unused.
