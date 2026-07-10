-- Configurable Discord nickname pattern applied on verify / daily sync.
-- NULL = use mode default (see src/nickname-utils.ts).
ALTER TABLE guild_configs
    ADD COLUMN nickname_template TEXT;
