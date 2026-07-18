-- Per-alliance preferred languages for diplomacy channel name flag suffixes
-- (JSON: { "ABCD": ["en","fr"] }).
ALTER TABLE guild_configs ADD COLUMN diplomacy_preferred_locales TEXT DEFAULT '{}';
