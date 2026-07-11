-- Discord agreement / code-of-conduct gate (DM button v1; channel react later)
ALTER TABLE guild_configs ADD COLUMN agreement_enabled INTEGER DEFAULT 0;
ALTER TABLE guild_configs ADD COLUMN agreement_timing TEXT DEFAULT 'after_verify';
ALTER TABLE guild_configs ADD COLUMN agreement_mode TEXT DEFAULT 'dm_button';
ALTER TABLE guild_configs ADD COLUMN agreement_channel_id TEXT;
ALTER TABLE guild_configs ADD COLUMN agreement_message_id TEXT;
ALTER TABLE guild_configs ADD COLUMN agreement_version TEXT;

ALTER TABLE verified_players ADD COLUMN agreement_accepted_at TEXT;
ALTER TABLE verified_players ADD COLUMN agreement_version TEXT;
ALTER TABLE verified_players ADD COLUMN agreement_method TEXT;
