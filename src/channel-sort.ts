import {
	listGuildChannels,
	modifyGuildChannelPositions,
	isLinkableGuildTextChannel,
	type DiscordChannel,
} from './discord-api';

/** Stable A–Z order for Discord channel names within a category. */
export function compareChannelNamesAlpha(a: string, b: string): number {
	return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

/**
 * Reorder text/announcement channels under a category alphabetically by name.
 */
export async function sortCategoryChannelsAlphabetically(
	token: string,
	guildId: string,
	categoryId: string,
	allChannels?: DiscordChannel[],
): Promise<{ sorted: number; changed: boolean }> {
	const channels = allChannels ?? (await listGuildChannels(token, guildId));
	const category = channels.find((ch) => ch.id === categoryId && ch.type === 4);
	const children = channels
		.filter((ch) => ch.parent_id === categoryId && isLinkableGuildTextChannel(ch.type))
		.sort((a, b) => compareChannelNamesAlpha(a.name, b.name));

	if (children.length <= 1) return { sorted: children.length, changed: false };

	const byPosition = [...children].sort(
		(a, b) =>
			(a.position ?? 0) - (b.position ?? 0) || compareChannelNamesAlpha(a.name, b.name),
	);
	const alreadySorted = byPosition.every((ch, i) => ch.id === children[i].id);
	if (alreadySorted) return { sorted: children.length, changed: false };

	const startPos = (category?.position ?? 0) + 1;
	await modifyGuildChannelPositions(
		token,
		guildId,
		children.map((ch, i) => ({
			id: ch.id,
			position: startPos + i,
			parent_id: categoryId,
		})),
	);
	return { sorted: children.length, changed: true };
}

/** Sort every unique category id in a map (personal letter buckets or similar). */
export async function sortCategoryIdMapAlphabetically(
	token: string,
	guildId: string,
	categoryIds: Iterable<string>,
	allChannels?: DiscordChannel[],
): Promise<{ categoriesSorted: number; channelsTouched: number }> {
	const channels = allChannels ?? (await listGuildChannels(token, guildId));
	let categoriesSorted = 0;
	let channelsTouched = 0;
	const seen = new Set<string>();
	for (const categoryId of categoryIds) {
		if (!/^\d{15,20}$/.test(categoryId) || seen.has(categoryId)) continue;
		seen.add(categoryId);
		try {
			const result = await sortCategoryChannelsAlphabetically(
				token,
				guildId,
				categoryId,
				channels,
			);
			if (result.changed) {
				categoriesSorted++;
				channelsTouched += result.sorted;
			}
		} catch {
			/* non-fatal — Manage Channels required */
		}
	}
	return { categoriesSorted, channelsTouched };
}

export async function sortMemberCategoryMapsAlphabetically(
	token: string,
	guildId: string,
	categoryMap: Record<string, string>,
	allChannels?: DiscordChannel[],
): Promise<{ categoriesSorted: number; channelsTouched: number }> {
	return sortCategoryIdMapAlphabetically(
		token,
		guildId,
		Object.values(categoryMap),
		allChannels,
	);
}
