import { inflate } from 'pako';
import type { PlayerData } from './types';

const STFC_HEADERS = {
	'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
	'Referer': 'https://stfc.pro/',
	'Accept': 'application/json',
	'Sec-Fetch-Mode': 'cors',
};

function shortDelay(): Promise<void> {
	const ms = (Math.floor(Math.random() * 3) + 2) * 1000;
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function decompressStfcPayload(compressedData: string): unknown {
	const decoded = atob(compressedData);
	const bytes = new Uint8Array(decoded.length);
	for (let i = 0; i < decoded.length; i++) {
		bytes[i] = decoded.charCodeAt(i);
	}
	const json = inflate(bytes, { to: 'string' });
	return JSON.parse(json);
}

function extractPlayerArray(data: unknown): Record<string, unknown>[] {
	if (Array.isArray(data)) return data;
	if (data && typeof data === 'object') {
		const obj = data as Record<string, unknown>;
		if (Array.isArray(obj.data)) return obj.data as Record<string, unknown>[];
		if (Array.isArray(obj.players)) return obj.players as Record<string, unknown>[];
	}
	return [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapRawPlayer(player: any, server: number, region: string, allianceTag = ''): PlayerData {
	return {
		playerId: player.playerid || player.player_id || player.playerId || 0,
		name: player.owner || player.name || player.player_name || '',
		rank: player.rank || player.alliance_rank || '',
		level: player.level || player.player_level || 0,
		helps: String(player.helps || player.daily_helps || ''),
		rss: String(player.power || player.player_power || player.rss || ''),
		power: Number(player.power || player.player_power || 0),
		max_power: Number(player.max_power || player.power || player.player_power || 0),
		iso: String(player.iso || player.tritanium || ''),
		joinDate: String(player.joinDate || player.join_date || ''),
		allianceId: String(player.allianceId || player.alliance_id || ''),
		allianceTag: allianceTag || player.tag || player.alliance_tag || '',
		server,
		region,
	};
}

async function fetchPlayersPage(url: string): Promise<Record<string, unknown>[]> {
	const response = await fetch(url, { headers: STFC_HEADERS });
	if (response.status === 429) {
		await new Promise((r) => setTimeout(r, 30_000));
		return fetchPlayersPage(url);
	}
	if (!response.ok) return [];

	const data = await response.json() as { data?: string; players?: string };
	const compressed = data.data || data.players;
	if (!compressed) return [];

	const pageData = decompressStfcPayload(compressed);
	return extractPlayerArray(pageData);
}

export async function fetchAllianceByTag(
	tag: string,
	server: number,
	region: string,
): Promise<PlayerData[]> {
	const allPlayers: PlayerData[] = [];
	const upperRegion = region.toUpperCase();

	for (let page = 1; page <= 10; page++) {
		const url =
			`https://stfc.pro/api/players?type=player_data_power&page=${page}&pageCount=250` +
			`&region=${upperRegion}&server=${server}&tag=${encodeURIComponent(tag)}` +
			`&sortBy=rank&sortOrder=asc&search=&searchMatch=false&rankMatch=false`;

		const players = await fetchPlayersPage(url);
		if (players.length === 0) break;

		allPlayers.push(...players.map((p) => mapRawPlayer(p, server, region, tag)));
		if (players.length < 250) break;
		if (page < 10) await shortDelay();
	}

	return allPlayers;
}

export async function findPlayerByIdOrName(
	playerIdOrName: string | number,
	server: number,
	region: string,
): Promise<PlayerData | null> {
	const searchTerm = typeof playerIdOrName === 'number' ? String(playerIdOrName) : playerIdOrName;
	const upperRegion = region.toUpperCase();
	const url =
		`https://stfc.pro/api/players?type=player_data_power&page=1&pageCount=50` +
		`&region=${upperRegion}&server=${server}&search=${encodeURIComponent(searchTerm)}` +
		`&searchMatch=true&tag=&sortBy=rank&sortOrder=asc&rankMatch=false`;

	const players = await fetchPlayersPage(url);
	if (players.length === 0) return null;

	if (typeof playerIdOrName === 'number') {
		const exact = players.find((p) => {
			const id = p.playerid || p.player_id || p.playerId;
			return Number(id) === playerIdOrName;
		});
		if (exact) return mapRawPlayer(exact, server, region, String(exact.tag || ''));
	}

	const nameLower = typeof playerIdOrName === 'string' ? playerIdOrName.toLowerCase() : '';
	if (nameLower) {
		const nameMatch = players.find((p) => {
			const name = String(p.owner || p.name || p.player_name || '').toLowerCase();
			return name === nameLower || name.includes(nameLower);
		});
		if (nameMatch) return mapRawPlayer(nameMatch, server, region, String(nameMatch.tag || ''));
	}

	return null;
}

export function formatPlayerSummary(player: PlayerData): string {
	const power = player.power ? player.power.toLocaleString() : player.rss;
	return [
		`**${player.name}** (ID: ${player.playerId})`,
		`Alliance: **${player.allianceTag || '—'}**`,
		`Ops: **${player.level}** • Power: **${power}**`,
		`Server: ${player.server} (${player.region})`,
	].join('\n');
}
