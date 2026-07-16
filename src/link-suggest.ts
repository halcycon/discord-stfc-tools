/**
 * Parse Discord display names / nicks for STFC-style prefixes and suggest
 * Discord member ↔ alliance-roster links.
 */
import type { DiscordActionRow } from './discord-api';
import { findNearestMatch, normalizePlayerName } from './player-name-match';

export type ParsedDiscordNick = {
	/** Uppercase alliance tag if nick starts with [TAG]. */
	tag: string | null;
	/** Remaining display name after stripping [TAG] and (rank). */
	name: string;
	/** Raw rank token inside parentheses, if any. */
	rankToken: string | null;
};

/**
 * Strip common bot nick patterns:
 * `[TAG] (Adm) PlayerName` · `[TAG] PlayerName` · `PlayerName`
 */
export function parseDiscordNick(raw: string | null | undefined): ParsedDiscordNick {
	let s = (raw ?? '').trim();
	if (!s) return { tag: null, name: '', rankToken: null };

	let tag: string | null = null;
	const tagMatch = s.match(/^\[([^\]]+)\]\s*/);
	if (tagMatch) {
		tag = tagMatch[1]!.trim().toUpperCase() || null;
		s = s.slice(tagMatch[0].length).trim();
	}

	let rankToken: string | null = null;
	const leadRank = s.match(/^\(([^)]+)\)\s*/);
	if (leadRank) {
		rankToken = leadRank[1]!.trim() || null;
		s = s.slice(leadRank[0].length).trim();
	} else {
		const trailRank = s.match(/\s*\(([^)]+)\)\s*$/);
		if (trailRank) {
			rankToken = trailRank[1]!.trim() || null;
			s = s.slice(0, -trailRank[0].length).trim();
		}
	}

	return { tag, name: s, rankToken };
}

export type LinkSuggestRosterPlayer = {
	playerId: number;
	playerName: string;
	allianceTag: string | null;
	opsLevel: number | null;
};

export type LinkSuggestDiscordMember = {
	discordUserId: string;
	username: string;
	nick: string | null;
};

export type LinkSuggestion = {
	discordUserId: string;
	discordLabel: string;
	playerId: number;
	playerName: string;
	allianceTag: string;
	confidence: 'high' | 'medium' | 'low';
	reason: string;
};

function confidenceRank(c: LinkSuggestion['confidence']): number {
	return c === 'high' ? 3 : c === 'medium' ? 2 : 1;
}

/**
 * Suggest Discord ↔ roster pairs. Greedy: highest confidence first; each
 * Discord user and each player_id used at most once.
 */
export function suggestRosterDiscordLinks(
	members: LinkSuggestDiscordMember[],
	roster: LinkSuggestRosterPlayer[],
	opts?: { tagFilter?: string | null; limit?: number },
): LinkSuggestion[] {
	const tagFilter = opts?.tagFilter?.trim().toUpperCase() || null;
	const limit = Math.min(Math.max(opts?.limit ?? 40, 1), 80);

	const rosterPool = tagFilter
		? roster.filter((r) => (r.allianceTag ?? '').toUpperCase() === tagFilter)
		: roster;

	type Cand = LinkSuggestion & { score: number };
	const candidates: Cand[] = [];

	for (const m of members) {
		const display = (m.nick?.trim() || m.username || '').trim();
		if (!display) continue;
		const parsed = parseDiscordNick(display);
		const queryName = parsed.name || display;
		const qNorm = normalizePlayerName(queryName);
		if (!qNorm) continue;

		const byTag =
			parsed.tag != null
				? rosterPool.filter((r) => (r.allianceTag ?? '').toUpperCase() === parsed.tag)
				: [];
		const searchIn = byTag.length > 0 ? byTag : rosterPool;
		if (searchIn.length === 0) continue;

		const exact = searchIn.find(
			(r) => normalizePlayerName(r.playerName) === qNorm,
		);
		if (exact) {
			const tagMatch =
				parsed.tag != null &&
				(exact.allianceTag ?? '').toUpperCase() === parsed.tag;
			candidates.push({
				discordUserId: m.discordUserId,
				discordLabel: display,
				playerId: exact.playerId,
				playerName: exact.playerName,
				allianceTag: exact.allianceTag ?? '—',
				confidence: tagMatch ? 'high' : 'high',
				reason: tagMatch ? 'exact name + [TAG]' : 'exact name',
				score: tagMatch ? 100 : 90,
			});
			continue;
		}

		const nearest = findNearestMatch(
			queryName,
			searchIn.map((r) => ({ name: r.playerName, payload: r })),
		);
		if (!nearest || nearest.distance > 2) continue;
		const r = nearest.payload;
		const tagMatch =
			parsed.tag != null && (r.allianceTag ?? '').toUpperCase() === parsed.tag;
		const confidence: LinkSuggestion['confidence'] =
			nearest.distance === 0 ? 'high' : nearest.distance === 1 ? 'medium' : 'low';
		candidates.push({
			discordUserId: m.discordUserId,
			discordLabel: display,
			playerId: r.playerId,
			playerName: r.playerName,
			allianceTag: r.allianceTag ?? '—',
			confidence: tagMatch && confidence === 'low' ? 'medium' : confidence,
			reason:
				(tagMatch ? '[TAG] + ' : '') +
				(nearest.distance === 0 ? 'exact' : `fuzzy Δ${nearest.distance}`),
			score:
				(tagMatch ? 20 : 0) +
				(confidence === 'high' ? 70 : confidence === 'medium' ? 50 : 30) -
				nearest.distance,
		});
	}

	candidates.sort(
		(a, b) =>
			b.score - a.score ||
			confidenceRank(b.confidence) - confidenceRank(a.confidence),
	);

	const usedUsers = new Set<string>();
	const usedPlayers = new Set<number>();
	const out: LinkSuggestion[] = [];
	for (const c of candidates) {
		if (usedUsers.has(c.discordUserId) || usedPlayers.has(c.playerId)) continue;
		usedUsers.add(c.discordUserId);
		usedPlayers.add(c.playerId);
		out.push({
			discordUserId: c.discordUserId,
			discordLabel: c.discordLabel,
			playerId: c.playerId,
			playerName: c.playerName,
			allianceTag: c.allianceTag,
			confidence: c.confidence,
			reason: c.reason,
		});
		if (out.length >= limit) break;
	}
	return out;
}

export function formatLinkSuggestions(
	suggestions: LinkSuggestion[],
	opts?: { tag?: string | null; rosterCount?: number; discordCount?: number },
): string {
	const tagNote = opts?.tag ? ` for **[${opts.tag.toUpperCase()}]**` : '';
	if (suggestions.length === 0) {
		const rosterN = opts?.rosterCount;
		const discordN = opts?.discordCount;
		if (rosterN === 0) {
			return (
				`🔗 **Link suggestions**${tagNote}\n` +
				`_No unlinked roster players` +
				(opts?.tag ? ` for **[${opts.tag.toUpperCase()}]**` : '') +
				`._ Scraped alliances may be fully verified, or the tag was not tracked/scraped yet (\`/alliance track tag:\`).`
			);
		}
		return (
			`🔗 **Link suggestions**${tagNote}\n` +
			`_No confident matches_` +
			(typeof rosterN === 'number' && typeof discordN === 'number'
				? ` (${rosterN} unlinked roster · ${discordN} unverified Discord)`
				: '') +
			`._ Members need server nick / display name close to the in-game name (ideally \`[TAG] Name\`).`
		);
	}
	const lines = suggestions.map((s, i) => {
		const conf =
			s.confidence === 'high' ? '🟢' : s.confidence === 'medium' ? '🟡' : '🟠';
		return (
			`${conf} **${i + 1}.** <@${s.discordUserId}> \`${s.discordLabel}\` → **${s.playerName}** ` +
			`(\`${s.playerId}\`) [${s.allianceTag}] — ${s.reason}`
		);
	});
	const highCount = suggestions.filter((s) => s.confidence === 'high').length;
	const buttonCap = maxLinkSuggestButtons(highCount > 0);
	let footer =
		`\n\nUse the buttons below to link` +
		(highCount ? ` (or **Approve all 🟢** for ${highCount} high-confidence)` : '') +
		`.`;
	if (suggestions.length > buttonCap) {
		footer +=
			`\n_Buttons for first **${buttonCap}** only — ` +
			`\`/server verify user:@Them link:https://stfc.pro/players/ID\` for the rest._`;
	}
	return (
		`🔗 **Link suggestions**${tagNote} (${suggestions.length})\n` +
		lines.join('\n') +
		footer
	);
}

/** Discord allows 5 action rows; Approve-all uses one when present. */
export function maxLinkSuggestButtons(hasApproveAllHigh: boolean): number {
	return hasApproveAllHigh ? 20 : 25;
}

/** Discord button rows for approving suggested links. */
export function buildLinkSuggestComponents(
	guildId: string,
	suggestions: LinkSuggestion[],
	tagFilter?: string | null,
): DiscordActionRow[] {
	if (suggestions.length === 0) return [];

	const rows: DiscordActionRow[] = [];
	const high = suggestions.filter((s) => s.confidence === 'high');
	const tagKey = (tagFilter?.trim().toUpperCase() || '_').slice(0, 12);

	if (high.length > 0) {
		rows.push({
			type: 1,
			components: [
				{
					type: 2,
					style: 3,
					label: `Approve all 🟢 (${high.length})`.slice(0, 80),
					custom_id: `alink:high:${guildId}:${tagKey}`,
				},
			],
		});
	}

	const forButtons = suggestions.slice(0, maxLinkSuggestButtons(high.length > 0));
	for (let i = 0; i < forButtons.length; i += 5) {
		const chunk = forButtons.slice(i, i + 5);
		rows.push({
			type: 1,
			components: chunk.map((s, j) => {
				const n = i + j + 1;
				const label = `${n} ✓ ${s.playerName}`.slice(0, 80);
				return {
					type: 2,
					style: s.confidence === 'high' ? 3 : s.confidence === 'medium' ? 1 : 2,
					label,
					custom_id: `alink:1:${guildId}:${s.discordUserId}:${s.playerId}:${tagKey}`,
				};
			}),
		});
	}

	// Discord max 5 action rows
	return rows.slice(0, 5);
}

export function stfcProPlayerUrl(playerId: number, server?: number, region?: string): string {
	const base = `https://stfc.pro/players/${playerId}`;
	if (server && region) {
		return `${base}?server=${server}&region=${encodeURIComponent(region)}`;
	}
	return base;
}
