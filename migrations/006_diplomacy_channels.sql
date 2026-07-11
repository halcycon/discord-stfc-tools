-- Multi-alliance diplomacy channels (one text channel per alliance tag).
ALTER TABLE guild_configs ADD COLUMN diplomacy_enabled INTEGER DEFAULT 0;
ALTER TABLE guild_configs ADD COLUMN diplomacy_category_id TEXT;
ALTER TABLE guild_configs ADD COLUMN diplomacy_channel_map TEXT DEFAULT '{}';
ALTER TABLE guild_configs ADD COLUMN diplomacy_everyone_can_view INTEGER DEFAULT 1;
ALTER TABLE guild_configs ADD COLUMN diplomacy_view_role_ids TEXT DEFAULT '[]';
ALTER TABLE guild_configs ADD COLUMN diplomacy_write_role_ids TEXT DEFAULT '[]';
ALTER TABLE guild_configs ADD COLUMN diplomacy_write_ranks TEXT DEFAULT '["Commodore","Admiral"]';
ALTER TABLE guild_configs ADD COLUMN diplomacy_name_template TEXT;
