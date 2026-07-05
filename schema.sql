-- Schema for STFC Officers D1 Database

-- Officers table
CREATE TABLE IF NOT EXISTS officers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  rarity INTEGER NOT NULL,
  class TEXT NOT NULL,
  faction TEXT NOT NULL,
  max_rank INTEGER NOT NULL,
  xp_costs TEXT, -- JSON array of XP costs per level
  stats TEXT,    -- JSON array of stats per rank
  trait_config TEXT -- JSON object containing trait configuration
);

-- Officer abilities table (normalized)
CREATE TABLE IF NOT EXISTS officer_abilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER NOT NULL,
  ability_type TEXT NOT NULL, -- 'captain', 'officer', 'below_deck'
  ability_id INTEGER NOT NULL,
  value_is_percentage INTEGER NOT NULL,
  values TEXT NOT NULL, -- JSON array of value/chance pairs
  art_id INTEGER NOT NULL,
  loca_id INTEGER NOT NULL,
  show_percentage INTEGER NOT NULL,
  value_type INTEGER NOT NULL,
  flag INTEGER NOT NULL,
  FOREIGN KEY (officer_id) REFERENCES officers (id)
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_officers_name ON officers(name);
CREATE INDEX IF NOT EXISTS idx_officers_faction ON officers(faction);
CREATE INDEX IF NOT EXISTS idx_officers_class ON officers(class);
CREATE INDEX IF NOT EXISTS idx_officers_rarity ON officers(rarity);
CREATE INDEX IF NOT EXISTS idx_abilities_officer_id ON officer_abilities(officer_id);
CREATE INDEX IF NOT EXISTS idx_abilities_art_id ON officer_abilities(art_id);
CREATE INDEX IF NOT EXISTS idx_abilities_type ON officer_abilities(ability_type);
