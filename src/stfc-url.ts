import type { ParsedStfcProUrl, StfcRegion } from './types';

const STFC_PRO_HOST = 'stfc.pro';

export function parseStfcProUrl(urlString: string): ParsedStfcProUrl | null {
	let url: URL;
	try {
		url = new URL(urlString.trim());
	} catch {
		return null;
	}

	if (!url.hostname.endsWith(STFC_PRO_HOST)) {
		return null;
	}

	const result: ParsedStfcProUrl = { rawUrl: urlString.trim() };
	const regionParam = url.searchParams.get('region')?.toUpperCase();
	if (regionParam === 'US' || regionParam === 'EU') {
		result.region = regionParam;
	}

	const pathParts = url.pathname.split('/').filter(Boolean);

	// /player/{id} or /players/{id}
	const playerIdx = pathParts.findIndex((p) => p === 'player' || p === 'players');
	if (playerIdx >= 0 && pathParts[playerIdx + 1]) {
		const id = parseInt(pathParts[playerIdx + 1], 10);
		if (!isNaN(id)) result.playerId = id;
	}

	// /servers/{server}/player/{name} patterns
	const serverIdx = pathParts.findIndex((p) => p === 'server' || p === 'servers');
	if (serverIdx >= 0 && pathParts[serverIdx + 1]) {
		const server = parseInt(pathParts[serverIdx + 1], 10);
		if (!isNaN(server)) result.server = server;
	}

	// Player name as last path segment when not numeric
	if (!result.playerId && pathParts.length > 0) {
		const last = decodeURIComponent(pathParts[pathParts.length - 1]);
		if (last && isNaN(parseInt(last, 10))) {
			result.playerName = last.replace(/-/g, ' ');
		}
	}

	const serverParam = url.searchParams.get('server');
	if (serverParam) {
		const server = parseInt(serverParam, 10);
		if (!isNaN(server)) result.server = server;
	}

	return result;
}

export function resolveSearchTerm(parsed: ParsedStfcProUrl): string | number | null {
	if (parsed.playerId) return parsed.playerId;
	if (parsed.playerName) return parsed.playerName;
	return null;
}
