-- Verification channel panel + demotion notify modes.
-- invite: dm (default) | channel_panel — skip auto join invite DMs when panel mode.
-- demotion_notify: dm (default) | channel | none

ALTER TABLE guild_configs ADD COLUMN verification_invite_mode TEXT DEFAULT 'dm';
ALTER TABLE guild_configs ADD COLUMN verify_panel_channel_id TEXT;
ALTER TABLE guild_configs ADD COLUMN verify_panel_message_id TEXT;
ALTER TABLE guild_configs ADD COLUMN demotion_notify TEXT DEFAULT 'dm';
