-- Explicitly tracked alliance tags for multi-alliance morning scrape
-- (in addition to verified player tags ∪ diplomacy_channel_map).
ALTER TABLE guild_configs ADD COLUMN tracked_alliance_tags TEXT DEFAULT '[]';
