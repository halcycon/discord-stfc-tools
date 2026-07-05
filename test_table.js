const { generateAsciiTable, parseCSV } = require('./dist/tableUtils.js');

console.log('=== Enhanced Table Demo with Double-Line Borders ===\n');

// Test CSV with multi-line content
const testCsv = `Name,Role,Details
John Smith,Developer,"Main dev|2 years experience|JavaScript expert"
Jane Doe,Designer,"UI/UX specialist|Creative director|5 years experience"
Bob Johnson,Manager,"Team lead|Budget planning|Strategic planning"`;

console.log('Input CSV:');
console.log(testCsv);
console.log('\n=== Parsed Table with Enhanced Formatting ===\n');

try {
    const data = parseCSV(testCsv);
    const table = generateAsciiTable(data);
    console.log(table);
} catch (error) {
    console.error('Error:', error.message);
}
