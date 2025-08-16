#!/usr/bin/env node

// Simple test for officer lookup functionality
const { handleOfficerLookup } = require('./dist/officerUtils.js');

console.log('🧪 Testing officer lookup functionality...\n');

// Test 1: Exact match
console.log('=== Test 1: Exact officer name match ===');
try {
    const result1 = handleOfficerLookup('Kirk');
    console.log(result1);
} catch (error) {
    console.error('Error:', error.message);
}

console.log('\n=== Test 2: Partial match ===');
try {
    const result2 = handleOfficerLookup('Spo');
    console.log(result2);
} catch (error) {
    console.error('Error:', error.message);
}

console.log('\n=== Test 3: Multiple matches ===');
try {
    const result3 = handleOfficerLookup('Data');
    console.log(result3);
} catch (error) {
    console.error('Error:', error.message);
}

console.log('\n✅ Officer lookup testing completed!');
