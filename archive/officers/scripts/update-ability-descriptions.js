const fs = require('fs');

// Script to update ability descriptions with real API data
function updateAbilityDescriptions() {
    console.log('🔄 Updating ability descriptions with real API data...');
    
    try {
        // Read the analysis data
        const analysisData = JSON.parse(fs.readFileSync('./ability-translations-analysis.json', 'utf8'));
        const descriptions = analysisData.abilityDescriptions;
        
        console.log(`📊 Found ${Object.keys(descriptions).length} ability descriptions`);
        
        // Generate the complete TypeScript file
        let content = `// Ability descriptions for STFC officers
// Auto-generated from API translations - DO NOT EDIT MANUALLY
// Run 'node investigate-translations.js && node update-ability-descriptions.js' to regenerate

export const ABILITY_DESCRIPTIONS: Record<number, string> = {
`;
        
        // Add all descriptions, sorted by ID
        const sortedEntries = Object.entries(descriptions)
            .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
        
        sortedEntries.forEach(([id, desc], index) => {
            const escapedDesc = desc
                .replace(/\\/g, '\\\\')  // Escape backslashes
                .replace(/"/g, '\\"')    // Escape quotes
                .replace(/\n/g, '\\n')   // Escape newlines
                .replace(/\r/g, '\\r')   // Escape carriage returns
                .replace(/\t/g, '\\t');  // Escape tabs
            const comma = index < sortedEntries.length - 1 ? ',' : '';
            content += `  ${id}: "${escapedDesc}"${comma}\n`;
        });
        
        content += `};

export function getAbilityDescription(locaId: number): string {
    const desc = ABILITY_DESCRIPTIONS[locaId];
    if (!desc) {
        return \`Unknown ability (ID: \${locaId})\`;
    }
    return desc;
}

export function getAbilityName(locaId: number): string {
    // For now, return generic name - could be enhanced with name extraction
    return \`Ability \${locaId}\`;
}

// Statistics about ability coverage
export const ABILITY_STATS = {
    totalDescriptions: ${Object.keys(descriptions).length},
    lastUpdated: "${new Date().toISOString()}",
    coverage: "${analysisData.matchedIds.length}/${analysisData.matchedIds.length + analysisData.unmatchedIds.length} abilities have descriptions"
};
`;
        
        // Write the file
        fs.writeFileSync('./src/abilityDescriptions.ts', content);
        console.log('✅ Updated src/abilityDescriptions.ts');
        console.log(`   Added ${Object.keys(descriptions).length} real ability descriptions`);
        console.log(`   Coverage: ${analysisData.matchedIds.length}/${analysisData.matchedIds.length + analysisData.unmatchedIds.length} abilities`);
        
        // Clean up temp file
        if (fs.existsSync('./temp_abilities.txt')) {
            fs.unlinkSync('./temp_abilities.txt');
        }
        
    } catch (error) {
        console.error('❌ Error updating ability descriptions:', error.message);
    }
}

updateAbilityDescriptions();
