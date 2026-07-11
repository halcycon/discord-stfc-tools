import {
	createGuildCategory,
	listGuildChannels,
	patchGuildChannel,
	createGuildTextChannel,
	fetchGuildChannel,
	getGuildChannel,
	isLinkableGuildTextChannel,
	describeChannelType,
	setChannelPermission,
	DiscordApiError,
	type ChannelPermissionOverwrite,
	type DiscordChannel,
} from './discord-api';
import { categoryForPlayerName, personalChannelsEnabled, slugPersonalChannelName } from './channel-utils';
import { buildOverwritesFromTemplate } from './personal-channel-perm-template';
import {
	DEFAULT_CATEGORY_NAME_TEMPLATE,
	DEFAULT_SOFT_LIMIT,
	applyCategoryNameTemplate,
	buildLetterHistogram,
	formatCategoryPlan,
	letterKeyForName,
	planCategoryBuckets,
	sortedCategoryMapEntries,
	type CategoryPlan,
} from './personal-channel-plan';
import type { GuildConfig, VerifiedPlayer } from './types';

const DEFAULT_ARCHIVE_NAME = 'Member Channels Archive';

export type PersonalChannelResult =
	| {
			ok: true;
			channelId: string;
			created: boolean;
			moved: boolean;
			renamed: boolean;
			permissionWarnings?: string[];
	  }
	| { ok: false; error: string };

function formatPermError(targetLabel: string, err: unknown): string {
	if (err instanceof DiscordApiError) {
		const hint =
			err.status === 403
				? ' (bot needs **Manage Channels**; role must be above any role it overwrites; grant **View Channel** on the channel/category first)'
				: '';
		return `${targetLabel}: HTTP ${err.status}${hint}`;
	}
	return `${targetLabel}: ${err instanceof Error ? err.message : 'unknown error'}`;
}

/**
 * Permission overwrites for a private member channel.
 * Uses locked-in template when set; otherwise built-in default.
 * Bot is listed first so it keeps access after @everyone is denied.
 */
export async function buildPersonalChannelOverwrites(
	token: string,
	guildId: string,
	userId: string,
	config: GuildConfig,
): Promise<ChannelPermissionOverwrite[]> {
	return buildOverwritesFromTemplate(token, guildId, userId, config);
}

/**
 * Apply personal-channel permissions. Always grants the bot View/Send first
 * (needed for surveys and other posts). Non-fatal overwrite failures become warnings.
 */
export async function applyPersonalChannelPermissions(
	token: string,
	guildId: string,
	channelId: string,
	userId: string,
	config: GuildConfig,
): Promise<{ warnings: string[] }> {
	const warnings: string[] = [];
	const overwrites = await buildPersonalChannelOverwrites(token, guildId, userId, config);

	for (const ow of overwrites) {
		try {
			await setChannelPermission(token, channelId, ow.id, ow.allow, ow.deny, ow.type);
		} catch (err) {
			let label: string;
			if (ow.id === guildId) label = '@everyone';
			else if (ow.id === userId && ow.type === 1) label = 'member';
			else if (ow.type === 1) label = 'bot';
			else label = `role ${ow.id}`;
			warnings.push(formatPermError(label, err));
		}
	}

	return { warnings };
}

/**
 * Create or update a verified member's personal channel.
 * Skips creation when personal channels are not configured.
 */
export async function ensurePersonalChannel(
	token: string,
	config: GuildConfig,
	guildId: string,
	userId: string,
	playerName: string,
	existingChannelId?: string | null,
): Promise<PersonalChannelResult> {
	if (config.mode !== 'single_alliance' || !personalChannelsEnabled(config)) {
		return { ok: false, error: 'Personal channels are not configured for this server.' };
	}

	const targetCategoryId = categoryForPlayerName(config, playerName);
	const channelName = slugPersonalChannelName(playerName, userId);

	try {
		if (existingChannelId) {
			const existing = await getGuildChannel(token, existingChannelId);
			if (existing && isLinkableGuildTextChannel(existing.type)) {
				let moved = false;
				let renamed = false;

				if (targetCategoryId && existing.parent_id !== targetCategoryId) {
					await patchGuildChannel(token, existingChannelId, { parent_id: targetCategoryId });
					moved = true;
				}
				if (existing.name !== channelName) {
					await patchGuildChannel(token, existingChannelId, { name: channelName });
					renamed = true;
				}

				await applyPersonalChannelPermissions(token, guildId, existingChannelId, userId, config);
				return { ok: true, channelId: existingChannelId, created: false, moved, renamed };
			}
		}

		const overwrites = await buildPersonalChannelOverwrites(token, guildId, userId, config);
		const channel = await createGuildTextChannel(token, guildId, channelName, {
			parentId: targetCategoryId ?? undefined,
			permissionOverwrites: overwrites,
		});
		// Re-apply in case Discord dropped sync/overwrites; soft-fail warnings ignored on create.
		await applyPersonalChannelPermissions(token, guildId, channel.id, userId, config);
		return { ok: true, channelId: channel.id, created: true, moved: false, renamed: false };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'unknown error';
		return { ok: false, error: message };
	}
}

/** Link an existing guild text/announcement channel to a member (optional permission rewrite). */
export async function linkExistingPersonalChannel(
	token: string,
	config: GuildConfig,
	guildId: string,
	userId: string,
	channelId: string,
	opts?: {
		applyPermissions?: boolean;
		/** From interaction resolved.channels — avoids a GET the bot may not be allowed to make. */
		knownChannel?: Pick<DiscordChannel, 'id' | 'name' | 'type' | 'parent_id' | 'guild_id'> | null;
	},
): Promise<PersonalChannelResult> {
	let channel: DiscordChannel | Pick<DiscordChannel, 'id' | 'name' | 'type' | 'parent_id' | 'guild_id'>;

	if (opts?.knownChannel && opts.knownChannel.id === channelId) {
		channel = opts.knownChannel;
	} else {
		const fetched = await fetchGuildChannel(token, channelId);
		if (!fetched.ok) {
			return { ok: false, error: fetched.error };
		}
		channel = fetched.channel;
	}

	if (channel.guild_id && channel.guild_id !== guildId) {
		return { ok: false, error: 'That channel belongs to a different server.' };
	}

	if (!isLinkableGuildTextChannel(channel.type)) {
		return {
			ok: false,
			error:
				`#${channel.name || channelId} is a **${describeChannelType(channel.type)}** channel — ` +
				`link a **text** or **announcement** channel (not a category, voice, forum, or thread).`,
		};
	}

	try {
		let permissionWarnings: string[] | undefined;
		if (opts?.applyPermissions !== false) {
			const { warnings } = await applyPersonalChannelPermissions(
				token,
				guildId,
				channelId,
				userId,
				config,
			);
			permissionWarnings = warnings.length ? warnings : undefined;
		}
		return {
			ok: true,
			channelId,
			created: false,
			moved: false,
			renamed: false,
			permissionWarnings,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : 'unknown error';
		return { ok: false, error: message };
	}
}

function memberCategoryIds(map: Record<string, string>, ...extra: Array<string | null | undefined>): Set<string> {
	const ids = new Set<string>();
	for (const id of Object.values(map)) {
		if (/^\d{15,20}$/.test(id)) ids.add(id);
	}
	for (const id of extra) {
		if (id && /^\d{15,20}$/.test(id)) ids.add(id);
	}
	return ids;
}

function linkedChannelIds(players: VerifiedPlayer[]): Set<string> {
	const ids = new Set<string>();
	for (const p of players) {
		if (p.personal_channel_id) ids.add(p.personal_channel_id);
	}
	return ids;
}

/** Text channels under member categories that are not linked to any verified player. */
export function findUnlinkedMemberChannels(
	channels: DiscordChannel[],
	memberCategoryIdSet: Set<string>,
	linkedIds: Set<string>,
	archiveCategoryId?: string | null,
): DiscordChannel[] {
	return channels.filter((ch) => {
		if (!isLinkableGuildTextChannel(ch.type) || !ch.parent_id) return false;
		if (!memberCategoryIdSet.has(ch.parent_id)) return false;
		if (archiveCategoryId && ch.parent_id === archiveCategoryId) return false;
		if (linkedIds.has(ch.id)) return false;
		return true;
	});
}

export interface ResolveArchiveCategoryOptions {
	/** Existing category snowflake. */
	archiveCategoryId?: string | null;
	/** Find or create by name. */
	archiveName?: string | null;
	/** Prefer existing config when options omit a target. */
	configArchiveCategoryId?: string | null;
	createIfMissing?: boolean;
}

export async function resolveArchiveCategory(
	token: string,
	guildId: string,
	opts: ResolveArchiveCategoryOptions,
): Promise<{ categoryId: string | null; created: boolean; error?: string }> {
	const explicitId = opts.archiveCategoryId?.trim();
	if (explicitId) {
		if (!/^\d{15,20}$/.test(explicitId)) {
			return { categoryId: null, created: false, error: 'Invalid archive category id.' };
		}
		const ch = await getGuildChannel(token, explicitId);
		if (!ch || ch.type !== 4) {
			return { categoryId: null, created: false, error: 'archive_category must be a Discord category.' };
		}
		return { categoryId: ch.id, created: false };
	}

	const name = (opts.archiveName?.trim() || '').slice(0, 100);
	if (name) {
		const channels = await listGuildChannels(token, guildId);
		const existing = channels.find((c) => c.type === 4 && c.name.toLowerCase() === name.toLowerCase());
		if (existing) return { categoryId: existing.id, created: false };
		if (opts.createIfMissing === false) {
			return { categoryId: null, created: false, error: `No category named "${name}".` };
		}
		const created = await createGuildCategory(token, guildId, name);
		return { categoryId: created.id, created: true };
	}

	const fromConfig = opts.configArchiveCategoryId?.trim();
	if (fromConfig && /^\d{15,20}$/.test(fromConfig)) {
		return { categoryId: fromConfig, created: false };
	}

	return { categoryId: null, created: false };
}

export interface PlanPersonalChannelsOptions {
	softLimit?: number;
	players: VerifiedPlayer[];
}

export interface PersonalChannelPlanResult {
	plan: CategoryPlan;
	namesUsed: number;
	currentMap: Record<string, string>;
	currentOccupancy: Array<{ range: string; categoryId: string; discordChildren: number }>;
	unlinkedInMemberCategories: number;
	missingChannels: number;
	summary: string;
}

/** Build a dry-run plan from verified players (and optional Discord occupancy). */
export async function planPersonalChannels(
	token: string | null,
	guildId: string,
	config: GuildConfig,
	opts: PlanPersonalChannelsOptions,
): Promise<PersonalChannelPlanResult> {
	const softLimit = opts.softLimit ?? DEFAULT_SOFT_LIMIT;
	const names: string[] = [];
	for (const p of opts.players) {
		const name = p.player_name?.trim();
		if (name) names.push(name);
	}

	const plan = planCategoryBuckets(buildLetterHistogram(names), softLimit);
	const missingChannels = opts.players.filter(
		(p) =>
			p.player_name?.trim() &&
			!p.personal_channel_id &&
			(p.verification_status === 'active' || p.verification_status === 'verified'),
	).length;

	const currentOccupancy: PersonalChannelPlanResult['currentOccupancy'] = [];
	let unlinkedInMemberCategories = 0;

	if (token) {
		const channels = await listGuildChannels(token, guildId);
		const childCount = new Map<string, number>();
		for (const ch of channels) {
			if (!isLinkableGuildTextChannel(ch.type) || !ch.parent_id) continue;
			childCount.set(ch.parent_id, (childCount.get(ch.parent_id) ?? 0) + 1);
		}
		for (const entry of sortedCategoryMapEntries(config.channel_category_map)) {
			currentOccupancy.push({
				range: entry.range,
				categoryId: entry.categoryId,
				discordChildren: childCount.get(entry.categoryId) ?? 0,
			});
		}

		const cats = memberCategoryIds(config.channel_category_map);
		unlinkedInMemberCategories = findUnlinkedMemberChannels(
			channels,
			cats,
			linkedChannelIds(opts.players),
			config.personal_channel_archive_category_id,
		).length;
	}

	let summary = formatCategoryPlan(plan);
	if (currentOccupancy.length > 0) {
		const occLines = currentOccupancy.map((o) => {
			const mark = o.discordChildren >= softLimit ? ' ⚠' : '';
			return `• \`${o.range}\` → <#${o.categoryId}> — ${o.discordChildren}/${softLimit}${mark}`;
		});
		summary += `\n\n**Current map occupancy**\n${occLines.join('\n')}`;
	} else if (Object.keys(config.channel_category_map).length === 0) {
		summary += '\n\nNo category map set yet — rebalance will create categories.';
	}

	summary += `\n\nBased on ${names.length} verified player name${names.length === 1 ? '' : 's'}.`;
	if (missingChannels > 0) {
		summary += `\n• Missing personal channels: ${missingChannels} (use \`create_missing:true\` on rebalance)`;
	}
	if (unlinkedInMemberCategories > 0) {
		summary += `\n• Unlinked channels in member categories: ${unlinkedInMemberCategories} (moved to archive on rebalance; default \`archive_unlinked:true\`)`;
	}
	if (config.personal_channel_archive_category_id) {
		summary += `\n• Archive category: <#${config.personal_channel_archive_category_id}>`;
	}

	return {
		plan,
		namesUsed: names.length,
		currentMap: config.channel_category_map,
		currentOccupancy,
		unlinkedInMemberCategories,
		missingChannels,
		summary: summary.slice(0, 1900),
	};
}

export interface RebalancePersonalChannelsOptions {
	softLimit?: number;
	nameTemplate?: string;
	renameCategories?: boolean;
	createCategories?: boolean;
	/** Create personal channels for active/verified players without one. */
	createMissing?: boolean;
	/** Move unlinked channels under member categories into the archive category. */
	archiveUnlinked?: boolean;
	archiveCategoryId?: string | null;
	archiveName?: string | null;
	players: VerifiedPlayer[];
	moveDelayMs?: number;
	/** Called when a missing channel is created so the caller can persist personal_channel_id. */
	onChannelCreated?: (player: VerifiedPlayer, channelId: string) => Promise<void>;
}

export interface RebalancePersonalChannelsResult {
	ok: boolean;
	plan: CategoryPlan;
	newMap: Record<string, string>;
	archiveCategoryId: string | null;
	categoriesCreated: number;
	categoriesRenamed: number;
	channelsMoved: number;
	channelsCreated: number;
	channelsArchived: number;
	channelsFailed: number;
	errors: string[];
	summary: string;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * Apply a category plan: create/rename categories, update map, move personal channels,
 * optionally create missing channels and archive unlinked ones.
 */
export async function rebalancePersonalChannels(
	token: string,
	guildId: string,
	config: GuildConfig,
	opts: RebalancePersonalChannelsOptions,
): Promise<RebalancePersonalChannelsResult> {
	const softLimit = opts.softLimit ?? DEFAULT_SOFT_LIMIT;
	const nameTemplate = opts.nameTemplate?.trim() || DEFAULT_CATEGORY_NAME_TEMPLATE;
	const renameCategories = opts.renameCategories !== false;
	const createCategories = opts.createCategories !== false;
	const createMissing = opts.createMissing === true;
	const archiveUnlinked = opts.archiveUnlinked !== false;
	const moveDelayMs = opts.moveDelayMs ?? 350;

	const names: string[] = [];
	for (const p of opts.players) {
		if (p.player_name?.trim()) names.push(p.player_name.trim());
	}
	const plan = planCategoryBuckets(buildLetterHistogram(names), softLimit);

	const existing = sortedCategoryMapEntries(config.channel_category_map);
	const newMap: Record<string, string> = {};
	const errors: string[] = [];
	let categoriesCreated = 0;
	let categoriesRenamed = 0;
	let archiveCategoryId: string | null = null;

	if (archiveUnlinked || opts.archiveCategoryId || opts.archiveName) {
		try {
			const wantDefault =
				archiveUnlinked && !opts.archiveCategoryId && !opts.archiveName && !config.personal_channel_archive_category_id;
			const resolved = await resolveArchiveCategory(token, guildId, {
				archiveCategoryId: opts.archiveCategoryId,
				archiveName: opts.archiveName || (wantDefault ? DEFAULT_ARCHIVE_NAME : null),
				configArchiveCategoryId: config.personal_channel_archive_category_id,
				createIfMissing: true,
			});
			if (resolved.error && archiveUnlinked) {
				errors.push(resolved.error);
			} else {
				archiveCategoryId = resolved.categoryId;
				if (resolved.created) categoriesCreated++;
			}
		} catch (error) {
			errors.push(
				`Archive category failed: ${error instanceof Error ? error.message : 'unknown'}`,
			);
		}
	} else {
		archiveCategoryId = config.personal_channel_archive_category_id;
	}

	for (let i = 0; i < plan.buckets.length; i++) {
		const bucket = plan.buckets[i];
		const desiredName = applyCategoryNameTemplate(nameTemplate, bucket.range);
		let categoryId = existing[i]?.categoryId;

		if (!categoryId) {
			if (!createCategories) {
				errors.push(`Missing category for \`${bucket.range}\` and create_categories is false.`);
				continue;
			}
			try {
				const created = await createGuildCategory(token, guildId, desiredName);
				categoryId = created.id;
				categoriesCreated++;
			} catch (error) {
				errors.push(
					`Failed to create category ${desiredName}: ${error instanceof Error ? error.message : 'unknown'}`,
				);
				continue;
			}
		} else if (renameCategories) {
			try {
				const ch = await getGuildChannel(token, categoryId);
				if (ch && ch.name !== desiredName) {
					await patchGuildChannel(token, categoryId, { name: desiredName });
					categoriesRenamed++;
				}
			} catch (error) {
				errors.push(
					`Failed to rename category ${categoryId}: ${error instanceof Error ? error.message : 'unknown'}`,
				);
			}
		}

		if (categoryId) newMap[bucket.range] = categoryId;
	}

	const configWithMap: GuildConfig = {
		...config,
		channel_category_map: newMap,
		personal_channel_archive_category_id: archiveCategoryId,
	};
	let channelsMoved = 0;
	let channelsCreated = 0;
	let channelsArchived = 0;
	let channelsFailed = 0;

	// Move (and optionally create) linked/missing personal channels.
	for (const player of opts.players) {
		if (!player.player_name?.trim()) continue;

		if (!player.personal_channel_id) {
			if (!createMissing) continue;
			if (player.verification_status !== 'active' && player.verification_status !== 'verified') continue;
			const result = await ensurePersonalChannel(
				token,
				configWithMap,
				guildId,
				player.discord_user_id,
				player.player_name,
				null,
			);
			if (!result.ok) {
				channelsFailed++;
				errors.push(`Create failed for ${player.player_name}: ${result.error}`);
				continue;
			}
			channelsCreated++;
			player.personal_channel_id = result.channelId;
			if (opts.onChannelCreated) {
				await opts.onChannelCreated(player, result.channelId);
			}
			if (moveDelayMs > 0) await sleep(moveDelayMs);
			continue;
		}

		const targetCategoryId = categoryForPlayerName(configWithMap, player.player_name);
		if (!targetCategoryId) {
			channelsFailed++;
			errors.push(`No category for ${player.player_name} (${letterKeyForName(player.player_name)})`);
			continue;
		}
		try {
			const existingCh = await getGuildChannel(token, player.personal_channel_id);
			if (!existingCh || !isLinkableGuildTextChannel(existingCh.type)) {
				channelsFailed++;
				errors.push(`Channel missing for ${player.player_name}`);
				continue;
			}
			if (existingCh.parent_id !== targetCategoryId) {
				await patchGuildChannel(token, player.personal_channel_id, { parent_id: targetCategoryId });
				channelsMoved++;
				if (moveDelayMs > 0) await sleep(moveDelayMs);
			}
		} catch (error) {
			channelsFailed++;
			errors.push(
				`Move failed for ${player.player_name}: ${error instanceof Error ? error.message : 'unknown'}`,
			);
		}
	}

	if (archiveUnlinked) {
		if (!archiveCategoryId) {
			errors.push('Archive requested but no archive category is available.');
		} else {
			try {
				const channels = await listGuildChannels(token, guildId);
				const cats = memberCategoryIds(config.channel_category_map, ...Object.values(newMap));
				// Do not treat archive itself as a member category.
				cats.delete(archiveCategoryId);
				const unlinked = findUnlinkedMemberChannels(
					channels,
					cats,
					linkedChannelIds(opts.players),
					archiveCategoryId,
				);
				for (const ch of unlinked) {
					if (ch.parent_id === archiveCategoryId) continue;
					try {
						await patchGuildChannel(token, ch.id, { parent_id: archiveCategoryId });
						channelsArchived++;
						if (moveDelayMs > 0) await sleep(moveDelayMs);
					} catch (error) {
						channelsFailed++;
						errors.push(
							`Archive failed for #${ch.name}: ${error instanceof Error ? error.message : 'unknown'}`,
						);
					}
				}
			} catch (error) {
				errors.push(
					`Archive scan failed: ${error instanceof Error ? error.message : 'unknown'}`,
				);
			}
		}
	}

	const orphaned = existing.slice(plan.buckets.length);
	const orphanNote =
		orphaned.length > 0
			? `\n• Unused old categories (not deleted): ${orphaned.map((o) => `<#${o.categoryId}>`).join(', ')}`
			: '';

	const mapComplete = Object.keys(newMap).length === plan.buckets.length;
	const summary = (
		`${formatCategoryPlan(plan, { title: mapComplete ? 'Rebalance complete' : 'Rebalance partial' })}\n\n` +
		`• Categories created: ${categoriesCreated}\n` +
		`• Categories renamed: ${categoriesRenamed}\n` +
		`• Channels moved: ${channelsMoved}\n` +
		`• Channels created: ${channelsCreated}\n` +
		`• Channels archived: ${channelsArchived}\n` +
		`• Channels failed: ${channelsFailed}\n` +
		`• Archive: ${archiveCategoryId ? `<#${archiveCategoryId}>` : 'none'}\n` +
		`• New map: ${Object.entries(newMap)
			.map(([r, id]) => `${r}→${id}`)
			.join(', ') || 'none'}` +
		orphanNote +
		(errors.length ? `\n\n⚠ Errors (${errors.length}):\n${errors.slice(0, 8).join('\n')}` : '')
	).slice(0, 1900);

	return {
		ok: mapComplete && channelsFailed === 0,
		plan,
		newMap,
		archiveCategoryId,
		categoriesCreated,
		categoriesRenamed,
		channelsMoved,
		channelsCreated,
		channelsArchived,
		channelsFailed,
		errors,
		summary,
	};
}
