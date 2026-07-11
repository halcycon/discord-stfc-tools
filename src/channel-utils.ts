import type { GuildConfig } from './types';
import { latinizePlayerName } from './name-latinize';
import {
	letterInRange,
	letterKeyForName,
	parseLetterRange,
	type LetterKey,
} from './personal-channel-plan';

/** Personal channels are enabled when category buckets are configured. */
export function personalChannelsEnabled(config: GuildConfig): boolean {
	return Object.keys(config.channel_category_map).length > 0;
}

/** Pick a Discord category ID from the player's first letter (A–Z, else `#`). */
export function categoryForPlayerName(config: GuildConfig, playerName: string): string | undefined {
	if (!playerName.trim()) return undefined;
	const letter: LetterKey = letterKeyForName(playerName);

	for (const [range, categoryId] of Object.entries(config.channel_category_map)) {
		const parsed = parseLetterRange(range);
		if (!parsed) continue;
		if (letterInRange(letter, parsed.start, parsed.end)) return categoryId;
	}
	return undefined;
}

/** Slug a player name into a Discord channel name (Latin lookalikes folded first). */
export function slugPersonalChannelName(playerName: string, userId: string): string {
	return (
		latinizePlayerName(playerName)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/-{2,}/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 90) || `member-${userId}`
	);
}

/**
 * Parse admin input like `A-F=123456789,G-M=987654321` or `A-F:123`.
 * Returns range → category snowflake map.
 */
export function parseCategoryMapInput(input: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const part of input.split(',')) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const match = trimmed.match(/^([^=:]+)[=:](\d{15,20})$/);
		if (!match) continue;
		const range = match[1].trim().toUpperCase();
		if (range) out[range] = match[2];
	}
	return out;
}

export function formatCategoryMap(map: Record<string, string>): string {
	const entries = Object.entries(map);
	if (entries.length === 0) return 'none';
	return entries.map(([range, id]) => `${range}→${id}`).join(', ');
}
