-- Multi-alliance: when enabled, skip Admiral Discord roles (and Admiral overlays)
-- for players whose alliance is not explicitly tracked / on the diplomacy map.
-- Diplomacy channel creation for untracked tags is also deferred until /alliance track.

ALTER TABLE guild_configs ADD COLUMN defer_untracked_admiral_roles INTEGER DEFAULT 0;
