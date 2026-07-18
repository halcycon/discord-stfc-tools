# Command reference — single vs multi-alliance

Slash commands for **discord-stfc-tools**, with how each behaves on **`single_alliance`** vs **`multi_alliance`** servers.

Deep setup (roles, channel perms, cron details) lives in [ADMIN_GUIDE.md](./ADMIN_GUIDE.md). Command definitions are registered from `register-command.js`.

**Who can run**

| Who | Typical access |
|-----|----------------|
| Anyone | `/language`, `/lookup`, `/table`, `/tablehelp`, `/verify`, `/player` (after setup) |
| Admin or `/server assistant` roles | Most `/roster` queries |
| Administrator | `/server`, `/channels`, `/diplomacy`, `/survey` creators config, `/exchange` setup, activity setters, set-guest |

---

## Mode overview

| | **single_alliance** | **multi_alliance** |
|--|---------------------|--------------------|
| Who verifies as “member” | Tag matches `alliance_tag` (must be in an alliance) | Any alliance **or no alliance** (no guest gating on tag) |
| Wrong / left alliance | Guest role + demotion policy | No auto-guest for tag change; use `/roster set-guest` |
| Morning roster | One alliance page (`alliance_tag` / `stfc_alliance_id`) | Server directory + scrapes of **tracked** tags (verified tags ∪ diplomacy map), max **40**/run |
| Unlinked roster players | Everyone on that one alliance page | Everyone on **successfully scraped tracked** alliances only |
| Activity streak / days inactive | Same rules; full alliance page each morning | Same rules **per tracked scrape**; untracked / failed / overflow tags skip that day |
| Personal channels | Auto-create + `/channels plan` / `rebalance` | Prefer `/channels link`; **rebalance is blocked** |
| Diplomacy channels | Optional | Primary alliance-channel tool (`/diplomacy`) |
| Resource exchange | Works; same-alliance donors never notified | Best fit (many tags) |

**Tracked tags (multi only):** verified player tags ∪ diplomacy map ∪ `/alliance track` list. Tags not on the server directory list, or past the 40-scrape cap, are **skipped** that morning (audit log notes them).

Switching **single → multi** clears the single-alliance roster cache.

---

## Mode-sensitive cheat sheet

| Feature / command | Single | Multi |
|-------------------|:------:|:-----:|
| `/roster missing-verify` | ✓ full home alliance | ✓ all cached tracked alliances |
| `/roster … include_unlinked` | ✓ home alliance | ✓ tracked caches only |
| `/roster inactive` / activity / set-streak / set-inactive | ✓ | ✓ (same; multi scope = tracked) |
| `/roster alliances` | Usually one tag | Useful (many tags) |
| `/roster set-guest` / demotion automation | Core path | Manual / rare (no auto on tag change) |
| `/channels map` `plan` `rebalance` | ✓ | Rebalance **rejected**; link/status/perms/logs OK |
| `/diplomacy …` | Optional | Recommended |
| `/exchange` | OK | Recommended |
| Guest 6h re-check | ✓ | N/A (no guest-by-tag) |
| Morning “left alliance” from roster absence | ✓ | ✗ (live player-page fallback instead) |

---

## Utility (mode-agnostic)

| Command | Use |
|---------|-----|
| `/language` | Preferred language for bot DMs (en/de/fr/es/pt/nl/pl/it/ru/tr/hu). |
| `/lookup coordinates:` | Parse STFC share strings → system/faction/warp table. |
| `/table` / `/tablehelp` | CSV → ASCII table (inline or `.csv` attachment). |
| `/player name:` | Live stfc.pro lookup (needs `/server setup`). Not mode-specific. |

---

## Verification

| Command | Single | Multi |
|---------|--------|-------|
| `/verify link:` `[screenshot:]` | Must match `alliance_tag` (else guest) or fail per config. Roles, nick, optional personal channel. | Any alliance → active member roles. Nick uses multi default template unless customized. Diplomacy channel may auto-update if enabled. |
| `/server verify user: link:` `[send_welcome:]` | Same outcome as self-verify. Welcome DM **off** by default (`send_welcome:true` to send). | Same. |

Also: Gateway DM flow (invite → language → consent → screenshot → link) follows the same mode rules as `/verify`.

---

## `/server` (Administrator)

| Subcommand | Notes | Single | Multi |
|------------|-------|:------:|:-----:|
| `setup` | `server`, `region`, `mode`, roles, nick template, `nickname_ranks`. `alliance_tag` **required** for single. | ✓ | ✓ (`alliance_tag` cleared) |
| `status` | Config + bot version + roster id hints. | ✓ | ✓ |
| `deploy` | `testing` vs `live`; `preview:true` lists pending invite/welcome DMs. | ✓ | ✓ |
| `demotion` | Leave / mismatch policy (`approval` / `yolo`). | Primary | Empty tags never auto-guest; policy still for missing players if used |
| `assistant` | Roles that may use `/roster` + DM roster Q&A. | ✓ | ✓ |
| `consent` | GDPR Yes/No before verify. | ✓ | ✓ |
| `agreement` | CoC after verify (guest lounge until Agree). | ✓ | ✓ |
| `welcome` | Post-onboarding welcome DM; `send_user` + `force` for manual retry (2-attempt auto cap). | ✓ | ✓ |
| `verify-panel` | `show` / `post` / `mode invite:` / `demotion-notify` — pinned **Start verification**; toggle **Invite DM** on join (`dm`) vs panel-only (`channel_panel`); demotion via DM, channel @mention, or none. Separate from `/server welcome`. | ✓ | ✓ |
| `onboarding` | Show consent / CoC / welcome path and step order. | ✓ | ✓ |
| `verify` | Manual verify; `send_welcome` default **false**. | ✓ | ✓ |
| `exclude-add` / `exclude-remove` / `exclude-list` | Skip bots/alts from invites + unverified stats. | ✓ | ✓ |
| `roles` / `rank-roles` / `bucket` | Role discovery and overlay buckets. | ✓ | ✓ |
| `categories` | List guild categories (helper). | ✓ | ✓ |
| `gateway` | Gateway Durable Object status. | ✓ | ✓ |
| `test-invite` / `test-reset` | Admin testing helpers. | ✓ | ✓ |

---

## `/roster` (Admin or assistant roles; setters = Admin)

List subcommands (`grade`, `ops`, `rank`, `inactive`, `missing-verify`) share options where noted:

- `sort:` — ops / name / streak / inactive / grade (as allowed)
- `format:` — `table` (default) or `list`
- `visibility:` — `private` (default) or `public`
- `include_unlinked:` — default **true** (alliance-cache rows with no Discord link → **DC=no**, status `unlinked`)
- `page:` — or use Prev/Next buttons; private replies get **Post to channel**

| Subcommand | What it does | Single | Multi |
|------------|--------------|--------|-------|
| `grades` / `grade` | Ops grade G3–G7 counts / lists. | Verified (+ unlinked if included). | Same; unlinked only from tracked caches. |
| `ops` | Ops level range. | Same. | Same. |
| `ranks` / `rank` | In-game alliance rank. | Same. | Same (more tag diversity). |
| `inactive` | `min_days:` (default 1) — days inactive ≥ N. | Linked + unlinked on home alliance. | Linked + unlinked on tracked caches. |
| `activity` | Show streak + inactive. `user:` (default you) **or** `player:` (name/id). | ✓ | ✓ |
| `set-streak` / `set-inactive` | Admin backfill. `value:` + `user:` **or** `player:`. Near-miss names → **Did you mean?** Yes/No. Updates Discord row and/or alliance cache. | ✓ | ✓ |
| `missing-verify` | Alliance-cache players with no Discord link. | Home alliance after morning scrape. | All tracked caches after morning scrape. |
| `/alliance track|suggest|list|untrack` | — | — | Track+scrape now; nick-based link suggestions |
| `unverified` | Discord members with no STFC link (paginated table + Prev/Next). Optional `format:` / `visibility:` / `set_guest:true` (Admin). | ✓ | ✓ |
| `set-guest` | Force guest (Admin). Blocked in deploy **testing**. | Common. | Manual only when needed. |
| `status` | Counts by verification status. | ✓ | ✓ |
| `alliances` | Counts by alliance tag. | Usually one row. | Breakdown across tags. |

---

## `/channels` (Administrator) — personal channels + staff logs

| Subcommand | Single | Multi |
|------------|--------|-------|
| `map` / `plan` / `rebalance` | Letter-bucket personal channels; `rebalance apply:true` creates/moves. | **`rebalance` errors** — not supported. Use `link` for existing channels. |
| `extra-roles` | Staff access on personal channels. | Same if you still use personal channels. |
| `link` | Adopt existing channel → player (`player:` or `user:`). | Preferred way to attach member channels. |
| `status` | Show map / template / diplomacy summary. | ✓ |
| `permissions-audit` | Read-only overwrite dump. | ✓ |
| `permissions-apply` | Bulk-add bot/role/extra/template overwrites (dry-run default). | ✓ |
| `permissions-template-from` / `show` / `clear` | Lock sample perms for creates/links. | ✓ |
| `log` / `audit` / `urgent` | Verification archive, bot audit, high-signal alerts. | ✓ (same) |

---

## `/alliance` (Administrator) — multi only

| Subcommand | Notes |
|------------|-------|
| `track` | `tag:` and/or `alliance_id:` — scrape HTML now, store roster, add to morning tracked set |
| `suggest` | Optional `tag:` — table of matches + **Approve 🟢/🟡/🟠** per confidence, individual **#** buttons, **Continue** |
| `list` | Explicit + diplomacy + combined tracked tags |
| `untrack` | Remove from explicit list (diplomacy/verified tags still track) |

**Group Approve** (per confidence) always chunks + **Continue**. Free default **2**/click, Paid **6**/click, hard max **10**/click — see [ADMIN_GUIDE — Approve-all chunking](./ADMIN_GUIDE.md#approve-all-chunking-workers-free-vs-paid).

---

## `/diplomacy` (Administrator)

Designed for **multi_alliance** (works if enabled on single, but less common).

| Action | Use |
|--------|-----|
| `enable:` / `disable:` + view/write roles, `write_ranks:`, `name_template:` | Config |
| `gaps:true` | Diff tracked/verified tags vs diplomacy channel map |
| `create_tag:` / `link_tag:` + `channel:` `[languages:]` | One alliance channel; optional preferred langs → flag emoji suffix on name |
| `special:create\|link\|clear` + `special_name` / `special_placement` | Non-listed alliances room (special category or top of first bucket) |
| `sync_all:` `[plan:]` `[create_missing:]` … | Letter-bucket categories, rename/move, archive unlinked |

**Side effect for activity/unlinked:** tags on the diplomacy map are **morning-tracked** even with zero Discord members — so you can watch inactive/unlinked for that alliance.

---

## `/survey` & `/exchange`

| Area | Mode notes |
|------|------------|
| `/survey create` … `list` `results` `close` `creators` | Verified Discord players only. Optional `title:`, `closes_in:` (e.g. `48h`), `alliance_tags:`. Delivery: DM or personal channel. Log channels default `{id}-{title}`. |
| `/exchange setup` / `resource` / `donate` / `undonate` / `need` | Cross-alliance matching; **same-alliance donors never notified**. Natural fit for multi. |

---

## `/test-dm` (Administrator)

Preview invite / consent / agreement / welcome / demote DMs to yourself or `user:` without changing live onboarding state. Mode-agnostic; demote previews matter more on single.

---

## Background jobs (not slash commands)

| Schedule | Single | Multi |
|----------|--------|-------|
| Morning (~06:00) alliance roster | Scrape home alliance; activity for all members; leave candidates if absent | Directory + tracked scrapes; activity for scraped members; absent verified → live lookup (not auto-guest) |
| Morning player sync | Prefer roster; update roles/nicks; activity on `verified_players` | Same from roster map; tag/rank changes update nick/roles, not guest |
| Morning activity audit | Became inactive / returned / still ≥3d | Same |
| Every 6h guest re-check | Promote guests who appear on roster | Skipped / N/A for tag guests |
| Every 5m | Gateway wake + member-poll fallback | Same |

---

## Typical setups

### Single-alliance checklist

1. `/server setup mode:single_alliance alliance_tag:… guest_role:… member_roles:…`
2. `/channels audit` (+ log/urgent) · optional personal `map` / `rebalance`
3. `/server deploy mode:testing` → morning dry-run → `mode:live`
4. `/roster missing-verify` · `/roster inactive` for ops

### Multi-alliance checklist

1. `/server setup mode:multi_alliance …` (no `alliance_tag`)
2. `/alliance track tag:…` for alliances you care about (or `/diplomacy enable:true` · create/link tags)
3. `/alliance suggest` · `/roster missing-verify` for onboarding
3. `/channels link` for personal channels as needed (skip rebalance)
4. Optional `/exchange setup`
5. `/roster alliances` · `/roster missing-verify` · `/roster inactive` across tracked tags

---

## Related docs

| Doc | Contents |
|-----|----------|
| [ADMIN_GUIDE.md](./ADMIN_GUIDE.md) | Full admin how-to (roles, perms, activity, demotion, channels) |
| [VERSION_HISTORY.md](../VERSION_HISTORY.md) | Release changelog |
| [AGENTS.md](../AGENTS.md) | Architecture for contributors |
