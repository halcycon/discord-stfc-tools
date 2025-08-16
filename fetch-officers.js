// Script to fetch officer data from api.spocks.club and generate TypeScript files
const fs = require('fs');
const path = require('path');
const https = require('https');

// Create directories if they don't exist
function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

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

// Helper function to download files
function downloadFile(url, filePath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filePath);
        const request = https.get(url, (response) => {
            if (response.statusCode === 200) {
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            } else {
                file.close();
                fs.unlink(filePath, () => {}); // Delete the file on error
                reject(new Error(`HTTP ${response.statusCode}`));
            }
        });
        
        request.on('error', (error) => {
            file.close();
            fs.unlink(filePath, () => {}); // Delete the file on error
            reject(error);
        });
        
        request.setTimeout(10000, () => {
            request.destroy();
            file.close();
            fs.unlink(filePath, () => {}); // Delete the file on error
            reject(new Error('Download timeout'));
        });
    });
}

async function fetchOfficerData() {
    console.log('🔍 Fetching officer data from api.spocks.club...');
    
    try {
        // Fetch officer data
        console.log('📡 Downloading officer data...');
        const officerData = await httpsGet('https://api.spocks.club/officer');
        console.log(`✅ Retrieved ${Object.keys(officerData).length} officers`);
        
        // Fetch all localisation data
        console.log('📡 Downloading localisation data...');
        let localisationData = {};
        let traitsData = {};
        let abilitiesData = {};
        let factionsData = {};
        let synergiesData = {};
        
        try {
            console.log('   - Officer names...');
            localisationData = await httpsGet('https://api.spocks.club/translations/en/officers');
            console.log(`     ✅ Retrieved ${Object.keys(localisationData).length} officer names`);
        } catch (error) {
            console.log(`     ⚠️  Could not fetch officer names: ${error.message}`);
        }
        
        try {
            console.log('   - Traits...');
            traitsData = await httpsGet('https://api.spocks.club/translations/en/traits');
            console.log(`     ✅ Retrieved ${Object.keys(traitsData).length} trait names`);
        } catch (error) {
            console.log(`     ⚠️  Could not fetch traits: ${error.message}`);
        }
        
        try {
            console.log('   - Abilities...');
            abilitiesData = await httpsGet('https://api.spocks.club/translations/en/abilities');
            console.log(`     ✅ Retrieved ${Object.keys(abilitiesData).length} ability names`);
        } catch (error) {
            console.log(`     ⚠️  Could not fetch abilities: ${error.message}`);
        }
        
        try {
            console.log('   - Factions...');
            factionsData = await httpsGet('https://api.spocks.club/translations/en/factions');
            console.log(`     ✅ Retrieved ${Object.keys(factionsData).length} faction names`);
        } catch (error) {
            console.log(`     ⚠️  Could not fetch factions: ${error.message}`);
        }
        
        try {
            console.log('   - Synergies...');
            synergiesData = await httpsGet('https://api.spocks.club/translations/en/synergies');
            console.log(`     ✅ Retrieved ${Object.keys(synergiesData).length} synergy names`);
        } catch (error) {
            console.log(`     ⚠️  Could not fetch synergies: ${error.message}`);
        }
        
        // Create enhanced officer data with names
        const enhancedOfficers = {};
        const downloadQueue = [];
        
        // Ensure public/officers directory exists
        const officersDir = path.join(__dirname, 'public', 'officers');
        ensureDirectoryExists(officersDir);
        
        for (const [officerId, officer] of Object.entries(officerData)) {
            // Extract the officer name from the localisation data
            let officerName = `Unknown Officer (${officer.art_id})`;
            
            if (localisationData && typeof localisationData === 'object') {
                // Look for the officer name in the localization data
                // The pattern is "officer_name_{loca_id}" not art_id
                for (const [locaId, locaEntry] of Object.entries(localisationData)) {
                    if (locaEntry && typeof locaEntry === 'object' && locaEntry.key && locaEntry.text) {
                        // Look for officer_name_X pattern where X matches loca_id
                        if (locaEntry.key === `officer_name_${officer.loca_id}`) {
                            officerName = locaEntry.text;
                            break;
                        }
                    }
                }
            }
            
            enhancedOfficers[officerId] = {
                ...officer,
                name: officerName,
                id: parseInt(officerId, 10)
            };
            
            // Add to download queue for officer portraits
            if (officer.art_id) {
                const imageUrl = `https://spocks.club/img/officers/${officer.art_id}.png`;
                const imagePath = path.join(officersDir, `${officer.art_id}.png`);
                
                downloadQueue.push({
                    url: imageUrl,
                    path: imagePath,
                    artId: officer.art_id
                });
            }
        }
        
        // Download officer portraits
        console.log(`🖼️  Downloading ${downloadQueue.length} officer portraits...`);
        const downloadPromises = downloadQueue.map(async (item, index) => {
            try {
                await downloadFile(item.url, item.path);
                if ((index + 1) % 10 === 0) {
                    console.log(`   Downloaded ${index + 1}/${downloadQueue.length} images...`);
                }
            } catch (error) {
                console.warn(`⚠️  Failed to download ${item.url}: ${error.message}`);
            }
        });
        
        await Promise.all(downloadPromises);
        console.log('✅ Officer portrait downloads completed');
        
        // Generate TypeScript file
        console.log('📝 Generating TypeScript file...');
        const tsContent = generateOfficerTypeScript(enhancedOfficers, {
            officers: localisationData,
            traits: traitsData,
            abilities: abilitiesData,
            factions: factionsData,
            synergies: synergiesData
        });
        
        const outputPath = path.join(__dirname, 'src', 'officerData.ts');
        fs.writeFileSync(outputPath, tsContent);
        
        console.log(`✅ Successfully generated officer data with ${Object.keys(enhancedOfficers).length} officers`);
        console.log(`📁 TypeScript output: ${outputPath}`);
        console.log(`📁 Images downloaded to: ${officersDir}`);
        
        // Generate summary statistics
        const factions = {};
        const classes = {};
        const rarities = {};
        
        for (const officer of Object.values(enhancedOfficers)) {
            factions[officer.faction] = (factions[officer.faction] || 0) + 1;
            classes[officer.class] = (classes[officer.class] || 0) + 1;
            rarities[officer.rarity] = (rarities[officer.rarity] || 0) + 1;
        }
        
        console.log('\n📊 Officer Statistics:');
        console.log(`   Factions: ${Object.keys(factions).length} (${JSON.stringify(factions)})`);
        console.log(`   Classes: ${Object.keys(classes).length} (${JSON.stringify(classes)})`);
        console.log(`   Rarities: ${Object.keys(rarities).length} (${JSON.stringify(rarities)})`);
        
    } catch (error) {
        console.error('❌ Error fetching officer data:', error.message);
        process.exit(1);
    }
}

function generateOfficerTypeScript(officerData, allLocalisationData) {
    const { officers, traits, abilities, factions, synergies } = allLocalisationData;
    
    // Helper function to convert localisation object to simple mapping
    function createLocalisationMap(data) {
        const result = {};
        if (data && typeof data === 'object') {
            for (const [key, value] of Object.entries(data)) {
                let text = 'Unknown';
                if (typeof value === 'string') {
                    text = value;
                } else if (value && value.text) {
                    text = value.text;
                }
                // Clean up the text - remove HTML tags and escape quotes properly
                text = text
                    .replace(/<[^>]*>/g, '') // Remove HTML tags
                    .replace(/\r?\n/g, ' ')  // Replace newlines with spaces
                    .replace(/\s+/g, ' ')    // Normalize multiple spaces
                    .trim();
                result[key] = text;
            }
        }
        return result;
    }
    
    const officerMap = createLocalisationMap(officers);
    const traitsMap = createLocalisationMap(traits);
    const abilitiesMap = createLocalisationMap(abilities);
    const factionsMap = createLocalisationMap(factions);
    const synergiesMap = createLocalisationMap(synergies);
    
    return `// Auto-generated from api.spocks.club/officers
// Do not edit this file manually - run 'node fetch-officers.js' to regenerate

export interface OfficerAbility {
  id: number;
  value_is_percentage: boolean;
  values: Array<{
    value: number;
    chance: number;
  }>;
  art_id: number;
  loca_id: number;
  show_percentage: boolean;
  value_type: number;
  flag: number;
}

export interface OfficerTrait {
  costs_per_level: Record<string, Array<Record<string, number>>>;
  trait_id: number;
}

export interface OfficerTraitProgression {
  required_rank: number;
  trait_id: number;
}

export interface OfficerTraitConfig {
  officer_id: number;
  trait_progression: OfficerTraitProgression[];
  traits: OfficerTrait[];
}

export interface OfficerLevel {
  level: number;
  xp: number;
}

export interface OfficerStats {
  level: number;
  attack: number;
  defense: number;
  health: number;
}

export interface OfficerRank {
  costs: Record<string, number>;
  max_level: number;
  rank: number;
  rating_factor: number;
  shards_required: number;
}

export interface OfficerData {
  id: number;
  name: string;
  art_id: number;
  loca_id: number;
  faction: number;
  trait_config?: OfficerTraitConfig;
  class: number;
  rarity: string;
  synergy_id: number;
  max_rank: number;
  ability?: OfficerAbility;
  captain_ability?: OfficerAbility;
  below_decks_ability?: OfficerAbility;
  levels?: OfficerLevel[];
  stats?: OfficerStats[];
  ranks?: OfficerRank[];
}

export const OFFICER_DATA: Record<string, OfficerData> = ${JSON.stringify(officerData, null, 2)};

export const OFFICER_DATA_ARRAY: OfficerData[] = Object.values(OFFICER_DATA);

export const OFFICER_NAME_MAP = new Map<string, OfficerData>(
  OFFICER_DATA_ARRAY.map(officer => [officer.name.toLowerCase(), officer])
);

export const OFFICER_ID_MAP = new Map<number, OfficerData>(
  OFFICER_DATA_ARRAY.map(officer => [officer.id, officer])
);

// Localisation data for reference
export const OFFICER_LOCALISATION: Record<number, string> = ${JSON.stringify(officerMap, null, 2)};

export const TRAITS_LOCALISATION: Record<number, string> = ${JSON.stringify(traitsMap, null, 2)};

export const ABILITIES_LOCALISATION: Record<number, string> = ${JSON.stringify(abilitiesMap, null, 2)};

export const FACTIONS_LOCALISATION: Record<number, string> = ${JSON.stringify(factionsMap, null, 2)};

export const SYNERGIES_LOCALISATION: Record<number, string> = ${JSON.stringify(synergiesMap, null, 2)};

// Helper functions
export function findOfficerByName(name: string): OfficerData | null {
  return OFFICER_NAME_MAP.get(name.toLowerCase()) || null;
}

export function findOfficerById(id: number): OfficerData | null {
  return OFFICER_ID_MAP.get(id) || null;
}

export function searchOfficers(searchTerm: string): OfficerData[] {
  const term = searchTerm.toLowerCase();
  return OFFICER_DATA_ARRAY.filter(officer => 
    officer.name.toLowerCase().includes(term)
  );
}

// Officer class names
export const OFFICER_CLASS_NAMES: Record<number, string> = {
  1: 'Command',
  2: 'Engineering', 
  3: 'Science'
};

// Officer rarity colors (for Discord embeds)
export const RARITY_COLORS: Record<string, number> = {
  '1': 0x808080, // Gray - Common
  '2': 0x00FF00, // Green - Uncommon  
  '3': 0x0080FF, // Blue - Rare
  '4': 0x8000FF, // Purple - Epic
  '5': 0xFFD700, // Gold - Legendary
};

export function getOfficerClassName(classId: number): string {
  return OFFICER_CLASS_NAMES[classId] || \`Unknown Class (\${classId})\`;
}

export function getRarityColor(rarity: string): number {
  return RARITY_COLORS[rarity] || 0x808080;
}

// Helper functions for localisation
export function getTraitName(traitId: number): string {
  return TRAITS_LOCALISATION[traitId] || \`Unknown Trait (\${traitId})\`;
}

export function getAbilityName(abilityId: number): string {
  return ABILITIES_LOCALISATION[abilityId] || \`Unknown Ability (\${abilityId})\`;
}

export function getFactionName(factionId: number): string {
  return FACTIONS_LOCALISATION[factionId] || \`Unknown Faction (\${factionId})\`;
}

export function getSynergyName(synergyId: number): string {
  return SYNERGIES_LOCALISATION[synergyId] || \`Unknown Synergy (\${synergyId})\`;
}
`;
}

if (require.main === module) {
    fetchOfficerData();
}

module.exports = { fetchOfficerData, generateOfficerTypeScript };