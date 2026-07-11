-- Survey lifecycle + targeting expansions; store alliance rank for rank-targeted surveys.

ALTER TABLE verified_players ADD COLUMN alliance_rank TEXT;

ALTER TABLE guild_configs ADD COLUMN survey_creator_role_ids TEXT DEFAULT '[]';
ALTER TABLE guild_configs ADD COLUMN survey_results_role_ids TEXT DEFAULT '[]';

ALTER TABLE surveys ADD COLUMN status TEXT DEFAULT 'draft';
ALTER TABLE surveys ADD COLUMN delivery TEXT DEFAULT 'dm';
ALTER TABLE surveys ADD COLUMN target_type TEXT DEFAULT 'all';
ALTER TABLE surveys ADD COLUMN target_role_ids TEXT DEFAULT '[]';
ALTER TABLE surveys ADD COLUMN target_ranks TEXT DEFAULT '[]';
ALTER TABLE surveys ADD COLUMN target_ops_min INTEGER;
ALTER TABLE surveys ADD COLUMN target_ops_max INTEGER;
ALTER TABLE surveys ADD COLUMN target_user_ids TEXT DEFAULT '[]';
ALTER TABLE surveys ADD COLUMN log_channel_id TEXT;
ALTER TABLE surveys ADD COLUMN viewer_role_ids TEXT DEFAULT '[]';
ALTER TABLE surveys ADD COLUMN sent_at TEXT;
ALTER TABLE surveys ADD COLUMN closed_at TEXT;
ALTER TABLE surveys ADD COLUMN target_count INTEGER DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_survey_responses_unique
	ON survey_responses (survey_id, discord_user_id);

CREATE INDEX IF NOT EXISTS idx_surveys_guild_status ON surveys (guild_id, status);
CREATE INDEX IF NOT EXISTS idx_verified_players_rank ON verified_players (guild_id, alliance_rank);
