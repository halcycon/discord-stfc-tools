import type { GuildConfig } from './types';

/** Personal channels are enabled when category buckets are configured. */
export function personalChannelsEnabled(config: GuildConfig): boolean {
	return Object.keys(config.channel_category_map).length > 0;
}

/** Pick a Discord category ID from the player's first letter. */
export function categoryForPlayerName(config: GuildConfig, playerName: string): string | undefined {
	const letter = playerName.trim().charAt(0).toUpperCase();
	if (!letter) return undefined;

	for (const [range, categoryId] of Object.entries(config.channel_category_map)) {
		const parts = range.toUpperCase().split('-');
		if (parts.length === 2) {
			const [start, end] = parts;
			if (letter >= start && letter <= end) return categoryId;
		} else if (range.toUpperCase() === letter) {
			return categoryId;
		}
	}
	return undefined;
}

/** Slug a player name into a Discord channel name. */
export function slugPersonalChannelName(playerName: string, userId: string): string {
	return (
		playerName
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
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
