#!/usr/bin/env node
/**
 * Build admin-web locally (reads admin-web/.env) and upload dist to Cloudflare Pages.
 * Use when you want an immediate deploy without waiting on a Git-triggered rebuild.
 *
 * Usage:
 *   npm run admin-web:deploy
 *   ADMIN_WEB_PAGES_PROJECT=my-app npm run admin-web:deploy
 */
require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ADMIN = path.join(ROOT, 'admin-web');
const project =
	process.env.ADMIN_WEB_PAGES_PROJECT?.trim() ||
	process.env.CLOUDFLARE_PAGES_PROJECT?.trim() ||
	'';

if (!project) {
	console.error('❌ Set ADMIN_WEB_PAGES_PROJECT (root .env).');
	process.exit(1);
}

if (!fs.existsSync(path.join(ADMIN, '.env'))) {
	console.warn('⚠️  admin-web/.env missing — build will use placeholder legal text.');
}

console.log('🏗  Building admin-web…');
execSync('npm run build', { stdio: 'inherit', cwd: ADMIN });

const dist = path.join(ADMIN, 'dist');
if (!fs.existsSync(dist)) {
	console.error('❌ admin-web/dist not found after build');
	process.exit(1);
}

console.log(`📤 Deploying dist → Pages project "${project}"…`);
execSync(`npx wrangler pages deploy "${dist}" --project-name="${project}" --commit-dirty=true`, {
	stdio: 'inherit',
	cwd: ROOT,
});

console.log('✅ admin-web deployed.');
