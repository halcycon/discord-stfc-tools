import type { GuildMode } from './types';

export const DISCORD_NICK_MAX = 32;

export type AllianceRankKey = 'Operative' | 'Agent' | 'Premier' | 'Commodore' | 'Admiral';

/** Short forms used in Discord nicknames (32-char limit). */
export type AllianceRankAbbrev = 'Op' | 'Ag' | 'Pr' | 'Com' | 'Adm';

export const ALL_ALLIANCE_RANKS: AllianceRankKey[] = [
	'Operative',
	'Agent',
	'Premier',
	'Commodore',
	'Admiral',
];

const LEADERSHIP_RANKS = new Set<AllianceRankKey>(['Premier', 'Commodore', 'Admiral']);

const RANK_ABBREV: Record<AllianceRankKey, AllianceRankAbbrev> = {
	Operative: 'Op',
	Agent: 'Ag',
	Premier: 'Pr',
	Commodore: 'Com',
	Admiral: 'Adm',
};

export function normalizeAllianceRank(rank: string | undefined | null): AllianceRankKey | null {
	if (!rank) return null;
	const r = rank.trim().toLowerCase();
	switch (r) {
		case 'operative':
		case 'op':
			return 'Operative';
		case 'agent':
		case 'ag':
			return 'Agent';
		case 'premier':
		case 'pr':
			return 'Premier';
		case 'commodore':
		case 'com':
			return 'Commodore';
		case 'admiral':
		case 'adm':
			return 'Admiral';
		default:
			return null;
	}
}

export function abbreviateAllianceRank(rank: AllianceRankKey): AllianceRankAbbrev {
	return RANK_ABBREV[rank];
}

export function isLeadershipRank(rank: AllianceRankKey | null): boolean {
	return rank !== null && LEADERSHIP_RANKS.has(rank);
}

/**
 * Parse comma-separated or JSON-ish rank list for nickname display.
 * Empty / invalid → all ranks (default). Dedupes, preserves canonical order.
 */
export function parseNicknameDisplayRanks(
	raw: string | readonly string[] | null | undefined,
): AllianceRankKey[] {
	let parts: string[] = [];
	if (Array.isArray(raw)) {
		parts = raw.map(String);
	} else if (typeof raw === 'string' && raw.trim()) {
		const trimmed = raw.trim();
		if (trimmed.startsWith('[')) {
			try {
				const parsed = JSON.parse(trimmed);
				if (Array.isArray(parsed)) parts = parsed.map(String);
			} catch {
				parts = trimmed.split(/[,|]/);
			}
		} else {
			parts = trimmed.split(/[,|]/);
		}
	}
	const selected = new Set<AllianceRankKey>();
	for (const p of parts) {
		const key = normalizeAllianceRank(p);
		if (key) selected.add(key);
	}
	if (selected.size === 0) return [...ALL_ALLIANCE_RANKS];
	return ALL_ALLIANCE_RANKS.filter((r) => selected.has(r));
}

export function rankShownInNickname(
	rank: AllianceRankKey | null,
	displayRanks: readonly string[] | null | undefined,
): boolean {
	if (!rank) return false;
	const allowed = parseNicknameDisplayRanks(displayRanks ?? null);
	return allowed.includes(rank);
}

/** Mode defaults when `guild_configs.nickname_template` is null/empty. */
export function defaultNicknameTemplate(mode: GuildMode): string {
	return mode === 'multi_alliance'
		? '[{alliance_tag}]{rank_paren} {player_name}'
		: '{rank_prefix}{player_name}';
}

export interface NicknamePlayerFields {
	name: string;
	allianceTag?: string | null;
	rank?: string | null;
}

export interface BuildNicknameOpts {
	/** Which ranks appear in {rank}/{rank_prefix}/{rank_paren}. Default: all five. */
	displayRanks?: readonly string[] | null;
}

/**
 * Build a Discord nickname from a template.
 *
 * Placeholders:
 * - `{player_name}` — in-game name
 * - `{alliance_tag}` — alliance tag (no brackets)
 * - `{rank}` — abbreviated rank (Adm/Com/Pr/Op/Ag) when allowed by displayRanks
 * - `{rank_prefix}` — `[Adm] ` / `[Com] ` / `[Pr] ` for leadership ranks in displayRanks
 * - `{rank_paren}` — ` (Adm)` etc. when rank is known and in displayRanks
 *
 * Result is trimmed, collapsed whitespace, and truncated to Discord's 32-char limit.
 */
export function buildMemberNickname(
	template: string | null | undefined,
	mode: GuildMode,
	player: NicknamePlayerFields,
	opts?: BuildNicknameOpts,
): string {
	const tpl = template?.trim() || defaultNicknameTemplate(mode);
	const rankKey = normalizeAllianceRank(player.rank);
	const showRank = rankShownInNickname(rankKey, opts?.displayRanks);
	const rankAbbrev = showRank && rankKey ? abbreviateAllianceRank(rankKey) : '';
	const rankPrefix =
		showRank && isLeadershipRank(rankKey) ? `[${rankAbbrev}] ` : '';
	const rankParen = rankAbbrev ? ` (${rankAbbrev})` : '';
	const allianceTag = (player.allianceTag ?? '').trim();
	const playerName = (player.name ?? '').trim() || 'Unknown';

	let nick = tpl
		.replaceAll('{player_name}', playerName)
		.replaceAll('{alliance_tag}', allianceTag)
		.replaceAll('{rank_prefix}', rankPrefix)
		.replaceAll('{rank_paren}', rankParen)
		.replaceAll('{rank}', rankAbbrev);

	nick = nick.replace(/\s+/g, ' ').trim();
	// Drop empty bracket/paren leftovers from missing tag/rank, e.g. "[] Name" or "() Name"
	nick = nick.replace(/\[\s*\]/g, '').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim();

	if (nick.length > DISCORD_NICK_MAX) {
		nick = nick.slice(0, DISCORD_NICK_MAX).trimEnd();
	}
	return nick || playerName.slice(0, DISCORD_NICK_MAX);
}
