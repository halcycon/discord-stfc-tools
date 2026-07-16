/**
 * Parse Discord display names / nicks for STFC-style prefixes and suggest
 * Discord member ↔ alliance-roster links.
 */
import type { DiscordActionRow } from './discord-api';
import { findNearestMatch, normalizePlayerName } from './player-name-match';
import { formatReportTable, playerCell, tagCell } from './report-table';
import type { TableColumn, TableData } from './tableUtils';

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
	/** Guild nickname only (null if unset). */
	serverNick: string | null;
	/** Discord display name (global_name), if any. */
	globalName: string | null;
};

export type LinkSuggestionConfidence = 'high' | 'medium' | 'low';

export type LinkSuggestion = {
	discordUserId: string;
	/** Display used for matching (server nick → global name → username). */
	discordLabel: string;
	/** Guild nickname, or null if they have none. */
	serverNick: string | null;
	/** Discord display name (global_name); mentions often show this when nick is unset. */
	globalName: string | null;
	username: string;
	playerId: number;
	playerName: string;
	allianceTag: string;
	confidence: LinkSuggestionConfidence;
	reason: string;
};

/**
 * What Discord typically shows for a member mention:
 * server nick → global display name (not the @username).
 */
export function discordDisplayNick(s: {
	serverNick?: string | null;
	globalName?: string | null;
}): string | null {
	const nick = s.serverNick?.trim() || null;
	if (nick) return nick;
	const global = s.globalName?.trim() || null;
	return global || null;
}

/** Short code used in `alink:grp:` / `alink:more:` custom_ids. */
export type ConfidenceCode = 'h' | 'm' | 'l';

export const CONFIDENCE_ORDER: LinkSuggestionConfidence[] = ['high', 'medium', 'low'];

export function confidenceEmoji(c: LinkSuggestionConfidence): string {
	return c === 'high' ? '🟢' : c === 'medium' ? '🟡' : '🟠';
}

export function confidenceCode(c: LinkSuggestionConfidence): ConfidenceCode {
	return c === 'high' ? 'h' : c === 'medium' ? 'm' : 'l';
}

export function confidenceFromCode(code: string): LinkSuggestionConfidence | null {
	if (code === 'h' || code === 'high') return 'high';
	if (code === 'm' || code === 'medium') return 'medium';
	if (code === 'l' || code === 'low') return 'low';
	return null;
}

function confidenceRank(c: LinkSuggestionConfidence): number {
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
		const serverNick = m.serverNick?.trim() || null;
		const globalName = m.globalName?.trim() || null;
		const username = (m.username || '').trim();
		const display = (serverNick || globalName || username).trim();
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

		const baseMeta = {
			discordUserId: m.discordUserId,
			discordLabel: display,
			serverNick,
			globalName,
			username: username || display,
		};

		const exact = searchIn.find(
			(r) => normalizePlayerName(r.playerName) === qNorm,
		);
		if (exact) {
			const tagMatch =
				parsed.tag != null &&
				(exact.allianceTag ?? '').toUpperCase() === parsed.tag;
			candidates.push({
				...baseMeta,
				playerId: exact.playerId,
				playerName: exact.playerName,
				allianceTag: exact.allianceTag ?? '—',
				confidence: 'high',
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
		const confidence: LinkSuggestionConfidence =
			nearest.distance === 0 ? 'high' : nearest.distance === 1 ? 'medium' : 'low';
		candidates.push({
			...baseMeta,
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
			serverNick: c.serverNick,
			globalName: c.globalName,
			username: c.username,
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

const SUGGEST_COLS: TableColumn[] = [
	{ header: '#', width: 2, align: 'right' },
	{ header: '●', width: 1 },
	{ header: 'Nick', width: 12 },
	{ header: 'User', width: 10 },
	{ header: 'Player', width: 11 },
	{ header: 'Id', width: 7, align: 'right' },
	{ header: 'Tag', width: 4 },
	{ header: 'Why', width: 12 },
];

function confidenceDot(c: LinkSuggestionConfidence): string {
	return c === 'high' ? 'H' : c === 'medium' ? 'M' : 'L';
}

/** Compact ASCII table of all suggestions (mentions do not render in fences). */
export function formatLinkSuggestionsTable(
	suggestions: LinkSuggestion[],
	opts?: { maxChars?: number },
): string {
	const rows: TableData[] = suggestions.map((s, i) => ({
		'#': String(i + 1),
		'●': confidenceDot(s.confidence),
		// Same name Discord shows on <@user> (guild nick, else global display name).
		Nick: playerCell(discordDisplayNick(s)),
		User: playerCell(s.username),
		Player: playerCell(s.playerName, s.playerId),
		Id: String(s.playerId),
		Tag: tagCell(s.allianceTag),
		Why: (s.reason || '—').slice(0, 12),
	}));
	return formatReportTable(rows, SUGGEST_COLS, {
		maxRows: suggestions.length,
		maxChars: opts?.maxChars ?? 1600,
	});
}

export function countByConfidence(suggestions: LinkSuggestion[]): Record<LinkSuggestionConfidence, number> {
	return {
		high: suggestions.filter((s) => s.confidence === 'high').length,
		medium: suggestions.filter((s) => s.confidence === 'medium').length,
		low: suggestions.filter((s) => s.confidence === 'low').length,
	};
}

export function formatLinkSuggestions(
	suggestions: LinkSuggestion[],
	opts?: {
		tag?: string | null;
		rosterCount?: number;
		discordCount?: number;
		/** Approve-all processes this many links of one confidence per click. */
		approveChunkSize?: number;
		workersPlanLabel?: string;
	},
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

	const counts = countByConfidence(suggestions);
	const tally =
		`🟢 **${counts.high}** · 🟡 **${counts.medium}** · 🟠 **${counts.low}**`;
	const table = formatLinkSuggestionsTable(suggestions, { maxChars: 1550 });
	const chunk = opts?.approveChunkSize;
	const buttonCap = maxLinkSuggestIndividualButtons();
	let footer =
		`\n\n**Buttons:** Approve by confidence (🟢/🟡/🟠), or tap **#** for one row.` +
		(chunk
			? ` Group approve runs **${chunk}/click**` +
				(opts?.workersPlanLabel ? ` (${opts.workersPlanLabel})` : '') +
				`, then **Continue**.`
			: '');
	if (suggestions.length > buttonCap) {
		footer +=
			`\n_Individual buttons for first **${buttonCap}** rows — use group Approve for the rest, ` +
			`or \`/server verify user:@Them link:https://stfc.pro/players/ID\`._`;
	}
	return (
		`🔗 **Link suggestions**${tagNote} (${suggestions.length}) — ${tally}\n` +
		`_● = H/M/L · **Nick** = what mentions show (server nick or display name) · **User** = @username._\n` +
		table +
		footer
	);
}

/** Discord: 5 rows; 1 reserved for group-approve; 4×5 individual. */
export function maxLinkSuggestIndividualButtons(): number {
	return 20;
}

/** Tag key embedded in `alink:*` custom_ids (12 chars max). */
export function linkSuggestTagKey(tagFilter?: string | null): string {
	return (tagFilter?.trim().toUpperCase() || '_').slice(0, 12);
}

/** Continue button after a partial group-approve chunk. */
export function buildApproveContinueComponents(
	guildId: string,
	tagFilter: string | null | undefined,
	remaining: number,
	chunkSize: number,
	confidence: LinkSuggestionConfidence,
): DiscordActionRow[] {
	const tagKey = linkSuggestTagKey(tagFilter);
	const code = confidenceCode(confidence);
	const emoji = confidenceEmoji(confidence);
	const next = Math.min(remaining, chunkSize);
	return [
		{
			type: 1,
			components: [
				{
					type: 2,
					style: confidence === 'high' ? 3 : confidence === 'medium' ? 1 : 2,
					label: `Continue ${emoji} (${remaining} left · next ${next})`.slice(0, 80),
					custom_id: `alink:more:${code}:${guildId}:${tagKey}`,
				},
			],
		},
	];
}

function groupApproveLabel(
	confidence: LinkSuggestionConfidence,
	count: number,
	chunk?: number,
): string {
	const emoji = confidenceEmoji(confidence);
	const next = chunk ? Math.min(count, chunk) : count;
	if (chunk && count > chunk) {
		return `Approve ${emoji} (${count} · ${next}/click)`;
	}
	return `Approve ${emoji} (${count})`;
}

/** Discord button rows: group Approves (one row) + individual # buttons. */
export function buildLinkSuggestComponents(
	guildId: string,
	suggestions: LinkSuggestion[],
	tagFilter?: string | null,
	opts?: { approveChunkSize?: number },
): DiscordActionRow[] {
	if (suggestions.length === 0) return [];

	const rows: DiscordActionRow[] = [];
	const tagKey = linkSuggestTagKey(tagFilter);
	const chunk = opts?.approveChunkSize;
	const counts = countByConfidence(suggestions);

	const groupButtons = CONFIDENCE_ORDER.filter((c) => counts[c] > 0).map((c) => ({
		type: 2 as const,
		style: (c === 'high' ? 3 : c === 'medium' ? 1 : 2) as 1 | 2 | 3,
		label: groupApproveLabel(c, counts[c], chunk).slice(0, 80),
		custom_id: `alink:grp:${confidenceCode(c)}:${guildId}:${tagKey}`,
	}));

	if (groupButtons.length > 0) {
		rows.push({ type: 1, components: groupButtons });
	}

	const forButtons = suggestions.slice(0, maxLinkSuggestIndividualButtons());
	for (let i = 0; i < forButtons.length; i += 5) {
		const slice = forButtons.slice(i, i + 5);
		rows.push({
			type: 1,
			components: slice.map((s, j) => {
				const n = i + j + 1;
				const label = `${n} ✓ ${s.playerName}`.slice(0, 80);
				return {
					type: 2 as const,
					style: (s.confidence === 'high' ? 3 : s.confidence === 'medium' ? 1 : 2) as
						| 1
						| 2
						| 3,
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
