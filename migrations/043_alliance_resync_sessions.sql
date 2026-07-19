-- Short-lived sessions for chunked `/alliance resync` (Continue buttons).
-- Cloudflare waitUntil is ~30s after a deferred interaction reply, so scrapes are chunked.

CREATE TABLE IF NOT EXISTS alliance_resync_sessions (
	token TEXT PRIMARY KEY,
	guild_id TEXT NOT NULL,
	actor_id TEXT,
	payload TEXT NOT NULL,
	expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alliance_resync_sessions_expires
	ON alliance_resync_sessions (expires_at);
