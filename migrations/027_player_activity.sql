-- Player activity from stfc.pro consecutive_days_active (+ derived days_inactive).

ALTER TABLE verified_players ADD COLUMN activity_streak INTEGER;
ALTER TABLE verified_players ADD COLUMN days_inactive INTEGER NOT NULL DEFAULT 0;
ALTER TABLE verified_players ADD COLUMN activity_updated_at TEXT;

ALTER TABLE alliance_roster_members ADD COLUMN activity_streak INTEGER;

CREATE INDEX IF NOT EXISTS idx_verified_players_days_inactive
	ON verified_players (guild_id, days_inactive);
