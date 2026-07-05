const fs = require('fs');

// Read and analyze the officer data to find all unique ability IDs
function analyzeAbilities() {
    console.log('🔍 Analyzing ability IDs in officer data...');
    
    try {
        // Read the TypeScript file as text
        const officerDataContent = fs.readFileSync('./src/officerData.ts', 'utf8');
        
        // Extract all loca_id values from abilities
        const abilityIds = new Set();
        const abilityUsage = {};
        
        // Find all captain_ability, ability, and below_decks_ability sections
        const abilityRegex = /"(captain_ability|ability|below_decks_ability)":\s*\{[\s\S]*?"loca_id":\s*(\d+)/g;
        
        let match;
        while ((match = abilityRegex.exec(officerDataContent)) !== null) {
            const abilityType = match[1];
            const locaId = parseInt(match[2]);
            
            abilityIds.add(locaId);
            
            if (!abilityUsage[locaId]) {
                abilityUsage[locaId] = { count: 0, types: new Set() };
            }
            
            abilityUsage[locaId].count++;
            abilityUsage[locaId].types.add(abilityType);
        }
        
        console.log(`Found ${abilityIds.size} unique ability IDs`);
        
        // Sort by usage frequency
        const sortedAbilities = Object.entries(abilityUsage)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 20); // Top 20 most used abilities
        
        console.log('\n📊 Top 20 most frequently used abilities:');
        console.log('Ability ID | Usage Count | Types');
        console.log('-----------|-------------|------');
        
        sortedAbilities.forEach(([locaId, data]) => {
            const types = Array.from(data.types).join(', ');
            console.log(`${locaId.padEnd(10)} | ${data.count.toString().padEnd(11)} | ${types}`);
        });
        
        // Generate a starter file for ability descriptions
        const abilityDescTemplate = `// Ability descriptions for STFC officers
// Add descriptions for the most common abilities first

export const ABILITY_DESCRIPTIONS: Record<number, string> = {
${sortedAbilities.slice(0, 10).map(([locaId]) => {
            return `  ${locaId}: "Description for ability ${locaId}", // TODO: Add actual description`;
        }).join('\n')}
  // Add more descriptions as needed
};

export function getAbilityDescription(locaId: number): string {
    return ABILITY_DESCRIPTIONS[locaId] || \`Ability ID: \${locaId}\`;
}

export function getAbilityName(locaId: number): string {
    // TODO: Add ability names if available
    return \`Ability \${locaId}\`;
}
`;
        
        fs.writeFileSync('./src/abilityDescriptions.ts', abilityDescTemplate);
        console.log('\n✅ Generated src/abilityDescriptions.ts template');
        console.log('   Edit this file to add actual ability descriptions');
        
        // Also create a JSON file with all ability IDs for reference
        const allAbilityIds = Array.from(abilityIds).sort((a, b) => a - b);
        const abilityData = {
            totalAbilities: allAbilityIds.length,
            abilityIds: allAbilityIds,
            usageStats: Object.fromEntries(
                Object.entries(abilityUsage).map(([id, data]) => [
                    id, 
                    { count: data.count, types: Array.from(data.types) }
                ])
            )
        };
        
        fs.writeFileSync('./ability-analysis.json', JSON.stringify(abilityData, null, 2));
        console.log('✅ Generated ability-analysis.json with complete data');
        
    } catch (error) {
        console.error('❌ Error analyzing abilities:', error.message);
    }
}

analyzeAbilities();
