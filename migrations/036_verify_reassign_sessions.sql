-- Short-lived sessions for /server verify Approve/Reject when player ID is already linked.

CREATE TABLE IF NOT EXISTS verify_reassign_sessions (
	token TEXT PRIMARY KEY,
	guild_id TEXT NOT NULL,
	admin_user_id TEXT NOT NULL,
	target_discord_user_id TEXT NOT NULL,
	existing_discord_user_ids TEXT NOT NULL, -- JSON array of Discord user IDs
	player_id INTEGER NOT NULL,
	player_name TEXT,
	stfc_pro_url TEXT NOT NULL,
	screenshot_url TEXT,
	send_welcome_dm INTEGER NOT NULL DEFAULT 0,
	expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_verify_reassign_sessions_expires
	ON verify_reassign_sessions (expires_at);
