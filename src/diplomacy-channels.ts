import {
	createGuildCategory,
	createGuildTextChannel,
	fetchGuildChannel,
	getBotUserId,
	getGuildChannel,
	isLinkableGuildTextChannel,
	describeChannelType,
	listGuildChannels,
	patchGuildChannel,
	setChannelPermission,
	type ChannelPermissionOverwrite,
	type DiscordChannel,
} from './discord-api';
import { categoryForAllianceTag, categoryForLetterName } from './channel-utils';
import { latinizePlayerName } from './name-latinize';
import { sortCategoryChannelsAlphabetically, sortCategoryIdMapAlphabetically } from './channel-sort';
import {
	DEFAULT_SOFT_LIMIT,
	applyCategoryNameTemplate,
	buildLetterHistogram,
	categoryNameTemplatePrefix,
	formatCategoryPlan,
	planCategoryBuckets,
	sortedCategoryMapEntries,
} from './personal-channel-plan';
import {
	findUnlinkedMemberChannels,
	resolveArchiveCategory,
} from './personal-channels';
import { formatLocaleFlagSuffix } from './i18n/locales';
import { normalizeAllianceRank, type AllianceRankKey } from './nickname-utils';
import type { GuildConfig } from './types';

const DEFAULT_DIPLOMACY_CATEGORY_NAME_TEMPLATE = 'Diplomacy Channels {range}';
const DEFAULT_DIPLOMACY_ARCHIVE_NAME = 'Diplomacy Channels Archive';
export const DEFAULT_DIPLOMACY_ARCHIVE_CATEGORY_NAME_TEMPLATE = 'Diplomacy Archive {range}';
export const DEFAULT_DIPLOMACY_SPECIAL_NAME = 'non-listed-alliances';
export const DEFAULT_DIPLOMACY_SPECIAL_CATEGORY_NAME = 'Diplomacy Channels (Special)';
/** Discord channel names max 100; keep slug headroom for `┃` + flags. */
const DIPLOMACY_NAME_MAX = 100;
const DIPLOMACY_LANG_SEPARATOR = '┃';

export type DiplomacySpecialPlacement = 'special_category' | 'top_of_first';

export function normalizeDiplomacySpecialPlacement(
	raw: string | null | undefined,
): DiplomacySpecialPlacement {
	return raw === 'top_of_first' ? 'top_of_first' : 'special_category';
}

const VIEW = 0x400;
const SEND = 0x800;
const EMBED = 0x4000;
const ATTACH = 0x8000;
const READ = 0x10000;

const PERM_VIEW = String(VIEW | READ);
const PERM_WRITE = String(VIEW | SEND | EMBED | ATTACH | READ);
const PERM_DENY_SEND = String(SEND | ATTACH);
const PERM_DENY_VIEW = String(VIEW);

export type DiplomacyChannelResult =
	| {
			ok: true;
			channelId: string;
			created: boolean;
			moved: boolean;
			renamed: boolean;
			tag: string;
	  }
	| { ok: false; error: string };

export function diplomacyChannelsEnabled(config: GuildConfig): boolean {
	return Boolean(config.diplomacy_enabled);
}

export function normalizeAllianceTag(tag: string): string {
	return tag.trim().toUpperCase();
}

/**
 * Slug a diplomacy channel name from template + alliance tag.
 * Latinizes lookalikes (Ł→L, β→B, …) before Discord-safe sanitizing — same fold as personal channels.
 */
export function slugDiplomacyChannelName(tag: string, template?: string | null): string {
	const foldedTag = latinizePlayerName(tag.trim());
	const raw = (template?.trim() || 'diplomacy-{tag}').replaceAll('{tag}', foldedTag);
	return (
		latinizePlayerName(raw)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/-{2,}/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 90) ||
		`diplomacy-${foldedTag
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')}`
	);
}

/** Preferred locales for a tag (uppercased key). */
export function preferredLocalesForTag(
	config: Pick<GuildConfig, 'diplomacy_preferred_locales'>,
	allianceTag: string,
): string[] {
	const tag = normalizeAllianceTag(allianceTag);
	if (!tag) return [];
	const locales = config.diplomacy_preferred_locales?.[tag];
	return Array.isArray(locales) ? locales : [];
}

/**
 * Full Discord channel name: a-z0-9 slug, optionally `┃` + country flags for preferred languages.
 * Example: `abcd-diplomacy┃🇬🇧🇫🇷`
 */
export function formatDiplomacyChannelName(
	tag: string,
	template?: string | null,
	locales?: readonly string[] | null,
): string {
	const base = slugDiplomacyChannelName(tag, template);
	const flags = formatLocaleFlagSuffix(locales ?? []);
	if (!flags) return base.slice(0, DIPLOMACY_NAME_MAX);
	const suffix = `${DIPLOMACY_LANG_SEPARATOR}${flags}`;
	const maxBase = Math.max(1, DIPLOMACY_NAME_MAX - suffix.length);
	return `${base.slice(0, maxBase)}${suffix}`.slice(0, DIPLOMACY_NAME_MAX);
}

export function diplomacyChannelDisplayName(
	tag: string,
	config: Pick<GuildConfig, 'diplomacy_name_template' | 'diplomacy_preferred_locales'>,
): string {
	return formatDiplomacyChannelName(
		tag,
		config.diplomacy_name_template,
		preferredLocalesForTag(config, tag),
	);
}

/** Merge/clear preferred locales for one tag (returns a new map). */
export function withDiplomacyPreferredLocales(
	current: Record<string, string[]>,
	allianceTag: string,
	locales: readonly string[],
): Record<string, string[]> {
	const tag = normalizeAllianceTag(allianceTag);
	const next = { ...current };
	if (!tag) return next;
	if (locales.length === 0) {
		delete next[tag];
	} else {
		next[tag] = [...locales];
	}
	return next;
}

/** Discord role IDs that should have write access (configured roles + rank roles). */
export function diplomacyWriteRoleIds(config: GuildConfig): string[] {
	const ids = new Set<string>();
	for (const id of config.diplomacy_write_role_ids) {
		if (/^\d{15,20}$/.test(id)) ids.add(id);
	}

	for (const rankRaw of config.diplomacy_write_ranks) {
		const rank = normalizeAllianceRank(rankRaw);
		if (!rank) continue;
		for (const id of roleIdsForRank(config, rank)) {
			if (/^\d{15,20}$/.test(id)) ids.add(id);
		}
	}
	return Array.from(ids);
}

function roleIdsForRank(config: GuildConfig, rank: AllianceRankKey): string[] {
	switch (rank) {
		case 'Operative':
			return config.operative_role_ids;
		case 'Agent':
			return config.agent_role_ids;
		case 'Premier':
			return config.premier_role_ids;
		case 'Commodore':
			return config.commodore_role_ids;
		case 'Admiral':
			return config.admiral_role_ids;
		default:
			return [];
	}
}

export async function applyDiplomacyChannelPermissions(
	token: string,
	guildId: string,
	channelId: string,
	config: GuildConfig,
): Promise<void> {
	const botUserId = await getBotUserId(token);
	const writeRoles = diplomacyWriteRoleIds(config);

	// @everyone
	if (config.diplomacy_everyone_can_view) {
		await setChannelPermission(token, channelId, guildId, PERM_VIEW, PERM_DENY_SEND, 0);
	} else {
		await setChannelPermission(token, channelId, guildId, '0', PERM_DENY_VIEW, 0);
	}

	await setChannelPermission(token, channelId, botUserId, PERM_WRITE, '0', 1);

	if (!config.diplomacy_everyone_can_view) {
		for (const roleId of config.diplomacy_view_role_ids) {
			if (!/^\d{15,20}$/.test(roleId)) continue;
			if (writeRoles.includes(roleId)) continue;
			await setChannelPermission(token, channelId, roleId, PERM_VIEW, PERM_DENY_SEND, 0);
		}
	} else {
		for (const roleId of config.diplomacy_view_role_ids) {
			if (!/^\d{15,20}$/.test(roleId)) continue;
			if (writeRoles.includes(roleId)) continue;
			await setChannelPermission(token, channelId, roleId, PERM_VIEW, PERM_DENY_SEND, 0);
		}
	}

	for (const roleId of writeRoles) {
		await setChannelPermission(token, channelId, roleId, PERM_WRITE, '0', 0);
	}
}

function buildCreateOverwrites(
	guildId: string,
	botUserId: string,
	config: GuildConfig,
): ChannelPermissionOverwrite[] {
	const writeRoles = diplomacyWriteRoleIds(config);
	const overwrites: ChannelPermissionOverwrite[] = [
		config.diplomacy_everyone_can_view
			? { id: guildId, type: 0, allow: PERM_VIEW, deny: PERM_DENY_SEND }
			: { id: guildId, type: 0, allow: '0', deny: PERM_DENY_VIEW },
		{ id: botUserId, type: 1, allow: PERM_WRITE, deny: '0' },
	];

	for (const roleId of config.diplomacy_view_role_ids) {
		if (!/^\d{15,20}$/.test(roleId) || writeRoles.includes(roleId)) continue;
		overwrites.push({ id: roleId, type: 0, allow: PERM_VIEW, deny: PERM_DENY_SEND });
	}
	for (const roleId of writeRoles) {
		overwrites.push({ id: roleId, type: 0, allow: PERM_WRITE, deny: '0' });
	}
	return overwrites;
}

async function syncDiplomacyChannelPlacement(
	token: string,
	guildId: string,
	channelId: string,
	channel: Pick<DiscordChannel, 'name' | 'parent_id'>,
	tag: string,
	config: GuildConfig,
): Promise<{ moved: boolean; renamed: boolean }> {
	const desiredName = diplomacyChannelDisplayName(tag, config);
	const targetCategoryId = categoryForAllianceTag(config, tag);
	const updates: { name?: string; parent_id?: string } = {};
	if (targetCategoryId && channel.parent_id !== targetCategoryId) {
		updates.parent_id = targetCategoryId;
	}
	if (channel.name !== desiredName) {
		updates.name = desiredName;
	}
	let moved = false;
	let renamed = false;
	if (updates.parent_id || updates.name) {
		await patchGuildChannel(token, channelId, updates);
		moved = Boolean(updates.parent_id);
		renamed = Boolean(updates.name);
	}
	const sortCategoryId = updates.parent_id ?? targetCategoryId ?? channel.parent_id ?? null;
	if (sortCategoryId && /^\d{15,20}$/.test(sortCategoryId)) {
		try {
			await sortCategoryChannelsAlphabetically(token, guildId, sortCategoryId);
		} catch {
			/* non-fatal */
		}
	}
	return { moved, renamed };
}

/**
 * Ensure a diplomacy channel exists for an alliance tag (create or refresh name/category/perms).
 */
export async function ensureDiplomacyChannel(
	token: string,
	config: GuildConfig,
	guildId: string,
	allianceTag: string,
): Promise<DiplomacyChannelResult> {
	if (!diplomacyChannelsEnabled(config)) {
		return { ok: false, error: 'Diplomacy channels are not enabled.' };
	}
	const tag = normalizeAllianceTag(allianceTag);
	if (!tag) return { ok: false, error: 'Missing alliance tag.' };

	const existingId = config.diplomacy_channel_map[tag];
	try {
		if (existingId) {
			const existing = await getGuildChannel(token, existingId);
			if (existing && isLinkableGuildTextChannel(existing.type)) {
				const { moved, renamed } = await syncDiplomacyChannelPlacement(
					token,
					guildId,
					existingId,
					existing,
					tag,
					config,
				);
				await applyDiplomacyChannelPermissions(token, guildId, existingId, config);
				return { ok: true, channelId: existingId, created: false, moved, renamed, tag };
			}
		}

		const botUserId = await getBotUserId(token);
		const name = diplomacyChannelDisplayName(tag, config);
		const parentId = categoryForAllianceTag(config, tag);
		const channel = await createGuildTextChannel(token, guildId, name, {
			parentId: parentId ?? undefined,
			topic: `Diplomacy channel for [${tag}]`,
			permissionOverwrites: buildCreateOverwrites(guildId, botUserId, config),
		});
		if (parentId) {
			try {
				await sortCategoryChannelsAlphabetically(token, guildId, parentId);
			} catch {
				/* non-fatal */
			}
		}
		return { ok: true, channelId: channel.id, created: true, moved: false, renamed: false, tag };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : 'unknown error' };
	}
}

/** Adopt an existing text channel as the diplomacy channel for a tag. */
export async function linkDiplomacyChannel(
	token: string,
	config: GuildConfig,
	guildId: string,
	allianceTag: string,
	channelId: string,
	opts?: {
		applyPermissions?: boolean;
		knownChannel?: Pick<DiscordChannel, 'id' | 'name' | 'type' | 'parent_id' | 'guild_id'> | null;
	},
): Promise<DiplomacyChannelResult> {
	const tag = normalizeAllianceTag(allianceTag);
	if (!tag) return { ok: false, error: 'Missing alliance tag.' };

	let channel: DiscordChannel | Pick<DiscordChannel, 'id' | 'name' | 'type' | 'parent_id' | 'guild_id'>;
	if (opts?.knownChannel && opts.knownChannel.id === channelId) {
		channel = opts.knownChannel;
	} else {
		const fetched = await fetchGuildChannel(token, channelId);
		if (!fetched.ok) return { ok: false, error: fetched.error };
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
				`link a **text** or **announcement** channel.`,
		};
	}

	try {
		const { moved, renamed } = await syncDiplomacyChannelPlacement(
			token,
			guildId,
			channelId,
			channel,
			tag,
			config,
		);
		if (opts?.applyPermissions !== false) {
			await applyDiplomacyChannelPermissions(token, guildId, channelId, config);
		}
		return { ok: true, channelId, created: false, moved, renamed, tag };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : 'unknown error' };
	}
}

export interface RebalanceDiplomacyOptions {
	/** Also create channels for these alliance tags if missing from the map. */
	createMissingTags?: string[];
	softLimit?: number;
	/** Category name pattern; use `{range}` (default `Diplomacy Channels {range}`). */
	categoryNameTemplate?: string;
	renameCategories?: boolean;
	createCategories?: boolean;
	archiveUnlinked?: boolean;
	archiveCategoryId?: string | null;
	archiveName?: string | null;
	applyPermissions?: boolean;
	moveDelayMs?: number;
	onProgress?: (message: string) => Promise<void>;
	/** Persist category map early so a mid-run crash does not leave an empty map. */
	onCategoriesReady?: (
		categoryMap: Record<string, string>,
		archiveCategoryId: string | null,
	) => Promise<void>;
	onChannelMapped?: (tag: string, channelId: string) => Promise<void>;
}

export interface RebalanceDiplomacyResult {
	ok: boolean;
	channelsMoved: number;
	channelsRenamed: number;
	channelsCreated: number;
	channelsArchived: number;
	channelsFailed: number;
	categoriesCreated: number;
	categoriesRenamed: number;
	categoriesAlphaSorted: number;
	categoryMap: Record<string, string>;
	archiveCategoryId: string | null;
	errors: string[];
	summary: string;
	/** Updated tag → channel map (includes newly created). */
	channelMap: Record<string, string>;
	specialChannelId?: string | null;
	specialCategoryId?: string | null;
}

export interface PlanDiplomacyChannelsResult {
	plan: ReturnType<typeof planCategoryBuckets>;
	tags: string[];
	summary: string;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function collectDiplomacyTags(
	channelMap: Record<string, string>,
	createMissingTags?: string[],
): string[] {
	const tags = new Set<string>([
		...Object.keys(channelMap).map(normalizeAllianceTag),
		...(createMissingTags ?? []).map(normalizeAllianceTag),
	]);
	tags.delete('');
	return [...tags].sort((a, b) => a.localeCompare(b));
}

/** Preview letter-bucket categories for alliance tags (no Discord writes). */
export function planDiplomacyChannels(
	config: GuildConfig,
	opts: { softLimit?: number; createMissingTags?: string[] } = {},
): PlanDiplomacyChannelsResult {
	const tags = collectDiplomacyTags(config.diplomacy_channel_map, opts.createMissingTags);
	const softLimit = opts.softLimit ?? DEFAULT_SOFT_LIMIT;
	const plan = planCategoryBuckets(buildLetterHistogram(tags), softLimit);
	const summary = (
		`${formatCategoryPlan(plan, { title: 'Diplomacy category plan' })}\n` +
		`• Tags: ${tags.length}\n` +
		`• Current category map: ${
			Object.keys(config.diplomacy_category_map).length
				? Object.entries(config.diplomacy_category_map)
						.map(([r, id]) => `${r}→<#${id}>`)
						.join(', ')
				: config.diplomacy_category_id
					? `legacy single <#${config.diplomacy_category_id}>`
					: 'none'
		}`
	).slice(0, 1900);
	return { plan, tags, summary };
}

/**
 * Sync diplomacy channels: plan/create letter-bucket categories (50-channel soft limit),
 * latinized slug rename, move into the right bucket, optional archive, A–Z sort per category.
 */
export async function rebalanceDiplomacyChannels(
	token: string,
	config: GuildConfig,
	guildId: string,
	opts: RebalanceDiplomacyOptions = {},
): Promise<RebalanceDiplomacyResult> {
	const softLimit = opts.softLimit ?? DEFAULT_SOFT_LIMIT;
	const nameTemplate =
		opts.categoryNameTemplate?.trim() || DEFAULT_DIPLOMACY_CATEGORY_NAME_TEMPLATE;
	const renameCategories = opts.renameCategories !== false;
	const createCategories = opts.createCategories !== false;
	const archiveUnlinked = opts.archiveUnlinked !== false;
	const moveDelayMs = opts.moveDelayMs ?? 250;
	const applyPermissions = opts.applyPermissions !== false;
	const errors: string[] = [];
	let channelsMoved = 0;
	let channelsRenamed = 0;
	let channelsCreated = 0;
	let channelsArchived = 0;
	let channelsFailed = 0;
	let categoriesCreated = 0;
	let categoriesRenamed = 0;
	let categoriesReusedByName = 0;
	const channelMap = { ...config.diplomacy_channel_map };

	const report = async (message: string) => {
		if (!opts.onProgress) return;
		try {
			await opts.onProgress(message);
		} catch {
			/* non-fatal */
		}
	};

	const tagList = collectDiplomacyTags(channelMap, opts.createMissingTags);
	const plan = planCategoryBuckets(buildLetterHistogram(tagList), softLimit);

	await report(
		`⏳ Diplomacy sync: preparing **${plan.buckets.length}** categor${plan.buckets.length === 1 ? 'y' : 'ies'} for **${tagList.length}** tag(s)…`,
	);

	const existing = sortedCategoryMapEntries(config.diplomacy_category_map);
	const previousMapCategoryIds = [
		...new Set([
			...existing.map((e) => e.categoryId).filter((id) => /^\d{15,20}$/.test(id)),
			...(config.diplomacy_category_id && /^\d{15,20}$/.test(config.diplomacy_category_id)
				? [config.diplomacy_category_id]
				: []),
		]),
	];
	const newMap: Record<string, string> = {};
	let archiveCategoryId: string | null = null;

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
				archiveUnlinked &&
				!opts.archiveCategoryId &&
				!opts.archiveName &&
				!config.diplomacy_archive_category_id;
			const resolved = await resolveArchiveCategory(token, guildId, {
				archiveCategoryId: opts.archiveCategoryId,
				archiveName: opts.archiveName || (wantDefault ? DEFAULT_DIPLOMACY_ARCHIVE_NAME : null),
				configArchiveCategoryId: config.diplomacy_archive_category_id,
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
						name: opts.archiveName?.trim() || DEFAULT_DIPLOMACY_ARCHIVE_NAME,
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
		archiveCategoryId = config.diplomacy_archive_category_id;
	}

	const guildCategories = [...channelById.values()].filter((ch) => ch.type === 4);
	const assignedCategoryIds = new Set<string>();
	if (archiveCategoryId) assignedCategoryIds.add(archiveCategoryId);

	for (let i = 0; i < plan.buckets.length; i++) {
		const bucket = plan.buckets[i];
		const desiredName = applyCategoryNameTemplate(nameTemplate, bucket.range);
		let categoryId: string | undefined = existing[i]?.categoryId;
		let reusedByName = false;

		if (categoryId && !channelById.has(categoryId)) {
			categoryId = undefined;
		}
		if (categoryId && assignedCategoryIds.has(categoryId)) {
			categoryId = undefined;
		}

		// Seed first bucket from legacy single diplomacy_category_id when map is empty.
		if (
			!categoryId &&
			i === 0 &&
			config.diplomacy_category_id &&
			/^\d{15,20}$/.test(config.diplomacy_category_id) &&
			channelById.has(config.diplomacy_category_id) &&
			!assignedCategoryIds.has(config.diplomacy_category_id)
		) {
			categoryId = config.diplomacy_category_id;
		}

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
		diplomacy_category_map: newMap,
		diplomacy_archive_category_id: archiveCategoryId,
		diplomacy_channel_map: channelMap,
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

	await report(
		`⏳ Diplomacy sync: categories ready (` +
			`${categoriesCreated} created, ${categoriesRenamed} renamed, ${categoriesReusedByName} reused by name). ` +
			`Moving/creating channels (0/${tagList.length})…`,
	);

	let processed = 0;
	for (const tag of tagList) {
		processed++;
		if (processed === 1 || processed % 5 === 0 || processed === tagList.length) {
			await report(
				`⏳ Diplomacy sync: ${processed}/${tagList.length}` +
					` (moved ${channelsMoved}, renamed ${channelsRenamed}, created ${channelsCreated}, failed ${channelsFailed})…`,
			);
		}

		const cfg: GuildConfig = {
			...configWithMap,
			diplomacy_channel_map: channelMap,
		};
		const result = await ensureDiplomacyChannel(token, cfg, guildId, tag);
		if (!result.ok) {
			channelsFailed++;
			errors.push(`[${tag}] ${result.error}`);
			continue;
		}

		channelMap[tag] = result.channelId;
		if (result.created) channelsCreated++;
		if (result.moved) channelsMoved++;
		if (result.renamed) channelsRenamed++;

		if (applyPermissions && !result.created) {
			try {
				await applyDiplomacyChannelPermissions(token, guildId, result.channelId, config);
			} catch (error) {
				errors.push(
					`[${tag}] perms: ${error instanceof Error ? error.message : 'unknown'}`,
				);
			}
		}

		if (opts.onChannelMapped) {
			await opts.onChannelMapped(tag, result.channelId);
		}
		if (moveDelayMs > 0) await sleep(moveDelayMs);
	}

	if (archiveUnlinked) {
		const archiveMap = config.diplomacy_archive_category_map ?? {};
		const archiveMapIds = new Set(
			Object.values(archiveMap).filter((id) => /^\d{15,20}$/.test(id)),
		);
		if (!archiveCategoryId && archiveMapIds.size === 0) {
			errors.push('Archive requested but no archive category is available.');
		} else {
			try {
				await report(`⏳ Diplomacy sync: archiving unlinked channels…`);
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
							!archiveMapIds.has(ch.id) &&
							!Object.values(newMap).includes(ch.id) &&
							(ch.name?.startsWith(namePrefix) || previousMapCategoryIds.includes(ch.id)),
					)
					.map((ch) => ch.id);

				const cats = new Set<string>([
					...Object.values(newMap),
					...previousMapCategoryIds,
					...leftoverByName,
				]);
				if (
					config.diplomacy_special_category_id &&
					/^\d{15,20}$/.test(config.diplomacy_special_category_id)
				) {
					cats.add(config.diplomacy_special_category_id);
				}
				if (archiveCategoryId) cats.delete(archiveCategoryId);
				for (const id of archiveMapIds) cats.delete(id);
				const linkedIds = new Set(Object.values(channelMap));
				if (
					config.diplomacy_special_channel_id &&
					/^\d{15,20}$/.test(config.diplomacy_special_channel_id)
				) {
					linkedIds.add(config.diplomacy_special_channel_id);
				}
				const unlinked = findUnlinkedMemberChannels(
					channels,
					cats,
					linkedIds,
					archiveCategoryId,
				).filter((ch) => !archiveMapIds.has(ch.parent_id ?? ''));
				let archivedProgress = 0;
				for (const ch of unlinked) {
					const targetParent =
						(Object.keys(archiveMap).length > 0
							? categoryForLetterName(archiveMap, ch.name || ch.id)
							: undefined) ?? archiveCategoryId;
					if (!targetParent || ch.parent_id === targetParent) continue;
					try {
						await patchGuildChannel(token, ch.id, { parent_id: targetParent });
						channelsArchived++;
						archivedProgress++;
						if (archivedProgress === 1 || archivedProgress % 10 === 0) {
							await report(
								`⏳ Diplomacy sync: archived ${channelsArchived}/${unlinked.length} unlinked channel(s)…`,
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

	let specialChannelId = config.diplomacy_special_channel_id;
	let specialCategoryId = config.diplomacy_special_category_id;
	let specialSynced = false;
	if (specialChannelId && /^\d{15,20}$/.test(specialChannelId)) {
		await report(`⏳ Diplomacy sync: placing special (non-listed) channel…`);
		const specialCfg: GuildConfig = {
			...configWithMap,
			diplomacy_channel_map: channelMap,
			diplomacy_category_map: newMap,
			diplomacy_special_channel_id: specialChannelId,
		};
		const specialResult = await ensureDiplomacySpecialChannel(token, specialCfg, guildId, {
			applyPermissions: false,
		});
		if (specialResult.ok) {
			specialChannelId = specialResult.channelId;
			specialCategoryId = specialResult.categoryId;
			specialSynced = true;
			if (specialResult.moved) channelsMoved++;
			if (specialResult.renamed) channelsRenamed++;
		} else {
			errors.push(`Special channel: ${specialResult.error}`);
		}
	}

	await report(`⏳ Diplomacy sync: sorting channels alphabetically within categories…`);
	let categoriesAlphaSorted = 0;
	try {
		const listed = await listGuildChannels(token, guildId);
		const placement = normalizeDiplomacySpecialPlacement(config.diplomacy_special_placement);
		const firstCat = sortedCategoryMapEntries(newMap)[0]?.categoryId ?? null;
		const sortResult = await sortCategoryIdMapAlphabetically(
			token,
			guildId,
			Object.values(newMap),
			listed,
			placement === 'top_of_first' && specialChannelId
				? {
						pinFirstChannelId: specialChannelId,
						pinFirstInCategoryId: firstCat,
					}
				: undefined,
		);
		categoriesAlphaSorted = sortResult.categoriesSorted;
		errors.push(...sortResult.errors);
		if (
			placement === 'special_category' &&
			specialCategoryId &&
			/^\d{15,20}$/.test(specialCategoryId)
		) {
			try {
				await sortCategoryChannelsAlphabetically(token, guildId, specialCategoryId, listed);
			} catch (error) {
				errors.push(
					`Special category sort: ${error instanceof Error ? error.message : 'unknown'}`,
				);
			}
		}
	} catch (error) {
		errors.push(
			`Alphabetical sort failed: ${error instanceof Error ? error.message : 'unknown'}`,
		);
	}

	const mapComplete = Object.keys(newMap).length === plan.buckets.length;
	const summary = (
		`${formatCategoryPlan(plan, { title: mapComplete ? 'Diplomacy sync complete' : 'Diplomacy sync partial' })}\n\n` +
		`• Categories created: ${categoriesCreated}\n` +
		`• Categories renamed: ${categoriesRenamed}\n` +
		`• Categories reused by name: ${categoriesReusedByName}\n` +
		`• Channels created: ${channelsCreated}\n` +
		`• Channels moved: ${channelsMoved}\n` +
		`• Channels renamed: ${channelsRenamed}\n` +
		`• Channels archived: ${channelsArchived}\n` +
		`• Channels failed: ${channelsFailed}\n` +
		`• Categories A–Z sorted: ${categoriesAlphaSorted}\n` +
		`• Special channel: ${specialSynced && specialChannelId ? `<#${specialChannelId}>` : specialChannelId ? 'configured (sync issue)' : 'none'}\n` +
		`• Archive: ${archiveCategoryId ? `<#${archiveCategoryId}>` : 'none'}\n` +
		`• Category map: ${
			Object.entries(newMap)
				.map(([r, id]) => `${r}→<#${id}>`)
				.join(', ') || 'none'
		}\n` +
		`• Channel map: ${formatDiplomacyChannelMap(channelMap, config.diplomacy_preferred_locales)}` +
		(errors.length ? `\n\n⚠ Errors (${errors.length}):\n${errors.slice(0, 8).join('\n')}` : '')
	).slice(0, 1900);

	return {
		ok: mapComplete && channelsFailed === 0,
		channelsMoved,
		channelsRenamed,
		channelsCreated,
		channelsArchived,
		channelsFailed,
		categoriesCreated,
		categoriesRenamed,
		categoriesAlphaSorted,
		categoryMap: newMap,
		archiveCategoryId,
		errors,
		summary,
		channelMap,
		specialChannelId,
		specialCategoryId,
	};
}

/** Parse comma/space-separated category snowflakes (optional `<#id>` mentions). */
export function parseArchiveSourceCategoryIds(
	raw: string | null | undefined,
	extraIds?: Array<string | null | undefined>,
): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const push = (id: string) => {
		const t = id.trim();
		if (!/^\d{15,20}$/.test(t) || seen.has(t)) return;
		seen.add(t);
		out.push(t);
	};
	for (const extra of extraIds ?? []) {
		if (extra) push(String(extra));
	}
	if (raw?.trim()) {
		for (const part of raw.split(/[,;\s]+/)) {
			const mention = part.match(/^<#(\d{15,20})>$/);
			push(mention?.[1] ?? part);
		}
	}
	return out;
}

export interface DiplomacyArchiveSyncOptions {
	/** Category IDs that currently hold archive (or unsorted) diplomacy rooms. */
	sourceCategoryIds: string[];
	softLimit?: number;
	/** Archive category name pattern; `{range}` → e.g. `A-M` (default `Diplomacy Archive {range}`). */
	categoryNameTemplate?: string;
	renameCategories?: boolean;
	createCategories?: boolean;
	moveDelayMs?: number;
	onProgress?: (message: string) => Promise<void>;
	/** Persist archive category map early. */
	onArchiveCategoriesReady?: (archiveCategoryMap: Record<string, string>) => Promise<void>;
}

export interface DiplomacyArchiveSyncResult {
	ok: boolean;
	channelsMoved: number;
	channelsFailed: number;
	categoriesCreated: number;
	categoriesRenamed: number;
	categoriesAlphaSorted: number;
	archiveCategoryMap: Record<string, string>;
	/** First archive bucket (compat with diplomacy_archive_category_id). */
	archiveCategoryId: string | null;
	channelCount: number;
	sourceCategoryIds: string[];
	errors: string[];
	summary: string;
}

export interface PlanDiplomacyArchiveResult {
	plan: ReturnType<typeof planCategoryBuckets>;
	channelCount: number;
	sourceCategoryIds: string[];
	summary: string;
}

/**
 * Preview letter-bucket archive categories for text channels in source categories
 * (excludes linked diplomacy + special channels). No Discord writes.
 */
export function planDiplomacyArchiveChannels(
	channels: DiscordChannel[],
	sourceCategoryIds: string[],
	config: Pick<GuildConfig, 'diplomacy_channel_map' | 'diplomacy_special_channel_id'>,
	opts?: { softLimit?: number },
): PlanDiplomacyArchiveResult {
	const sources = new Set(sourceCategoryIds.filter((id) => /^\d{15,20}$/.test(id)));
	const linked = new Set(Object.values(config.diplomacy_channel_map ?? {}));
	if (config.diplomacy_special_channel_id) linked.add(config.diplomacy_special_channel_id);

	const names: string[] = [];
	for (const ch of channels) {
		if (!sources.has(ch.parent_id ?? '')) continue;
		if (!isLinkableGuildTextChannel(ch.type)) continue;
		if (linked.has(ch.id)) continue;
		names.push(ch.name || ch.id);
	}

	const softLimit = opts?.softLimit ?? DEFAULT_SOFT_LIMIT;
	const plan = planCategoryBuckets(buildLetterHistogram(names), softLimit);
	const summary = (
		`${formatCategoryPlan(plan, { title: 'Diplomacy archive plan' })}\n` +
		`• Channels to organise: ${names.length}\n` +
		`• Source categories: ${
			sourceCategoryIds.length
				? sourceCategoryIds.map((id) => `<#${id}>`).join(', ')
				: 'none'
		}\n` +
		`• Linked diplomacy / special channels in those cats are skipped`
	).slice(0, 1900);
	return { plan, channelCount: names.length, sourceCategoryIds: [...sources], summary };
}

/**
 * Rebalance unlinked diplomacy rooms from source categories into letter-bucket
 * archive categories. Does **not** require tag linking; channel names are kept.
 */
export async function rebalanceDiplomacyArchiveChannels(
	token: string,
	config: GuildConfig,
	guildId: string,
	opts: DiplomacyArchiveSyncOptions,
): Promise<DiplomacyArchiveSyncResult> {
	const softLimit = opts.softLimit ?? DEFAULT_SOFT_LIMIT;
	const nameTemplate =
		opts.categoryNameTemplate?.trim() || DEFAULT_DIPLOMACY_ARCHIVE_CATEGORY_NAME_TEMPLATE;
	const renameCategories = opts.renameCategories !== false;
	const createCategories = opts.createCategories !== false;
	const moveDelayMs = opts.moveDelayMs ?? 250;
	const errors: string[] = [];
	let channelsMoved = 0;
	let channelsFailed = 0;
	let categoriesCreated = 0;
	let categoriesRenamed = 0;
	let categoriesReusedByName = 0;

	const report = async (message: string) => {
		if (!opts.onProgress) return;
		try {
			await opts.onProgress(message);
		} catch {
			/* non-fatal */
		}
	};

	const sourceIds = [
		...new Set(opts.sourceCategoryIds.filter((id) => /^\d{15,20}$/.test(id))),
	];
	if (sourceIds.length === 0) {
		return {
			ok: false,
			channelsMoved: 0,
			channelsFailed: 0,
			categoriesCreated: 0,
			categoriesRenamed: 0,
			categoriesAlphaSorted: 0,
			archiveCategoryMap: { ...config.diplomacy_archive_category_map },
			archiveCategoryId: config.diplomacy_archive_category_id,
			channelCount: 0,
			sourceCategoryIds: [],
			errors: ['Provide at least one source category (`archive_category:` and/or `archive_sources:`).'],
			summary: '❌ No archive source categories provided.',
		};
	}

	let channelById = new Map<string, DiscordChannel>();
	try {
		const listed = await listGuildChannels(token, guildId);
		channelById = new Map(listed.map((ch) => [ch.id, ch]));
	} catch (error) {
		const msg = error instanceof Error ? error.message : 'unknown';
		return {
			ok: false,
			channelsMoved: 0,
			channelsFailed: 0,
			categoriesCreated: 0,
			categoriesRenamed: 0,
			categoriesAlphaSorted: 0,
			archiveCategoryMap: { ...config.diplomacy_archive_category_map },
			archiveCategoryId: config.diplomacy_archive_category_id,
			channelCount: 0,
			sourceCategoryIds: sourceIds,
			errors: [`Could not list guild channels: ${msg}`],
			summary: `❌ Could not list guild channels: ${msg}`,
		};
	}

	for (const id of sourceIds) {
		const ch = channelById.get(id);
		if (!ch || ch.type !== 4) {
			errors.push(`Source <#${id}> is missing or not a category.`);
		}
	}

	const linked = new Set(Object.values(config.diplomacy_channel_map ?? {}));
	if (config.diplomacy_special_channel_id) linked.add(config.diplomacy_special_channel_id);
	const sourceSet = new Set(sourceIds);

	const toOrganise = [...channelById.values()].filter(
		(ch) =>
			sourceSet.has(ch.parent_id ?? '') &&
			isLinkableGuildTextChannel(ch.type) &&
			!linked.has(ch.id),
	);

	const plan = planCategoryBuckets(
		buildLetterHistogram(toOrganise.map((ch) => ch.name || ch.id)),
		softLimit,
	);

	await report(
		`⏳ Archive sync: preparing **${plan.buckets.length}** categor${plan.buckets.length === 1 ? 'y' : 'ies'} for **${toOrganise.length}** channel(s)…`,
	);

	const existing = sortedCategoryMapEntries(config.diplomacy_archive_category_map ?? {});
	const newMap: Record<string, string> = {};
	const guildCategories = [...channelById.values()].filter((ch) => ch.type === 4);
	const assignedCategoryIds = new Set<string>([
		...Object.values(config.diplomacy_category_map ?? {}),
		...(config.diplomacy_category_id ? [config.diplomacy_category_id] : []),
		...(config.diplomacy_special_category_id ? [config.diplomacy_special_category_id] : []),
	]);

	for (let i = 0; i < plan.buckets.length; i++) {
		const bucket = plan.buckets[i]!;
		const desiredName = applyCategoryNameTemplate(nameTemplate, bucket.range);
		let categoryId: string | undefined = existing[i]?.categoryId;
		let reusedByName = false;

		if (categoryId && !channelById.has(categoryId)) categoryId = undefined;
		if (categoryId && assignedCategoryIds.has(categoryId)) categoryId = undefined;

		// Prefer adopting a source category when its name already matches the planned bucket.
		if (!categoryId) {
			const sourceMatch = sourceIds.find((id) => {
				const ch = channelById.get(id);
				return ch?.type === 4 && ch.name === desiredName && !assignedCategoryIds.has(id);
			});
			if (sourceMatch) {
				categoryId = sourceMatch;
				reusedByName = true;
			}
		}

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
				errors.push(`Missing archive category for \`${bucket.range}\`.`);
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
					`Failed to create ${desiredName}: ${error instanceof Error ? error.message : 'unknown'}`,
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
					`Failed to rename archive category ${categoryId}: ${
						error instanceof Error ? error.message : 'unknown'
					}`,
				);
			}
		}

		if (categoryId) {
			if (reusedByName) categoriesReusedByName++;
			assignedCategoryIds.add(categoryId);
			newMap[bucket.range] = categoryId;
		}
	}

	if (opts.onArchiveCategoriesReady) {
		try {
			await opts.onArchiveCategoriesReady(newMap);
		} catch (error) {
			errors.push(
				`Failed to persist archive map early: ${error instanceof Error ? error.message : 'unknown'}`,
			);
		}
	}

	await report(
		`⏳ Archive sync: moving channels (0/${toOrganise.length})…`,
	);

	let processed = 0;
	for (const ch of toOrganise) {
		processed++;
		if (processed === 1 || processed % 10 === 0 || processed === toOrganise.length) {
			await report(
				`⏳ Archive sync: ${processed}/${toOrganise.length}` +
					` (moved ${channelsMoved}, failed ${channelsFailed})…`,
			);
		}
		const targetParent = categoryForLetterName(newMap, ch.name || ch.id);
		if (!targetParent) {
			channelsFailed++;
			errors.push(`No archive bucket for #${ch.name}`);
			continue;
		}
		if (ch.parent_id === targetParent) continue;
		try {
			await patchGuildChannel(token, ch.id, { parent_id: targetParent });
			channelsMoved++;
			channelById.set(ch.id, { ...ch, parent_id: targetParent });
			if (moveDelayMs > 0) await sleep(moveDelayMs);
		} catch (error) {
			channelsFailed++;
			errors.push(
				`Move failed for #${ch.name}: ${error instanceof Error ? error.message : 'unknown'}`,
			);
		}
	}

	await report(`⏳ Archive sync: sorting alphabetically…`);
	let categoriesAlphaSorted = 0;
	try {
		const listed = [...channelById.values()];
		const sortResult = await sortCategoryIdMapAlphabetically(
			token,
			guildId,
			Object.values(newMap),
			listed,
		);
		categoriesAlphaSorted = sortResult.categoriesSorted;
		errors.push(...sortResult.errors);
	} catch (error) {
		errors.push(
			`Alphabetical sort failed: ${error instanceof Error ? error.message : 'unknown'}`,
		);
	}

	const firstArchiveId = sortedCategoryMapEntries(newMap)[0]?.categoryId ?? null;
	const mapComplete = Object.keys(newMap).length === plan.buckets.length;
	const summary = (
		`${formatCategoryPlan(plan, { title: mapComplete ? 'Diplomacy archive sync complete' : 'Diplomacy archive sync partial' })}\n\n` +
		`• Source categories: ${sourceIds.map((id) => `<#${id}>`).join(', ')}\n` +
		`• Channels organised: ${toOrganise.length}\n` +
		`• Channels moved: ${channelsMoved}\n` +
		`• Channels failed: ${channelsFailed}\n` +
		`• Categories created: ${categoriesCreated}\n` +
		`• Categories renamed: ${categoriesRenamed}\n` +
		`• Categories reused by name: ${categoriesReusedByName}\n` +
		`• Categories A–Z sorted: ${categoriesAlphaSorted}\n` +
		`• Archive map: ${
			Object.entries(newMap)
				.map(([r, id]) => `${r}→<#${id}>`)
				.join(', ') || 'none'
		}` +
		(errors.length ? `\n\n⚠ Errors (${errors.length}):\n${errors.slice(0, 8).join('\n')}` : '')
	).slice(0, 1900);

	return {
		ok: mapComplete && channelsFailed === 0 && errors.filter((e) => !e.startsWith('Source')).length === 0,
		channelsMoved,
		channelsFailed,
		categoriesCreated,
		categoriesRenamed,
		categoriesAlphaSorted,
		archiveCategoryMap: newMap,
		archiveCategoryId: firstArchiveId,
		channelCount: toOrganise.length,
		sourceCategoryIds: sourceIds,
		errors,
		summary,
	};
}

export function formatDiplomacyChannelMap(
	map: Record<string, string>,
	preferredLocales?: Record<string, string[]>,
): string {
	const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
	if (entries.length === 0) return 'none';
	return entries
		.map(([tag, id]) => {
			const flags = formatLocaleFlagSuffix(preferredLocales?.[tag] ?? []);
			return flags ? `[${tag}]→<#${id}> ${flags}` : `[${tag}]→<#${id}>`;
		})
		.join(', ');
}

export interface DiplomacyGapsReport {
	trackedNoChannel: string[];
	verifiedNoChannel: string[];
	channelNotTracked: Array<{ tag: string; onVerified: boolean }>;
	summary: string;
}

function sortedUniqueTags(tags: Iterable<string>): string[] {
	const set = new Set<string>();
	for (const t of tags) {
		const n = normalizeAllianceTag(t);
		if (n) set.add(n);
	}
	return [...set].sort((a, b) => a.localeCompare(b));
}

/** Compare tracked / verified tags against the diplomacy channel map. */
export function formatDiplomacyGapsReport(input: {
	trackedTags: readonly string[];
	diplomacyTags: readonly string[];
	verifiedTags: readonly string[];
}): DiplomacyGapsReport {
	const tracked = sortedUniqueTags(input.trackedTags);
	const diplomacy = sortedUniqueTags(input.diplomacyTags);
	const verified = sortedUniqueTags(input.verifiedTags);
	const dipSet = new Set(diplomacy);
	const trackSet = new Set(tracked);
	const verifiedSet = new Set(verified);

	const trackedNoChannel = tracked.filter((t) => !dipSet.has(t));
	const verifiedNoChannel = verified.filter((t) => !dipSet.has(t));
	const channelNotTracked = diplomacy.map((tag) => ({
		tag,
		onVerified: verifiedSet.has(tag),
	})).filter(({ tag }) => !trackSet.has(tag));

	const fmt = (tags: string[]) =>
		tags.length ? tags.map((t) => `\`${t}\``).join(', ') : '_none_';
	const fmtChannel = (rows: Array<{ tag: string; onVerified: boolean }>) =>
		rows.length
			? rows
					.map(
						(r) =>
							`\`${r.tag}\`${r.onVerified ? ' (on verified player)' : ''}`,
					)
					.join(', ')
			: '_none_';

	const summary = (
		`🔍 **Diplomacy gaps**\n` +
		`• Tracked, no channel (${trackedNoChannel.length}): ${fmt(trackedNoChannel)}\n` +
		`• Verified tags, no channel (${verifiedNoChannel.length}): ${fmt(verifiedNoChannel)}\n` +
		`• Channel, not on explicit track (${channelNotTracked.length}): ${fmtChannel(channelNotTracked)}\n\n` +
		`Link missing: \`/diplomacy link_tag:TAG channel:#…\` · Track: \`/alliance track tag:TAG\``
	).slice(0, 1900);

	return { trackedNoChannel, verifiedNoChannel, channelNotTracked, summary };
}

export function slugDiplomacySpecialName(name: string): string {
	const folded = latinizePlayerName(name.trim() || DEFAULT_DIPLOMACY_SPECIAL_NAME);
	return (
		folded
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/-{2,}/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, DIPLOMACY_NAME_MAX) || DEFAULT_DIPLOMACY_SPECIAL_NAME
	);
}

export function resolveDiplomacySpecialName(
	config: Pick<GuildConfig, 'diplomacy_special_name'>,
	override?: string | null,
): string {
	const raw = override?.trim() || config.diplomacy_special_name?.trim() || DEFAULT_DIPLOMACY_SPECIAL_NAME;
	return slugDiplomacySpecialName(raw);
}

export function formatDiplomacySpecialStatus(
	config: Pick<
		GuildConfig,
		| 'diplomacy_special_channel_id'
		| 'diplomacy_special_name'
		| 'diplomacy_special_placement'
		| 'diplomacy_special_category_id'
	>,
): string {
	const id = config.diplomacy_special_channel_id;
	if (!id) return 'none';
	const name = resolveDiplomacySpecialName(config);
	const placement = normalizeDiplomacySpecialPlacement(config.diplomacy_special_placement);
	const cat =
		placement === 'special_category' && config.diplomacy_special_category_id
			? ` in <#${config.diplomacy_special_category_id}>`
			: placement === 'top_of_first'
				? ' (top of first letter-bucket)'
				: '';
	return `<#${id}> (\`${name}\`, ${placement}${cat})`;
}

export type DiplomacySpecialResult =
	| {
			ok: true;
			channelId: string;
			categoryId: string | null;
			created: boolean;
			moved: boolean;
			renamed: boolean;
			name: string;
			placement: DiplomacySpecialPlacement;
	  }
	| { ok: false; error: string };

async function resolveSpecialCategory(
	token: string,
	guildId: string,
	config: GuildConfig,
	opts?: { categoryId?: string | null; createIfMissing?: boolean },
): Promise<{ categoryId: string | null; created: boolean; error?: string }> {
	const wantId = opts?.categoryId?.trim() || config.diplomacy_special_category_id;
	if (wantId && /^\d{15,20}$/.test(wantId)) {
		const ch = await getGuildChannel(token, wantId);
		if (ch && ch.type === 4) return { categoryId: wantId, created: false };
		return { categoryId: null, created: false, error: 'special_category is not a valid category.' };
	}

	try {
		const listed = await listGuildChannels(token, guildId);
		const byName = listed.find(
			(ch) => ch.type === 4 && ch.name === DEFAULT_DIPLOMACY_SPECIAL_CATEGORY_NAME,
		);
		if (byName) return { categoryId: byName.id, created: false };
		if (opts?.createIfMissing === false) {
			return { categoryId: null, created: false };
		}
		const created = await createGuildCategory(token, guildId, DEFAULT_DIPLOMACY_SPECIAL_CATEGORY_NAME);
		return { categoryId: created.id, created: true };
	} catch (error) {
		return {
			categoryId: null,
			created: false,
			error: error instanceof Error ? error.message : 'Failed to resolve special category',
		};
	}
}

function firstLetterBucketCategoryId(config: GuildConfig): string | null {
	const entries = sortedCategoryMapEntries(config.diplomacy_category_map);
	if (entries[0]?.categoryId && /^\d{15,20}$/.test(entries[0].categoryId)) {
		return entries[0].categoryId;
	}
	if (config.diplomacy_category_id && /^\d{15,20}$/.test(config.diplomacy_category_id)) {
		return config.diplomacy_category_id;
	}
	return null;
}

/**
 * Create or refresh the non-listed-alliances diplomacy channel (not tagged in the map).
 */
export async function ensureDiplomacySpecialChannel(
	token: string,
	config: GuildConfig,
	guildId: string,
	opts?: {
		name?: string | null;
		placement?: DiplomacySpecialPlacement | null;
		categoryId?: string | null;
		applyPermissions?: boolean;
	},
): Promise<DiplomacySpecialResult> {
	if (!diplomacyChannelsEnabled(config)) {
		return { ok: false, error: 'Diplomacy channels are not enabled.' };
	}

	const placement = normalizeDiplomacySpecialPlacement(
		opts?.placement ?? config.diplomacy_special_placement,
	);
	const desiredName = resolveDiplomacySpecialName(config, opts?.name);
	let parentId: string | null = null;
	let categoryCreated = false;

	if (placement === 'special_category') {
		const resolved = await resolveSpecialCategory(token, guildId, config, {
			categoryId: opts?.categoryId,
			createIfMissing: true,
		});
		if (resolved.error || !resolved.categoryId) {
			return { ok: false, error: resolved.error || 'Could not resolve special category.' };
		}
		parentId = resolved.categoryId;
		categoryCreated = resolved.created;
	} else {
		parentId = firstLetterBucketCategoryId(config);
		if (!parentId) {
			return {
				ok: false,
				error:
					'No letter-bucket category yet. Run `/diplomacy sync_all:true` first, or use placement:special_category.',
			};
		}
	}

	const existingId = config.diplomacy_special_channel_id;
	try {
		if (existingId && /^\d{15,20}$/.test(existingId)) {
			const existing = await getGuildChannel(token, existingId);
			if (existing && isLinkableGuildTextChannel(existing.type)) {
				const updates: { name?: string; parent_id?: string } = {};
				if (existing.name !== desiredName) updates.name = desiredName;
				if (parentId && existing.parent_id !== parentId) updates.parent_id = parentId;
				if (updates.name || updates.parent_id) {
					await patchGuildChannel(token, existingId, updates);
				}
				if (opts?.applyPermissions !== false) {
					await applyDiplomacyChannelPermissions(token, guildId, existingId, config);
				}
				if (parentId) {
					await sortCategoryChannelsAlphabetically(token, guildId, parentId, undefined, {
						pinFirstChannelId:
							placement === 'top_of_first' ? existingId : undefined,
					});
				}
				return {
					ok: true,
					channelId: existingId,
					categoryId: parentId,
					created: false,
					moved: Boolean(updates.parent_id),
					renamed: Boolean(updates.name),
					name: desiredName,
					placement,
				};
			}
		}

		const botUserId = await getBotUserId(token);
		const channel = await createGuildTextChannel(token, guildId, desiredName, {
			parentId: parentId ?? undefined,
			topic: 'Diplomacy for alliances without a dedicated channel',
			permissionOverwrites: buildCreateOverwrites(guildId, botUserId, config),
		});
		if (parentId) {
			await sortCategoryChannelsAlphabetically(token, guildId, parentId, undefined, {
				pinFirstChannelId: placement === 'top_of_first' ? channel.id : undefined,
			});
		}
		return {
			ok: true,
			channelId: channel.id,
			categoryId: parentId,
			created: true,
			moved: false,
			renamed: false,
			name: desiredName,
			placement,
		};
	} catch (error) {
		return {
			ok: false,
			error:
				(categoryCreated ? '(special category created) ' : '') +
				(error instanceof Error ? error.message : 'unknown error'),
		};
	}
}

/** Adopt an existing text channel as the non-listed alliances diplomacy room. */
export async function linkDiplomacySpecialChannel(
	token: string,
	config: GuildConfig,
	guildId: string,
	channelId: string,
	opts?: {
		name?: string | null;
		placement?: DiplomacySpecialPlacement | null;
		categoryId?: string | null;
		applyPermissions?: boolean;
		knownChannel?: Pick<DiscordChannel, 'id' | 'name' | 'type' | 'parent_id' | 'guild_id'> | null;
	},
): Promise<DiplomacySpecialResult> {
	if (!/^\d{15,20}$/.test(channelId)) {
		return { ok: false, error: 'Invalid channel id.' };
	}

	let channel: DiscordChannel | Pick<DiscordChannel, 'id' | 'name' | 'type' | 'parent_id' | 'guild_id'>;
	if (opts?.knownChannel && opts.knownChannel.id === channelId) {
		channel = opts.knownChannel;
	} else {
		const fetched = await fetchGuildChannel(token, channelId);
		if (!fetched.ok) return { ok: false, error: fetched.error };
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
				`link a **text** or **announcement** channel.`,
		};
	}

	const withId: GuildConfig = {
		...config,
		diplomacy_special_channel_id: channelId,
	};
	return ensureDiplomacySpecialChannel(token, withId, guildId, {
		name: opts?.name,
		placement: opts?.placement,
		categoryId: opts?.categoryId,
		applyPermissions: opts?.applyPermissions,
	});
}
