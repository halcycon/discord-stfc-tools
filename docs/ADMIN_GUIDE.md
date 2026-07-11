# Discord admin guide — STFC Tools

How to configure the bot **inside Discord** after it is deployed. For Cloudflare/Worker install steps, see [SETUP.md](../SETUP.md).

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
  server:108
  region:EU
  mode:single_alliance
  alliance_tag:KWSN
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
| `single_alliance` | Tag must match `alliance_tag`. Else guest role + periodic re-check. Personal channels can auto-create. |
| `multi_alliance` | Any alliance verifies as active. No guest gating. Personal auto-create is off (link existing channels instead). |

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
| Single alliance | `{rank_prefix}{player_name}` | `[Admiral] Halcynicon` or `Halcynicon` |
| Multi alliance | `[{alliance_tag}]{rank_paren} {player_name}` | `[KWSN] (Admiral) Halcynicon` |

`{rank_prefix}` is `[Premier] ` / `[Commodore] ` / `[Admiral] ` only (empty for Operative/Agent).  
`{rank_paren}` is ` (Rank)` when rank is known.

### Custom template

```
/server setup … nickname_template:[{alliance_tag}] {player_name}
```

| Placeholder | Meaning |
|-------------|---------|
| `{player_name}` | In-game name |
| `{alliance_tag}` | Alliance tag (no brackets) |
| `{rank}` | Full rank or empty |
| `{rank_prefix}` | `[Admiral] ` style for leadership ranks |
| `{rank_paren}` | ` (Admiral)` when rank known |

Nicks are truncated to Discord’s **32** character limit.

---

## 3. Rank roles and overlay buckets

On verify (and daily sync), an **active** member receives the **union** of:

1. `member_roles` (everyone who matches the alliance)
2. The matching per-rank list (`premier_roles`, `admiral_roles`, …)
3. Every **overlay bucket** whose `ranks` list includes their in-game rank

Guests only get `guest_role` (member/rank/bucket roles are stripped).

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
/server channels log create:true
```

Optional: `name:verification-archive`

Permissions applied:

- `@everyone` — cannot view
- Bot — can view / send / attach
- Roles from `/server channels extra-roles` — can view / send

### Use an existing staff channel

```
/server channels log channel:#staff-verify-log
```

Ensure the bot can **View Channel**, **Send Messages**, **Embed Links**, and **Attach Files** there.

### Disable

```
/server channels log clear:true
```

---

## 4b. Bot audit log (admin + automated actions)

A staff-only channel for **everything the bot does** besides verification screenshots: admin commands, role/channel changes, cron sync summaries, invites, etc.

```
/server channels audit create:true
```

Optional: `name:bot-audit-log`

Or link an existing channel:

```
/server channels audit channel:#staff-bot-audit
```

Disable:

```
/server channels audit clear:true
```

Same private-channel permission pattern as the verification log (`@everyone` denied; bot + `/server channels extra-roles` can view). Prefer setting **extra-roles** first so viewers are included on create.

Logged events include (non-exhaustive): `/server setup`, verify (brief — screenshots stay on the verification log), guest invites, player sync changes, personal-channel map/rebalance/link, diplomacy config, surveys sent/closed, exchange setup, daily sync / guest re-check summaries.

---

## 4c. Urgent alerts (action needed)

Optional high-signal channel for events that need an admin to notice quickly — **not** the full audit trail. Today this includes **verification DM blocked (403)** when a member’s privacy settings prevent bot DMs.

```
/server channels urgent create:true
```

Optional: `name:bot-urgent`

Or link an existing channel:

```
/server channels urgent channel:#staff-urgent
```

Disable:

```
/server channels urgent clear:true
```

Same private-channel pattern as audit/log (`@everyone` denied; bot + `/server channels extra-roles` can view). Prefer setting **extra-roles** first.

Urgent posts use a short Badgey-style message so they stand out from routine audit embeds. The same event is still written to the audit log when configured.

---

## 5. Personal / member channels

### Permissions (set this first)

Before creating or linking member channels, configure which Discord roles can see **every** personal channel (officers, diplomats, etc.):

```
/server channels extra-roles roles:@Officer,@Diplomat
```

This attaches those roles to the **built-in default** permission template (same allow bits as the member). No sample channel lock required — confirm with `/server channels permissions-template-show`. Clear with an empty `roles:` value.

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
3. Use `/server channels link … apply_permissions:true` once the bot can see the channel (rewrites that channel only).

### Audit existing permissions (read-only)

Before changing anything, dump what Discord currently has on linked channels + channels under your member categories:

```
/server channels permissions-audit
```

- Does **not** sync or rewrite permissions
- Ephemeral summary with flags (`bot_missing_view`, `linked_member_no_overwrite`, …)
- Full text dump attached to `/server channels audit` when that channel is set (keep this as your record)

### Lock a permission template from a sample channel (optional)

You do **not** need this if the built-in default + `/server channels extra-roles` is enough.

Once you find a member channel whose overwrites look right (bot can post, member + staff roles correct):

```
/server channels permissions-template-from channel:#good-example
```

Optional: `member:@Owner` if the channel isn’t linked yet; `sync_extra_roles:false` to leave `/server channels extra-roles` unchanged (default **true** copies role overwrites into extra-roles).

If a locked template already lists role overwrites, those take precedence for personal channels; extra-roles still apply to log/audit/urgent channels.

```
/server channels permissions-template-show
/server channels permissions-template-clear
```

Locked templates are used for **new** personal channels and for `/server channels link` / verify when `apply_permissions` is on. Existing channels are not rewritten until you link/re-apply.

Do this **before** `/server channels rebalance … create_missing:true` or bulk `/server channels link`, so new and rewritten channels get the right access. Changing extra-roles later does **not** rewrite existing channels until the next create/update/link that applies permissions.

### Auto-create (single-alliance)

Buckets use the **first letter** of the in-game name (`A`–`Z`). Names starting with a digit or symbol go in `#` (non-alphabetic), always at the end of the alphabet (e.g. range `N-#`).

**Recommended:** let the bot plan and apply categories (handles Discord’s ~50 channels/category limit):

```
/server channels plan
/server channels rebalance apply:true create_missing:true
```

That creates/renames categories like `Member Channels A-M` / `Member Channels N-#`, updates the map, moves linked member channels, creates missing ones (if `create_missing`), and archives unlinked ones.

The planner splits **fairly evenly** under the soft limit (50 players → two ~25 buckets, not 45+5). Re-run when occupancy nears the limit (`/server channels status` shows counts).

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

1. `/server channels extra-roles` — who can see all member channels (see above).
2. Verify players (`/verify` or `/server verify`).
3. `/server channels link` for members who already have a channel (rebalance will **not** guess links by name).
4. `/server channels plan` — review suggested ranges, missing channels, and unlinked channels.
5. `/server channels rebalance apply:true create_missing:true` — splits categories, creates missing channels, moves linked ones, archives unlinked ones.

**Manual map** (if you prefer to create categories yourself):

```
/server categories
/server channels map category_map:A-M=111...,N-#=222...
```

Or one range at a time: `range:A-M` + `category_id:…`.

On verify, the bot creates a private channel for the member in the matching category (name slug from player name), with access for the member + extra-roles.

Clear mappings (disables auto-create):

```
/server channels map clear:true
```

### Link existing channels (any mode)

If the server already has member or diplomacy channels, **do not recreate them** — link them:

```
/server channels link channel:#halcynicon player:Halcynicon
```

Pick a **text** (or announcement) channel — not a category. If linking fails because the bot can’t see the channel, give the bot **View Channel** there (private member channels often deny `@everyone`), then retry.

```
/server channels link channel:#kwsn-diplomacy player:301268920
```

```
/server channels link channel:#some-channel user:@Member
```

| Option | Description |
|--------|-------------|
| `channel` | Existing text channel (required) |
| `player` | In-game name, STFC player ID, or Discord snowflake |
| `user` | Discord member (alternative to `player`) |
| `apply_permissions` | Default `true` — rewrite perms for member + extra-roles. Set `false` to only store the link and leave existing permissions alone |

Examples for an existing framework:

```
/server channels link channel:#adam-diplomacy player:Adam apply_permissions:false
```

Status:

```
/server channels status
```

---

## 5b. Diplomacy channels (multi-alliance)

One shared text channel **per alliance tag** (not per player). Typical use: everyone can **see** the channel; only leadership ranks and/or a Diplomat role can **write**.

Discord cannot gate on in-game rank directly — write access uses the Discord roles assigned for those ranks (`commodore_roles` / `admiral_roles` from `/server setup`) plus any `write_roles` you configure.

### Configure

```
/server channels diplomacy
  enable:true
  everyone_can_view:true
  write_roles:Diplomat
  write_ranks:Commodore,Admiral
  category:#Diplomacy
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
| `category` | Parent category for newly created channels |
| `name_template` | Channel name; `{tag}` → alliance tag (default `diplomacy-{tag}`) |

### Create for a tag

```
/server channels diplomacy create_tag:KWSN
```

Also happens automatically on verify/sync in **multi_alliance** mode when diplomacy is enabled and the player has an alliance tag.

### Adopt an existing channel

```
/server channels diplomacy link_tag:KWSN channel:#kwsn-diplo
/server channels diplomacy link_tag:KWSN channel:#kwsn-diplo apply_permissions:false
```

### Status

```
/server channels diplomacy
```

(with no action options) prints the current diplomacy config and tag→channel map.

---

## 6. Member verification flow

### What members do

1. Join the server → bot DMs them (if DMs allowed), **or**
2. Admin runs `/server test-invite`, **or**
3. Member runs `/verify link:https://stfc.pro/players/…` (optional screenshot attachment)

DM flow: screenshot (optional depending on policy) → stfc.pro link → roles / nick / channel / log post.

### Manual verify (existing servers)

Admins can link a Discord member to an stfc.pro profile **without** the DM flow — useful when onboarding a server that already has members:

```
/server verify user:@Them link:https://stfc.pro/players/…
/server verify user:@Them link:https://stfc.pro/players/… screenshot:<file>
```

This runs the same pipeline as self-verify (roles, nickname template, personal/diplomacy channels, verification log). The log embed notes `Manual by @Admin`. Repeat once per member; alliance guest rules still apply in single-alliance mode.

Requires Administrator. Set the archive channel first (`/server channels log`) so staff can audit these posts.

### Admin testing

```
/server test-invite              # DM yourself
/server test-invite user:@Them
/verify link:https://stfc.pro/players/…
/server test-reset               # clear your record to re-test
/server test-reset user:@Them
```

### Guest re-check (single-alliance)

Wrong alliance → guest role. Cron re-checks periodically; when the tag matches, they are promoted like a normal verify.

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

### Player flow

1. Donor registers (button or `/exchange donate resource:Crystal`)
2. Recipient taps **I need this** (or `/exchange need`) → eligible donors get a DM (name + ops) with **Help** / **Ignore**
3. First **Help** wins → recipient gets donor details + **Completed** / **Ask again**
4. **Ask again** re-notifies current cross-alliance donors
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
| Log channel name | `survey-{id}` |

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

`log_name` uses `{id}` (or `{n}`) for the survey number — e.g. `event-feedback-{id}` → `#event-feedback-12`. Applies to **new** surveys only (rename `#survey-1` manually in Discord if you want).

Empty `log_name` resets to `survey-{id}`.

### Create → test → send

```
/survey create question:"Ready for the event?" options:Yes|No|Maybe target:grade grades:5,6
```

| Option | Purpose |
|--------|---------|
| `question` | Shown to players |
| `options` | `A\|B\|C` — **2–5** answers (Discord button limit) |
| `target` | `all` · `role` · `rank` · `level` · `grade` · `users` |
| `delivery` | `dm` (default) or `personal_channel` (falls back to DM) |
| `grades` / `ranks` / `roles` / `users` / `ops_min` / `ops_max` | Filters for the chosen `target` |
| `alliance_tags` | Optional extra filter (comma-separated tags) |
| `log_category` | Optional category for **this** survey’s log channel (else server default from `/survey creators`) |

After create you get an ephemeral draft with buttons:

1. **Test to me** — DM yourself (draft clicks are **not** counted)
2. **Approve & send** — creates private log channel (name from `log_name` template), DMs/posts buttons to matched players, logs each vote
3. **Cancel** — deletes the draft

### Results & close

```
/survey list
/survey results id:12
/survey close id:12
```

`/survey results` shows a **Summary** vote table and a **Who voted** table.

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
| `/server channels …` | Personal channels + verification log |

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
| No verification DM / `DM open failed: 403` | Member privacy: **User Settings → Privacy** or server privacy — allow DMs from server members; or they blocked the bot. Use `/verify` in-channel as fallback; retry with `/server test-invite` after they fix privacy. After one 403 the bot stops auto-retrying that member (and posts to `/server channels urgent` if set) |
| Repeat “Verification invite failed” for people already verified | Fixed: manual `/server verify` marks invited; already `active`/`guest` are skipped; clobbered `pending_*` rows with player data are auto-restored. Redeploy to pick up — **no re-verify needed** if Discord roles still look correct |
| “Server not configured” | Run `/server setup` |
| Log channel silent | `/server channels log` set; bot can attach files; redeploy after feature add |
| Personal channel not created | Single-alliance + category map set; check `/server channels status` |
| `/server channels link` fails / “not a text channel” | Pick a **text** channel (not a category). Redeploy + re-register commands |
| `/server channels link` permission overwrite fails | Bot needs **Manage Channels** + **View Channel** on that channel/category. After deploy, link still saves and reports which overwrites failed; bot is granted View/Send first so it can post surveys |
| Diplomacy channel not created | Multi-alliance + `/server channels diplomacy enable:true`; rank write roles must exist from setup |
| Link finds no player | Member must verify first, or use `user:@Member` |
| stfc.pro lookup fails | Bot falls back to HTML scrape for numeric player IDs; confirm URL/server/region |
| Survey create denied | Admin or `/survey creators` role; run `/server setup` first |
| Survey DM missing | Member allows DMs from server members; bot can message them |
| Zero matched players | Check `target` filters vs verified roster (`/survey list` shows target count) |
| Exchange no donors notified | Need cross-alliance donors; verify alliance tags differ |
| Exchange role assign fails | Bot role above `{Resource} Donor` / `Need` roles |

---

## Discord agreement / code of conduct

Optional gate for **single-** or **multi-alliance** servers. Members must accept via a **DM “I agree” button** (channel reactions planned next). Acceptance is logged to **audit** and, on promote, noted on the **verification log**.

| Timing | Behaviour |
|--------|-----------|
| `after_verify` (default) | stfc.pro verify succeeds; member gets **guest/lounge** until they agree, then full member roles |
| `before_verify` | Must agree before screenshot / stfc.pro link is accepted |

```
/server agreement
/server agreement enabled:true timing:after_verify channel:#discord-agreement version:2026-07
/server agreement enabled:false
```

Bump `version` when the CoC changes to force re-accept. `mode:channel_react` is reserved — DM button is used until reaction support ships.

---

## DM assistant (Badgey / HAL)

Verified members (and admins) can **DM the bot** outside of verification:

| Message | Behaviour |
|---------|-----------|
| Unrecognized question / request | HAL: *I'm sorry \{name\}, I'm afraid I can't do that.* |
| Unknown / not verified | Badgey invite to join & verify |
| `menu` / `admin` / `help` | Admin button wizard (Administrator or Manage Server required) |
| Roster questions (e.g. “how many G6?”) | Allowed for admins, or roles set below |

Prefer slash commands for listings: `/roster grades`, `/roster grade grade:6`, `/roster ops min:50`, `/roster unverified`.

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
3. [ ] `/server channels extra-roles` — officers/roles that see **all** member channels (not part of setup)  
4. [ ] `/server channels audit create:true` — general bot audit (admin + automated actions)
5. [ ] `/server channels urgent create:true` — high-signal alerts (DM blocked, etc.; optional)
6. [ ] `/server channels log create:true` — verification archive (screenshots; separate from audit)
7. [ ] Members pick language on first DM (or `/language`) — player-facing messages are localized  
8. [ ] Link existing member channels with `/server channels link` if needed  
9. [ ] `/server channels plan` then `/server channels rebalance apply:true create_missing:true` (or manual `/server channels map`)  
10. [ ] Optional: `nickname_template`, rank roles, `/server bucket`  
11. [ ] Multi-alliance: `/server channels diplomacy enable:true write_roles:Diplomat write_ranks:Commodore,Admiral`  
12. [ ] Optional: `/survey creators` for officers who may poll the alliance  
13. [ ] Optional: `/exchange setup` + `/exchange resource create` for cross-alliance resources  
14. [ ] `/server test-invite` → verify yourself → check roles, log, personal/diplomacy channels  
15. [ ] Existing members: `/server verify user:@Them link:https://stfc.pro/…` (repeat as needed)  
16. [ ] `/server status` looks correct  
17. [ ] Optional: `/server assistant roles:…` for who may ask roster questions in DMs  
17. [ ] Optional: DM the bot as admin and say **menu** to try guided setup  
