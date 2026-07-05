import { searchOfficers } from './src/officerData.js';
import { getAbilityDescription } from './src/abilityDescriptions.js';

const officerName = process.argv[2] || 'Kirk';
const officers = searchOfficers(officerName);

if (officers.length === 0) {
    console.log(`❌ No officers found matching "${officerName}"`);
} else {
    const officer = officers[0];
    console.log(`\n🖖 Officer Found: ${officer.name}`);
    console.log(`   Class: ${officer.class}`);
    console.log(`   Rarity: ${officer.rarity}`);
    
    // Test ability descriptions
    if (officer.captain_maneuver_id) {
        const captainDesc = getAbilityDescription(officer.captain_maneuver_id);
        console.log(`   Captain Maneuver: ${captainDesc}`);
    }
    
    if (officer.officer_ability_id) {
        const abilityDesc = getAbilityDescription(officer.officer_ability_id);
        console.log(`   Officer Ability: ${abilityDesc}`);
    }
    
    if (officer.below_deck_ability_id) {
        const belowDeckDesc = getAbilityDescription(officer.below_deck_ability_id);
        console.log(`   Below Deck Ability: ${belowDeckDesc}`);
    }
}
