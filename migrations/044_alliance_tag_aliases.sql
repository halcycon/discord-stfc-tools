-- Every tag string ever seen for an alliance id (rename history).
-- Planner resolves tracked/diplomacy tags via this when meta.alliance_tag already moved on.

CREATE TABLE IF NOT EXISTS alliance_roster_tag_aliases (
	guild_id TEXT NOT NULL,
	alliance_id TEXT NOT NULL,
	alliance_tag TEXT NOT NULL,
	seen_at TEXT NOT NULL,
	PRIMARY KEY (guild_id, alliance_tag),
	FOREIGN KEY (guild_id) REFERENCES guild_configs (guild_id)
);

CREATE INDEX IF NOT EXISTS idx_alliance_tag_aliases_id
	ON alliance_roster_tag_aliases (guild_id, alliance_id);

-- Backfill from current meta (current tag only; enough for future renames after next scrape).
INSERT OR IGNORE INTO alliance_roster_tag_aliases (guild_id, alliance_id, alliance_tag, seen_at)
SELECT guild_id, alliance_id, UPPER(TRIM(alliance_tag)), fetched_at
FROM alliance_roster_meta
WHERE alliance_id IS NOT NULL AND TRIM(alliance_id) != ''
  AND alliance_tag IS NOT NULL AND TRIM(alliance_tag) != '';
