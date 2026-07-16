import { inflate } from 'pako';
import type { PlayerData } from './types';
import { getStfcAuthHeaders, invalidateStfcAuth } from './stfc-session';

const STFC_HEADERS = {
	'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
	Referer: 'https://stfc.pro/',
	Origin: 'https://stfc.pro',
	Accept: 'application/json',
	'Sec-Fetch-Mode': 'cors',
};

const STFC_HTML_HEADERS = {
	'User-Agent': STFC_HEADERS['User-Agent'],
	Referer: STFC_HEADERS.Referer,
	Accept: 'text/html,application/xhtml+xml',
};

/** Cloudflare / datacenter egress is blocked on /api/players (403 forbidden). */
const API_BLOCKED_ERRORS = new Set(['forbidden']);

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

/** Unwrap API player rows (legacy flat objects or `{ data: {...} }`). */
export function unwrapPlayerRow(row: unknown): Record<string, unknown> | null {
	if (!row || typeof row !== 'object') return null;
	const obj = row as Record<string, unknown>;
	if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
		return obj.data as Record<string, unknown>;
	}
	return obj;
}

/**
 * Normalize /api/players JSON into a flat player object array.
 * Supports:
 * - New: `{ players: [{ data: {...} }, ...] }`
 * - Legacy compressed: `{ data|players: "<base64+zlib>" }` → array / `{ data|players: [...] }`
 * - Raw array
 */
export function extractPlayerArray(data: unknown): Record<string, unknown>[] {
	if (Array.isArray(data)) {
		return data.map(unwrapPlayerRow).filter((p): p is Record<string, unknown> => p != null);
	}
	if (!data || typeof data !== 'object') return [];

	const obj = data as Record<string, unknown>;

	// New uncompressed shape
	if (Array.isArray(obj.players)) {
		const first = obj.players[0];
		if (typeof first === 'string') {
			// unlikely, but treat as compressed string fallthrough below
		} else {
			return obj.players.map(unwrapPlayerRow).filter((p): p is Record<string, unknown> => p != null);
		}
	}

	// Legacy: compressed string on data/players
	const compressed = obj.data ?? obj.players;
	if (typeof compressed === 'string' && compressed.length > 0) {
		try {
			const pageData = decompressStfcPayload(compressed);
			return extractPlayerArray(pageData);
		} catch {
			return [];
		}
	}

	if (Array.isArray(obj.data)) {
		return obj.data.map(unwrapPlayerRow).filter((p): p is Record<string, unknown> => p != null);
	}

	return [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapRawPlayer(player: any, server: number, region: string, allianceTag = ''): PlayerData {
	const streakRaw =
		player.consecutive_days_active ??
		player.consecutiveDaysActive ??
		player.consecutive_days ??
		null;
	const consecutiveDaysActive =
		streakRaw == null || streakRaw === ''
			? null
			: Number.isFinite(Number(streakRaw))
				? Math.max(0, Math.floor(Number(streakRaw)))
				: null;
	const allianceTagOut = String(allianceTag || player.tag || player.alliance_tag || '').trim();
	// Prefer textual rankdesc; bare `rank` is often a numeric code and can mis-map.
	const rankRaw = String(
		player.rankdesc || player.alliance_rank || player.rank_name || '',
	).trim();
	return {
		playerId: player.playerid || player.player_id || player.playerId || 0,
		name: player.owner || player.name || player.player_name || '',
		// No alliance ⇒ no in-game alliance rank (avoids stale/wrong Premier etc.).
		rank: allianceTagOut ? rankRaw : '',
		level: player.level || player.player_level || 0,
		helps: String(player.helps || player.ahelps || player.daily_helps || ''),
		rss: String(player.rss || player.power || player.player_power || ''),
		power: Number(player.power || player.player_power || 0),
		max_power: Number(player.max_power || player.power || player.player_power || 0),
		iso: String(player.iso || player.tritanium || ''),
		joinDate: String(player.ajoined || player.joinDate || player.join_date || ''),
		allianceId: String(player.allianceid || player.allianceId || player.alliance_id || ''),
		allianceTag: allianceTagOut,
		server,
		region,
		consecutiveDaysActive,
	};
}

export function coerceNumericPlayerId(playerIdOrName: string | number): number | null {
	if (typeof playerIdOrName === 'number' && Number.isFinite(playerIdOrName) && playerIdOrName > 0) {
		return playerIdOrName;
	}
	if (typeof playerIdOrName === 'string' && /^\d+$/.test(playerIdOrName.trim())) {
		const n = Number(playerIdOrName.trim());
		return Number.isFinite(n) && n > 0 ? n : null;
	}
	return null;
}

function extractStringNearKey(html: string, startIdx: number, key: string): string | null {
	const idx = html.indexOf(key, startIdx);
	if (idx === -1) return null;
	const snippet = html.slice(Math.max(0, idx - 80), Math.min(html.length, idx + 250));

	const re = new RegExp(`\\\\?\\\"?${key}\\\\?\\\"?[^:]*:\\s*(?:\\\\?\\\")?([^\\\\\\\",]+)`);
	const m = snippet.match(re);
	return m ? m[1].replace(/\\+$/g, '').trim() : null;
}

function extractNumberNearKey(html: string, startIdx: number, key: string): number | null {
	const idx = html.indexOf(key, startIdx);
	if (idx === -1) return null;
	const snippet = html.slice(Math.max(0, idx - 80), Math.min(html.length, idx + 250));

	const re = new RegExp(`\\\\?\\\"?${key}\\\\?\\\"?[^:]*:\\s*(?:\\\\?\\\")?(\\d+)`);
	const m = snippet.match(re);
	return m ? Number(m[1]) : null;
}

/** Prefer parsing the embedded initialPlayer object (handles Next.js-escaped JSON). */
export function extractInitialPlayerObject(html: string): Record<string, unknown> | null {
	const marker = html.indexOf('initialPlayer');
	if (marker === -1) return null;

	const window = html.slice(marker, marker + 12_000);
	const unescaped = window.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
	const brace = unescaped.indexOf('{');
	if (brace === -1) return null;

	let depth = 0;
	let inString = false;
	let escape = false;
	for (let i = brace; i < unescaped.length; i++) {
		const ch = unescaped[i];
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
				try {
					const parsed = JSON.parse(unescaped.slice(brace, i + 1)) as unknown;
					return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
				} catch {
					return null;
				}
			}
		}
	}
	return null;
}

export function extractInitialPlayerFromHtml(
	html: string,
	fallbackServer: number,
	fallbackRegion: string,
): PlayerData | null {
	const obj = extractInitialPlayerObject(html);
	if (obj) {
		const mapped = mapRawPlayer(obj, fallbackServer, fallbackRegion, String(obj.tag || ''));
		if (mapped.playerId) {
			const server = Number(obj.server ?? mapped.server);
			const region = String(obj.region ?? mapped.region).toUpperCase();
			const tag = (mapped.allianceTag || '').trim();
			const rankDesc = String(obj.rankdesc ?? '').trim();
			return {
				...mapped,
				allianceTag: tag,
				// Only trust textual rankdesc when the player is in an alliance.
				rank: tag ? rankDesc || mapped.rank : '',
				server: Number.isFinite(server) ? server : fallbackServer,
				region: region || fallbackRegion,
			};
		}
	}

	// Fallback: near-key scrape (works on escaped flight payloads).
	const start = html.indexOf('initialPlayer');
	if (start === -1) return null;

	const playerId = extractNumberNearKey(html, start, 'playerid') ?? extractNumberNearKey(html, start, 'player_id');
	if (!playerId) return null;

	const name = extractStringNearKey(html, start, 'owner') ?? extractStringNearKey(html, start, 'name') ?? '';
	// Prefer rankdesc only — bare `rank` is often numeric and not an alliance rank name.
	const rankDesc = extractStringNearKey(html, start, 'rankdesc') ?? '';
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
	const streakNear = extractNumberNearKey(html, start, 'consecutive_days_active');

	const allianceId =
		extractStringNearKey(html, start, 'allianceid') ?? extractStringNearKey(html, start, 'alliance_id') ?? '';
	const allianceTag = (
		extractStringNearKey(html, start, 'tag') ?? extractStringNearKey(html, start, 'alliance_tag') ?? ''
	).trim();

	const server = extractNumberNearKey(html, start, 'server') ?? fallbackServer;
	const region = (extractStringNearKey(html, start, 'region') ?? fallbackRegion).toUpperCase();

	return {
		playerId,
		name,
		rank: allianceTag ? rankDesc : '',
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
		consecutiveDaysActive: streakNear != null ? Math.max(0, Math.floor(streakNear)) : null,
	};
}

async function fetchPlayerFromHtml(
	playerId: number,
	server: number,
	region: string,
): Promise<PlayerData | null> {
	const upperRegion = region.toUpperCase();
	const urls = [
		`https://stfc.pro/players/${playerId}?region=${encodeURIComponent(upperRegion)}&server=${server}`,
		`https://stfc.pro/players/${playerId}`,
	];

	let lastStatus: number | null = null;
	for (const playerUrl of urls) {
		try {
			const pageRes = await fetch(playerUrl, { headers: STFC_HTML_HEADERS });
			lastStatus = pageRes.status;
			if (!pageRes.ok) continue;
			const html = await pageRes.text();
			const mapped = extractInitialPlayerFromHtml(html, server, region);
			if (mapped?.playerId) return mapped;
		} catch {
			/* try next URL */
		}
	}

	if (lastStatus === 404) return null;
	return null;
}

async function fetchPlayersPage(url: string, env: Env): Promise<Record<string, unknown>[]> {
	const result = await fetchPlayersPageResult(url, env);
	return result.ok ? result.players : [];
}

type FetchPageResult =
	| { ok: true; players: Record<string, unknown>[] }
	| { ok: false; error: string; blocked?: boolean };

async function readPlayersJson(response: Response): Promise<unknown> {
	const buf = await response.arrayBuffer();
	const bytes = new Uint8Array(buf);
	// Some edges return gzip without auto-inflate; handle both.
	if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
		const ds = new DecompressionStream('gzip');
		const stream = new Blob([bytes]).stream().pipeThrough(ds);
		const text = await new Response(stream).text();
		return JSON.parse(text);
	}
	const text = new TextDecoder().decode(bytes);
	return JSON.parse(text);
}

async function fetchPlayersPageResult(url: string, env: Env, retried = false): Promise<FetchPageResult> {
	try {
		const auth = await getStfcAuthHeaders(env);
		const response = await fetch(url, {
			headers: {
				...STFC_HEADERS,
				Cookie: auth.cookie,
				'X-STFC-Token': auth.token,
			},
		});

		if (response.status === 429) {
			await new Promise((r) => setTimeout(r, 30_000));
			return fetchPlayersPageResult(url, env, retried);
		}

		if (!response.ok) {
			let errBody = '';
			try {
				errBody = await response.text();
			} catch {
				/* ignore */
			}
			let parsed: { error?: string } | null = null;
			try {
				parsed = JSON.parse(errBody) as { error?: string };
			} catch {
				/* ignore */
			}
			const code = parsed?.error;

			// Datacenter / CF egress block — do not burn retries reminting auth.
			if (code && API_BLOCKED_ERRORS.has(code)) {
				return {
					ok: false,
					blocked: true,
					error: `stfc.pro API HTTP ${response.status} (${code})`,
				};
			}

			if (!retried && (code === 'no_session' || code === 'invalid_token')) {
				await invalidateStfcAuth(env, code === 'no_session' ? 'session' : 'token');
				await getStfcAuthHeaders(env, {
					forceSession: code === 'no_session',
					forceToken: true,
				});
				return fetchPlayersPageResult(url, env, true);
			}

			return {
				ok: false,
				error: code
					? `stfc.pro API HTTP ${response.status} (${code})`
					: `stfc.pro API HTTP ${response.status}`,
			};
		}

		const data = await readPlayersJson(response);
		return { ok: true, players: extractPlayerArray(data) };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : 'stfc.pro API fetch failed',
		};
	}
}

export async function fetchAllianceByTag(
	env: Env,
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

		const players = await fetchPlayersPage(url, env);
		if (players.length === 0) break;

		allPlayers.push(...players.map((p) => mapRawPlayer(p, server, region, tag)));
		if (players.length < 250) break;
		if (page < 10) await shortDelay();
	}

	return allPlayers;
}

export type StfcLookupResult =
	| { status: 'ok'; player: PlayerData }
	| { status: 'not_found' }
	| { status: 'error'; error: string };

/**
 * Lookup with explicit not_found vs transport/API error (for demotion resilience).
 *
 * Numeric IDs: HTML profile page first (works from Cloudflare egress).
 * Name search: /api/players (often blocked from CF — returns error).
 */
export async function lookupPlayerByIdOrName(
	env: Env,
	playerIdOrName: string | number,
	server: number,
	region: string,
): Promise<StfcLookupResult> {
	const numericId = coerceNumericPlayerId(playerIdOrName);
	const upperRegion = region.toUpperCase();

	// Prefer HTML for numeric IDs — /api/players is blocked from CF datacenter IPs.
	if (numericId != null) {
		const htmlPlayer = await fetchPlayerFromHtml(numericId, server, upperRegion);
		if (htmlPlayer) return { status: 'ok', player: htmlPlayer };
	}

	const searchTerm = numericId != null ? String(numericId) : String(playerIdOrName);
	let apiError: string | null = null;
	let apiSucceeded = false;
	let apiBlocked = false;

	const url =
		`https://stfc.pro/api/players?type=player_data_power&page=1&pageCount=50` +
		`&region=${upperRegion}&server=${server}&search=${encodeURIComponent(searchTerm)}` +
		`&level=&searchMatch=true&tag=&sortBy=rank&sortOrder=asc&rankMatch=false`;

	const api = await fetchPlayersPageResult(url, env);
	if (api.ok) {
		apiSucceeded = true;
		const players = api.players;
		if (players.length > 0) {
			if (numericId != null) {
				const exact = players.find((p) => {
					const id = p.playerid || p.player_id || p.playerId;
					return Number(id) === numericId;
				});
				if (exact) {
					return {
						status: 'ok',
						player: mapRawPlayer(exact, server, region, String(exact.tag || '')),
					};
				}
			}

			const nameLower = typeof playerIdOrName === 'string' ? playerIdOrName.toLowerCase() : '';
			if (nameLower && numericId == null) {
				const nameMatch = players.find((p) => {
					const name = String(p.owner || p.name || p.player_name || '').toLowerCase();
					return name === nameLower || name.includes(nameLower);
				});
				if (nameMatch) {
					return {
						status: 'ok',
						player: mapRawPlayer(nameMatch, server, region, String(nameMatch.tag || '')),
					};
				}
			}
		}
	} else {
		apiError = api.error;
		apiBlocked = Boolean(api.blocked);
	}

	// HTML already tried for numeric IDs above.
	if (numericId != null) {
		// HTML miss + API miss/block → not found (don't treat CF block as hard error for ID lookups).
		if (apiBlocked || apiSucceeded) return { status: 'not_found' };
		return { status: 'error', error: apiError ?? 'stfc.pro player page unavailable' };
	}

	if (!apiSucceeded) {
		return {
			status: 'error',
			error: apiBlocked
				? 'stfc.pro player API blocked from this network; use a numeric player ID / profile URL'
				: (apiError ?? 'stfc.pro API unavailable'),
		};
	}

	return { status: 'not_found' };
}

/** Convenience wrapper — null means not found or error (legacy callers). */
export async function findPlayerByIdOrName(
	env: Env,
	playerIdOrName: string | number,
	server: number,
	region: string,
): Promise<PlayerData | null> {
	const result = await lookupPlayerByIdOrName(env, playerIdOrName, server, region);
	return result.status === 'ok' ? result.player : null;
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

export type AllianceRosterScrape = {
	allianceId: string;
	allianceTag: string;
	allianceName: string;
	server: number;
	region: string;
	players: PlayerData[];
};

/** Extract a JSON value after `"key":` from Next.js-escaped (or raw) HTML. */
function extractJsonAfterKey(html: string, key: string): unknown | null {
	const markers = [
		`\\"${key}\\"`, // \"key\"
		`"${key}"`, // "key"
		`${key}\\"`, // key\"  (inside an already-quoted RSC string)
		`${key}"`, // key"
	];

	const tryParseAt = (markerIdx: number, escaped: boolean): unknown | null => {
		const window = html.slice(markerIdx, markerIdx + 900_000);
		const text = escaped
			? // RSC flight embeds JSON with \" … \". Leave \\n / \\t as JSON escapes for JSON.parse.
				window.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
			: window;

		let keyAt = text.indexOf(`"${key}"`);
		if (keyAt === -1) {
			keyAt = text.indexOf(key);
			if (keyAt === -1) return null;
		}
		let i = text.indexOf(':', keyAt);
		if (i === -1) return null;
		i++;
		while (i < text.length && /\s/.test(text[i]!)) i++;
		const startChar = text[i];
		// Alliance pages also embed `"players": 87` (count) — prefer array/object payloads.
		if (startChar !== '{' && startChar !== '[') return null;

		const stack: string[] = [];
		let inString = false;
		let escape = false;
		for (let j = i; j < text.length; j++) {
			const ch = text[j]!;
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
			if (ch === '{' || ch === '[') stack.push(ch);
			else if (ch === '}' || ch === ']') {
				const open = stack.pop();
				if ((ch === '}' && open !== '{') || (ch === ']' && open !== '[')) return null;
				if (stack.length === 0) {
					try {
						return JSON.parse(text.slice(i, j + 1));
					} catch {
						return null;
					}
				}
			}
		}
		return null;
	};

	for (const m of markers) {
		const escaped = m.includes('\\');
		let from = 0;
		while (from < html.length) {
			const idx = html.indexOf(m, from);
			if (idx === -1) break;
			const parsed = tryParseAt(idx, escaped);
			if (parsed != null) return parsed;
			from = idx + m.length;
		}
	}
	return null;
}

export function extractAllianceRosterFromHtml(
	html: string,
	fallbackServer: number,
	fallbackRegion: string,
): AllianceRosterScrape | null {
	const playersRaw = extractJsonAfterKey(html, 'players');
	if (!Array.isArray(playersRaw) || playersRaw.length === 0) return null;

	const first = playersRaw[0] as Record<string, unknown>;
	let allianceId = String(first.allianceid ?? first.allianceId ?? first.alliance_id ?? '');
	let allianceTag = String(first.tag ?? first.alliance_tag ?? '');
	// Alliance roster rows use `name` for the alliance name and `owner` for the player.
	const allianceName = String(first.name ?? '');
	const server = Number(first.server ?? fallbackServer) || fallbackServer;
	const region = String(first.region ?? fallbackRegion).toUpperCase() || fallbackRegion;

	if (!allianceId) {
		const m = html.match(/allianceid\\":(\d+)/) || html.match(/"allianceid":(\d+)/);
		if (m) allianceId = m[1]!;
	}

	const players: PlayerData[] = [];
	for (const row of playersRaw) {
		if (!row || typeof row !== 'object') continue;
		const obj = row as Record<string, unknown>;
		const mapped = mapRawPlayer(obj, server, region, allianceTag);
		if (!mapped.playerId || !mapped.name) continue;
		const rowServer = Number(obj.server ?? server);
		const rowRegion = String(obj.region ?? region).toUpperCase() || region;
		players.push({
			...mapped,
			name: String(obj.owner ?? mapped.name),
			rank: String(obj.rankdesc ?? mapped.rank ?? ''),
			allianceId: String(obj.allianceid ?? obj.allianceId ?? allianceId),
			allianceTag: String(obj.tag ?? allianceTag),
			server: Number.isFinite(rowServer) ? rowServer : server,
			region: rowRegion,
		});
	}
	if (players.length === 0) return null;

	return {
		allianceId,
		allianceTag,
		allianceName,
		server,
		region,
		players,
	};
}

export async function scrapeAllianceById(
	allianceId: string | number,
	server: number,
	region: string,
): Promise<AllianceRosterScrape | null> {
	const id = String(allianceId).trim();
	if (!id) return null;
	const upperRegion = region.toUpperCase();
	const urls = [
		`https://stfc.pro/alliances/${id}?region=${encodeURIComponent(upperRegion)}&server=${server}`,
		`https://stfc.pro/alliances/${id}`,
	];

	for (const url of urls) {
		try {
			const res = await fetch(url, { headers: STFC_HTML_HEADERS });
			if (!res.ok) continue;
			const html = await res.text();
			const scraped = extractAllianceRosterFromHtml(html, server, upperRegion);
			if (scraped && scraped.players.length > 0) {
				if (!scraped.allianceId) scraped.allianceId = id;
				return scraped;
			}
		} catch {
			/* try next */
		}
	}
	return null;
}

export type ServerAllianceDirectoryEntry = {
	allianceId: string;
	allianceTag: string;
	allianceName: string;
	serverRank: number | null;
	playerCount: number | null;
	server: number;
	region: string;
};

export function extractServerAlliancesFromHtml(
	html: string,
	fallbackServer: number,
	fallbackRegion: string,
): ServerAllianceDirectoryEntry[] {
	const raw = extractJsonAfterKey(html, 'alliances');
	if (!Array.isArray(raw) || raw.length === 0) return [];

	const out: ServerAllianceDirectoryEntry[] = [];
	for (const row of raw) {
		if (!row || typeof row !== 'object') continue;
		const obj = row as Record<string, unknown>;
		const allianceId = String(obj.id ?? obj.allianceid ?? obj.allianceId ?? '').trim();
		const allianceTag = String(obj.tag ?? obj.alliance_tag ?? '').trim();
		if (!allianceId || !allianceTag) continue;
		const server = Number(obj.server ?? fallbackServer);
		const region = String(obj.region ?? fallbackRegion).toUpperCase() || fallbackRegion;
		const serverRank = obj.server_rank != null ? Number(obj.server_rank) : null;
		const playerCount =
			obj.players != null
				? Number(obj.players)
				: obj.player_count != null
					? Number(obj.player_count)
					: null;
		out.push({
			allianceId,
			allianceTag,
			allianceName: String(obj.name ?? ''),
			serverRank: Number.isFinite(serverRank as number) ? serverRank : null,
			playerCount: Number.isFinite(playerCount as number) ? playerCount : null,
			server: Number.isFinite(server) ? server : fallbackServer,
			region,
		});
	}
	return out;
}

export async function scrapeServerAlliances(
	server: number,
	region: string,
): Promise<ServerAllianceDirectoryEntry[]> {
	const upperRegion = region.toUpperCase();
	const urls = [
		`https://stfc.pro/servers/${server}?region=${encodeURIComponent(upperRegion)}`,
		`https://stfc.pro/servers/${server}`,
	];
	for (const url of urls) {
		try {
			const res = await fetch(url, { headers: STFC_HTML_HEADERS });
			if (!res.ok) continue;
			const html = await res.text();
			const entries = extractServerAlliancesFromHtml(html, server, upperRegion);
			if (entries.length > 0) return entries;
		} catch {
			/* try next */
		}
	}
	return [];
}
