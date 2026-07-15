# Privacy Policy — STFC Tools Discord Bot

**Effective date:** 14 July 2026  
**Version:** 1.0

> **Not legal advice.** This policy describes how the STFC Tools Discord bot (“the Bot”) processes personal data in practice. Set operator details via Cloudflare Pages `VITE_LEGAL_*` env vars (see [ADMIN_WEB.md](./ADMIN_WEB.md)), confirm controller/processor roles with counsel, and publish a stable URL before linking it from Discord consent flows.

**Public URL (Cloudflare Pages):** `/privacy` on the admin site — see [ADMIN_WEB.md](./ADMIN_WEB.md) and [BOT_MIGRATION.md](./BOT_MIGRATION.md).

---

## 1. Plain summary

The Bot helps Discord servers for **Star Trek Fleet Command (STFC)** verify players and run alliance tools. To do that it may link your **Discord user ID** to your **in-game / stfc.pro player identity**, store verification screenshots, and keep operational records (roles, channels, survey answers, activity).

- **Guild admins** decide whether the Bot runs in their server and which features are on.
- **[OPERATOR LEGAL NAME]** hosts the Bot (Cloudflare). Contact: **[CONTACT EMAIL OR FORM]**.
- Where a Guild enables the data-consent gate (`/server consent`), you will be asked to agree **before** screenshot / stfc.pro verification proceeds.

This Bot is **not** affiliated with Scopely, Paramount, Discord, or stfc.pro.

---

## 2. Who is responsible (controllers)

| Party | Typical role |
|-------|----------------|
| **Discord server (Guild) administrators** | Decide to invite the Bot; configure verification, consent, CoC, surveys, and who can see logs. For data processed **for that Guild’s community management**, they are usually the **data controller** (or joint controller). |
| **[OPERATOR LEGAL NAME]** (“Operator”, “we”) | Provides hosting and software. May act as **processor** for Guilds and/or **controller** for infrastructure logs, abuse prevention, and multi-tenant operation of the service. |
| **Discord** | Controller for your Discord account. See [Discord Privacy Policy](https://discord.com/privacy). |
| **stfc.pro / similar sites** | Controllers for data they publish; we only request publicly available player/alliance information they expose. |

If you are unsure who to contact first: ask the **admins of the Discord server** where you used the Bot; for hosting/deletion across our infrastructure, contact **[CONTACT EMAIL OR FORM]**.

---

## 3. Data we process

Categories depend on which features the Guild enables and what you submit.

### 3.1 Discord identifiers and membership

- Discord user ID, guild ID, role IDs, channel IDs
- Whether you are a known member, excluded from invites, or blocked DMs (technical delivery status)
- Preferred language for Bot DMs (`/language`)

### 3.2 Verification and STFC identity

- In-game player name, player ID, alliance tag, ops level, power, grade, alliance rank (from stfc.pro and/or admin entry)
- stfc.pro profile URL you submit
- Verification status (e.g. pending, verified, guest, failed)
- Profile **screenshots** you send for verification (stored in object storage when configured; metadata in the database; may also appear in a Guild verification log channel)
- Consent records: choice (accepted/declined), version, timestamp, method
- Optional code-of-conduct agreement records (separate from data consent)

### 3.3 Server automation

- Personal / diplomacy channel IDs linked to you
- Nickname templates applied on Discord
- Activity / inactivity streaks derived from alliance roster scrapes
- Daily sync history (ops/power/alliance snapshots) for trend and demotion tools

### 3.4 Surveys and similar tools

- Survey questions, options, targeting rules
- Your vote / response and timestamp (one response per survey per user)
- Survey delivery preference (DM vs personal channel)

### 3.5 Resource exchange / admin tools

- Opt-in exchange donor/recipient style records as configured by the Guild
- Admin audit events (who ran which command; automated cron summaries)

### 3.6 Technical / operational data

- Cloudflare Worker request logs and error logs (may include Discord IDs in error context)
- Bot configuration for each Guild (roles, categories, feature flags)—not usually “your” personal data, but may reference role/channel IDs

We do **not** intentionally collect payment card data, government IDs, or precise GPS location. Do not put sensitive personal data in screenshots beyond what is needed to verify your STFC profile.

---

## 4. Why we process data (purposes and legal bases)

| Purpose | Examples | Typical legal basis (EU/UK GDPR) |
|---------|----------|-----------------------------------|
| Identity verification & access control | Link Discord ↔ STFC player; assign member/guest roles; personal channels | **Consent** (when `/server consent` is enabled); otherwise **legitimate interests** of the Guild in managing an alliance Discord, and/or **contract** if membership rules require verification |
| Ongoing membership integrity | Daily stfc.pro sync; demotion / guest when alliance changes | Legitimate interests (Guild) |
| Communication | Verification DMs, welcome DM, survey delivery, demotion notices | Legitimate interests / consent as configured |
| Surveys & roster tools | Collect votes; list grades / unverified | Legitimate interests (Guild); consent where required |
| Security & abuse prevention | Audit logs; rate limits; excluding bots from invites | Legitimate interests (Operator & Guild) |
| Legal compliance | Respond to lawful requests | Legal obligation |

Where processing is based on **consent**, you can decline; verification that depends on that lookup will not proceed. Declining does not automatically remove you from Discord—that is controlled by Guild admins.

---

## 5. Where data is stored and who sees it

- **Primary storage:** Cloudflare **D1** (SQL) and optional **R2** (verification screenshots), in regions Cloudflare provides for the Operator’s account.
- **Discord:** Messages, embeds, and log channels live on Discord’s infrastructure (verification archive, audit, urgent, survey log channels). Guild staff with access to those channels can see relevant content (including screenshots posted to log channels).
- **stfc.pro:** Lookups are outbound requests; we do not control how long that site retains its own data.

**Access within a Guild:** typically Bot process + Discord Administrators + roles configured for verification logs, audit, survey creators/results, etc.

**Operator access:** may access tenant data as needed to operate, debug, secure, or delete the service, under confidentiality and least privilege.

We do not sell personal data.

---

## 6. Sharing and international transfers

Data is shared with:

- **Discord**, **Cloudflare**, and (for lookups) **stfc.pro** as processors or independent controllers of their platforms
- **Guild moderators / configured staff roles** via Discord channels and Bot commands
- Authorities if required by law

Cloudflare and Discord may process data in the United States and other countries. Where GDPR/UK GDPR applies, transfers rely on those providers’ transfer mechanisms (e.g. SCCs) as described in their policies.

---

## 7. Retention

| Data | Typical retention |
|------|-------------------|
| Guild config | Until the Bot is removed / config deleted |
| Verified player links, consent, agreement stamps | While you remain relevant to that Guild’s membership tools, or until erasure is completed |
| Verification screenshots (R2) | Retained for audit/troubleshooting; **not routinely deleted** by automation (admins/Operator may purge on request where feasible) |
| Survey responses | While the survey/Guild record exists |
| Stats history / activity | While useful for sync/demotion features, or until purged |
| Cloudflare logs | Per Cloudflare / Operator log retention (often short-lived) |

When a Guild removes the Bot, data for that `guild_id` may remain until Operator deletion procedures run—contact **[CONTACT EMAIL OR FORM]** to request erasure of hosted records.

---

## 8. Your rights

Depending on your location (especially EEA/UK), you may have rights to **access**, **rectification**, **erasure**, **restriction**, **portability**, and **objection**, and to **withdraw consent** without affecting prior lawful processing.

**How to exercise:**

1. **Guild-scoped requests** (roles, CoC, local channel content): contact that server’s admins first.
2. **Hosted database / screenshot erasure or export:** contact **[CONTACT EMAIL OR FORM]** and include your Discord user ID and the server name/ID if known.
3. You may also complain to your local data protection authority (e.g. ICO in the UK).

Withdrawing data consent (or declining it) stops verification lookups; it may not delete historical screenshots or audit entries already stored—ask for erasure explicitly if you want those removed.

---

## 9. Children

The Bot is intended for users who meet Discord’s age requirements. We do not knowingly collect data from children under that age. If you believe a child has submitted data, contact us to delete it.

---

## 10. Automated decision-making

The Bot applies **rules configured by Guild admins** (e.g. alliance tag match → member roles; mismatch → guest; inactivity streaks). These are not “profiling” for marketing. Significant membership decisions should be reviewable by Guild admins (`/roster`, audit logs, demotion policy settings).

---

## 11. Security

We use managed cloud infrastructure (Cloudflare), Discord-signed interactions, and access-controlled private channels for sensitive logs. No method of transmission or storage is 100% secure. Limit what you put in screenshots; prefer official verification flows over posting profiles in public channels.

---

## 12. Changes

We may update this policy by publishing a new version with a new effective date. When processing purposes change materially, Guilds should bump the `/server consent` version so members re-consent where that gate is used.

**Related documents:** [Terms of Service](./TERMS_OF_SERVICE.md) · [Admin guide — consent](./ADMIN_GUIDE.md#data-processing-consent-gdpr--optional-coc)

---

## 13. Contact

**Operator / privacy contact:** **[CONTACT EMAIL OR FORM]**  
**Postal address (if required):** **[ADDRESS]**  
**Guild questions:** Discord server administrators where you use the Bot
