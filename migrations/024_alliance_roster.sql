-- Alliance roster cache (HTML scrape of /alliances/{id}) for daily sync + verify.
ALTER TABLE guild_configs ADD COLUMN stfc_alliance_id TEXT;

CREATE TABLE IF NOT EXISTS alliance_roster_meta (
	guild_id TEXT PRIMARY KEY,
	alliance_id TEXT NOT NULL,
	alliance_tag TEXT,
	alliance_name TEXT,
	player_count INTEGER NOT NULL DEFAULT 0,
	fetched_at TEXT NOT NULL,
	FOREIGN KEY (guild_id) REFERENCES guild_configs (guild_id)
);

CREATE TABLE IF NOT EXISTS alliance_roster_members (
	guild_id TEXT NOT NULL,
	player_id INTEGER NOT NULL,
	player_name TEXT,
	alliance_tag TEXT,
	alliance_id TEXT,
	alliance_rank TEXT,
	ops_level INTEGER,
	power INTEGER,
	grade INTEGER,
	join_date TEXT,
	fetched_at TEXT NOT NULL,
	PRIMARY KEY (guild_id, player_id),
	FOREIGN KEY (guild_id) REFERENCES guild_configs (guild_id)
);

CREATE INDEX IF NOT EXISTS idx_alliance_roster_members_fetched
	ON alliance_roster_members (guild_id, fetched_at);
