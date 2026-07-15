# Admin web UI (Cloudflare Pages)

Additive dashboard for Discord Administrators and configured web-admin roles. Slash commands remain the primary ops surface.

**New Discord app / D1 reuse:** [BOT_MIGRATION.md](./BOT_MIGRATION.md)

## Layout

| Path | Cloudflare project |
|------|--------------------|
| Repo root (`src/`, wrangler) | **Worker** — bot + `/api/admin/*` |
| [`admin-web/`](../admin-web/) | **Pages** — set Root directory to `admin-web` |

## Public pages (no login)

Use these URLs for Discord Developer Portal verification and consent links:

| Page | Path |
|------|------|
| Landing | `/` |
| Privacy Policy | `/privacy` |
| Terms of Service | `/terms` |
| Admin login | `/login` |
| Authenticated console | `/app` |

**Operator identity is not committed.** Keep values in `admin-web/.env` (gitignored), then push or deploy:

```bash
# root .env
ADMIN_WEB_PAGES_PROJECT=your-pages-project-name

npm run admin-web:push-env   # upload VITE_* to Pages as secrets (for Git builds)
# then Retry deployment in the Pages dashboard — OR:
npm run admin-web:deploy     # local Vite build (reads admin-web/.env) + wrangler pages deploy
```

| Variable | Used for |
|----------|----------|
| `VITE_LEGAL_PRODUCT_NAME` | Product name in titles / body |
| `VITE_LEGAL_LEGAL_NAME` | Operator legal / trading name |
| `VITE_LEGAL_CONTACT` | Email or contact form URL |
| `VITE_LEGAL_ADDRESS` | Optional postal address |
| `VITE_LEGAL_GOVERNING_LAW` | Governing law |
| `VITE_LEGAL_VENUE` | Venue |
| `VITE_LEGAL_LIABILITY_CAP` | Liability cap wording |
| `VITE_LEGAL_EFFECTIVE_DATE` | Effective date |
| `VITE_LEGAL_VERSION` | Policy version |
| `VITE_API_BASE_URL` | Worker API origin |

`VITE_*` are baked into the static JS at **build** time. Git-connected Pages builds need those vars on the project (`admin-web:push-env`); a direct `admin-web:deploy` bakes from your local `.env` without waiting on Git. Fallbacks in code are placeholders only. Markdown sources: `admin-web/src/legal/*.md`.

## Setup

1. Discord Developer Portal → your application → **OAuth2**
   - Add redirect: `{WORKER_URL}/api/admin/auth/callback`
   - Client secret → `.env` as `DISCORD_CLIENT_SECRET`
2. Generate `ADMIN_SESSION_SECRET` (long random string)
3. Set `ADMIN_WEB_ORIGIN` to your Pages URL (and `http://localhost:5173` for local), comma-separated
4. Optional: `DISCORD_CLIENT_ID` if different from `DISCORD_APPLICATION_ID`
5. `npm run push-env` then `npm run deploy`
6. Apply migration `033_web_admin_roles.sql` (`npm run db:migrate`) if not already
7. Create Pages project on this repo, root `admin-web`
8. Set `ADMIN_WEB_PAGES_PROJECT` in root `.env`, fill `admin-web/.env`, then `npm run admin-web:push-env` and retry the Pages deployment (or `npm run admin-web:deploy`)
9. After Pages is live, paste `https://<pages>/privacy` and `https://<pages>/terms` into Discord’s verification / privacy fields

## Access control

- Discord **Administrator** always has access (server Admin permission bit).
- Optionally, members of roles listed in `guild_configs.web_admin_role_ids` (empty by default = **Administrators only** — not all guild members).
- Guild dashboard: **List roles** loads Discord roles via the bot; tick roles to grant web access. **Suggest leadership** selects Premier/Commodore/Admiral roles already configured in `/server setup`.

## Auth (Pages + Worker)

OAuth callback runs on the **Worker**. The SPA lives on **Pages** (different origin). Session cookies on the Worker are third-party to the SPA, so mobile Safari often drops them and you bounce back to `/login`.

Fix: after Discord OAuth, the Worker redirects to `/auth/callback?stfc_session=…` on Pages; the SPA stores the signed token in `sessionStorage` and sends `Authorization: Bearer …` on API calls (cookie still set as a best-effort fallback).

## Local

```bash
# terminal 1
npm run dev

# terminal 2
cd admin-web && cp .env.example .env && npm run dev
```

Open http://localhost:5173 — public `/privacy` and `/terms` work without OAuth. API calls and login cookies use `VITE_API_BASE_URL` (Worker on :8787).
