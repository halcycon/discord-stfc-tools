const fs = require('fs');

// This script helps find which officers use specific ability IDs
// Useful for researching what abilities actually do

function findOfficersWithAbility(targetAbilityId) {
    console.log(`🔍 Finding officers with ability ID: ${targetAbilityId}`);
    
    try {
        const officerDataContent = fs.readFileSync('./src/officerData.ts', 'utf8');
        
        // More precise parsing: find each officer block and examine abilities individually
        const officerMatches = [];
        
        // Split by officer entries (each starts with "id": number)
        const officerBlocks = officerDataContent.split(/(?="id":\s*\d+,)/);
        
        for (const block of officerBlocks) {
            // Skip if this block doesn't contain a name (not a valid officer block)
            const nameMatch = block.match(/"name":\s*"([^"]+)"/);
            if (!nameMatch) continue;
            
            const officerName = nameMatch[1];
            
            // Check each ability type separately with more precise regex
            const abilityChecks = [
                { type: 'captain_ability', regex: new RegExp('"captain_ability":\\s*\\{[\\s\\S]*?"loca_id":\\s*' + targetAbilityId + '[,\\s}]') },
                { type: 'ability', regex: new RegExp('"ability":\\s*\\{[\\s\\S]*?"loca_id":\\s*' + targetAbilityId + '[,\\s}]') },
                { type: 'below_decks_ability', regex: new RegExp('"below_decks_ability":\\s*\\{[\\s\\S]*?"loca_id":\\s*' + targetAbilityId + '[,\\s}]') }
            ];
            
            for (const check of abilityChecks) {
                if (check.regex.test(block)) {
                    // Get more details about the ability
                    const abilityBlockRegex = new RegExp(`"${check.type}":\\s*\\{([\\s\\S]*?)\\}(?=\\s*[,}])`);
                    const abilityBlockMatch = block.match(abilityBlockRegex);
                    
                    let abilityDetails = '';
                    if (abilityBlockMatch) {
                        const abilityContent = abilityBlockMatch[1];
                        
                        // Extract some key details
                        const idMatch = abilityContent.match(/"id":\s*(\d+)/);
                        const percentageMatch = abilityContent.match(/"value_is_percentage":\s*(true|false)/);
                        const valueMatch = abilityContent.match(/"value":\s*([\d.]+)/);
                        
                        if (idMatch) abilityDetails += ` [ID: ${idMatch[1]}]`;
                        if (valueMatch && percentageMatch) {
                            const value = parseFloat(valueMatch[1]);
                            const isPercentage = percentageMatch[1] === 'true';
                            abilityDetails += ` [Value: ${isPercentage ? (value * 100) + '%' : value}]`;
                        }
                    }
                    
                    officerMatches.push({
                        name: officerName,
                        abilityType: check.type,
                        abilityId: targetAbilityId,
                        details: abilityDetails
                    });
                }
            }
        }
        
        console.log(`Found ${officerMatches.length} matches for ability ID ${targetAbilityId}:`);
        officerMatches.forEach((match, index) => {
            console.log(`  ${index + 1}. ${match.name} (${match.abilityType})${match.details}`);
        });
        
        // Show unique officers count
        const uniqueOfficers = [...new Set(officerMatches.map(m => m.name))];
        console.log(`\nAcross ${uniqueOfficers.length} unique officers: ${uniqueOfficers.join(', ')}`);
        
        return officerMatches;
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        return [];
    }
}

// Check command line arguments
const targetId = process.argv[2];
if (!targetId) {
    console.log('Usage: node find-ability-officers.js <ability_id>');
    console.log('Example: node find-ability-officers.js 41007');
    console.log('\nMost common ability IDs:');
    console.log('41007 - Used 17 times');
    console.log('56005 - Used 12 times'); 
    console.log('50005 - Used 4 times');
    process.exit(1);
}

findOfficersWithAbility(parseInt(targetId));
