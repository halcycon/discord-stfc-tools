import type { GuildMode } from './types';

export const DISCORD_NICK_MAX = 32;

export type AllianceRankKey = 'Operative' | 'Agent' | 'Premier' | 'Commodore' | 'Admiral';

const LEADERSHIP_RANKS = new Set<AllianceRankKey>(['Premier', 'Commodore', 'Admiral']);

export function normalizeAllianceRank(rank: string | undefined | null): AllianceRankKey | null {
	if (!rank) return null;
	const r = rank.trim().toLowerCase();
	switch (r) {
		case 'operative':
			return 'Operative';
		case 'agent':
			return 'Agent';
		case 'premier':
			return 'Premier';
		case 'commodore':
			return 'Commodore';
		case 'admiral':
			return 'Admiral';
		default:
			return null;
	}
}

export function isLeadershipRank(rank: AllianceRankKey | null): boolean {
	return rank !== null && LEADERSHIP_RANKS.has(rank);
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

/**
 * Build a Discord nickname from a template.
 *
 * Placeholders:
 * - `{player_name}` — in-game name
 * - `{alliance_tag}` — alliance tag (no brackets)
 * - `{rank}` — normalized rank or empty
 * - `{rank_prefix}` — `[Admiral] ` / `[Commodore] ` / `[Premier] ` for leadership ranks; else empty
 * - `{rank_paren}` — ` (Admiral)` etc. when rank is known; else empty
 *
 * Result is trimmed, collapsed whitespace, and truncated to Discord's 32-char limit.
 */
export function buildMemberNickname(
	template: string | null | undefined,
	mode: GuildMode,
	player: NicknamePlayerFields,
): string {
	const tpl = (template?.trim() || defaultNicknameTemplate(mode));
	const rankKey = normalizeAllianceRank(player.rank);
	const rank = rankKey ?? '';
	const rankPrefix = isLeadershipRank(rankKey) ? `[${rankKey}] ` : '';
	const rankParen = rankKey ? ` (${rankKey})` : '';
	const allianceTag = (player.allianceTag ?? '').trim();
	const playerName = (player.name ?? '').trim() || 'Unknown';

	let nick = tpl
		.replaceAll('{player_name}', playerName)
		.replaceAll('{alliance_tag}', allianceTag)
		.replaceAll('{rank_prefix}', rankPrefix)
		.replaceAll('{rank_paren}', rankParen)
		.replaceAll('{rank}', rank);

	nick = nick.replace(/\s+/g, ' ').trim();
	// Drop empty bracket/paren leftovers from missing tag/rank, e.g. "[] Name" or "() Name"
	nick = nick.replace(/\[\s*\]/g, '').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim();

	if (nick.length > DISCORD_NICK_MAX) {
		nick = nick.slice(0, DISCORD_NICK_MAX).trimEnd();
	}
	return nick || playerName.slice(0, DISCORD_NICK_MAX);
}
