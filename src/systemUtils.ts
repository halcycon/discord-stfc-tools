// System lookup utilities for STFC coordinate processing
import { generateAsciiTable, type TableColumn, type TableData } from './tableUtils';
import { SYSTEM_DATA_MAP, type SystemData } from './systemData';

export type { SystemData };

export interface CoordinateMatch {
	alliance: string;
	player: string;
	systemId: string;
	x: string;
	y: string;
}

// Faction ID mapping - update these names as needed based on STFC factions
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

// Load system data from in-memory map (no longer needed, but kept for API compatibility)
export function loadSystemData(): SystemData[] {
	return Array.from(SYSTEM_DATA_MAP.values());
}

export function lookupSystemData(systemId: string): SystemData | null {
	return SYSTEM_DATA_MAP.get(systemId) || null;
}

export function parseCoordinateLink(text: string): CoordinateMatch | null {
	// More flexible pattern to match various STFC coordinate formats
	// Matches: [[ALLIANCE] Player S:12345 X:123.456 Y:789.012]
	// Also handles variations with different spacing and negative coordinates
	const pattern = /\[\[([^\]]+)\]\s*([^S]+?)\s*S:(\d+)\s*X:([-\d.]+)\s*Y:([-\d.]+)\]/;
	const match = text.match(pattern);
	
	if (!match) {
		// Try alternative pattern without double brackets
		const altPattern = /\[([^\]]+)\]\s*([^S]+?)\s*S:(\d+)\s*X:([-\d.]+)\s*Y:([-\d.]+)\]/;
		const altMatch = text.match(altPattern);
		
		if (!altMatch) return null;
		
		return {
			alliance: altMatch[1].trim(),
			player: altMatch[2].trim(),
			systemId: altMatch[3],
			x: altMatch[4],
			y: altMatch[5]
		};
	}
	
	return {
		alliance: match[1].trim(),
		player: match[2].trim(),
		systemId: match[3],
		x: match[4],
		y: match[5]
	};
}

export function parseMultipleCoordinates(text: string): CoordinateMatch[] {
	// Pattern to find all coordinate links in text
	const pattern = /\[\[([^\]]+)\]\s*([^S]+?)\s*S:(\d+)\s*X:([-\d.]+)\s*Y:([-\d.]+)\]/g;
	const matches: CoordinateMatch[] = [];
	let match;
	
	while ((match = pattern.exec(text)) !== null) {
		matches.push({
			alliance: match[1].trim(),
			player: match[2].trim(),
			systemId: match[3],
			x: match[4],
			y: match[5]
		});
	}
	
	return matches;
}

export function getFactionName(factionId: string): string {
	return FACTION_NAMES[factionId] || `Unknown (${factionId})`;
}

// New function using our table utilities
export function formatSystemLookupResults(results: Array<{ coordinate: CoordinateMatch, systemData: SystemData | null }>): string {
	if (results.length === 0) {
		return 'No valid coordinate links found in the message.';
	}

	// Convert results to table data format
	const tableData: TableData[] = results.map(result => {
		if (!result.systemData) {
			return {
				'Alliance': result.coordinate.alliance.substring(0, 10),
				'System': result.coordinate.systemId,
				'Warp': '????',
				'Warp (Highway)': '????',
				'Faction': 'Not Found',
				'Player': result.coordinate.player.substring(0, 15)
			};
		}

		const factionName = getFactionName(result.systemData.factionId);
		return {
			'Alliance': result.coordinate.alliance.substring(0, 10),
			'System': result.systemData.systemName.substring(0, 12),
			'Warp': result.systemData.warpRange,
			'Warp (Highway)': result.systemData.warpRangeSH,
			'Faction': factionName.substring(0, 12),
			'Player': result.coordinate.player.substring(0, 15)
		};
	});

	// Define columns with appropriate alignment
	const columns: TableColumn[] = [
		{ header: 'Alliance', width: 10, align: 'left' },
		{ header: 'System', width: 12, align: 'left' },
		{ header: 'Warp', width: 4, align: 'right' },
		{ header: 'Warp (Highway)', width: 13, align: 'right' },
		{ header: 'Faction', width: 12, align: 'left' },
		{ header: 'Player', width: 15, align: 'left' }
	];

	const table = generateAsciiTable(tableData, columns);
	return '```\n' + table + '\n```';
}

export function handleCoordinateLookup(message: string): string {
	const coordinates = parseMultipleCoordinates(message);
	
	if (coordinates.length === 0) {
		const singleCoordinate = parseCoordinateLink(message);
		if (!singleCoordinate) {
			return 'No valid coordinate links found in the message.';
		}
		coordinates.push(singleCoordinate);
	}

	// Lookup system data for each coordinate
	const results = coordinates.map((coordinate) => ({
		coordinate,
		systemData: lookupSystemData(coordinate.systemId)
	}));

	// Check if any systems were not found
	const notFoundSystems = results.filter(r => !r.systemData);
	if (notFoundSystems.length === results.length) {
		// All systems not found
		if (results.length === 1) {
			return `System ${results[0].coordinate.systemId} not found in database.`;
		}
		return `${notFoundSystems.length} systems not found in database.`;
	}

	// Use our new table formatting function
	return formatSystemLookupResults(results);
}
