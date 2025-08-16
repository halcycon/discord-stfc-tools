// Officer lookup utilities for STFC officer information
import { generateAsciiTable, type TableColumn, type TableData } from './tableUtils';
import { 
    OFFICER_DATA_ARRAY, 
    OFFICER_NAME_MAP, 
    OFFICER_ID_MAP,
    findOfficerByName,
    findOfficerById,
    searchOfficers,
    getOfficerClassName,
    getRarityColor,
    getSynergyName,
    type OfficerData,
    type OfficerAbility,
    type OfficerStats
} from './officerData';

// Faction names mapping (same as systemUtils but for officers)
const FACTION_NAMES: Record<string, string> = {
    '-1': 'Neutral',
    '669838839': 'Romulan',
    '1306860549': 'Augment Exile',
    '1530685377': 'Dominion',
    '2064723306': 'Federation',
    '2113010081': 'Augment',
    '2143656960': 'Rogue',
    '2796195869': 'Texas-Class',
    '3292196998': 'Transogen',
    '3522167047': 'Krenim Imperium',
    '4138978039': 'Ex-Borg',
    '4153667145': 'Klingon',
};

export function getFactionName(factionId: number): string {
    return FACTION_NAMES[factionId.toString()] || `Unknown (${factionId})`;
}

export function formatOfficerAbility(ability?: OfficerAbility, rank: number = 1): string {
    if (!ability || !ability.values || ability.values.length === 0) {
        return 'No ability data';
    }
    
    // Clamp rank to available values
    const effectiveRank = Math.min(Math.max(1, rank), ability.values.length);
    const value = ability.values[effectiveRank - 1];
    
    if (!value) {
        return 'No ability data for this rank';
    }
    
    let formattedValue: string;
    
    if (ability.show_percentage && ability.value_is_percentage) {
        formattedValue = `${(value.value * 100).toFixed(1)}%`;
    } else if (ability.show_percentage) {
        formattedValue = `${value.value}%`;
    } else {
        formattedValue = value.value.toString();
    }
    
    return formattedValue;
}

export function handleOfficerLookup(searchTerm: string, rank: number = 1): string {
    if (!searchTerm || searchTerm.trim().length === 0) {
        return 'Please provide an officer name to search for.';
    }
    
    // Try exact name match first
    const exactMatch = findOfficerByName(searchTerm.trim());
    if (exactMatch) {
        return formatOfficerDetails(exactMatch, rank);
    }
    
    // Try searching for partial matches
    const searchResults = searchOfficers(searchTerm.trim());
    
    if (searchResults.length === 0) {
        return `No officers found matching "${searchTerm}". Try a different search term.`;
    }
    
    if (searchResults.length === 1) {
        return formatOfficerDetails(searchResults[0], rank);
    }
    
    // Multiple matches - show a list
    if (searchResults.length <= 10) {
        const tableData: TableData[] = searchResults.map(officer => ({
            'Name': officer.name.length > 18 ? officer.name.substring(0, 15) + '...' : officer.name,
            'Class': getOfficerClassName(officer.class),
            'Rarity': `${officer.rarity}⭐`,
            'Faction': getFactionName(officer.faction).substring(0, 12),
            'Image': `https://stfc-tools-development.adam-57b.workers.dev/officers/${officer.art_id}.png`
        }));
        
        const columns: TableColumn[] = [
            { header: 'Name', width: 20, align: 'left' },
            { header: 'Class', width: 12, align: 'left' },
            { header: 'Rarity', width: 8, align: 'center' },
            { header: 'Faction', width: 12, align: 'left' },
            { header: 'Image', width: 25, align: 'left' }
        ];
        
        return `Found ${searchResults.length} officers matching "${searchTerm}":\n\n\`\`\`\n${generateAsciiTable(tableData, columns)}\n\`\`\``;
    }
    
    return `Found ${searchResults.length} officers matching "${searchTerm}". Please be more specific.`;
}

export function formatOfficerDetails(officer: OfficerData, rank: number = 1): string {
    // Clamp rank to valid range
    const effectiveRank = Math.min(Math.max(1, rank), officer.max_rank);
    
    // Get stats for the specified rank's max level
    const rankData = officer.ranks?.[effectiveRank - 1];
    const maxLevelForRank = rankData?.max_level || 1;
    const statsForRank = officer.stats?.find((s: any) => s.level === maxLevelForRank);
    
    const tableData: TableData[] = [
        { 'Property': 'Name', 'Value': officer.name },
        { 'Property': 'Class', 'Value': getOfficerClassName(officer.class) },
        { 'Property': 'Rarity', 'Value': `${officer.rarity}⭐` },
        { 'Property': 'Faction', 'Value': getFactionName(officer.faction) },
        { 'Property': 'Max Rank', 'Value': officer.max_rank.toString() },
        { 'Property': 'Current Rank', 'Value': effectiveRank.toString() },
        { 'Property': 'Max Level (Rank)', 'Value': maxLevelForRank.toString() },
        { 'Property': '', 'Value': '' }, // Separator
        { 'Property': 'Captain Ability', 'Value': formatOfficerAbility(officer.captain_ability, effectiveRank) },
        { 'Property': 'Officer Ability', 'Value': formatOfficerAbility(officer.ability, effectiveRank) },
        { 'Property': 'Below Decks', 'Value': formatOfficerAbility(officer.below_decks_ability, effectiveRank) },
    ];
    
    // Add stats if available
    if (statsForRank) {
        tableData.push({ 'Property': '', 'Value': '' }); // Separator
        tableData.push({ 'Property': 'Attack', 'Value': Math.round(statsForRank.attack).toString() });
        tableData.push({ 'Property': 'Defense', 'Value': Math.round(statsForRank.defense).toString() });
        tableData.push({ 'Property': 'Health', 'Value': Math.round(statsForRank.health).toString() });
    }
    
    // Add shards required info
    if (effectiveRank < officer.max_rank && officer.ranks) {
        const nextRankData = officer.ranks[effectiveRank];
        if (nextRankData) {
            tableData.push({ 'Property': '', 'Value': '' }); // Separator
            tableData.push({ 'Property': 'Next Rank Shards', 'Value': nextRankData.shards_required.toString() });
        }
    }
    
    const columns: TableColumn[] = [
        { header: 'Property', width: 18, align: 'left' },
        { header: 'Value', width: 40, align: 'left' }
    ];
    
    let result = `**${officer.name}** (${getOfficerClassName(officer.class)} • ${getFactionName(officer.faction)})\n\n`;
    result += generateAsciiTable(tableData, columns);
    
    // Add a note about rank
    if (rank > officer.max_rank) {
        result += `\n\n*Note: Requested rank ${rank} exceeds max rank ${officer.max_rank}. Showing rank ${effectiveRank}.*`;
    }
    
    return result;
}

export function getAllOfficers(): OfficerData[] {
    return OFFICER_DATA_ARRAY;
}

export function getOfficersByFaction(factionId: number): OfficerData[] {
    return OFFICER_DATA_ARRAY.filter((officer: any) => officer.faction === factionId);
}

export function getOfficersByClass(classId: number): OfficerData[] {
    return OFFICER_DATA_ARRAY.filter((officer: any) => officer.class === classId);
}

export function getOfficersByRarity(rarity: string): OfficerData[] {
    return OFFICER_DATA_ARRAY.filter((officer: any) => officer.rarity === rarity);
}
