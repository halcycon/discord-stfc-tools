# Admin web (STFC Tools)

Cloudflare Pages app (Root directory: `admin-web`). UI uses a custom **LCARS** theme (TNG-inspired elbows, Antonio typeface, classic Okuda/Drexler palette) — see `src/lcars/`.

## Public URLs

| Path | Purpose |
|------|---------|
| `/` | Landing |
| `/privacy` | Privacy Policy (Discord verification) |
| `/terms` | Terms of Service |
| `/login` | Discord OAuth admin login |
| `/app` | Guild picker / dashboard (auth required) |

Edit operator contact via **Pages secrets** (`npm run admin-web:push-env`) or local deploy (`npm run admin-web:deploy`). See `.env.example` / root `ADMIN_WEB_PAGES_PROJECT`.

## Pages project

- Build: `npm ci && npm run build`
- Output: `dist`
- Env: `VITE_API_BASE_URL` = Worker URL

See [docs/ADMIN_WEB.md](../docs/ADMIN_WEB.md) and [docs/BOT_MIGRATION.md](../docs/BOT_MIGRATION.md).
