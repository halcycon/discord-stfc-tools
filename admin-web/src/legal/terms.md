# Terms of Service — STFC Tools Discord Bot

**Effective date:** 15 July 2026  
**Version:** 1.1

> **Not legal advice.** These terms are a starting template for operators of the STFC Tools Discord bot (“the Bot”). Have them reviewed for your jurisdiction before relying on them. Set real operator details via Cloudflare Pages `VITE_LEGAL_*` env vars (see [ADMIN_WEB.md](./ADMIN_WEB.md)) — do not commit personal legal identity in the public repo.

**Public URL (Cloudflare Pages):** `/terms` on the admin site — see [ADMIN_WEB.md](./ADMIN_WEB.md) and [BOT_MIGRATION.md](./BOT_MIGRATION.md).

---

## 1. Who these terms are with

**STFC Tools** is an open-source Discord application that helps Star Trek Fleet Command (STFC) Discord servers with player verification, roles, channels, surveys, roster tools, and related alliance management.

| Party | Role |
|-------|------|
| **[OPERATOR LEGAL NAME]** (“we”, “us”, “Operator”) | Hosts and maintains the Bot infrastructure (e.g. Cloudflare Worker, database, optional object storage). Contact: **[CONTACT EMAIL OR FORM]**. |
| **Server administrators** | People who invite the Bot into a Discord server (“Guild”) and configure it. They decide how the Bot is used in that Guild. |
| **You** | A Discord user who interacts with the Bot (member, admin, or otherwise). |

By inviting the Bot, configuring it, or using its commands / DMs / buttons, you agree to these Terms. If you do not agree, do not use the Bot (and ask Guild admins to remove it if you invited it).

Discord’s [Terms of Service](https://discord.com/terms) and [Community Guidelines](https://discord.com/guidelines) also apply. In-game play is governed by Scopely’s and related game terms. See **§9** for trademarks and affiliation.

---

## 2. What the Bot does

Depending on Guild configuration, the Bot may:

- Send verification invites and other messages via Discord DM or in-server channels
- Accept profile screenshots and stfc.pro profile links for verification
- Fetch publicly available player data from **stfc.pro** (and similar public STFC data sources)
- Assign or remove Discord roles, nicknames, and personal / diplomacy channels
- Run surveys, roster reports, resource exchange helpers, activity sync, and admin audit logging
- Store configuration and player-link records for that Guild

Features are optional and controlled by Guild admins (`/server`, `/channels`, `/survey`, etc.). Exact behaviour varies by Guild settings (e.g. single- vs multi-alliance mode).

---

## 3. Eligibility and accounts

- You must comply with Discord’s age and account requirements.
- You must only verify **your own** STFC identity (or use admin tools only with authority granted by the Guild).
- Do not submit another person’s screenshots, profile links, or personal data without permission.

---

## 4. Acceptable use

You agree not to:

- Abuse, spam, reverse-engineer, or overload the Bot or its upstream APIs (including stfc.pro)
- Attempt to circumvent verification, consent gates, or role security
- Use the Bot to harass, dox, or unlawfully process others’ data
- Use the Bot in violation of Discord rules, applicable law, or your Guild’s code of conduct
- Impersonate players or submit false verification materials

We or Guild admins may refuse service, close surveys, revoke verification-related access, or remove the Bot from a Guild if misuse is suspected.

---

## 5. Roles of Operator vs Guild admins

- **Guild admins** choose whether to invite the Bot, which features to enable, who can run admin commands, and how verification / consent / CoC gates work in that server.
- **We** provide software and hosting. We do not control day-to-day Guild moderation, alliance membership decisions, or Discord server rules, except where we must act to protect the service or comply with law.
- A Guild’s optional **code of conduct** (via `/server agreement`) is that Guild’s rules, not our corporate policy.

---

## 6. Third-party services

The Bot depends on third parties, including:

- **Discord** — messaging, identity, roles, channels
- **Cloudflare** — Worker compute, D1 database, optional R2 storage, networking
- **stfc.pro** (and similar) — public STFC player / alliance data

Their availability, accuracy, and policies are outside our control. Game or site data may be wrong, delayed, or unavailable; verification and sync features may fail as a result.

---

## 7. No warranties

The Bot is provided **“as is”** and **“as available”**, without warranties of any kind, including fitness for a particular purpose, uninterrupted availability, or accuracy of STFC / Discord data. Alliance tools can mis-assign roles if upstream data or configuration is wrong—admins should review critical changes.

---

## 8. Limitation of liability

To the maximum extent permitted by law:

- We are not liable for indirect, incidental, special, consequential, or punitive damages, or loss of data, profits, or goodwill, arising from use of the Bot.
- Our total liability for claims relating to the Bot is limited to **[AMOUNT, e.g. £0 / USD 0]** or the amount you paid us for the Bot in the 12 months before the claim (if any)—whichever is greater.
- Guild admins remain responsible for how they configure and use the Bot in their server.

Nothing in these Terms excludes liability that cannot be excluded under applicable law (e.g. fraud, or certain consumer rights).

---

## 9. Intellectual property, trademarks, and affiliation

### 9.1 Our software

Bot software may be offered under an open-source licence in the project repository; that licence governs use of **our** code. You retain rights in content you submit (e.g. screenshots); you grant us and the Guild a licence to store and use that content solely to operate the Bot’s features for that Guild.

### 9.2 Third-party trademarks

This project is an **unofficial, fan-made** tool. It is **not** affiliated with, endorsed by, sponsored by, or approved by the owners of the following (or their affiliates), except as those parties’ own terms may allow for ordinary use of their platforms:

| Mark / name | Typical rights holder (informational) |
|-------------|----------------------------------------|
| **Star Trek**, related logos, characters, and settings | Paramount Global / CBS Studios (and related licensors) |
| **Star Trek Fleet Command** (STFC) and related game assets | Scopely (publisher) and its licensors |
| **Discord** name and logos | Discord Inc. |
| **Cloudflare** name and logos | Cloudflare, Inc. |
| **stfc.pro** and similar community / data sites | Their respective operators (independent of Scopely and of us) |

All such names and marks are the property of their respective owners. Use of those names in this Bot, documentation, or marketing is for **identification and interoperability only** (e.g. describing the game the Bot helps manage, or the public data source used for verification).

### 9.3 No official relationship

- We do **not** claim any official partnership with Paramount, CBS, Scopely, Discord, Cloudflare, or stfc.pro.
- The Bot is **not** an official Star Trek, STFC, Discord, or stfc.pro product.
- Game data obtained via third-party sites (including stfc.pro) may be incomplete or inaccurate; those sites’ terms and availability are outside our control.
- Nothing in these Terms grants you any licence to use third-party trademarks beyond what their owners already allow.

### 9.4 Your content and Guild branding

Alliance tags, Discord server names, and similar labels belong to the relevant communities or rights holders. We do not claim ownership of them.

---

## 10. Suspension and termination

- You may stop using the Bot at any time (leave the Guild, block the Bot, or ask admins to remove your data—see the Privacy Policy).
- Guild admins may remove the Bot from a Guild at any time.
- We may suspend or discontinue the Bot or any feature with or without notice (including for abuse, cost, or legal reasons).

---

## 11. Changes

We may update these Terms by posting a new version (and bumping the version / effective date). Material changes that affect data processing may also require Guilds to bump `/server consent` version so members re-confirm. Continued use after the effective date constitutes acceptance of the updated Terms where permitted by law.

---

## 12. Governing law

These Terms are governed by the laws of **[COUNTRY / REGION]**, without regard to conflict-of-law rules. Courts of **[VENUE]** have exclusive jurisdiction, except where mandatory consumer protections require otherwise.

---

## 13. Contact

Questions about these Terms: **[CONTACT EMAIL OR FORM]**  
For Guild-specific questions (roles, CoC, why you were demoted): contact that Discord server’s admins.
