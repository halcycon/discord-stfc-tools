-- Letter-bucket map for diplomacy archive categories (onboarding cleanup / large archives).
ALTER TABLE guild_configs ADD COLUMN diplomacy_archive_category_map TEXT DEFAULT '{}';
