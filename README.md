# STFC Tools Discord Bot

Cloudflare Worker Discord bot for **Star Trek Fleet Command (STFC)**:

- **Alliance verification** — DM flow, stfc.pro validation, role assignment
- **Alliance roster sync** — morning fetch of your alliance page; day-over-day joins/leaves/ops/rank report on the audit channel; verify + daily sync prefer the cache (single-alliance)
- **Coordinate lookup** — parse in-game share links
- **Tables** — ASCII tables from CSV

**Version:** see **[VERSION_HISTORY.md](./VERSION_HISTORY.md)** (MAJOR.MINOR.INCREMENTAL). Current release is shown in `/server status`.

**Setup:** see **[SETUP.md](./SETUP.md)** for fresh install and migration from older versions.

**Discord admins:** see **[docs/ADMIN_GUIDE.md](./docs/ADMIN_GUIDE.md)** for in-server configuration (roles, nicknames, channels, verification log, **daily alliance roster**).

**Development context:** see [AGENTS.md](./AGENTS.md) (architecture, roster sync, cron).

## Commands

| Command | Description |
|---------|-------------|
| `/lookup` | STFC coordinate lookup |
| `/table` | ASCII table from CSV |
| `/player` | stfc.pro player lookup (requires `/server setup`) |
| `/verify` | Verify STFC account with stfc.pro link |
| `/server setup` | Configure guild (admin) |
| `/server status` | Show guild configuration |
| `/channels …` | Personal channels, link existing, verification/audit/urgent logs |
| `/diplomacy …` | Multi-alliance diplomacy channels |

## Quick start

```bash
npm install
cp .env.template .env   # fill in Discord + D1 IDs — see SETUP.md
npm run push-env
npm run db:migrate
npm run deploy
npm run register-commands
```

Full step-by-step instructions (Discord portal, secrets, Gateway, troubleshooting): **[SETUP.md](./SETUP.md)**.

## License

MIT
