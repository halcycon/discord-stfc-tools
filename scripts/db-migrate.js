#!/usr/bin/env node
/**
 * Apply pending SQL migrations to D1, tracking applied files in `_schema_migrations`.
 *
 * Re-running is safe: already-applied migrations are skipped. Migrations already
 * reflected in the live schema (e.g. columns from earlier ALTER TABLE runs) are
 * recorded without re-executing, so duplicate-column errors are avoided.
 */
require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dbName = process.env.D1_DATABASE_NAME || 'stfc-officers';
const target = process.argv.includes('--local') ? '--local' : '--remote';
const root = path.join(__dirname, '..');
const migrationsDir = path.join(root, 'migrations');

function wranglerCapture(command) {
	return execSync(command, {
		cwd: root,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		env: process.env,
	});
}

function parseWranglerJson(out) {
	const trimmed = out.trim();
	// Prefer array payloads (wrangler --json often returns [{ results, success, meta }]).
	const arrayStart = trimmed.indexOf('[');
	const objectStart = trimmed.indexOf('{');
	let start = -1;
	if (arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart)) {
		start = arrayStart;
		const end = trimmed.lastIndexOf(']');
		if (end > start) return JSON.parse(trimmed.slice(start, end + 1));
	}
	if (objectStart !== -1) {
		const end = trimmed.lastIndexOf('}');
		if (end > objectStart) return JSON.parse(trimmed.slice(objectStart, end + 1));
	}
	throw new Error(`Could not parse wrangler JSON output:\n${out}`);
}

function d1ExecuteSql(sql, { json = false } = {}) {
	const escaped = sql.replace(/'/g, "'\\''");
	const jsonFlag = json ? ' --json' : '';
	const cmd = `npx wrangler d1 execute ${dbName} ${target} --yes${jsonFlag} --command='${escaped}'`;
	if (json) return parseWranglerJson(wranglerCapture(cmd));
	execSync(cmd, { cwd: root, stdio: 'inherit', env: process.env });
}

function d1ExecuteFile(relPath) {
	execSync(`npx wrangler d1 execute ${dbName} ${target} --yes --file=${relPath}`, {
		cwd: root,
		stdio: 'inherit',
		env: process.env,
	});
}

function queryRows(sql) {
	const result = d1ExecuteSql(sql, { json: true });
	const batches = Array.isArray(result) ? result : [result];
	const first = batches[0];
	if (!first) return [];
	if (Array.isArray(first.results)) return first.results;
	if (Array.isArray(first)) return first;
	return [];
}

function ensureTrackingTable() {
	d1ExecuteSql(
		`CREATE TABLE IF NOT EXISTS _schema_migrations (
			id TEXT PRIMARY KEY,
			applied_at TEXT NOT NULL DEFAULT (datetime('now'))
		)`,
	);
}

function listApplied() {
	const rows = queryRows('SELECT id FROM _schema_migrations');
	return new Set(rows.map((r) => String(r.id)));
}

function recordApplied(id) {
	const safe = id.replace(/'/g, "''");
	d1ExecuteSql(
		`INSERT OR IGNORE INTO _schema_migrations (id) VALUES ('${safe}')`,
	);
}

function tableExists(table) {
	const safe = table.replace(/'/g, "''");
	const rows = queryRows(
		`SELECT name FROM sqlite_master WHERE type='table' AND name='${safe}'`,
	);
	return rows.length > 0;
}

function columnExists(table, column) {
	const rows = queryRows(`PRAGMA table_info(${table})`);
	return rows.some((r) => String(r.name) === column);
}

/** Detect migrations already present in schema and record them without re-running. */
function syncAppliedFromSchema(migrationIds, applied) {
	/** @type {Record<string, () => boolean>} */
	const detectors = {
		'001_guild_schema.sql': () => tableExists('guild_configs'),
		'002_guild_rank_roles.sql': () => columnExists('guild_configs', 'operative_role_ids'),
		'003_guild_overlay_buckets.sql': () => columnExists('guild_configs', 'overlay_buckets'),
		'004_nickname_template.sql': () => columnExists('guild_configs', 'nickname_template'),
		'005_verification_log_channel.sql': () =>
			columnExists('guild_configs', 'verification_log_channel_id'),
		'006_diplomacy_channels.sql': () => columnExists('guild_configs', 'diplomacy_enabled'),
	};

	for (const id of migrationIds) {
		if (applied.has(id)) continue;
		const detect = detectors[id];
		if (!detect || !detect()) continue;
		console.log(`✓ adopt ${id} (already present in schema)`);
		recordApplied(id);
		applied.add(id);
	}
}

const files = fs
	.readdirSync(migrationsDir)
	.filter((f) => f.endsWith('.sql'))
	.sort();

if (files.length === 0) {
	console.log(`No migrations found in ${migrationsDir}`);
	process.exit(0);
}

console.log(`Migrating D1 database "${dbName}" (${target})...`);
ensureTrackingTable();
const applied = listApplied();
syncAppliedFromSchema(files, applied);

let pending = 0;
for (const file of files) {
	if (applied.has(file)) {
		console.log(`✓ skip ${file} (already applied)`);
		continue;
	}

	const rel = path.join('migrations', file);
	console.log(`→ apply ${rel}`);
	d1ExecuteFile(rel);
	recordApplied(file);
	pending += 1;
	console.log(`✓ recorded ${file}`);
}

if (pending === 0) {
	console.log('No pending migrations.');
} else {
	console.log(`Applied ${pending} migration(s).`);
}
