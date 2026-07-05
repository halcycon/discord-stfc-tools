#!/usr/bin/env node

const fs = require('fs');
const https = require('https');

// Helper function to make HTTPS requests
function httpsGet(url) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, (response) => {
            let data = '';
            
            response.on('data', chunk => {
                data += chunk;
            });
            
            response.on('end', () => {
                if (response.statusCode === 200) {
                    try {
                        const jsonData = JSON.parse(data);
                        resolve(jsonData);
                    } catch (error) {
                        reject(new Error(`Failed to parse JSON: ${error.message}`));
                    }
                } else {
                    reject(new Error(`HTTP ${response.statusCode}: ${data}`));
                }
            });
        });
        
        request.on('error', (error) => {
            reject(error);
        });
        
        request.setTimeout(10000, () => {
            request.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

// Generate SQL INSERT statements
function generateSQL(officers, translations) {
    const statements = [];
    
    // Generate officers table inserts
    console.log('Generating officers table inserts...');
    for (const officer of officers) {
        const sql = `INSERT INTO officers (id, art_id, loca_id, faction, class, rarity, synergy_id, max_rank) VALUES (${officer.id}, ${officer.art_id}, ${officer.loca_id}, ${officer.faction}, ${officer.class}, '${officer.rarity}', ${officer.synergy_id}, ${officer.max_rank});`;
        statements.push(sql);
    }
    
    // Generate officer_abilities table inserts
    console.log('Generating officer_abilities table inserts...');
    for (const officer of officers) {
        // Regular ability
        if (officer.ability) {
            const ability = officer.ability;
            const sql = `INSERT INTO officer_abilities (officer_id, ability_type, ability_id, art_id, loca_id, value_is_percentage, show_percentage, value_type, flag) VALUES (${officer.id}, 'ability', ${ability.id}, ${ability.art_id}, ${ability.loca_id}, ${ability.value_is_percentage ? 1 : 0}, ${ability.show_percentage ? 1 : 0}, ${ability.value_type}, ${ability.flag});`;
            statements.push(sql);
            
            // Ability values
            ability.values.forEach((value, index) => {
                const valueSQL = `INSERT INTO ability_values (ability_id, rank, value, chance) VALUES (${ability.id}, ${index + 1}, ${value.value}, ${value.chance});`;
                statements.push(valueSQL);
            });
        }
        
        // Captain ability
        if (officer.captain_ability) {
            const capAbility = officer.captain_ability;
            const sql = `INSERT INTO officer_abilities (officer_id, ability_type, ability_id, art_id, loca_id, value_is_percentage, show_percentage, value_type, flag) VALUES (${officer.id}, 'captain_ability', ${capAbility.id}, ${capAbility.art_id}, ${capAbility.loca_id}, ${capAbility.value_is_percentage ? 1 : 0}, ${capAbility.show_percentage ? 1 : 0}, ${capAbility.value_type}, ${capAbility.flag});`;
            statements.push(sql);
            
            // Captain ability values
            capAbility.values.forEach((value, index) => {
                const valueSQL = `INSERT INTO ability_values (ability_id, rank, value, chance) VALUES (${capAbility.id}, ${index + 1}, ${value.value}, ${value.chance});`;
                statements.push(valueSQL);
            });
        }
    }
    
    // Generate officer_stats table inserts
    console.log('Generating officer_stats table inserts...');
    for (const officer of officers) {
        if (officer.levels && officer.stats) {
            officer.levels.forEach((level, index) => {
                const stat = officer.stats[index];
                if (stat) {
                    const sql = `INSERT INTO officer_stats (officer_id, level, xp, attack, defense, health) VALUES (${officer.id}, ${level.level}, ${level.xp}, ${stat.attack}, ${stat.defense}, ${stat.health});`;
                    statements.push(sql);
                }
            });
        }
    }
    
    // Generate officer_ranks table inserts
    console.log('Generating officer_ranks table inserts...');
    for (const officer of officers) {
        if (officer.ranks) {
            officer.ranks.forEach(rank => {
                const costsJSON = JSON.stringify(rank.costs).replace(/'/g, "''"); // Escape single quotes
                const sql = `INSERT INTO officer_ranks (officer_id, rank, max_level, rating_factor, shards_required, costs) VALUES (${officer.id}, ${rank.rank}, ${rank.max_level}, ${rank.rating_factor}, ${rank.shards_required}, '${costsJSON}');`;
                statements.push(sql);
            });
        }
    }
    
    // Generate officer_traits table inserts
    console.log('Generating officer_traits table inserts...');
    for (const officer of officers) {
        if (officer.trait_config && officer.trait_config.traits) {
            officer.trait_config.traits.forEach(trait => {
                const costsJSON = JSON.stringify(trait.costs_per_level).replace(/'/g, "''");
                const requiredRank = officer.trait_config.trait_progression.find(p => p.trait_id === trait.trait_id)?.required_rank || 1;
                const sql = `INSERT INTO officer_traits (officer_id, trait_id, required_rank, costs) VALUES (${officer.id}, ${trait.trait_id}, ${requiredRank}, '${costsJSON}');`;
                statements.push(sql);
            });
        }
    }
    
    // Generate officer_translations table inserts
    console.log('Generating officer_translations table inserts...');
    for (const translation of translations) {
        const officerId = parseInt(translation.id);
        const escapedText = translation.text.replace(/'/g, "''"); // Escape single quotes
        const escapedKey = translation.key.replace(/'/g, "''");
        const sql = `INSERT INTO officer_translations (officer_id, key, text, modified) VALUES (${officerId}, '${escapedKey}', '${escapedText}', '${translation.modified}');`;
        statements.push(sql);
    }
    
    return statements;
}

// Main function
async function generateD1Migration() {
    console.log('🔍 Fetching officer data from Spocks Club API...');
    
    try {
        // Fetch all data
        console.log('Fetching officers...');
        const officers = await httpsGet('https://api.spocks.club/officer');
        console.log(`✅ Fetched ${officers.length} officers`);
        
        console.log('Fetching officer translations...');
        const translations = await httpsGet('https://api.spocks.club/translations/en/officers');
        console.log(`✅ Fetched ${translations.length} translation records`);
        
        // Generate SQL
        console.log('📝 Generating SQL statements...');
        const sqlStatements = generateSQL(officers, translations);
        
        // Write schema file
        const schemaSQL = `-- STFC Officers Database Schema
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
`;
        
        fs.writeFileSync('d1-schema.sql', schemaSQL);
        console.log('✅ Generated d1-schema.sql');
        
        // Write migration SQL in batches (D1 has limits)
        const batchSize = 1000;
        let batchNumber = 1;
        
        for (let i = 0; i < sqlStatements.length; i += batchSize) {
            const batch = sqlStatements.slice(i, i + batchSize);
            const batchSQL = batch.join('\n');
            
            fs.writeFileSync(`d1-migration-batch-${batchNumber}.sql`, batchSQL);
            console.log(`✅ Generated d1-migration-batch-${batchNumber}.sql (${batch.length} statements)`);
            batchNumber++;
        }
        
        // Write a complete migration file (warning: this might be very large)
        const completeMigration = schemaSQL + '\n\n-- Data inserts\n' + sqlStatements.join('\n');
        fs.writeFileSync('d1-complete-migration.sql', completeMigration);
        console.log('✅ Generated d1-complete-migration.sql (WARNING: This file is very large)');
        
        // Generate summary
        const summary = {
            officers_count: officers.length,
            translations_count: translations.length,
            total_sql_statements: sqlStatements.length,
            batch_files: batchNumber - 1,
            generated_at: new Date().toISOString()
        };
        
        fs.writeFileSync('d1-migration-summary.json', JSON.stringify(summary, null, 2));
        console.log('✅ Generated d1-migration-summary.json');
        
        console.log(`\n🎉 D1 migration files generated successfully!`);
        console.log(`📊 Summary:`);
        console.log(`   - Officers: ${summary.officers_count}`);
        console.log(`   - Translation records: ${summary.translations_count}`);
        console.log(`   - SQL statements: ${summary.total_sql_statements}`);
        console.log(`   - Batch files: ${summary.batch_files}`);
        console.log(`\n📁 Generated files:`);
        console.log(`   - d1-schema.sql (database schema)`);
        console.log(`   - d1-migration-batch-*.sql (data in batches)`);
        console.log(`   - d1-complete-migration.sql (complete migration - large file)`);
        console.log(`   - d1-migration-summary.json (summary statistics)`);
        
    } catch (error) {
        console.error('❌ Error generating D1 migration:', error.message);
        process.exit(1);
    }
}

// Run the migration generator
if (require.main === module) {
    generateD1Migration();
}

module.exports = { generateD1Migration };
