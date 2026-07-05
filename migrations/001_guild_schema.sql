-- Guild management and player verification tables (STFC_DB binding).
-- Cloudflare D1 database name remains `stfc-officers` (historical); binding in code is STFC_DB.

CREATE TABLE IF NOT EXISTS guild_configs (
    guild_id TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'single_alliance' CHECK (mode IN ('single_alliance', 'multi_alliance')),
    stfc_server INTEGER NOT NULL DEFAULT 0,
    stfc_region TEXT NOT NULL DEFAULT 'US' CHECK (stfc_region IN ('US', 'EU')),
    alliance_tag TEXT,
    guest_role_id TEXT,
    member_role_ids TEXT DEFAULT '[]',
    alliance_role_prefix TEXT,
    channel_category_map TEXT DEFAULT '{}',
    personal_channel_extra_roles TEXT DEFAULT '[]',
    poll_interval_hours INTEGER DEFAULT 6,
    verification_enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guild_members (
    guild_id TEXT NOT NULL,
    discord_user_id TEXT NOT NULL,
    username TEXT,
    first_seen_at TEXT DEFAULT (datetime('now')),
    verification_invited_at TEXT,
    PRIMARY KEY (guild_id, discord_user_id)
);

CREATE TABLE IF NOT EXISTS verified_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    discord_user_id TEXT NOT NULL,
    player_id INTEGER,
    player_name TEXT,
    alliance_tag TEXT,
    ops_level INTEGER,
    power INTEGER,
    grade INTEGER,
    stfc_pro_url TEXT,
    verification_status TEXT DEFAULT 'pending_invite',
    personal_channel_id TEXT,
    verified_at TEXT,
    last_synced_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE (guild_id, discord_user_id)
);

CREATE TABLE IF NOT EXISTS verification_screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    discord_user_id TEXT NOT NULL,
    r2_key TEXT,
    discord_attachment_url TEXT,
    discord_message_id TEXT,
    uploaded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS player_stats_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    verified_player_id INTEGER NOT NULL,
    ops_level INTEGER,
    power INTEGER,
    alliance_tag TEXT,
    recorded_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (verified_player_id) REFERENCES verified_players (id)
);

CREATE TABLE IF NOT EXISTS surveys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    question TEXT NOT NULL,
    button_type TEXT,
    options TEXT,
    target_grades TEXT,
    target_alliance_tags TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS survey_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    survey_id INTEGER NOT NULL,
    discord_user_id TEXT NOT NULL,
    response TEXT NOT NULL,
    responded_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (survey_id) REFERENCES surveys (id)
);

CREATE INDEX IF NOT EXISTS idx_verified_players_guild ON verified_players (guild_id);
CREATE INDEX IF NOT EXISTS idx_verified_players_status ON verified_players (guild_id, verification_status);
CREATE INDEX IF NOT EXISTS idx_verified_players_grade ON verified_players (guild_id, grade);
CREATE INDEX IF NOT EXISTS idx_guild_members_guild ON guild_members (guild_id);
