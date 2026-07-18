-- Non-listed alliances diplomacy channel (not a tag in diplomacy_channel_map).
ALTER TABLE guild_configs ADD COLUMN diplomacy_special_channel_id TEXT;
ALTER TABLE guild_configs ADD COLUMN diplomacy_special_name TEXT;
ALTER TABLE guild_configs ADD COLUMN diplomacy_special_placement TEXT DEFAULT 'special_category';
ALTER TABLE guild_configs ADD COLUMN diplomacy_special_category_id TEXT;
