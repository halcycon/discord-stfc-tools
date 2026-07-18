-- Persisted soft limit for diplomacy letter-bucket planning (default 45).
ALTER TABLE guild_configs ADD COLUMN diplomacy_soft_limit INTEGER DEFAULT 45;
