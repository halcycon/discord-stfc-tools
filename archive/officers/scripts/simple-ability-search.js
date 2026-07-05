const fs = require('fs');

// Simple script to find all officers with a specific loca_id
function findAbilityById(targetId) {
    console.log(`🔍 Searching for loca_id: ${targetId}`);
    
    const content = fs.readFileSync('./src/officerData.ts', 'utf8');
    const lines = content.split('\n');
    
    const matches = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Check if this line contains our target loca_id
        const locaMatch = line.match(new RegExp(`"loca_id":\\s*${targetId}[,\\s}]`));
        if (locaMatch) {
            // Look backward to find the officer name
            let officerName = 'Unknown';
            let abilityType = 'Unknown';
            
            // Search backwards for officer name (within reasonable distance)
            for (let j = Math.max(0, i - 500); j < i; j++) {
                const nameMatch = lines[j].match(/"name":\s*"([^"]+)"/);
                if (nameMatch) {
                    officerName = nameMatch[1];
                }
                
                // Also look for ability type
                const abilityMatch = lines[j].match(/"(captain_ability|ability|below_decks_ability)":\s*\{/);
                if (abilityMatch && j > i - 50) { // Only if it's close to our loca_id
                    abilityType = abilityMatch[1];
                }
            }
            
            matches.push({
                line: i + 1,
                officer: officerName,
                abilityType: abilityType,
                context: line.trim()
            });
        }
    }
    
    console.log(`Found ${matches.length} matches:`);
    matches.forEach((match, idx) => {
        console.log(`${idx + 1}. ${match.officer} (${match.abilityType}) - Line ${match.line}`);
        console.log(`   Context: ${match.context}`);
    });
    
    return matches;
}

const targetId = process.argv[2];
if (!targetId) {
    console.log('Usage: node simple-ability-search.js <loca_id>');
    console.log('Example: node simple-ability-search.js 41007');
    process.exit(1);
}

findAbilityById(parseInt(targetId));
