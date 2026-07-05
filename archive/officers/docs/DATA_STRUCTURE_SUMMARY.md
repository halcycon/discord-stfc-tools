# STFC Data Structure Summary

## Data Sources from Spocks Club API

Based on the analysis of the fetch scripts and API endpoints, we capture data from these endpoints:

### 1. Main Officer Data
**Endpoint**: `https://api.spocks.club/officer`
**Contains**: Core officer information with embedded abilities

### 2. Translation/Localization Data
**Endpoint**: `https://api.spocks.club/translations/en/officers`
**Contains**: Human-readable descriptions and names linked by officer_id

### 3. Additional Translation Data
- `https://api.spocks.club/translations/en/traits`
- `https://api.spocks.club/translations/en/abilities`
- `https://api.spocks.club/translations/en/factions`
- `https://api.spocks.club/translations/en/synergies`

## Data Structure & Relationships

### Officers Table (from `/officer` endpoint)
```json
{
  "id": 988947581,           // Primary key - officer ID
  "art_id": 1,               // Links to officer portrait images
  "loca_id": 1,              // Links to translations
  "faction": 2064723306,     // Faction ID (links to factions translations)
  "class": 1,                // Officer class (1=Command, 2=Engineering, 3=Science)
  "rarity": "4",             // Officer rarity
  "synergy_id": 1,           // Links to synergy translations
  "max_rank": 5,             // Maximum rank achievable
  
  // Embedded nested objects:
  "ability": {               // Officer ability (when not captain)
    "id": 2068068163,
    "art_id": 6,             // Links to ability icon images
    "loca_id": 2,            // Links to ability descriptions
    "values": [...],         // Ability values per rank
    "value_is_percentage": true,
    "show_percentage": true,
    "value_type": 1,
    "flag": 0
  },
  
  "captain_ability": {       // Captain ability (when acting as captain)
    "id": 4102716881,
    "art_id": 41,            // Links to captain ability icon images
    "loca_id": 1,            // Links to captain ability descriptions
    "values": [...],         // Captain ability values per rank
    "value_is_percentage": true,
    "show_percentage": true,
    "value_type": 0,
    "flag": 0
  },
  
  "trait_config": {          // Officer traits configuration
    "officer_id": 988947581,
    "trait_progression": [...], // Which traits unlock at which rank
    "traits": [...]          // Trait upgrade costs and IDs
  },
  
  "levels": [...],           // XP requirements per level
  "stats": [...],            // Attack/Defense/Health per level
  "ranks": [...]             // Rank upgrade costs and requirements
}
```

### Translations Table (from `/translations/en/officers` endpoint)
```json
{
  "id": "988947581",         // Links to officer.id (as string!)
  "key": "officer_tooltip_description_1",  // Type of translation
  "text": "<color=#309BBF>Leader</color>\n...", // HTML-formatted text
  "modified": "2025-08-13 17:11:38"
}
```

### Key Relationships

1. **Officers ↔ Translations**:
   - `officer.id` (number) ↔ `translation.id` (string)
   - Multiple translation records per officer with different `key` values

2. **Officers ↔ Ability Icons**:
   - `officer.ability.art_id` → `public/abilities/{art_id}.png`
   - `officer.captain_ability.art_id` → `public/abilities/{art_id}.png`

3. **Officers ↔ Officer Portraits**:
   - `officer.art_id` → `public/officers/{art_id}.png`

4. **Translation Key Types** (observed):
   - `officer_tooltip_description_{loca_id}` - Full ability description
   - `officer_tooltip_description_short_{loca_id}` - Short ability description  
   - `officer_flavor_text_{loca_id}` - Officer biography/flavor text
   - `officer_name_{loca_id}` - Officer name

## D1 Database Design Recommendations

### Tables Structure:
```sql
-- Main officers table
CREATE TABLE officers (
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
CREATE TABLE officer_abilities (
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
CREATE TABLE ability_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ability_id INTEGER,
  rank INTEGER,
  value REAL,
  chance REAL,
  FOREIGN KEY (ability_id) REFERENCES officer_abilities (id)
);

-- Officer translations
CREATE TABLE officer_translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER,
  key TEXT,
  text TEXT,
  modified TIMESTAMP,
  FOREIGN KEY (officer_id) REFERENCES officers (id)
);

-- Officer stats per level
CREATE TABLE officer_stats (
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
CREATE TABLE officer_ranks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER,
  rank INTEGER,
  max_level INTEGER,
  rating_factor INTEGER,
  shards_required INTEGER,
  costs TEXT, -- JSON string of costs
  FOREIGN KEY (officer_id) REFERENCES officers (id)
);

-- Officer traits (simplified)
CREATE TABLE officer_traits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id INTEGER,
  trait_id INTEGER,
  required_rank INTEGER,
  costs TEXT, -- JSON string of costs per level
  FOREIGN KEY (officer_id) REFERENCES officers (id)
);
```

## Data Population Strategy

1. **Fetch raw JSON** from all endpoints
2. **Parse and normalize** the nested structures
3. **Insert into D1** using the relational structure
4. **Create indexes** on commonly queried fields (officer name, faction, class)

This approach will:
- Reduce bundle size significantly 
- Enable complex queries (search by faction, class, ability type)
- Support real-time updates without redeploying
- Scale better than the current large TypeScript file approach
