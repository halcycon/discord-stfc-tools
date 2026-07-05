const { getAbilityDescription } = require('./temp-abilityDescriptions.js');

console.log('🔍 Testing ability descriptions...');
console.log('ID 1:', getAbilityDescription(1));
console.log('ID 15:', getAbilityDescription(15));
console.log('ID 100:', getAbilityDescription(100));
console.log('ID 999999:', getAbilityDescription(999999));

console.log('\n📊 Sample ability descriptions:');
[1, 2, 3, 15, 20, 25].forEach(id => {
    console.log(`  ${id}: ${getAbilityDescription(id)}`);
});
