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
	deleteChannelPermission,
	DiscordApiError,
	type ChannelPermissionOverwrite,
	type DiscordChannel,
} from './discord-api';
import { categoryForPlayerName, personalChannelsEnabled, slugPersonalChannelName } from './channel-utils';
import { buildOverwritesFromTemplate } from './personal-channel-perm-template';
import {
	sortCategoryChannelsAlphabetically,
	sortMemberCategoryMapsAlphabetically,
} from './channel-sort';
import {
	DEFAULT_CATEGORY_NAME_TEMPLATE,
	DEFAULT_SOFT_LIMIT,
	applyCategoryNameTemplate,
	buildLetterHistogram,
	categoryNameTemplatePrefix,
	formatCategoryPlan,
	letterKeyForName,
	planCategoryBuckets,
	sortedCategoryMapEntries,
	type CategoryPlan,
} from './personal-channel-plan';
import type { GuildConfig, VerifiedPlayer } from './types';

export {
	compareChannelNamesAlpha,
	sortCategoryChannelsAlphabetically,
	sortMemberCategoryMapsAlphabetically,
} from './channel-sort';

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
 * Apply personal-channel permissions. Always grants the bot role first
 * (needed for surveys, moves, and overwrite edits). Non-fatal overwrite failures become warnings.
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
	const botRoleOw = overwrites.find((o) => o.type === 0 && o.id !== guildId);

	// Clear a stale bot *member* overwrite (same snowflake) so Discord shows the bot under Roles.
	if (botRoleOw) {
		try {
			await deleteChannelPermission(token, channelId, botRoleOw.id);
		} catch {
			/* non-fatal — PUT below may still succeed */
		}
	}

	for (const ow of overwrites) {
		try {
			await setChannelPermission(token, channelId, ow.id, ow.allow, ow.deny, ow.type);
		} catch (err) {
			let label: string;
			if (ow.id === guildId) label = '@everyone';
			else if (ow.id === userId && ow.type === 1) label = 'member';
			else if (ow.type === 0 && botRoleOw && ow.id === botRoleOw.id) label = 'bot role';
			else if (ow.type === 1) label = 'user';
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
				if ((moved || renamed) && targetCategoryId) {
					try {
						await sortCategoryChannelsAlphabetically(token, guildId, targetCategoryId);
					} catch {
						/* non-fatal */
					}
				}
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
		if (targetCategoryId) {
			try {
				await sortCategoryChannelsAlphabetically(token, guildId, targetCategoryId);
			} catch {
				/* non-fatal */
			}
		}
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
	playerName: string,
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
		let moved = false;
		let renamed = false;
		const name = playerName.trim();
		if (name) {
			const desiredName = slugPersonalChannelName(name, userId);
			const targetCategoryId = categoryForPlayerName(config, name);

			if (targetCategoryId && channel.parent_id !== targetCategoryId) {
				await patchGuildChannel(token, channelId, { parent_id: targetCategoryId });
				moved = true;
			}
			if (channel.name !== desiredName) {
				await patchGuildChannel(token, channelId, { name: desiredName });
				renamed = true;
			}
			if ((moved || renamed) && targetCategoryId) {
				try {
					await sortCategoryChannelsAlphabetically(token, guildId, targetCategoryId);
				} catch {
					/* non-fatal */
				}
			}
		}

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
			moved,
			renamed,
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
	/** After categories/map are ready (before channel moves) — persist map early. */
	onCategoriesReady?: (
		newMap: Record<string, string>,
		archiveCategoryId: string | null,
	) => Promise<void>;
	/** Periodic status for Discord “thinking” follow-ups. */
	onProgress?: (message: string) => Promise<void>;
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
	const moveDelayMs = opts.moveDelayMs ?? 250;

	const report = async (message: string) => {
		if (!opts.onProgress) return;
		try {
			await opts.onProgress(message);
		} catch {
			/* non-fatal */
		}
	};

	const names: string[] = [];
	for (const p of opts.players) {
		if (p.player_name?.trim()) names.push(p.player_name.trim());
	}
	const plan = planCategoryBuckets(buildLetterHistogram(names), softLimit);

	await report(
		`⏳ Rebalance: preparing **${plan.buckets.length}** categor${plan.buckets.length === 1 ? 'y' : 'ies'} for **${names.length}** player(s)…`,
	);

	const existing = sortedCategoryMapEntries(config.channel_category_map);
	const previousMapCategoryIds = [
		...new Set(existing.map((e) => e.categoryId).filter((id) => /^\d{15,20}$/.test(id))),
	];
	const newMap: Record<string, string> = {};
	const errors: string[] = [];
	let categoriesCreated = 0;
	let categoriesRenamed = 0;
	let categoriesReusedByName = 0;
	let archiveCategoryId: string | null = null;

	// List once up front — reuse by map id / exact name, and archive across old+new categories.
	let channelById = new Map<string, DiscordChannel>();
	try {
		const listed = await listGuildChannels(token, guildId);
		channelById = new Map(listed.map((ch) => [ch.id, ch]));
	} catch (error) {
		errors.push(
			`Could not list guild channels: ${error instanceof Error ? error.message : 'unknown'}`,
		);
	}

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
				if (archiveCategoryId && resolved.created) {
					channelById.set(archiveCategoryId, {
						id: archiveCategoryId,
						name: opts.archiveName?.trim() || DEFAULT_ARCHIVE_NAME,
						type: 4,
						guild_id: guildId,
					});
				}
			}
		} catch (error) {
			errors.push(
				`Archive category failed: ${error instanceof Error ? error.message : 'unknown'}`,
			);
		}
	} else {
		archiveCategoryId = config.personal_channel_archive_category_id;
	}

	const guildCategories = [...channelById.values()].filter((ch) => ch.type === 4);
	const assignedCategoryIds = new Set<string>();
	if (archiveCategoryId) assignedCategoryIds.add(archiveCategoryId);

	for (let i = 0; i < plan.buckets.length; i++) {
		const bucket = plan.buckets[i];
		const desiredName = applyCategoryNameTemplate(nameTemplate, bucket.range);
		let categoryId: string | undefined = existing[i]?.categoryId;
		let reusedByName = false;

		// Drop stale map ids that no longer exist in the guild.
		if (categoryId && !channelById.has(categoryId)) {
			categoryId = undefined;
		}
		if (categoryId && assignedCategoryIds.has(categoryId)) {
			categoryId = undefined;
		}

		// After a crashed run the map may be empty but categories already exist — adopt by name.
		if (!categoryId) {
			const byName = guildCategories.find(
				(ch) => ch.name === desiredName && !assignedCategoryIds.has(ch.id),
			);
			if (byName) {
				categoryId = byName.id;
				reusedByName = true;
			}
		}

		if (!categoryId) {
			if (!createCategories) {
				errors.push(`Missing category for \`${bucket.range}\` and create_categories is false.`);
				continue;
			}
			try {
				const created = await createGuildCategory(token, guildId, desiredName);
				categoryId = created.id;
				categoriesCreated++;
				channelById.set(created.id, {
					id: created.id,
					name: desiredName,
					type: 4,
					guild_id: guildId,
				});
			} catch (error) {
				errors.push(
					`Failed to create category ${desiredName}: ${error instanceof Error ? error.message : 'unknown'}`,
				);
				continue;
			}
		} else if (renameCategories) {
			try {
				const ch = channelById.get(categoryId) ?? (await getGuildChannel(token, categoryId));
				if (ch && ch.name !== desiredName) {
					await patchGuildChannel(token, categoryId, { name: desiredName });
					categoriesRenamed++;
					channelById.set(categoryId, { ...ch, name: desiredName });
				}
			} catch (error) {
				errors.push(
					`Failed to rename category ${categoryId}: ${error instanceof Error ? error.message : 'unknown'}`,
				);
			}
		}

		if (categoryId) {
			if (reusedByName) categoriesReusedByName++;
			assignedCategoryIds.add(categoryId);
			newMap[bucket.range] = categoryId;
		}
	}

	const configWithMap: GuildConfig = {
		...config,
		channel_category_map: newMap,
		personal_channel_archive_category_id: archiveCategoryId,
	};

	if (opts.onCategoriesReady) {
		try {
			await opts.onCategoriesReady(newMap, archiveCategoryId);
		} catch (error) {
			errors.push(
				`Failed to persist category map early: ${error instanceof Error ? error.message : 'unknown'}`,
			);
		}
	}

	let channelsMoved = 0;
	let channelsCreated = 0;
	let channelsArchived = 0;
	let channelsFailed = 0;
	let channelsRenamed = 0;

	const linkedWithNames = opts.players.filter((p) => p.player_name?.trim());
	let processed = 0;

	await report(
		`⏳ Rebalance: categories ready (` +
			`${categoriesCreated} created, ${categoriesRenamed} renamed, ${categoriesReusedByName} reused by name). ` +
			`Moving/creating channels (0/${linkedWithNames.length})…`,
	);

	// Move (and optionally create) linked/missing personal channels.
	for (const player of linkedWithNames) {
		processed++;
		if (processed === 1 || processed % 10 === 0 || processed === linkedWithNames.length) {
			await report(
				`⏳ Rebalance: channels ${processed}/${linkedWithNames.length}` +
					` (moved ${channelsMoved}, renamed ${channelsRenamed}, created ${channelsCreated}, failed ${channelsFailed})…`,
			);
		}

		if (!player.personal_channel_id) {
			if (!createMissing) continue;
			if (player.verification_status !== 'active' && player.verification_status !== 'verified') continue;
			const result = await ensurePersonalChannel(
				token,
				configWithMap,
				guildId,
				player.discord_user_id,
				player.player_name!,
				null,
			);
			if (!result.ok) {
				channelsFailed++;
				errors.push(`Create failed for ${player.player_name}: ${result.error}`);
				continue;
			}
			channelsCreated++;
			player.personal_channel_id = result.channelId;
			channelById.set(result.channelId, {
				id: result.channelId,
				name: slugPersonalChannelName(player.player_name!, player.discord_user_id),
				type: 0,
				parent_id: categoryForPlayerName(configWithMap, player.player_name!) ?? null,
				guild_id: guildId,
			});
			if (opts.onChannelCreated) {
				await opts.onChannelCreated(player, result.channelId);
			}
			if (moveDelayMs > 0) await sleep(moveDelayMs);
			continue;
		}

		const targetCategoryId = categoryForPlayerName(configWithMap, player.player_name!);
		if (!targetCategoryId) {
			channelsFailed++;
			errors.push(`No category for ${player.player_name} (${letterKeyForName(player.player_name!)})`);
			continue;
		}
		try {
			let existingCh = channelById.get(player.personal_channel_id) ?? null;
			if (!existingCh) {
				existingCh = await getGuildChannel(token, player.personal_channel_id);
			}
			if (!existingCh || !isLinkableGuildTextChannel(existingCh.type)) {
				channelsFailed++;
				errors.push(`Channel missing for ${player.player_name}`);
				continue;
			}
			const desiredName = slugPersonalChannelName(player.player_name!, player.discord_user_id);
			const updates: { name?: string; parent_id?: string } = {};
			if (existingCh.parent_id !== targetCategoryId) {
				updates.parent_id = targetCategoryId;
			}
			if (existingCh.name !== desiredName) {
				updates.name = desiredName;
			}
			if (updates.parent_id || updates.name) {
				await patchGuildChannel(token, player.personal_channel_id, updates);
				if (updates.parent_id) channelsMoved++;
				if (updates.name) channelsRenamed++;
				channelById.set(player.personal_channel_id, {
					...existingCh,
					name: updates.name ?? existingCh.name,
					parent_id: updates.parent_id ?? existingCh.parent_id,
				});
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
				await report(`⏳ Rebalance: archiving unlinked channels → <#${archiveCategoryId}>…`);
				// Refresh list so parent_ids reflect moves we just made.
				try {
					const listed = await listGuildChannels(token, guildId);
					channelById = new Map(listed.map((ch) => [ch.id, ch]));
				} catch {
					/* keep cached list */
				}
				const channels = [...channelById.values()];
				const namePrefix = categoryNameTemplatePrefix(nameTemplate);
				const leftoverByName = channels
					.filter(
						(ch) =>
							ch.type === 4 &&
							ch.id !== archiveCategoryId &&
							!Object.values(newMap).includes(ch.id) &&
							(ch.name?.startsWith(namePrefix) || previousMapCategoryIds.includes(ch.id)),
					)
					.map((ch) => ch.id);

				const cats = memberCategoryIds(
					config.channel_category_map,
					...Object.values(newMap),
					...previousMapCategoryIds,
					...leftoverByName,
				);
				cats.delete(archiveCategoryId);
				const unlinked = findUnlinkedMemberChannels(
					channels,
					cats,
					linkedChannelIds(opts.players),
					archiveCategoryId,
				);
				let archivedProgress = 0;
				for (const ch of unlinked) {
					if (ch.parent_id === archiveCategoryId) continue;
					try {
						await patchGuildChannel(token, ch.id, { parent_id: archiveCategoryId });
						channelsArchived++;
						archivedProgress++;
						if (archivedProgress === 1 || archivedProgress % 10 === 0) {
							await report(
								`⏳ Rebalance: archived ${channelsArchived}/${unlinked.length} unlinked channel(s)…`,
							);
						}
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

	await report(`⏳ Rebalance: sorting channels alphabetically within categories…`);
	let categoriesAlphaSorted = 0;
	try {
		const listed = await listGuildChannels(token, guildId);
		channelById = new Map(listed.map((ch) => [ch.id, ch]));
		const sortResult = await sortMemberCategoryMapsAlphabetically(
			token,
			guildId,
			newMap,
			[...channelById.values()],
		);
		categoriesAlphaSorted = sortResult.categoriesSorted;
	} catch (error) {
		errors.push(
			`Alphabetical sort failed: ${error instanceof Error ? error.message : 'unknown'}`,
		);
	}

	const orphanedMapped = existing.slice(plan.buckets.length);
	const activeIds = new Set(Object.values(newMap));
	if (archiveCategoryId) activeIds.add(archiveCategoryId);
	const orphanedLeftover = [...channelById.values()].filter(
		(ch) =>
			ch.type === 4 &&
			!activeIds.has(ch.id) &&
			(ch.name?.startsWith(categoryNameTemplatePrefix(nameTemplate)) ||
				previousMapCategoryIds.includes(ch.id)),
	);
	const orphanNoteParts: string[] = [];
	if (orphanedMapped.length > 0) {
		orphanNoteParts.push(
			`Unused prior map slots: ${orphanedMapped.map((o) => `<#${o.categoryId}>`).join(', ')}`,
		);
	}
	if (orphanedLeftover.length > 0) {
		orphanNoteParts.push(
			`Leftover member categories (not deleted): ${orphanedLeftover.map((c) => `<#${c.id}>`).join(', ')}`,
		);
	}
	const orphanNote =
		orphanNoteParts.length > 0 ? `\n• ${orphanNoteParts.join('\n• ')}` : '';

	const mapComplete = Object.keys(newMap).length === plan.buckets.length;
	const summary = (
		`${formatCategoryPlan(plan, { title: mapComplete ? 'Rebalance complete' : 'Rebalance partial' })}\n\n` +
		`• Categories created: ${categoriesCreated}\n` +
		`• Categories renamed: ${categoriesRenamed}\n` +
		`• Categories reused by name: ${categoriesReusedByName}\n` +
		`• Channels moved: ${channelsMoved}\n` +
		`• Channels renamed: ${channelsRenamed}\n` +
		`• Channels created: ${channelsCreated}\n` +
		`• Channels archived: ${channelsArchived}\n` +
		`• Channels failed: ${channelsFailed}\n` +
		`• Categories A–Z sorted: ${categoriesAlphaSorted}\n` +
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
