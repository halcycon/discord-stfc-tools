-- Resumable morning daily sync (roster scrape + verified player sync).
-- Cloudflare scheduled invocations have ~15 min wall time; large multi-alliance
-- guilds continue across chunks via */5 cron and optional HTTP self-continue.

CREATE TABLE IF NOT EXISTS daily_sync_jobs (
	guild_id TEXT PRIMARY KEY,
	started_at TEXT NOT NULL,
	phase TEXT NOT NULL CHECK (phase IN ('scrape', 'players', 'finalize')),
	payload TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_daily_sync_jobs_expires
	ON daily_sync_jobs (expires_at);
