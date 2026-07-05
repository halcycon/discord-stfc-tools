// Quick test to see the new table format
import { generateAsciiTable } from './src/tableUtils.js';

const testData = [
    {
        'Alliance': 'RONE',
        'System': 'Nidox',
        'Warp': '1',
        'Warp (Highway)': '1',
        'Faction': 'Neutral',
        'Player': 'RogueOneAdmiral'
    }
];

const columns = [
    { header: 'Alliance', width: 10, align: 'left' },
    { header: 'System', width: 12, align: 'left' },
    { header: 'Warp', width: 4, align: 'right' },
    { header: 'Warp (Highway)', width: 13, align: 'right' },
    { header: 'Faction', width: 12, align: 'left' },
    { header: 'Player', width: 15, align: 'left' }
];

console.log(generateAsciiTable(testData, columns));
