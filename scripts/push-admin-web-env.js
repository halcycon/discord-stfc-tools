#!/usr/bin/env node
/**
 * Push admin-web/.env (VITE_*) to a Cloudflare Pages project as secrets.
 *
 * Pages Git builds inject project secrets/vars into the build environment, so Vite
 * can bake them into the static bundle. After pushing, trigger a new Pages deploy
 * (dashboard "Retry deployment", or `npm run admin-web:deploy`).
 *
 * Usage:
 *   npm run admin-web:push-env
 *   ADMIN_WEB_PAGES_PROJECT=my-pages-app npm run admin-web:push-env
 *
 * Requires: wrangler logged in, admin-web/.env present, ADMIN_WEB_PAGES_PROJECT set
 * (root .env or environment).
 */
require('dotenv').config(); // root .env — project name, etc.
const { config: loadEnv } = require('dotenv');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ADMIN_ENV = path.join(ROOT, 'admin-web', '.env');

loadEnv({ path: ADMIN_ENV, override: true });

const project =
	process.env.ADMIN_WEB_PAGES_PROJECT?.trim() ||
	process.env.CLOUDFLARE_PAGES_PROJECT?.trim() ||
	'';

if (!project) {
	console.error('❌ Set ADMIN_WEB_PAGES_PROJECT to your Cloudflare Pages project name.');
	console.error('   Add it to the repo root .env (see .env.template), e.g.:');
	console.error('   ADMIN_WEB_PAGES_PROJECT=stfc-tools-admin');
	process.exit(1);
}

if (!fs.existsSync(ADMIN_ENV)) {
	console.error(`❌ Missing ${ADMIN_ENV}`);
	console.error('   Copy admin-web/.env.example → admin-web/.env and fill VITE_* values.');
	process.exit(1);
}

/** Parse KEY=VALUE lines (ignore comments / blank). */
function parseEnvFile(filePath) {
	const out = {};
	for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq < 1) continue;
		const key = trimmed.slice(0, eq).trim();
		let val = trimmed.slice(eq + 1).trim();
		if (
			(val.startsWith('"') && val.endsWith('"')) ||
			(val.startsWith("'") && val.endsWith("'"))
		) {
			val = val.slice(1, -1);
		}
		if (key) out[key] = val;
	}
	return out;
}

const parsed = parseEnvFile(ADMIN_ENV);
const viteKeys = Object.keys(parsed)
	.filter((k) => k.startsWith('VITE_') && String(parsed[k] ?? '').trim() !== '')
	.sort();

if (viteKeys.length === 0) {
	console.error('❌ No non-empty VITE_* keys found in admin-web/.env');
	process.exit(1);
}

const tmpPath = path.join(ROOT, '.admin-web-pages-secrets.tmp');
const bulkBody = viteKeys.map((k) => `${k}=${parsed[k]}`).join('\n') + '\n';

try {
	fs.writeFileSync(tmpPath, bulkBody, { mode: 0o600 });
	console.log(`📤 Pushing ${viteKeys.length} VITE_* secret(s) to Pages project "${project}"…`);
	for (const k of viteKeys) {
		console.log(`   • ${k}`);
	}
	execSync(`npx wrangler pages secret bulk "${tmpPath}" --project-name="${project}"`, {
		stdio: 'inherit',
		cwd: ROOT,
	});
	console.log('✅ Pages secrets updated.');
} finally {
	if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
}

console.log(`
Next: trigger a Pages rebuild so Vite bakes the new values:

  • Dashboard → Workers & Pages → ${project} → Deployments → Retry deployment
  • Or build+upload from this machine (uses admin-web/.env directly):

      npm run admin-web:deploy

Note: VITE_* values end up in the public JS bundle (expected for Privacy/Terms).
Secrets here only keep them out of git / the Pages UI plaintext list.
`);
