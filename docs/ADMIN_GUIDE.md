# Discord admin guide — STFC Tools

How to configure the bot **inside Discord** after it is deployed. For Cloudflare/Worker install steps, see [SETUP.md](../SETUP.md).

**Slash command catalogue (single vs multi-alliance):** [COMMANDS.md](./COMMANDS.md)

**Admin web UI (optional):** [ADMIN_WEB.md](./ADMIN_WEB.md) — Discord OAuth dashboard on Cloudflare Pages (`admin-web/`). Public **Privacy** (`/privacy`) and **Terms** (`/terms`) for app verification. New-bot cutover: [BOT_MIGRATION.md](./BOT_MIGRATION.md).

Release versions (MAJOR.MINOR.INCREMENTAL) are listed in [VERSION_HISTORY.md](../VERSION_HISTORY.md). `/server status` shows the running bot version.

You need the **Administrator** permission in the Discord server for `/server` commands.

---

## Before you start

1. Invite the bot with: **Manage Roles**, **Manage Channels**, **Manage Nicknames**, **Send Messages**, **Attach Files**, **Embed Links**.
2. Raise the bot in the **role hierarchy** (see below) — required for role assign and nicknames.
3. The bot **cannot rename the server owner** (Discord limitation). Nicknames still work for other members.
4. Members must allow DMs from server members for the join/DM verification flow.

Confirm the bot is live:

```
/server gateway
/server status
```

### Role hierarchy (drag the bot up)

Discord only lets a bot **grant or remove roles that sit below its own role** in the list. If verify fails with `Missing Permissions` / `50013` on a `/roles/…` URL, the bot is almost always too low — **not** missing Administrator.

1. Open the server → **Server Settings** (gear) → **Roles**.
2. Find the role that belongs to the bot (usually named like the bot / application, e.g. `STFC Tools`).  
   - Tip: open the bot’s member profile → **Roles** to see which role it has.
3. **Drag that role upward** so it sits **above**:
   - `@Member` / guest / every rank role (`Premier`, `Commodore`, …)
   - every **overlay bucket** role (`Leadership`, etc.)
   - roles you expect the bot to edit on normal members  
   Higher in the list = higher in the hierarchy (closer to the top / Administrator).
4. Leave **Administrator** (human admins) and any roles you do **not** want the bot to manage **above** the bot if you prefer — the bot only needs to sit above roles it **assigns**.
5. Confirm the bot role still has **Manage Roles** (and **Manage Nicknames** if you use nicks).
6. Retry `/server verify` (or have the member re-verify).

**Do you need Administrator on the bot?** No. Hierarchy + Manage Roles is enough. Administrator is a blunt workaround and is broader than necessary.

**Admins verifying themselves:** your personal admin roles are often near the top. The bot must still be above every **STFC role it assigns**. It does not need to outrank your personal `Admin` role unless that role is also in `member_roles` / buckets.

Check role IDs mentioned in audit errors with:

```
/server roles
```

---

## 1. Core setup — `/server setup`

Run once (or again to change settings):

```
/server setup
  server:42
  region:US
  mode:single_alliance
  alliance_tag:ABCD
  guest_role:@Guest
  member_roles:@Member
  create_missing_roles:true
  operative_roles:@Operative
  agent_roles:@Agent
  premier_roles:@Premier
  commodore_roles:@Commodore
  admiral_roles:@Admiral
  nickname_template:
```

| Option | Required | Description |
|--------|----------|-------------|
| `server` | Yes | STFC server number |
| `region` | No | `US` or `EU` (default US) |
| `mode` | No | `single_alliance` or `multi_alliance` |
| `alliance_tag` | Yes if single | Expected alliance tag; mismatches get guest role |
| `guest_role` | No | Role for wrong-alliance / guest members |
| `member_roles` | No | Base roles granted when alliance matches |
| `create_missing_roles` | No | Create roles by name if they do not exist |
| `operative_roles` … `admiral_roles` | No | Extra roles by in-game alliance rank |
| `nickname_template` | No | Nick pattern (see below). Empty = mode default |

Role fields accept **IDs**, **@mentions**, or **names** (with `create_missing_roles`).

### Modes

| Mode | Behaviour |
|------|-----------|
| `single_alliance` | Tag must match `alliance_tag`. Else guest role + periodic re-check. Personal channels can auto-create. **Morning alliance roster** caches the full member list for daily sync + verify (see § Daily alliance roster). |
| `multi_alliance` | Any alliance **or no alliance** verifies as active. No guest gating. Unaffiliated players get member roles only (no Premier/Operative/etc. rank). Personal auto-create is off (link existing channels instead). **Morning multi roster**: scrape set = verified tags ∪ diplomacy map ∪ `/alliance track`; day-over-day moves report; live player-page fallback when not on a scraped roster (no demotion). Diplomacy auto-create on verify/sync is intentional — see §4d caveats. Switching from single → multi clears the single-alliance roster cache. |

Check config anytime:

```
/server status
```

---

## 2. Nicknames

On verify (and daily sync), the bot sets the member’s nick from a template.

### Defaults (when `nickname_template` is unset)

| Mode | Pattern | Example |
|------|---------|---------|
| Single alliance | `{rank_prefix}{player_name}` | `[Adm] ExamplePlayer` or `ExamplePlayer` |
| Multi alliance | `[{alliance_tag}]{rank_paren} {player_name}` | `[ABCD] (Adm) ExamplePlayer` |

`{rank_prefix}` is `[Pr] ` / `[Com] ` / `[Adm] ` only (empty for Op/Ag), and only when that rank is in **nickname ranks**.  
`{rank_paren}` is ` (Adm)` / … when rank is known **and** allowed by nickname ranks.

### Nickname ranks (which ranks appear)

By default all five ranks can appear in `{rank}` / `{rank_paren}` (leadership only for `{rank_prefix}`). Restrict with:

```
/server setup … nickname_ranks:Commodore,Admiral
```

Abbrevs work too (`Adm,Com`). Empty / omit = all ranks. Also on `/server status` and admin web Config.

### Custom template

```
/server setup … nickname_template:[{alliance_tag}] {player_name}
```

| Placeholder | Meaning |
|-------------|---------|
| `{player_name}` | In-game name |
| `{alliance_tag}` | Alliance tag (no brackets) |
| `{rank}` | Abbreviated rank (`Adm`/`Com`/`Pr`/`Op`/`Ag`) when allowed |
| `{rank_prefix}` | `[Adm] ` style for leadership ranks when allowed |
| `{rank_paren}` | ` (Adm)` when rank known and allowed |

Nicks are truncated to Discord’s **32** character limit.

---

## 3. Rank roles and overlay buckets

On verify (and daily sync), an **active** member receives the **union** of:

1. `member_roles` (everyone who matches the alliance)
2. The matching per-rank list (`premier_roles`, `admiral_roles`, …)
3. Every **overlay bucket** whose `ranks` list includes their in-game rank

Guests only get `guest_role` (member/rank/bucket roles are removed).

### Per-rank roles

Set on `/server setup` (`operative_roles`, `agent_roles`, `premier_roles`, `commodore_roles`, `admiral_roles`). Use these for roles that belong to **one** rank only (e.g. `@Premier`).

Preview the resolved set without changing anything:

```
/server rank-roles rank:Premier
/server rank-roles rank:Admiral
```

List Discord role names → IDs:

```
/server roles
/server roles limit:50
```

Role fields accept **IDs**, **@mentions**, or **exact role names** (comma-separated). Prefer `@mention` or ID when matching an existing layout so renames do not create duplicates.

### Overlay buckets (shared roles across ranks)

A **bucket** is a named overlay: “these Discord roles go to anyone whose in-game rank is in this list.” Typical use: Leadership / Officer / Diplomat shared by Premier+Commodore+Admiral.

| Option | Required | Meaning |
|--------|----------|---------|
| `name` | Yes | Bucket key (e.g. `leadership`). Re-running the same name **replaces** that bucket. |
| `ranks` | Yes | Comma-separated: `Operative`, `Agent`, `Premier`, `Commodore`, `Admiral` |
| `role_ids` | No* | Discord roles to grant (IDs, mentions, or names). Omit / empty → **clears** the bucket. |
| `create_if_missing` | No | `true` = create roles by name if missing. Leave **false/off** when linking existing roles. |

\*Omitting `role_ids` (or passing nothing resolvable) deletes the bucket named in `name`.

#### Matching an existing Discord layout (recommended)

If Leadership (and friends) **already exist** in Server Settings → Roles:

1. Run `/server setup` with **only** the per-rank roles (`@Premier`, `@Commodore`, …) — **not** Leadership in every rank list.
2. Discover IDs if needed: `/server roles`.
3. Point the bucket at the existing roles — **do not** set `create_if_missing`:

```
/server bucket name:leadership ranks:Premier,Commodore,Admiral role_ids:@Leadership
```

Multiple shared roles in one bucket:

```
/server bucket name:leadership ranks:Premier,Commodore,Admiral role_ids:@Leadership,@Officer,@Diplomat
```

Several independent buckets are fine (each has its own `name`):

```
/server bucket name:leadership ranks:Premier,Commodore,Admiral role_ids:@Leadership
/server bucket name:diplomats ranks:Commodore,Admiral role_ids:@Diplomat
```

4. Confirm: `/server rank-roles rank:Premier` should list `@Premier` **and** everything from buckets that include Premier.
5. Existing verified members pick up bucket changes on the **next daily sync**, or after re-verify / `/server verify`.

#### Creating roles from scratch

```
/server bucket name:leadership ranks:Premier,Commodore,Admiral role_ids:Leadership,Officer create_if_missing:true
```

Only use `create_if_missing:true` when the names are new. If a role already exists under that name, the bot reuses it.

#### Update / clear

```
# Change ranks or roles (same name overwrites)
/server bucket name:leadership ranks:Commodore,Admiral role_ids:@Leadership

# Remove the bucket entirely (keep ranks arg; omit role_ids)
/server bucket name:leadership ranks:Premier,Commodore,Admiral
```

#### Setup vs bucket — what goes where?

| Role | Put it in… |
|------|------------|
| `@Member` (all alliance matches) | `/server setup` → `member_roles` |
| `@Premier` / `@Commodore` / … (one rank) | `/server setup` → `premier_roles` etc. |
| `@Leadership` shared by several ranks | `/server bucket` |
| `@Guest` | `/server setup` → `guest_role` |

Do **not** paste `@Leadership` into `premier_roles`, `commodore_roles`, and `admiral_roles` unless you want to maintain that duplication by hand — the bucket is the single source of truth for shared overlays.

---

## 3b. Player language (i18n)

Player-facing **DMs** (and survey delivery) are localized. On first bot contact (join invite), members get a **language picker**. They can change later with:

```
/language
```

Stored per Discord user on `verified_players.preferred_locale`.

Supported: English, Deutsch, Français, Español, Português, Nederlands, Polski, Italiano, Русский, Türkçe, Magyar.

Admin ephemeral replies and shared channel pins (e.g. exchange hub) stay in English for now.

---

## 4. Verification log channel (admin archive)

Posts a **summary + screenshot** to a staff-only channel on each successful verify (active or guest). Screenshots are still stored in R2 when configured; the log channel is for day-to-day review without digging in storage.

This is **separate** from the general [bot audit log](#4b-bot-audit-log-admin--automated-actions).

### Create a private log channel

```
/channels log create:true
```

Optional: `name:verification-archive`

Permissions applied:

- `@everyone` — cannot view
- Bot — can view / send / attach
- Roles from `/channels extra-roles` — can view / send

### Use an existing staff channel

```
/channels log channel:#staff-verify-log
```

Ensure the bot can **View Channel**, **Send Messages**, **Embed Links**, and **Attach Files** there.

### Disable

```
/channels log clear:true
```

---

## 4b. Bot audit log (admin + automated actions)

A staff-only channel for **everything the bot does** besides verification screenshots: admin commands, role/channel changes, cron sync summaries, invites, etc.

```
/channels audit create:true
```

Optional: `name:bot-audit-log`

Or link an existing channel:

```
/channels audit channel:#staff-bot-audit
```

Disable:

```
/channels audit clear:true
```

Same private-channel permission pattern as the verification log (`@everyone` denied; bot + `/channels extra-roles` can view). Prefer setting **extra-roles** first so viewers are included on create.

Logged events include (non-exhaustive): `/server setup`, verify (brief — screenshots stay on the verification log), guest invites, personal-channel map/rebalance/link, diplomacy config, surveys sent/closed, exchange setup, daily sync / guest re-check summaries, **morning alliance roster change report** (joins / leaves / ops / rank / renames), **batched** morning **Player activity** + **Player sync — daily updates** tables (welcome DM sent/failed, status/role/channel changes — not one embed per player).

---

## 4c. Urgent alerts (action needed)

Optional high-signal channel for events that need an admin to notice quickly — **not** the full audit trail. Today this includes **verification DM blocked (403)** when a member’s privacy settings prevent bot DMs.

```
/channels urgent create:true
```

Optional: `name:bot-urgent`

Or link an existing channel:

```
/channels urgent channel:#staff-urgent
```

Disable:

```
/channels urgent clear:true
```

Same private-channel pattern as audit/log (`@everyone` denied; bot + `/channels extra-roles` can view). Prefer setting **extra-roles** first.

Urgent posts use a short Badgey-style message so they stand out from routine audit embeds. The same event is still written to the audit log when configured.

---

## Player activity (streak + days inactive)

stfc.pro exposes **`consecutive_days_active`** on alliance/player pages:

| Value | Meaning |
|-------|---------|
| `> 0` | Current login streak (days) |
| `0` | No current streak (hasn’t logged in within the game’s “active day” window) |

Each morning sync (`0 6 * * *`), for every verified player we successfully look up:

1. Store **activity streak** = that value.
2. If streak `> 0` → set **days inactive** = `0`.
3. If streak `=== 0` → increment **days inactive** by 1 (or set to 1 on the first zero day).

We **do not** change counters when a scrape/lookup fails or omits the field. Streak is read from the **alliance roster HTML** (`consecutive_days_active` on each member row) during the morning sync — for **everyone** on the alliance page (Discord-linked or not). `days_inactive` increments on that same morning scrape when streak is `0`. Individual player pages are only a fallback for linked players missing from the cache.

### Commands

```
/roster inactive min_days:3     # inactive ≥ N days (linked + unlinked; default 1)
/roster activity user:@Name     # show streak + days inactive
/roster activity player:Name    # same for alliance / unlinked (name or STFC id)
/roster set-streak user:@Name value:12   # admin: set streak (value>0 clears inactive)
/roster set-streak player:Name value:12  # admin: unlinked OK; typos → Did you mean? buttons
/roster set-inactive user:@Name value:5  # admin: set days inactive (value>0 clears streak)
/roster set-inactive player:12345 value:5
```

Use either `user:` or `player:` (not both). Exact name/id applies immediately. A near miss shows **Did you mean?** with **Yes, use this player** / **No**.

Roster list lines (ops/grade/rank/inactive) also show `streak N` / `inactive Nd` when known.

### Audit reports

Morning cron posts **Player activity — streak / inactive** (ASCII table sections) when anyone:

- **Became inactive** (streak hit 0)
- **Returned active** (streak returned after inactive days)
- **Still inactive ≥3d** (ongoing)

### Storage

`verified_players.activity_streak`, `days_inactive`, `activity_updated_at`  
`alliance_roster_members.activity_streak`, `days_inactive` (same morning scrape; used for unlinked roster lists)  
Cached on `alliance_roster_members.activity_streak` for roster-driven sync.

---

New guilds start in **testing** after `/server setup`. Existing guilds stay **live** unless you switch.

| Mode | Behavior |
|------|----------|
| **testing** | Slash replies prefixed `[TESTING]`. Automated demotions / leave queues are **dry-run**. **No outbound DMs** (invites, welcome, CoC, etc.) — preview only via `/test-dm` to yourself or a nominated user. Manual `/roster set-guest` blocked. |
| **live** | Full automation (demotions follow `/server demotion` policy; invite/welcome DMs resume). |

Activity streak / days inactive still update in testing (non-destructive counters) so you can validate the morning report before go-live.

```
/server deploy                 # show current mode + go-live DM preview
/server deploy preview:true    # litmus test only (who would get invite/welcome DMs)
/server deploy mode:testing    # safe setup
/server deploy mode:live       # go live (reply includes pending DM backlog)
```

**Go-live DM litmus test:** while in **testing**, members are still recorded but invites are not sent (`verification_invited_at` stays null). `/server deploy` (or `preview:true`) lists:

| Pending DM | When it fires after live |
|------------|--------------------------|
| Verification invites | Next member poll (≤5 minutes) |
| Welcome DMs | Same member poll (≤5 minutes; up to 40 per poll if the backlog is large). Morning sync still retries leftovers. |

CoC / consent DMs are **not** a go-live backlog (they fire on verify/join flows). Already verified/guest members and the exclude list are skipped for invites.

Shown on `/server status`.

---

## 4d. Daily alliance roster

Each morning (`~06:00 UTC`, cron `0 6 * * *`) the bot refreshes alliance member lists from stfc.pro HTML pages, posts a day-over-day report to the **audit** channel, then syncs verified Discord players from that cache (with live player-page fallbacks when needed).

### Single-alliance

1. Fetches your one alliance page (`/alliances/{id}`).
2. Compares to **yesterday’s** cached roster.
3. Posts joins / leaves / ops / rank / renames.
4. Updates verified members from the cache; **missing** from roster → leave / wrong-alliance candidates (leave-detection policy).

### Multi-alliance

1. Fetches the server alliance directory (`/servers/{n}`).
2. Builds the **morning scrape set** = verified players’ current tags ∪ diplomacy channel map ∪ `/alliance track` list.
3. Scrapes those alliance pages in a **batch** (cap ~40/run, ~1.2s between pages).
4. Posts a multi report: **alliance moves**, joined/left tracked rosters, ops / rank / renames.
5. Syncs verified players from those caches. If a player isn’t on any scraped roster (new/empty/untracked tag) → **live player page**. Guests without a player id are skipped.
6. Posts a second audit digest for **verified** Discord members who changed alliance and/or Discord roles/rank overlays.

| Section | Meaning |
|---------|---------|
| **Alliance moves** | Same player id, different alliance tag (multi) |
| **Joined / Left tracked roster** | Appeared on / disappeared from a scraped alliance |
| **Ops up / down** | Same player id, ops level changed |
| **Rank changes** | Same player id, alliance rank string changed |
| **Renames** | Same player id, in-game name changed |

First successful roster for a guild is an **initial snapshot** (no join spam). Unchanged days get a short “no changes” note.

Change sections (joins, leaves, moves, ops, rank, renames) and the morning **Player activity** audit render as **compact ASCII tables** in code fences (same engine as `/table`). Player **names** appear in the table — Discord mentions do not render inside fences.

#### Multi-alliance: scrape set vs “tracked” vs diplomacy (read this)

These are easy to conflate. They are **not** the same list:

| Concept | What it is | How tags get on it |
|---------|------------|--------------------|
| **Morning scrape set** | Alliance pages scraped for cache + day-over-day report | Verified players’ **current** tags ∪ diplomacy map ∪ `/alliance track` |
| **Explicit track list** (`/alliance track`) | Configured admin list kept in morning sync | **Only** `/alliance track` — never auto-added by cron/verify |
| **Diplomacy map** | Tags that already have a diplomacy channel | `/diplomacy` / `/alliance track` (when diplomacy enabled), **and** auto-create on verify/sync (see below) |

**Implications for admins:**

1. **“Left tracked roster”** means the player disappeared from an alliance page that was scraped that morning. On multi they are **not** demoted (unlike single-alliance). The cron still syncs them via their **individual** stfc.pro profile (`/players/{id}`). They may still be in-game in another alliance.
2. After a live sync updates their tag to e.g. `[XYZ]`, **`XYZ` enters tomorrow’s scrape set** (because verified tags are included). That does **not** add `XYZ` to the explicit `/alliance track` list by itself.
3. **Diplomacy auto-create (intended):** when diplomacy is enabled, verify and daily sync call ensure-diplomacy for the player’s current tag. Creating that channel **writes the tag into the diplomacy map**, which then keeps it in the scrape set. So a member joining (or moving to) a new alliance can create a diplomacy channel and permanently pull that tag into morning scrapes — unless you use deferral (next point).
4. **`/alliance defer-untracked-admirals enabled:true`:** Admirals whose tag is **not** on the explicit track list ∪ diplomacy map get member roles only (no Admiral/overlay roles). Diplomacy for those tags is also deferred until you `/alliance track` (or otherwise put the tag on the diplomacy map). Use this if you do **not** want random new alliances to spawn diplomacy channels / Admiral roles on first verify.
5. **`/alliance untrack`** only removes a tag from the **explicit** list. It does not remove an existing diplomacy channel or stop scraping a tag that still appears on verified players or the diplomacy map. Check `/alliance list` for explicit vs combined.

### Requirements

- Mode: **`single_alliance`** with `alliance_tag`, or **`multi_alliance`** with at least one tag in the scrape set (verified players, diplomacy map, and/or `/alliance track`).
- Audit channel configured (`/channels audit`).
- Single-alliance: `stfc_alliance_id` (shown on `/server status`; auto-discovered from a verified profile if missing).

### Multi-alliance: track + link suggestions

```
/alliance track tag:ABCD                    # scrape now into D1 + keep in morning sync (+ diplomacy if enabled)
/alliance resync                            # re-scrape tracked rosters now + remap tag renames / diplomacy
/alliance suggest tag:ABCD                  # match unverified Discord nicks → roster
/alliance list                              # explicit + diplomacy + combined scrape tags
/alliance untrack tag:ABCD                  # drop from explicit list only
/alliance defer-untracked-admirals enabled:true   # optional: defer Admiral roles + diplomacy until track
```

Unlinked STFC players stay in the alliance roster cache (`/roster missing-verify`). Suggestions prefer nicks like `[TAG] Name` / `[TAG] (Adm) Name`. The suggest reply shows an **ASCII table** of all matches (H/M/L), then:

- **Approve 🟢 / 🟡 / 🟠** — batch-approve that confidence tier (chunked; **Continue** if more remain)
- **# ✓ Name** — approve a single table row
- Or `/server verify user:@Them link:https://stfc.pro/players/ID`

Discord allows only five button rows, so individual buttons cover the first **20** rows; use the group Approves for the rest. Mentions do not render inside the table (names are shown instead).

#### Approve-all chunking (Workers Free vs Paid)

Group Approve **always** uses the same pattern: process a small batch with live progress edits, then show **Continue** if that confidence tier still has matches. Only the **chunk size** differs by plan.

Why chunk on Paid too? Each link does several Discord API calls (roles, nick, channels, audit). Even with Paid’s higher CPU/subrequest caps, a single interaction still hits ~**30s `waitUntil`** — in practice batches die around **~10** approvals mid-run. So Paid is not “do all 30 at once”; it is “same Continue flow, larger chunks.”

| Setting | Default chunk | Behaviour |
|---------|---------------|-----------|
| `WORKERS_PLAN=free` (default) | **2** links / click | Safer under Free’s **50 subrequests** / request |
| `WORKERS_PLAN=paid` | **6** links / click | Same Continue flow; stays under the ~10 cliff |
| `ALLIANCE_APPROVE_CHUNK=N` | override (**1–10** max) | Free struggling → try `1`. Do not set above 10 |

Set in `.env`, then `npm run push-env && npm run deploy`. The suggest message footer shows the active chunk size and plan. Progress updates appear after each link in the current batch (`this batch: N / M`).

**Single Approve** always processes one link (works on Free and Paid).

### Verify / guests

- Fresh roster (≤36h) hit → use cache; else live lookup.
- Guest re-check every 6 hours prefers the roster before a live lookup (single-alliance guest path).
- List roster members with no Discord link: `/roster missing-verify` (works for multi across all tracked caches).

---

## 5. Personal / member channels

### Permissions (set this first)

Before creating or linking member channels, configure which Discord roles can see **every** personal channel (officers, diplomats, etc.):

```
/channels extra-roles roles:@Officer,@Diplomat
```

This attaches those roles to the **built-in default** permission template (same allow bits as the member). No sample channel lock required — confirm with `/channels permissions-template-show`. Clear with an empty `roles:` value.

This is **not** part of `/server setup` — it is required for personal channels.

When the bot creates a channel, updates one on verify, or links with `apply_permissions` left on (default), it applies:

| Target | Access |
|--------|--------|
| **Bot** (first) | **Role** overwrite for the bot’s managed guild role (shows under Roles like Carl-bot): View, Send, Embed, Attach, Read History, Manage Channels, Manage Permissions, **Administrator**. A prior bot *member* overwrite on the same id is cleared so Discord does not keep the bot under Members. |
| `@everyone` | Deny View Channel |
| The member | View, Send, Embed Links, Attach Files, Read History |
| Extra-roles | Same as the member |

The bot overwrite is applied **before** denying `@everyone`, so the bot never locks itself out. Newly created channels include these overwrites at create time.

If linking an **existing** private channel fails on permissions, give the bot **View Channel** (and **Manage Channels**) on that channel or its category, then retry — or use `apply_permissions:false` and add the bot overwrite manually.

**Do not “Sync now” from the category** onto existing member channels if those channels already have per-member allows — Discord sync will wipe individual overwrites. Prefer:

1. Add the bot on the **category** and choose **not** to sync to children, **or**
2. Add the bot overwrite on each channel you care about, **or**
3. Use `/channels link … apply_permissions:true` once the bot can see the channel (rewrites that channel only).

### Audit existing permissions (read-only)

Before changing anything, dump what Discord currently has on linked channels + channels under your member categories:

```
/channels permissions-audit
```

- Does **not** sync or rewrite permissions
- Ephemeral summary with flags (`bot_missing_view`, `linked_member_no_overwrite`, …)
- Full text dump attached to `/channels audit` when that channel is set (keep this as your record)

### Bulk-add overwrites (bot / roles / buckets)

Add or refresh **one target’s** overwrite across many linked channels **without** wiping per-member allows (safe for new-bot migration and staff role rollouts).

```
/channels permissions-apply target:bot
/channels permissions-apply target:bot scope:all dry_run:false
/channels permissions-apply target:role role:@Leadership preset:member dry_run:false
/channels permissions-apply target:extra_roles scope:personal dry_run:false
/channels permissions-apply target:template_roles dry_run:false
```

| Option | Notes |
|--------|--------|
| `target` | `bot` · `role` (+ `role:`) · `extra_roles` · `template_roles` |
| `scope` | `personal` (default) · `diplomacy` · `staff_logs` · `survey_logs` · `all` |
| `preset` | `bot` (full bot bits) · `member` (view/send set) · `view_send` (lighter) |
| `dry_run` | Default **true** — preview; set `false` to apply |
| `only_missing` | Default **true** — skip if target already has View |

Posts a detail file to the audit log channel when configured. See also [BOT_MIGRATION.md](./BOT_MIGRATION.md) § channel overwrites.

### Lock a permission template from a sample channel (optional)

You do **not** need this if the built-in default + `/channels extra-roles` is enough.

Once you find a member channel whose overwrites look right (bot can post, member + staff roles correct):

```
/channels permissions-template-from channel:#good-example
```

Optional: `member:@Owner` if the channel isn’t linked yet; `sync_extra_roles:false` to leave `/channels extra-roles` unchanged (default **true** copies role overwrites into extra-roles).

If a locked template already lists role overwrites, those take precedence for personal channels; extra-roles still apply to log/audit/urgent channels.

```
/channels permissions-template-show
/channels permissions-template-clear
```

Locked templates are used for **new** personal channels and for `/channels link` / verify when `apply_permissions` is on. Existing channels are not rewritten until you link/re-apply.

Do this **before** `/channels rebalance … create_missing:true` or bulk `/channels link`, so new and rewritten channels get the right access. Changing extra-roles later does **not** rewrite existing channels until the next create/update/link that applies permissions.

### Auto-create (single-alliance)

Buckets use the **first letter** of the in-game name (`A`–`Z`). Names starting with a digit or symbol go in `#` (non-alphabetic), always at the end of the alphabet (e.g. range `N-#`).

**Recommended:** let the bot plan and apply categories (handles Discord’s ~50 channels/category limit):

```
/channels plan
/channels rebalance apply:true create_missing:true
```

That creates/renames categories like `Member Channels A-M` / `Member Channels N-#`, updates the map, moves linked member channels, creates missing ones (if `create_missing`), and archives unlinked ones.

Large servers take a while: the command shows **progress** on the slash reply, posts **started** + **finished** (or failed) to the audit log, and saves the category map as soon as categories exist so a retry can continue. Re-running `apply:true` **reuses** mapped categories (renames ranges in place, creates only extra buckets). If the map was empty after a crash, it also **adopts existing categories by matching name** (e.g. `Member Channels A-L`) instead of creating duplicates. Archive scans the current map, the previous map, and leftover `Member Channels *` categories so unlinked channels left behind by a partial run still get moved.

The planner splits **fairly evenly** under the soft limit (50 players → two ~25 buckets, not 45+5). Re-run when occupancy nears the limit (`/channels status` shows counts).

| Option | Default | Description |
|--------|---------|-------------|
| `soft_limit` | `45` | Target max channels per category (headroom under Discord’s 50) |
| `name_template` | `Member Channels {range}` | Category name; `{range}` → `A-M`, `N-#`, etc. |
| `rename_categories` | `true` | Rename existing mapped categories to match new ranges |
| `create_categories` | `true` | Create extra categories when more buckets are needed |
| `create_missing` | `false` | Create personal channels for verified players who have none |
| `archive_unlinked` | `true` | Move text channels in member categories that are **not** linked to any player into the archive |
| `archive_category` | — | Existing Discord category to use as archive |
| `archive_name` | `Member Channels Archive` | Find or create archive category by name |
| `apply` | `false` | Preview only unless `true` |

**First-time / migration workflow:**

1. `/channels extra-roles` — who can see all member channels (see above).
2. Verify players (`/verify` or `/server verify`).
3. `/channels link` for members who already have a channel (rebalance will **not** guess links by name).
4. `/channels plan` — review suggested ranges, missing channels, and unlinked channels.
5. `/channels rebalance apply:true create_missing:true` — splits categories, creates missing channels, moves linked ones, archives unlinked ones.

**Manual map** (if you prefer to create categories yourself):

```
/server categories
/channels map category_map:A-M=111...,N-#=222...
```

Or one range at a time: `range:A-M` + `category_id:…`.

On verify, the bot creates a private channel for the member in the matching category (name slug from player name), with access for the member + extra-roles. Channels within each member category are kept in **alphabetical** order (rebalance re-sorts all buckets; create/link/rename re-sorts that category).

Clear mappings (disables auto-create):

```
/channels map clear:true
```

### Link existing channels (any mode)

If the server already has member or diplomacy channels, **do not recreate them** — link them:

```
/channels link channel:#exampleplayer player:ExamplePlayer
```

Pick a **text** (or announcement) channel — not a category. If linking fails because the bot can’t see the channel, give the bot **View Channel** there (private member channels often deny `@everyone`), then retry.

```
/channels link channel:#abcd-diplomacy player:123456789
```

```
/channels link channel:#some-channel user:@Member
```

| Option | Description |
|--------|-------------|
| `channel` | Existing text channel (required) |
| `player` | In-game name, STFC player ID, or Discord snowflake |
| `user` | Discord member (alternative to `player`) |
| `apply_permissions` | Default `true` — rewrite perms for member + extra-roles. Set `false` to only store the link and leave existing permissions alone |

Channel names always follow the **current in-game player name** (slugified). Create, link, rebalance, verify, and the **daily player sync** rename (and re-bucket) when the name no longer matches. Slugs fold common lookalikes first (e.g. `Ł`→`l`, `β`→`b`, accents stripped) before Discord-safe sanitizing.

Examples for an existing framework:

```
/channels link channel:#example-diplomacy player:ExamplePlayer apply_permissions:false
```

Status:

```
/channels status
```

---

## 5b. Diplomacy channels (multi-alliance)

One shared text channel **per alliance tag** (not per player). Typical use: everyone can **see** the channel; only leadership ranks and/or a Diplomat role can **write**.

Discord cannot gate on in-game rank directly — write access uses the Discord roles assigned for those ranks (`commodore_roles` / `admiral_roles` from `/server setup`) plus any `write_roles` you configure.

Multi-alliance servers often have **dozens of tags** — Discord’s **50 channels per category** limit applies. Prefer **letter-bucket categories** (same idea as personal channels) via `sync_all`, not a single `category:`.

### Configure

```
/diplomacy
  enable:true
  everyone_can_view:true
  write_roles:Diplomat
  write_ranks:Commodore,Admiral
  name_template:diplomacy-{tag}
```

| Option | Meaning |
|--------|---------|
| `enable` | Turn feature on and save options |
| `disable` | Stop auto-create (keeps linked channels) |
| `everyone_can_view` | `@everyone` can view; send still denied (default true) |
| `view_roles` | Extra viewer roles (especially if everyone cannot view) |
| `write_roles` | Roles that can send (e.g. Diplomat) — created by name if missing |
| `write_ranks` | In-game ranks whose Discord rank roles may write |
| `category` | Legacy **single** parent category (used only when no letter-bucket map yet) |
| `name_template` | Channel name; `{tag}` → alliance tag (default `diplomacy-{tag}`). Tags are **latinized** like personal channels (`β`→`b`, `Ł`→`l`, …) |
| `sync_all` | Plan/create letter-bucket categories, rename/move channels, A–Z sort, optional archive |
| `plan` | With `sync_all`: preview buckets only (no Discord writes) |
| `soft_limit` | With `sync_all` / `archive_sync`: max channels per category (10–50). **Persisted** when you pass it (default **45**). Auto-rebalance on track / morning sync uses the stored value. Raising the limit later does **not** merge existing letter buckets. |
| `category_name_template` | With `sync_all`: category name; `{range}` → e.g. `A-M` (default `Diplomacy Channels {range}`) |
| `create_missing` | With `sync_all`: also create channels for alliance tags on verified players |
| `archive_unlinked` | With `sync_all`: move unlinked channels under diplomacy categories to archive (default true) |
| `archive_category` | With `sync_all`: single dump target; with `archive_sync`: a **source** pile to organise (re-run for more piles) |
| `archive_sync` | Rebalance unlinked rooms from source pile(s) into letter-bucket archive categories — **no tag linking required** |
| `languages` | With `create_tag` / `link_tag`: preferred languages as country flags on the channel name (optional). Codes: `en,de,fr,es,pt,nl,pl,it,ru,tr,hu`. Use `none` to clear. |
| `gaps` | Ephemeral report: tracked/verified tags missing channels, and channels not on explicit track |
| `special` | `create` / `link` / `clear` — non-listed alliances room (not a tag in the channel map) |
| `special_name` | Channel name for special room (default `non-listed-alliances`) |
| `special_placement` | `special_category` (dedicated **Diplomacy Channels (Special)**) or `top_of_first` (pin at top of first letter-bucket) |
| `special_category` | Optional category to use when placement is `special_category` |

### Gaps (tracked / verified vs channels)

```
/diplomacy gaps:true
```

Shows tags on the explicit `/alliance track` list or on verified players that lack a diplomacy channel, and mapped channels that are not on the explicit track list.

### Special (non-listed alliances) channel

Catch-all room for alliances without their own channel. **Not** added to `diplomacy_channel_map` (does not enter morning scrape via diplomacy).

```
/diplomacy special:create special_name:non-listed-alliances special_placement:special_category
/diplomacy special:link channel:#existing-room special_placement:top_of_first
/diplomacy special:clear
```

- **`special_category`:** create/find `Diplomacy Channels (Special)` (or pass `special_category:`) and put the channel there.
- **`top_of_first`:** after letter buckets exist, pin the channel at the top of the first A–… category. Run `sync_all` first if buckets are missing.

### Create for a tag

```
/diplomacy create_tag:ABCD
/diplomacy create_tag:ABCD languages:en,fr
```

Also happens automatically on verify/sync in **multi_alliance** mode when diplomacy is enabled and the player has an alliance tag — **unless** `/alliance defer-untracked-admirals` is on and that tag is not yet tracked / on the diplomacy map. Auto-create is intentional; it adds the tag to the diplomacy map (and therefore the morning scrape set). See [scrape set vs tracked vs diplomacy](#multi-alliance-scrape-set-vs-tracked-vs-diplomacy-read-this) above. Existing channels are **renamed** to the current slug and **moved** into the letter-bucket category (or legacy `category` if no map).

**Preferred languages (optional):** when set, the channel name appends a box separator and flag emojis after the slug — e.g. `abcd-diplomacy┃🇬🇧🇫🇷`. Auto-created channels have no languages until you set them with `create_tag` + `languages:` (same command updates an existing mapped channel). Sync/rename preserves the stored languages.

### Sync / rebalance (letter buckets)

Preview splits (also **saves** `soft_limit:` when provided):

```
/diplomacy sync_all:true plan:true soft_limit:45 create_missing:true
```

Apply (creates `Diplomacy Channels A-M`-style categories as needed, moves channels by tag first letter, archives unlinked):

```
/diplomacy sync_all:true create_missing:true
```

Same spirit as personal-channel rebalance. Progress posts on the slash command after each tag; audit gets started + finished. After the first successful sync, status shows the **category map** (ranges → categories) instead of a single legacy category.

**Performance:** `sync_all` moves/renames only by default (no per-channel permission rewrite). Pass `apply_permissions:true` if you need overwrites refreshed. A–Z sort runs once at the end of the job, not after every channel.

**Auto-rebalance:** when `/alliance track` (or verify) adds a diplomacy channel that would overflow a bucket, or after the morning multi-alliance roster scrape, the bot rebalances using the **persisted** soft limit (sticky: it will not merge categories if you raise the limit later).

**Alliance tag rename:** if a tracked alliance changes its tag on stfc.pro (same alliance id, new tag string), the morning job (or `/alliance resync`) remaps `diplomacy_channel_map` / preferred languages / `tracked_alliance_tags` / verified player tags, renames and re-places the diplomacy room, then rebalances letter buckets if needed. This is **not** the same as a player moving between alliances.

**Why resync matters mid-day:** if players sync with the **new** tag before remap, diplomacy may auto-create a second channel for the new tag while the old map key still exists. Run `/alliance resync` promptly after a rename; remap keeps the original room and unmaps the duplicate (you can delete the extra Discord channel).

### Organise existing archive piles (no linking)

For onboarding servers that already have categories full of old diplomacy rooms you do **not** want to `link_tag`:

```
/diplomacy archive_sync:true archive_category:#old-diplomacy-archive plan:true soft_limit:45 category_name_template:Diplomacy Archive {range}
/diplomacy archive_sync:true archive_category:#old-diplomacy-archive category_name_template:Diplomacy Archive {range}
```

- Moves **unlinked** text channels from the source category into letter-bucket archive categories (default names `Diplomacy Archive A-M`, …).
- Skips channels already in the diplomacy map and the special (non-listed) channel.
- Does **not** rename channels or require alliance tags.
- Re-run with another `archive_category:` for a second pile — the existing archive map is included as sources automatically so everything rebalances together.
- If a source category is already named exactly like a planned bucket (e.g. `Diplomacy Archive A-M`), it is reused.

### Adopt an existing channel

```
/diplomacy link_tag:ABCD channel:#abcd-diplo
/diplomacy link_tag:ABCD channel:#abcd-diplo languages:en,de apply_permissions:false
```

### Status

```
/diplomacy
```

(with no action options) prints the current diplomacy config (including **soft limit**), category map, and tag→channel map.

---

## 6. Member verification flow

### What members do

**Invite DM** = the join-time verification DM this bot would send (language picker / “start verifying”). That is **not** the same as `/server welcome` (post-onboarding welcome after they finish verify).

**Default (`invite:dm`):**

1. Join the server → this bot sends an **Invite DM** (if DMs allowed), **or**
2. Admin runs `/server test-invite`, **or**
3. Member runs `/verify link:https://stfc.pro/players/…` (optional screenshot attachment)

**Channel panel (`invite:channel_panel`)** — use when another bot already greets members on join (that other message is what we call Invite territory; turn ours off):

1. Join → this bot records the member but **does not** send an Invite DM
2. Member opens your verification channel → taps **Start verification** → same DM verification flow
3. Or use `/verify` in-channel if DMs are blocked

```
/server verify-panel post channel:#verify          # pin panel + turn Invite DM off (channel_panel)
/server verify-panel show
/server verify-panel mode invite:dm|channel_panel  # toggle Invite DM on join vs panel-only
/server verify-panel demotion-notify mode:dm|channel|none
```

**Discord layout tip:** make the verification channel visible to Guest/Visitor (+ bot + staff); hide from full members if you want. On demote, guest role restores access so they can re-start. Go live with `deploy_mode:live` + `invite:channel_panel` + panel posted. Leave `/server welcome` alone unless you also want this bot’s *post-verify* welcome DM.

**Demotion notify:** after a guest demotion, `dm` sends the Restart DM (default); `channel` posts an `@mention` in the verify panel channel (avoids mass-DM storms); `none` is audit-only.

DM flow: language → consent (if enabled) → screenshot → stfc.pro link → roles / nick / channel / log post.

### Manual verify (existing servers)

Admins can link a Discord member to an stfc.pro profile **without** the DM flow — useful when onboarding a server that already has members:

```
/server verify user:@Them link:https://stfc.pro/players/…
/server verify user:@Them link:https://stfc.pro/players/… screenshot:<file>
```

This runs the same pipeline as self-verify (roles, nickname template, personal/diplomacy channels, verification log). The log embed notes `Manual by @Admin`. Repeat once per member; alliance guest rules still apply in single-alliance mode.

Requires Administrator. Set the archive channel first (`/channels log`) so staff can audit these posts.

### Admin testing

```
/server test-invite              # DM yourself
/server test-invite user:@Them
/verify link:https://stfc.pro/players/…
/server test-reset               # clear your record to re-test
/server test-reset user:@Them
```

### Guest re-check (single-alliance)

Wrong alliance (or empty alliance tag on stfc.pro) → **guest** candidate. Behavior depends on **demotion policy**:

| Policy | Confirmed mismatch / empty tag | Player missing on stfc.pro | API / network error |
|--------|--------------------------------|----------------------------|---------------------|
| **approval** (default) | Queue → urgent channel Approve/Reject | Queue → urgent Approve/Reject | Skip (never change roles) |
| **yolo** (auto) | Apply guest immediately | Queue 1h recheck; apply guest only if still missing | Skip (never change roles) |

The **6-hour guest poll** and **morning sync** prefer the cached alliance roster when fresh: if a guest appears on the roster, they are promoted without a per-player stfc.pro hit. If the morning roster succeeds and an **active** member is absent, they become a leave-detection candidate.

If a personal-channel archive category is configured, applying guest moves their channel there.

```
/server demotion                          # show policy
/server demotion policy:approval
/server demotion policy:yolo
/server demotion list:true
/roster set-guest user:@Member reason:left alliance
```

Urgent digest buttons: **Approve all** / **Reject all**. Individuals: `/roster set-guest`.

**Multi-alliance:** empty alliance tags are normal — never auto-queued or set to guest for “no tag.” Use `/roster set-guest` manually if needed.

### Unverified members (any mode)

```
/roster unverified                      # Discord members with no STFC link (paginated table; Admin or assistant roles)
/roster unverified format:list          # Dense list with mentions (more rows per page)
/roster unverified set_guest:true       # Admin: assign guest_role + remove member/rank roles for everyone listed
```

Bulk set-guest requires `guest_role` from `/server setup`. Never-verified users are roles-only (no new `verified_players` row). Excluded users and bots are skipped.

### Alliance members missing Discord verify

Opposite direction: players on the **morning alliance roster cache** who are **not** linked as active/guest on this Discord server.

```
/roster missing-verify
```

Lists in-game name, player id, ops, and rank. Requires a cached alliance roster (after morning sync). Guests count as linked.

- **single_alliance:** everyone on the configured alliance page.
- **multi_alliance:** everyone on successfully scraped **tracked** alliances (verified tags ∪ diplomacy map). See [COMMANDS.md](./COMMANDS.md).

### Reports by ops grade vs in-game rank

| Command | What it counts / lists |
|---------|------------------------|
| `/roster grades` | Ops **grade** buckets G3–G7 (from ops level) |
| `/roster grade grade:6` | Verified players at that grade |
| `/roster ranks` | In-game **alliance rank** (Operative, Agent, Premier, …) |
| `/roster rank rank:Admiral` | Verified players with that alliance rank |
| `/roster ops min:50` | Ops level range |

Player list replies use ASCII **tables** by default with **Previous** / **Next** / **Full list** / **Table** buttons. Options: `sort:`, `format:list`, `visibility:public` (default **private**), `include_unlinked` (default **true** — alliance members with no Discord link show as **DC=no** / status `unlinked`), `page:`. Private replies also get **Post to channel**. `/roster missing-verify` still lists only unlinked. Mentions on `/roster unverified` / `activity`. Streak comes from the alliance page.

On **multi-alliance**, alliance tag/rank changes on daily sync update nick + rank roles; they are **not** auto-set to guest (use `/roster set-guest` if needed).

---

## 7. Resource exchange (`/exchange`)

Cross-alliance resource matching (best for **multi_alliance**). Same-alliance donors are never notified. Verified players only.

### Setup (admin)

Two layouts:

| Layout | Behaviour |
|--------|-----------|
| **hub** | One channel; each resource gets a **pinned** post with buttons |
| **category** | One text channel **per resource** under a category; each pinned |

```
/exchange setup layout:hub channel:#resource-exchange
/exchange setup layout:category create_category:true category_name:Resource Exchange
/exchange setup admin_roles:Officer
```

Bot role must sit **above** the Donor / Need roles it creates.

### Resources

```
/exchange resource create name:Crystal
/exchange resource list
/exchange resource disable name:Crystal
```

Creates Discord roles `{Name} Donor` and `{Name} Need`, posts + pins **Register as donor** / **Stop donating** / **I need this** / **I no longer need this**.

The pinned post shows live totals (names are not listed):

- **Registered donors**
- **Active requests** (open + claimed)

The bot **edits** that pinned message whenever donors or requests change.

### Player flow

1. Donor registers (button or `/exchange donate resource:Crystal`) — if open requests are waiting, they are DMed about them **oldest first**
2. Recipient taps **I need this** (or `/exchange need`):
   - If cross-alliance donors exist → they get a DM (name + ops) with **Help** / **Ignore**
   - If none yet → request is **queued** (still counted on the pin); first matching donor who later registers gets DMed in queue order
3. First **Help** wins → recipient gets donor details + **Completed** / **Ask again**
4. **Ask again** re-notifies current cross-alliance donors (or stays queued if none)
5. **I no longer need this** cancels an open/claimed request (e.g. resolved offline); notifies the claimer if someone had claimed Help

Same-alliance donors are **never** notified (tags compared case-insensitively).

Slash `donate` / `need` / `undonate` must be run in that resource’s channel (hub or dedicated).

---

## 8. Surveys & polls (`/survey`)

Button surveys for verified players (DM or personal channel). Votes land in a **private** log channel (default `#survey-{id}`). Results use ASCII tables (buttons stay on the message — never inside tables).

### Who can create

| Setting | Default |
|---------|---------|
| Creators | **Administrators** only |
| Log / results viewers | Survey creator + creator roles + Administrators |
| Log channel name | `{id}-{title}` |

```
/survey creators                          # show current settings
/survey creators roles:Officer,Leadership
/survey creators results_roles:Officer
/survey creators log_name:poll-{id}
/survey creators create_category:true category_name:Surveys
/survey creators category:#ExistingCategory
/survey creators clear_category:true
```

Use role IDs or `<@&id>` mentions, comma-separated. Empty `roles` clears back to admins-only.

**Log channels are private:** `@everyone` cannot see them. Access is granted to the bot, the member who created the survey, configured **creator** roles, and **results_roles**. Discord Administrators can still see them via admin override.

**Category:** New survey logs go under the configured **server default** category (if set). Override per survey with `/survey create … log_category:#Events`. `create_category:true` makes a private default category (name `Surveys` unless `category_name` is set). Does not move already-created channels.

`log_name` placeholders: `{id}` / `{n}` (survey number), `{title}` (slugified survey title, or `survey` if unset). Default `{id}-{title}` → e.g. `#3-ops-readiness`. Applies to **new** surveys only (rename old `#survey-1` channels manually if you want).

Empty `log_name` resets to `{id}-{title}`.

### Create → test → send

```
/survey create title:"Ops readiness" question:"Ready for the event?" options:Yes|No|Maybe closes_in:48h target:grade grades:5,6
```

| Option | Purpose |
|--------|---------|
| `question` | Shown to players |
| `options` | `A\|B\|C` — **2–5** answers (Discord button limit) |
| `title` | Player-facing heading in DM / personal channel (default: localized `Survey #id`); also used in log channel name |
| `closes_in` | Optional auto-close after **Approve & send** — e.g. `30m`, `12h`, `7d` (max 90 days). Omit = manual `/survey close` only |
| `target` | `all` · `role` · `rank` · `level` · `grade` · `users` |
| `delivery` | `dm` (default) or `personal_channel` (falls back to DM) |
| `grades` / `ranks` / `roles` / `users` / `ops_min` / `ops_max` | Filters for the chosen `target` |
| `alliance_tags` | Optional extra filter (comma-separated tags) |
| `log_category` | Optional category for **this** survey’s log channel (else server default from `/survey creators`) |

After create you get an ephemeral draft with buttons:

1. **Test to me** — delivers using the survey’s `delivery` setting (`dm` → your DMs; `personal_channel` → your linked personal channel). Draft clicks are **not** counted.
2. **Approve & send** — creates private log channel (name from `log_name` template), DMs/posts buttons to matched players, logs each vote; starts the `closes_in` clock if set
3. **Cancel** — deletes the draft

### Results & close

```
/survey list
/survey results id:12
/survey close id:12
```

`/survey results` shows a **Summary** vote table and a **Who voted** table.

**Auto-close:** When `closes_in` was set, the bot soft-closes the survey at the deadline (votes stop counting; Discord buttons may still appear). Cron checks about every 5 minutes; a late click also triggers close. Existing surveys without a deadline are unchanged.

---

## 9. Other `/server` commands

| Command | Purpose |
|---------|---------|
| `/server status` | Full config summary |
| `/server gateway` | Gateway WebSocket health |
| `/server roles` | List Discord roles + IDs |
| `/server categories` | List categories + IDs |
| `/server rank-roles` | Preview roles for a rank |
| `/server bucket` | Configure overlay buckets |
| `/channels …` | Personal channels + verification log |

---

## 10. Utility commands (everyone)

| Command | Purpose |
|---------|---------|
| `/player` | Live stfc.pro lookup (needs `/server setup`) |
| `/roster …` | Roster reports — Admin or `/server assistant` roles (see below) |
| `/lookup` | Coordinate share-string lookup |
| `/table` / `/tablehelp` | CSV → ASCII table |
| `/survey …` | Surveys / polls (creator roles; see §8) |
| `/exchange …` | Resource exchange (see §7) |

---

## 11. Troubleshooting

| Symptom | Likely fix |
|---------|------------|
| Roles not assigned / `50013` on `/roles/…` | [Raise bot in role hierarchy](#role-hierarchy-drag-the-bot-up); bot needs **Manage Roles** (Administrator not required) |
| Nickname fails (403) | Manage Nicknames; bot role above member; **owner cannot be renamed** |
| No verification DM / `DM open failed: 403` | Member privacy: **User Settings → Privacy** or server privacy — allow DMs from server members; or they blocked the bot. Use `/verify` in-channel as fallback; retry with `/server test-invite` after they fix privacy. After one 403 the bot stops auto-retrying that member (and posts to `/channels urgent` if set) |
| Repeat “Verification invite failed” for people already verified | Fixed: manual `/server verify` marks invited; already `active`/`guest` are skipped; clobbered `pending_*` rows with player data are auto-restored. Redeploy to pick up — **no re-verify needed** if Discord roles still look correct |
| “Server not configured” | Run `/server setup` |
| Log channel silent | `/channels log` set; bot can attach files; redeploy after feature add |
| Personal channel not created | Single-alliance + category map set; check `/channels status` |
| `/channels link` fails / “not a text channel” | Pick a **text** channel (not a category). Redeploy + re-register commands |
| `/channels link` permission overwrite fails | Bot needs **Manage Channels** + **View Channel** on that channel/category. After deploy, link still saves and reports which overwrites failed; bot is granted View/Send first so it can post surveys |
| Diplomacy channel not created | Multi-alliance + `/diplomacy enable:true`; rank write roles must exist from setup |
| Link finds no player | Member must verify first, or use `user:@Member` |
| stfc.pro lookup fails | Bot falls back to HTML player page lookup for numeric IDs; confirm URL/server/region |
| Survey create denied | Admin or `/survey creators` role; run `/server setup` first |
| Survey DM missing | Member allows DMs from server members; bot can message them |
| Zero matched players | Check `target` filters vs verified roster (`/survey list` shows target count) |
| Exchange no donors notified | Need cross-alliance donors; verify alliance tags differ |
| Exchange role assign fails | Bot role above `{Resource} Donor` / `Need` roles |

---

## Data-processing consent (GDPR) + optional CoC

Two separate gates:

| Gate | Command | When | Purpose |
|------|---------|------|---------|
| **Data consent** | `/server consent` | **Before** screenshot / stfc.pro lookup | Link Discord ↔ player identity; Yes/No buttons; logged to audit |
| **Code of conduct** | `/server agreement` | **After** verify (guest lounge until accept) | Optional server rules; can still link a CoC channel |

**Legal templates** (customise before publishing): [Privacy Policy](./PRIVACY_POLICY.md) · [Terms of Service](./TERMS_OF_SERVICE.md). Link stable hosted copies from your consent DM or CoC channel when you enable `/server consent`.

```
/server consent
/server consent enabled:true version:2026-07
/server agreement enabled:true timing:after_verify channel:#code-of-conduct version:2026-07
```

**Existing / manually verified members stuck as guest until CoC** (e.g. DMs blocked): mark accepted and restore member roles without them tapping Agree:

```
/server agreement backfill:true
/server agreement user:@Player
```

Records `agreement_method: admin_backfill`, stamps the current CoC version, then runs the same role/nick/channel grant as the Agree button. Alliance guests stay on guest role. Large servers continue in ~20s Worker chunks via `WORKER_URL` (must be set in `.env`). Guild owner / higher-than-bot roles are skipped for Discord mutations (CoC still stamped).

**Onboarding order when data consent is on:** language (if needed) → consent Yes/No → verification instructions → screenshot + link → (optional CoC) → welcome DM.

Bump `version` on either gate to re-prompt after policy changes.

---

## Welcome DM (post-onboarding)

After a member reaches **full access** (verified, and agreement accepted if that gate is enabled), the bot can DM a welcome message once.

**Retries:** each player gets at most **2** automatic send attempts (first failure + one retry on a later verify/sync/agreement). After that, auto-send stops (no more audit spam). Admins can force another try with `/server welcome send_user:@Them force:true`.

**Manual verify:** `/server verify` does **not** send the welcome DM by default (avoids DMing already-onboarded members). Pass `send_welcome:true` when you want it.

**Hybrid setup:**

1. Post a welcome message in any channel the bot can read (include recommended channels as normal `#channel` mentions).
2. Copy Message Link → configure the bot.
3. The bot fetches that post’s content (and embeds) and appends a link to the member’s personal channel.

```
/server welcome
/server welcome enabled:true message_link:https://discord.com/channels/<guild>/<channel>/<message>
/server welcome preview:true
/server welcome clear:true
/server welcome send_user:@Member force:true   # manual / forced retry
/server onboarding                            # show full path + order of gates
/server verify user:@Them link:… send_welcome:true
```

Optional: put `{personal_channel}` in the source post where you want the personal channel mention mid-text (the bot still appends the personal-channel line at the end).

Bot needs **View Channel** + **Read Message History** on the source channel. Guests / wrong-alliance members do not receive this DM.

### Preview DMs (no status change)

```
/test-dm kind:invite
/test-dm kind:agreement user:@Them
/test-dm kind:welcome
/test-dm kind:demote_mismatch   # choice label: Guest mismatch preview
/test-dm kind:all
```

These send real-looking DMs marked as admin previews. Buttons do **not** record agreement or restart verification. Prefer this over `/server test-invite` when testing copy/layout for already-verified members.

`/server test-invite` is for **live** onboarding of not-yet-verified users (can set `pending_screenshot`). `/server test-reset` clears verification for a true re-test.

---

## DM assistant (Badgey / HAL)

Verified members (and admins) can **DM the bot** outside of verification:

| Message | Behaviour |
|---------|-----------|
| Unrecognized question / request | HAL: *I'm sorry \{name\}, I'm afraid I can't do that.* |
| Unknown / not verified | Badgey invite to join & verify |
| `menu` / `admin` / `help` | Admin button wizard (Administrator or Manage Server required) |
| Roster questions (e.g. “how many G6?”) | Allowed for admins, or roles set below |

Prefer slash commands for listings: `/roster grades`, `/roster grade grade:6`, `/roster ranks`, `/roster rank rank:Admiral`, `/roster ops min:50`, `/roster unverified`, `/roster missing-verify`, `/roster set-guest`, `/roster status`.

Admin wizards (DM → `menu`): **Server status**, **Server setup** (core fields), **Verification log**, **Audit log**.

```
/server assistant                          # show settings
/server assistant roles:@Officer,@Leadership
/server assistant roles:                   # clear → admins only
/server assistant ai:true                  # guild flag only; still needs ENABLE_WORKERS_AI + DM_AI_ENABLED
```

**Cost:** Roster answers and wizards use D1 + buttons — **no Workers AI**. Optional AI intent assist is off by default and hard-capped per day if enabled.

---

## Exclude users (bots / never-verify)

Discord **bots are skipped automatically** (no invite DMs). For other accounts that should never verify:

```
/server exclude-add user:@OtherBot reason:MEE6 twin
/server exclude-remove user:@OtherBot
/server exclude-list
```

Excluded users never get verification invite DMs and are omitted from `/roster unverified`.

---

## Quick checklist (new alliance server)

1. [ ] Bot invited; role near top of list  
2. [ ] `/server setup` with server, region, mode, tag, roles  
3. [ ] `/channels extra-roles` — officers/roles that see **all** member channels (not part of setup)  
4. [ ] `/channels audit create:true` — general bot audit (admin + automated actions)
5. [ ] `/channels urgent create:true` — high-signal alerts (DM blocked, etc.; optional)
6. [ ] `/channels log create:true` — verification archive (screenshots; separate from audit)
7. [ ] Members pick language on first DM (or `/language`) — player-facing messages are localized  
8. [ ] Link existing member channels with `/channels link` if needed  
9. [ ] `/channels plan` then `/channels rebalance apply:true create_missing:true` (or manual `/channels map`)  
10. [ ] Optional: `nickname_template`, rank roles, `/server bucket`  
11. [ ] Multi-alliance: `/diplomacy enable:true write_roles:Diplomat write_ranks:Commodore,Admiral`  
12. [ ] Optional: `/survey creators` for officers who may poll the alliance  
13. [ ] Optional: `/exchange setup` + `/exchange resource create` for cross-alliance resources  
14. [ ] `/server test-invite` → verify yourself → check roles, log, personal/diplomacy channels  
15. [ ] Existing members: `/server verify user:@Them link:https://stfc.pro/…` (repeat as needed)  
16. [ ] `/server status` looks correct  
17. [ ] Optional: `/server assistant roles:…` for who may ask roster questions in DMs  
17. [ ] Optional: DM the bot as admin and say **menu** to try guided setup  
