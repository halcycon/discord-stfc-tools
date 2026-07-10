import { inflate } from 'pako';
import type { PlayerData } from './types';

const STFC_HEADERS = {
	'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
	'Referer': 'https://stfc.pro/',
	'Accept': 'application/json',
	'Sec-Fetch-Mode': 'cors',
};

const STFC_HTML_HEADERS = {
	'User-Agent': STFC_HEADERS['User-Agent'],
	'Referer': STFC_HEADERS['Referer'],
	'Accept': 'text/html,application/xhtml+xml',
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
	const jsonStr = inflate(bytes, { toText: true }) as unknown as string;
	return JSON.parse(jsonStr);
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

function extractJsonObjectFromHtml(html: string, key: string): unknown | null {
	// Finds `"${key}":{...}` and returns the parsed JSON object.
	const needle = `"${key}":`;
	const startIdx = html.indexOf(needle);
	if (startIdx === -1) return null;

	const openBraceIdx = html.indexOf('{', startIdx + needle.length);
	if (openBraceIdx === -1) return null;

	let depth = 0;
	let inString = false;
	let escape = false;
	for (let i = openBraceIdx; i < html.length; i++) {
		const ch = html[i];
		if (inString) {
			if (escape) {
				escape = false;
				continue;
			}
			if (ch === '\\') {
				escape = true;
				continue;
			}
			if (ch === '"') inString = false;
			continue;
		}

		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === '{') depth++;
		if (ch === '}') {
			depth--;
			if (depth === 0) {
				const jsonStr = html.slice(openBraceIdx, i + 1);
				try {
					return JSON.parse(jsonStr);
				} catch {
					return null;
				}
			}
		}
	}

	return null;
}

function stripTrailingBackslashes(value: string): string {
	return value.replace(/\\+$/g, '').trim();
}

function extractStringNearKey(html: string, startIdx: number, key: string): string | null {
	const idx = html.indexOf(key, startIdx);
	if (idx === -1) return null;
	const snippet = html.slice(Math.max(0, idx - 80), Math.min(html.length, idx + 250));

	// Handles both raw and escaped Next.js script-string forms.
	// Captures until the next quote or backslash.
	const re = new RegExp(`\\\\?\\\"?${key}\\\\?\\\"?[^:]*:\\s*(?:\\\\?\\\")?([^\\\\\\\",]+)`);
	const m = snippet.match(re);
	return m ? stripTrailingBackslashes(m[1]) : null;
}

function extractNumberNearKey(html: string, startIdx: number, key: string): number | null {
	const idx = html.indexOf(key, startIdx);
	if (idx === -1) return null;
	const snippet = html.slice(Math.max(0, idx - 80), Math.min(html.length, idx + 250));

	const re = new RegExp(`\\\\?\\\"?${key}\\\\?\\\"?[^:]*:\\s*(?:\\\\?\\\")?(\\d+)`);
	const m = snippet.match(re);
	return m ? Number(m[1]) : null;
}

function extractInitialPlayerFromHtml(
	html: string,
	fallbackServer: number,
	fallbackRegion: string,
): PlayerData | null {
	const start = html.indexOf('initialPlayer');
	if (start === -1) return null;

	const playerId = extractNumberNearKey(html, start, 'playerid') ?? extractNumberNearKey(html, start, 'player_id');
	if (!playerId) return null;

	const name = extractStringNearKey(html, start, 'owner') ?? extractStringNearKey(html, start, 'name') ?? '';
	const rank = extractStringNearKey(html, start, 'rankdesc') ?? extractStringNearKey(html, start, 'rank') ?? '';
	const level = extractNumberNearKey(html, start, 'level') ?? 0;

	const helps =
		extractStringNearKey(html, start, 'helps') ??
		extractStringNearKey(html, start, 'daily_helps') ??
		extractStringNearKey(html, start, 'ahelps') ??
		'';
	const rss = extractStringNearKey(html, start, 'rss') ?? extractStringNearKey(html, start, 'rssmined') ?? '';
	const power = extractNumberNearKey(html, start, 'power') ?? 0;
	const max_power = extractNumberNearKey(html, start, 'max_power') ?? power;
	const iso = extractStringNearKey(html, start, 'iso') ?? extractStringNearKey(html, start, 'tritanium') ?? '';
	const joinDate = extractStringNearKey(html, start, 'ajoined') ?? extractStringNearKey(html, start, 'joinDate') ?? '';

	const allianceId = extractStringNearKey(html, start, 'allianceid') ?? extractStringNearKey(html, start, 'alliance_id') ?? '';
	const allianceTag = extractStringNearKey(html, start, 'tag') ?? extractStringNearKey(html, start, 'alliance_tag') ?? '';

	const server = extractNumberNearKey(html, start, 'server') ?? fallbackServer;
	const region = (extractStringNearKey(html, start, 'region') ?? fallbackRegion).toUpperCase();

	return {
		playerId,
		name,
		rank,
		level,
		helps,
		rss,
		power,
		max_power,
		iso,
		joinDate,
		allianceId,
		allianceTag,
		server,
		region,
	};
}

function mapInitialPlayerFromHtml(initialPlayer: any, fallbackServer: number, fallbackRegion: string): PlayerData | null {
	if (!initialPlayer || typeof initialPlayer !== 'object') return null;

	const server = Number(initialPlayer.server ?? fallbackServer);
	const region = String(initialPlayer.region ?? fallbackRegion).toUpperCase();

	return {
		playerId: Number(initialPlayer.playerid ?? initialPlayer.player_id ?? initialPlayer.playerId ?? 0),
		name: String(initialPlayer.owner ?? initialPlayer.name ?? initialPlayer.player_name ?? ''),
		rank: String(initialPlayer.rankdesc ?? initialPlayer.rank ?? initialPlayer.alliance_rank ?? ''),
		level: Number(initialPlayer.level ?? initialPlayer.player_level ?? 0),
		helps: String(initialPlayer.helps ?? initialPlayer.ahelps ?? initialPlayer.daily_helps ?? ''),
		rss: String(initialPlayer.rss ?? initialPlayer.player_rss ?? ''),
		power: Number(initialPlayer.power ?? initialPlayer.player_power ?? 0),
		max_power: Number(initialPlayer.max_power ?? initialPlayer.cur_max_power ?? initialPlayer.player_max_power ?? initialPlayer.power ?? 0),
		iso: String(initialPlayer.iso ?? initialPlayer.tritanium ?? ''),
		joinDate: String(initialPlayer.ajoined ?? initialPlayer.joinDate ?? initialPlayer.join_date ?? ''),
		allianceId: String(initialPlayer.allianceid ?? initialPlayer.alliance_id ?? initialPlayer.allianceId ?? ''),
		allianceTag: String(initialPlayer.tag ?? initialPlayer.alliance_tag ?? ''),
		server: Number.isFinite(server) ? server : fallbackServer,
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
	const asNumberId = typeof playerIdOrName === 'number' ? playerIdOrName : Number.NaN;
	const searchTerm = Number.isFinite(asNumberId) ? String(asNumberId) : String(playerIdOrName);
	const upperRegion = region.toUpperCase();

	// Primary path: try the documented stfc.pro API.
	try {
		const url =
			`https://stfc.pro/api/players?type=player_data_power&page=1&pageCount=50` +
			`&region=${upperRegion}&server=${server}&search=${encodeURIComponent(searchTerm)}` +
			`&level=&searchMatch=true&tag=&sortBy=rank&sortOrder=asc&rankMatch=false`;

		const players = await fetchPlayersPage(url);

		if (players.length > 0) {
			if (Number.isFinite(asNumberId)) {
				const exact = players.find((p) => {
					const id = p.playerid || p.player_id || p.playerId;
					return Number(id) === asNumberId;
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
		}
	} catch {
		// Ignore API failures and fall back to HTML scraping below.
	}

	// Fallback: for numeric IDs, scrape the player page HTML (`initialPlayer` JSON).
	if (Number.isFinite(asNumberId)) {
		try {
			const playerUrl = `https://stfc.pro/players/${asNumberId}`;
			const pageRes = await fetch(playerUrl, { headers: STFC_HTML_HEADERS });
			if (pageRes.ok) {
				const html = await pageRes.text();
				const mapped = extractInitialPlayerFromHtml(html, server, region);
				if (mapped && mapped.playerId) return mapped;
			}
		} catch {
			// swallow and return null below
		}
	}

	return null;
}

export function formatPlayerSummary(player: PlayerData): string {
	const power = player.power ? player.power.toLocaleString() : player.rss;
	const rank = player.rank?.trim() ? player.rank.trim() : '—';
	return [
		`**${player.name}** (ID: ${player.playerId})`,
		`Alliance: **${player.allianceTag || '—'}** • Rank: **${rank}**`,
		`Ops: **${player.level}** • Power: **${power}**`,
		`Server: ${player.server} (${player.region})`,
	].join('\n');
}
