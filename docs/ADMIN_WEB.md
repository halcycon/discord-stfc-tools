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

**Operator identity is not committed.** Set Cloudflare Pages environment variables (or `admin-web/.env` locally — gitignored):

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

Vite bakes `VITE_*` into the static build — change them in Pages, then **redeploy** Pages. Fallbacks in code are placeholders only (`[OPERATOR LEGAL NAME]`, etc.). Markdown sources: `admin-web/src/legal/*.md`.

## Setup

1. Discord Developer Portal → your application → **OAuth2**
   - Add redirect: `{WORKER_URL}/api/admin/auth/callback`
   - Client secret → `.env` as `DISCORD_CLIENT_SECRET`
2. Generate `ADMIN_SESSION_SECRET` (long random string)
3. Set `ADMIN_WEB_ORIGIN` to your Pages URL (and `http://localhost:5173` for local), comma-separated
4. Optional: `DISCORD_CLIENT_ID` if different from `DISCORD_APPLICATION_ID`
5. `npm run push-env` then `npm run deploy`
6. Apply migration `033_web_admin_roles.sql` (`npm run db:migrate`) if not already
7. Create Pages project on this repo, root `admin-web`, env `VITE_API_BASE_URL=<WORKER_URL>`
8. After Pages is live, paste `https://<pages>/privacy` and `https://<pages>/terms` into Discord’s verification / privacy fields

## Access control

- Discord **Administrator**, or
- Member of a role listed in `guild_configs.web_admin_role_ids` (editable in the web Config form)

## Local

```bash
# terminal 1
npm run dev

# terminal 2
cd admin-web && cp .env.example .env && npm run dev
```

Open http://localhost:5173 — public `/privacy` and `/terms` work without OAuth. API calls and login cookies use `VITE_API_BASE_URL` (Worker on :8787).
