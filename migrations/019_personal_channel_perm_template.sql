-- Locked-in permission overwrite template for new/linked personal member channels
-- (captured from an existing channel via /server channels permissions template-from).
ALTER TABLE guild_configs
    ADD COLUMN personal_channel_perm_template TEXT;
