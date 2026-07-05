// Simple test for officer lookup functionality
import { handleOfficerLookup } from './src/officerUtils.js';

console.log('🧪 Testing officer lookup functionality...\n');

// Test 1: Kirk
console.log('=== Test 1: Searching for Kirk ===');
try {
    const result1 = handleOfficerLookup('Kirk');
    console.log(result1);
} catch (error) {
    console.error('Error:', error.message);
}

console.log('\n=== Test 2: Searching for James ===');
try {
    const result2 = handleOfficerLookup('James');
    console.log(result2);
} catch (error) {
    console.error('Error:', error.message);
}

console.log('\n✅ Officer lookup testing completed!');
