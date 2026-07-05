// Officer lookup utilities for STFC officer information
import { generateAsciiTable, type TableColumn, type TableData } from './tableUtils';
import { getAbilityDescription } from './abilityDescriptions';
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
    
    // Include chance information if it's not 100%
    let chanceInfo = '';
    if (value.chance < 1) {
        chanceInfo = ` (${(value.chance * 100).toFixed(0)}% chance)`;
    }
    
    // Try to get ability description, fallback to basic info
    const description = getAbilityDescription(ability.loca_id);
    
    return `${formattedValue}${chanceInfo} - ${description}`;
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
            'Name': `</officer name:${officer.name}>`,
            'Class': getOfficerClassName(officer.class),
            'Rarity': `${officer.rarity}⭐`,
            'Faction': getFactionName(officer.faction).substring(0, 12),
            'Image': `https://stfc-tools.adam-57b.workers.dev/officers/${officer.art_id}.png`
        }));
        
        const columns: TableColumn[] = [
            { header: 'Name', width: 20, align: 'left' },
            { header: 'Class', width: 12, align: 'left' },
            { header: 'Rarity', width: 6, align: 'center' },
            { header: 'Faction', width: 12, align: 'left' },
            { header: 'Image', width: 50, align: 'left' }
        ];
        
        return `Found ${searchResults.length} officers matching "${searchTerm}":\n\n\`\`\`\n${generateAsciiTable(tableData, columns)}\n\`\`\``;
    }
    
    return `Found ${searchResults.length} officers matching "${searchTerm}". Please be more specific.`;
}

export function formatOfficerDetails(officer: OfficerData, rank: number = 1): string {
    // Clamp rank to valid range
    const effectiveRank = Math.min(Math.max(1, rank), officer.max_rank);
    
    // Start with officer header info and image
    let result = `**${officer.name}** (${getOfficerClassName(officer.class)} • ${getFactionName(officer.faction)})\n`;
    result += `🌟 Rarity: ${officer.rarity}⭐ | Max Rank: ${officer.max_rank}\n`;
    result += `https://stfc-tools.adam-57b.workers.dev/officers/${officer.art_id}.png\n\n`;
    
    // Show abilities
    if (officer.captain_ability) {
        result += `**Captain Ability (Rank ${effectiveRank}):** ${formatOfficerAbility(officer.captain_ability, effectiveRank)}\n`;
    }
    if (officer.ability) {
        result += `**Officer Ability (Rank ${effectiveRank}):** ${formatOfficerAbility(officer.ability, effectiveRank)}\n`;
    }
    if (officer.below_decks_ability) {
        result += `**Below Decks (Rank ${effectiveRank}):** ${formatOfficerAbility(officer.below_decks_ability, effectiveRank)}\n`;
    }
    
    // Create stats table for all available ranks
    if (officer.ranks && officer.stats) {
        result += `\n**Stats by Rank:**\n`;
        
        const statsTableData: TableData[] = [];
        
        for (let r = 1; r <= officer.max_rank; r++) {
            const rankData = officer.ranks[r - 1];
            if (rankData) {
                const maxLevelForRank = rankData.max_level;
                const statsForRank = officer.stats.find((s: any) => s.level === maxLevelForRank);
                
                if (statsForRank) {
                    const isCurrentRank = r === effectiveRank;
                    statsTableData.push({
                        'Rank': isCurrentRank ? `→ ${r} ←` : r.toString(),
                        'Max Level': maxLevelForRank.toString(),
                        'Attack': Math.round(statsForRank.attack).toString(),
                        'Defense': Math.round(statsForRank.defense).toString(),
                        'Health': Math.round(statsForRank.health).toString(),
                        'Shards': r < officer.max_rank && officer.ranks[r] ? officer.ranks[r].shards_required.toString() : '-'
                    });
                }
            }
        }
        
        const statsColumns: TableColumn[] = [
            { header: 'Rank', width: 8, align: 'center' },
            { header: 'Max Level', width: 9, align: 'center' },
            { header: 'Attack', width: 8, align: 'right' },
            { header: 'Defense', width: 8, align: 'right' },
            { header: 'Health', width: 8, align: 'right' },
            { header: 'Shards', width: 8, align: 'right' }
        ];
        
        result += `\`\`\`\n${generateAsciiTable(statsTableData, statsColumns)}\n\`\`\``;
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
