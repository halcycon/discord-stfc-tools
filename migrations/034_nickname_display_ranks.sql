-- Which in-game alliance ranks appear in Discord nickname placeholders
-- ({rank}, {rank_prefix}, {rank_paren}). JSON array of full rank names.
-- NULL / empty = all five ranks (Operative, Agent, Premier, Commodore, Admiral).
ALTER TABLE guild_configs ADD COLUMN nickname_display_ranks TEXT;
