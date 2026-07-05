# STFC Tools Discord Bot

Cloudflare Worker Discord bot for **Star Trek Fleet Command (STFC)**:

- **Alliance verification** — DM flow, stfc.pro validation, role assignment
- **Coordinate lookup** — parse in-game share links
- **Tables** — ASCII tables from CSV

**Setup:** see **[SETUP.md](./SETUP.md)** for fresh install and migration from older versions.

**Development context:** see [AGENTS.md](./AGENTS.md).

## Commands

| Command | Description |
|---------|-------------|
| `/lookup` | STFC coordinate lookup |
| `/table` | ASCII table from CSV |
| `/player` | stfc.pro player lookup (requires `/server setup`) |
| `/verify` | Verify STFC account with stfc.pro link |
| `/server setup` | Configure guild (admin) |
| `/server status` | Show guild configuration |

## Quick start

```bash
npm install
cp .env.template .env   # fill in Discord + D1 IDs — see SETUP.md
npm run generate-config
npm run db:migrate
npm run deploy
npm run register-commands
```

Full step-by-step instructions (Discord portal, secrets, Gateway, troubleshooting): **[SETUP.md](./SETUP.md)**.

## License

MIT
