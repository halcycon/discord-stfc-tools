# Admin Web UI Setup (Cloudflare Pages)

The admin web UI is an optional frontend for managing STFC Tools through a browser. It is deployed separately from the Cloudflare Worker using Cloudflare Pages.

## Prerequisites

Before setting up the admin UI, make sure:

* The Worker is deployed successfully.
* Discord OAuth is configured for the application.
* You have completed the main Worker setup.
* Wrangler is authenticated:

```bash
npx wrangler login
```

## Configuration overview

The admin UI uses two separate configurations:

### Worker configuration

The root `.env` controls the Worker:

```env
ADMIN_WEB_ORIGIN=https://your-pages-project.pages.dev
ADMIN_WEB_PAGES_PROJECT=stfc-tools-admin

DISCORD_CLIENT_SECRET=your-discord-client-secret
ADMIN_SESSION_SECRET=random-secret-string
```

`ADMIN_WEB_ORIGIN` must match the deployed Pages URL. It is used for CORS and post-login redirects.

### Admin UI configuration

The frontend uses `admin-web/.env`.

Create it from the example:

```bash
cd admin-web
cp .env.example .env
```

Set the Worker API URL:

```env
VITE_API_BASE_URL=https://your-worker.workers.dev
```

For local development:

```env
VITE_API_BASE_URL=http://127.0.0.1:8787
```

For production:

```env
VITE_API_BASE_URL=https://your-worker-name.your-subdomain.workers.dev
```

## Create the Cloudflare Pages project

Create the Pages project once:

```bash
npx wrangler pages project create stfc-tools-admin --production-branch main
```

The project name must match:

```env
ADMIN_WEB_PAGES_PROJECT=stfc-tools-admin
```

## Push frontend environment variables

The repository includes a helper script that uploads `VITE_*` variables from `admin-web/.env` to Cloudflare Pages.

From the repository root:

```bash
npm run admin-web:push-env
```

This keeps environment values out of git while allowing Vite to inject them during builds.

## Deploy the admin UI

Deploy the frontend:

```bash
npm run admin-web:deploy
```

This will:

1. Build the Vite application.
2. Upload `admin-web/dist` to Cloudflare Pages.
3. Deploy the new version.

The deployment URL will be shown after completion.

## Configure Discord OAuth

In the Discord Developer Portal:

1. Open your application.
2. Go to **OAuth2 → Redirects**.
3. Add:

```
https://YOUR-WORKER-URL/api/admin/auth/callback
```

Example:

```
https://stfc-tools.example.workers.dev/api/admin/auth/callback
```

The callback URL points to the Worker, not the Pages site.

## Local development

Run the Worker locally:

```bash
npm run dev
```

The Worker runs on:

```
http://127.0.0.1:8787
```

Run the admin UI:

```bash
npm run admin-web:dev
```

The frontend runs on:

```
http://localhost:5173
```

Use:

```env
ADMIN_WEB_ORIGIN=http://localhost:5173
```

for local testing.

## Troubleshooting

### Pages deploy warns about `wrangler.json`

Example warning:

```
Pages now has wrangler.json support.
Detected configuration file but it is missing pages_build_output_dir.
Ignoring configuration file.
```

This is expected.

The repository uses `wrangler.json` for the Worker configuration. Pages deployments use:

```bash
wrangler pages deploy admin-web/dist
```

and do not use the Worker configuration file.

### Login fails after deployment

Check:

1. `ADMIN_WEB_ORIGIN` matches the Pages URL exactly.
2. Discord OAuth redirect includes:

```
https://YOUR-WORKER-URL/api/admin/auth/callback
```

3. The Worker was redeployed after changing environment variables.

## After first deployment

Initialize the production D1 schema:

npm run db:migrate

Then deploy the Worker:

npm run deploy

## Admin login troubleshooting

If Discord OAuth succeeds but the admin panel immediately shows you as logged out:

The issue is usually browser cookie restrictions.

The default Cloudflare URLs:

- Pages: `*.pages.dev`
- Workers: `*.workers.dev`

are considered different sites by browsers.

For testing:
- Allow third-party cookies.

For production:
- Configure custom domains for both Pages and Worker.

Example:

Admin UI:
https://admin.example.com

API:
https://api.example.com

## Deployment checklist

* [ ] Worker deployed
* [ ] Pages project created
* [ ] `admin-web/.env` configured
* [ ] `VITE_API_BASE_URL` points to Worker URL
* [ ] Pages environment uploaded with `npm run admin-web:push-env`
* [ ] Admin UI deployed with `npm run admin-web:deploy`
* [ ] `ADMIN_WEB_ORIGIN` updated in Worker `.env`
* [ ] Worker redeployed
* [ ] Discord OAuth redirect configured
