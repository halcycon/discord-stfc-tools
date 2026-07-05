const https = require('https');
const fs = require('fs');

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function investigateAbilityTranslations() {
    console.log('🔍 Investigating ability translations in officers data...');
    
    try {
        // Fetch officer translations data
        console.log('📡 Fetching officer translations...');
        const translations = await httpsGet('https://api.spocks.club/translations/en/officers');
        console.log(`✅ Retrieved ${translations.length} officer translation entries`);
        
        // Filter for ability-related translations
        const abilityTranslations = translations.filter(t => 
            t.key.includes('ability_name') || 
            t.key.includes('ability_desc') ||
            t.key.includes('ability_short_desc')
        );
        
        console.log(`Found ${abilityTranslations.length} ability-related translations`);
        
        // Extract loca_id from keys (officer_ability_name_4 -> 4)
        const locaIdPattern = /ability_(?:name|desc|short_desc)_(\d+)$/;
        const abilityByLocaId = {};
        
        abilityTranslations.forEach(t => {
            const match = t.key.match(locaIdPattern);
            if (match) {
                const locaId = parseInt(match[1]);
                if (!abilityByLocaId[locaId]) {
                    abilityByLocaId[locaId] = {
                        locaId: locaId,
                        officerId: t.id,
                        translations: {}
                    };
                }
                
                // Determine the type (name, desc, short_desc)
                if (t.key.includes('_name_')) {
                    abilityByLocaId[locaId].translations.name = t.text;
                } else if (t.key.includes('_short_desc_')) {
                    abilityByLocaId[locaId].translations.shortDesc = t.text;
                } else if (t.key.includes('_desc_')) {
                    abilityByLocaId[locaId].translations.desc = t.text;
                }
            }
        });
        
        console.log(`\nFound ability descriptions for ${Object.keys(abilityByLocaId).length} different loca_ids`);
        
        // Show some examples
        console.log('\n📋 Sample ability translations:');
        let count = 0;
        for (const [locaId, data] of Object.entries(abilityByLocaId)) {
            if (count >= 5) break;
            
            console.log(`\nLoca ID: ${locaId} (Officer ID: ${data.officerId})`);
            if (data.translations.name) {
                console.log(`  Name: ${data.translations.name}`);
            }
            if (data.translations.shortDesc) {
                console.log(`  Short: ${data.translations.shortDesc.substring(0, 100)}...`);
            }
            if (data.translations.desc) {
                console.log(`  Full: ${data.translations.desc.substring(0, 100)}...`);
            }
            count++;
        }
        
        // Check which loca_ids from our officer data have translations
        console.log('\n🔗 Cross-referencing with officer data...');
        const officerDataContent = fs.readFileSync('./src/officerData.ts', 'utf8');
        
        const locaIdMatches = [...officerDataContent.matchAll(/"loca_id":\s*(\d+)/g)];
        const officerDataLocaIds = [...new Set(locaIdMatches.map(m => parseInt(m[1])))];
        
        const matchedIds = officerDataLocaIds.filter(id => abilityByLocaId[id]);
        const unmatchedIds = officerDataLocaIds.filter(id => !abilityByLocaId[id]);
        
        console.log(`Officer data contains ${officerDataLocaIds.length} unique loca_ids`);
        console.log(`${matchedIds.length} have translations available`);
        console.log(`${unmatchedIds.length} do NOT have translations`);
        
        if (matchedIds.length > 0) {
            console.log(`\n✅ Sample matched abilities:`);
            matchedIds.slice(0, 3).forEach(id => {
                const ability = abilityByLocaId[id];
                console.log(`  loca_id ${id}: ${ability.translations.name || 'No name'}`);
            });
        }
        
        if (unmatchedIds.length > 0) {
            console.log(`\n❌ Sample unmatched loca_ids: ${unmatchedIds.slice(0, 10).join(', ')}`);
        }
        
        // Save the mapping for use in our descriptions
        const abilityDescriptions = {};
        Object.values(abilityByLocaId).forEach(ability => {
            const locaId = ability.locaId;
            const name = ability.translations.name || '';
            const shortDesc = ability.translations.shortDesc || '';
            const fullDesc = ability.translations.desc || '';
            
            // Choose the best description (prefer short desc, fall back to name)
            let description = shortDesc || fullDesc || name || `Ability ${locaId}`;
            
            // Clean up HTML tags and formatting
            description = description
                .replace(/<[^>]*>/g, '') // Remove HTML tags
                .replace(/\{[^}]*\}/g, '%') // Replace placeholders with %
                .trim();
            
            abilityDescriptions[locaId] = description;
        });
        
        fs.writeFileSync('./ability-translations-analysis.json', JSON.stringify({
            totalAbilityTranslations: abilityTranslations.length,
            abilitiesWithTranslations: Object.keys(abilityByLocaId).length,
            matchedIds: matchedIds,
            unmatchedIds: unmatchedIds,
            abilityDescriptions: abilityDescriptions
        }, null, 2));
        
        console.log('\n✅ Analysis saved to ability-translations-analysis.json');
        console.log('💡 Use the abilityDescriptions object to update src/abilityDescriptions.ts');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

investigateAbilityTranslations();
