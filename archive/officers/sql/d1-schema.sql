-- STFC Officers Database Schema
-- Generated from Spocks Club API data

-- Main officers table
CREATE TABLE IF NOT EXISTS officers (
    id INTEGER PRIMARY KEY,
    art_id INTEGER,
    loca_id INTEGER,
    faction INTEGER,
    class INTEGER,
    rarity TEXT,
    synergy_id INTEGER,
    max_rank INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Officer abilities (both regular and captain)
CREATE TABLE IF NOT EXISTS officer_abilities (
    id INTEGER PRIMARY KEY,
    officer_id INTEGER,
    ability_type TEXT, -- 'ability' or 'captain_ability'
    ability_id INTEGER,
    art_id INTEGER,
    loca_id INTEGER,
    value_is_percentage BOOLEAN,
    show_percentage BOOLEAN,
    value_type INTEGER,
    flag INTEGER,
    FOREIGN KEY (officer_id) REFERENCES officers (id)
);

-- Ability values per rank
CREATE TABLE IF NOT EXISTS ability_values (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ability_id INTEGER,
    rank INTEGER,
    value REAL,
    chance REAL,
    FOREIGN KEY (ability_id) REFERENCES officer_abilities (ability_id)
);

-- Officer translations
CREATE TABLE IF NOT EXISTS officer_translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    officer_id INTEGER,
    key TEXT,
    text TEXT,
    modified TIMESTAMP,
    FOREIGN KEY (officer_id) REFERENCES officers (id)
);

-- Officer stats per level
CREATE TABLE IF NOT EXISTS officer_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    officer_id INTEGER,
    level INTEGER,
    xp INTEGER,
    attack REAL,
    defense REAL,
    health REAL,
    FOREIGN KEY (officer_id) REFERENCES officers (id)
);

-- Officer ranks
CREATE TABLE IF NOT EXISTS officer_ranks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    officer_id INTEGER,
    rank INTEGER,
    max_level INTEGER,
    rating_factor INTEGER,
    shards_required INTEGER,
    costs TEXT, -- JSON string of costs
    FOREIGN KEY (officer_id) REFERENCES officers (id)
);

-- Officer traits
CREATE TABLE IF NOT EXISTS officer_traits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    officer_id INTEGER,
    trait_id INTEGER,
    required_rank INTEGER,
    costs TEXT, -- JSON string of costs per level
    FOREIGN KEY (officer_id) REFERENCES officers (id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_officers_faction ON officers (faction);
CREATE INDEX IF NOT EXISTS idx_officers_class ON officers (class);
CREATE INDEX IF NOT EXISTS idx_officers_rarity ON officers (rarity);
CREATE INDEX IF NOT EXISTS idx_abilities_officer_id ON officer_abilities (officer_id);
CREATE INDEX IF NOT EXISTS idx_abilities_type ON officer_abilities (ability_type);
CREATE INDEX IF NOT EXISTS idx_translations_officer_id ON officer_translations (officer_id);
CREATE INDEX IF NOT EXISTS idx_translations_key ON officer_translations (key);
CREATE INDEX IF NOT EXISTS idx_stats_officer_id ON officer_stats (officer_id);
CREATE INDEX IF NOT EXISTS idx_ranks_officer_id ON officer_ranks (officer_id);
CREATE INDEX IF NOT EXISTS idx_traits_officer_id ON officer_traits (officer_id);
