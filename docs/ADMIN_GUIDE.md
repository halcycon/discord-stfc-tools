# Discord admin guide — STFC Tools

How to configure the bot **inside Discord** after it is deployed. For Cloudflare/Worker install steps, see [SETUP.md](../SETUP.md).

You need the **Administrator** permission in the Discord server for `/server` commands.

---

## Before you start

1. Invite the bot with: **Manage Roles**, **Manage Channels**, **Manage Nicknames**, **Send Messages**, **Attach Files**, **Embed Links**.
2. In **Server Settings → Roles**, drag the bot’s role **above** every role it will assign (member, guest, rank roles, overlays).
3. The bot **cannot rename the server owner** (Discord limitation). Nicknames still work for other members.
4. Members must allow DMs from server members for the join/DM verification flow.

Confirm the bot is live:

```
/server gateway
/server status
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

### Per-rank roles

Set on `/server setup` (`operative_roles`, `agent_roles`, …). On verify, the bot grants **member_roles** plus the matching rank roles.

Preview without changing anything:

```
/server rank-roles rank:Admiral
```

### Overlay buckets (e.g. leadership)

Extra roles for a set of ranks:

```
/server bucket name:leadership ranks:Premier,Commodore,Admiral role_ids:@Officer,@Diplomat create_if_missing:true
```

List roles / IDs:

```
/server roles
```

---

## 4. Verification log channel (admin archive)

Posts a **summary + screenshot** to a staff-only channel on each successful verify (active or guest). Screenshots are still stored in R2 when configured; the log channel is for day-to-day review without digging in storage.

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

## 5. Personal / member channels

### Auto-create (single-alliance)

1. Create Discord **categories** (e.g. `Members A–F`, `Members G–M`).
2. Map letter ranges:

```
/server categories
/server channels map category_map:A-F=111...,G-M=222...,N-Z=333...
```

Or one range at a time: `range:A-F` + `category_id:…`.

3. Roles that can see **all** personal channels (officers, diplomats):

```
/server channels extra-roles roles:@Officer,@Diplomat
```

4. On verify, the bot creates a private channel for the member in the matching category (name slug from player name), with access for the member + extra-roles.

Clear mappings (disables auto-create):

```
/server channels map clear:true
```

### Link existing channels (any mode)

If the server already has member or diplomacy channels, **do not recreate them** — link them:

```
/server channels link channel:#halcynicon player:Halcynicon
```

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

## 7. Surveys & polls (`/survey`)

Button surveys for verified players (DM or personal channel). Votes land in a private `#survey-{id}` log channel. Results use ASCII tables (buttons stay on the message — never inside tables).

### Who can create

| Setting | Default |
|---------|---------|
| Creators | **Administrators** only |
| Results viewers | Survey creator + Administrators |

```
/survey creators roles:Officer,Leadership
/survey creators results_roles:Officer
```

Use role IDs or `<@&id>` mentions, comma-separated. Empty `roles` clears back to admins-only.

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

After create you get an ephemeral draft with buttons:

1. **Test to me** — DM yourself (draft clicks are **not** counted)
2. **Approve & send** — creates `#survey-{id}`, DMs/posts buttons to matched players, logs each vote
3. **Cancel** — deletes the draft

### Results & close

```
/survey list
/survey results id:12
/survey close id:12
```

`/survey results` shows a **Summary** vote table and a **Who voted** table.

---

## 8. Other `/server` commands

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

## 9. Utility commands (everyone)

| Command | Purpose |
|---------|---------|
| `/player` | Live stfc.pro lookup (needs `/server setup`) |
| `/lookup` | Coordinate share-string lookup |
| `/table` / `/tablehelp` | CSV → ASCII table |
| `/survey …` | Surveys / polls (creator roles; see §7) |

---

## 10. Troubleshooting

| Symptom | Likely fix |
|---------|------------|
| Roles not assigned | Bot role **above** target roles; bot has Manage Roles |
| Nickname fails (403) | Manage Nicknames; bot role above member; **owner cannot be renamed** |
| No verification DM | Member privacy (allow DMs); `/server gateway` Ready; bot token secret set |
| “Server not configured” | Run `/server setup` |
| Log channel silent | `/server channels log` set; bot can attach files; redeploy after feature add |
| Personal channel not created | Single-alliance + category map set; check `/server channels status` |
| Diplomacy channel not created | Multi-alliance + `/server channels diplomacy enable:true`; rank write roles must exist from setup |
| Link finds no player | Member must verify first, or use `user:@Member` |
| stfc.pro lookup fails | Bot falls back to HTML scrape for numeric player IDs; confirm URL/server/region |
| Survey create denied | Admin or `/survey creators` role; run `/server setup` first |
| Survey DM missing | Member allows DMs from server members; bot can message them |
| Zero matched players | Check `target` filters vs verified roster (`/survey list` shows target count) |

---

## Quick checklist (new alliance server)

1. [ ] Bot invited; role near top of list  
2. [ ] `/server setup` with server, region, mode, tag, roles  
3. [ ] `/server channels extra-roles` for officers who see all member channels  
4. [ ] `/server channels map` (single-alliance personal channels) **or** plan to `/server channels link` existing ones  
5. [ ] `/server channels log create:true`  
6. [ ] Optional: `nickname_template`, rank roles, `/server bucket`  
7. [ ] Multi-alliance: `/server channels diplomacy enable:true write_roles:Diplomat write_ranks:Commodore,Admiral`  
8. [ ] Optional: `/survey creators` for officers who may poll the alliance  
9. [ ] `/server test-invite` → verify yourself → check roles, log, personal/diplomacy channels  
10. [ ] `/server status` looks correct  
