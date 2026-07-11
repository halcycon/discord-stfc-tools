-- Letter-range category buckets for diplomacy channels (multi-alliance 50-channel limit).
ALTER TABLE guild_configs ADD COLUMN diplomacy_category_map TEXT DEFAULT '{}';
ALTER TABLE guild_configs ADD COLUMN diplomacy_archive_category_id TEXT;
