import {
	createGuildTextChannel,
	getBotUserId,
	getGuildChannel,
	setChannelPermission,
	type ChannelPermissionOverwrite,
} from './discord-api';
import { normalizeAllianceRank, type AllianceRankKey } from './nickname-utils';
import type { GuildConfig } from './types';

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
	| { ok: true; channelId: string; created: boolean; tag: string }
	| { ok: false; error: string };

export function diplomacyChannelsEnabled(config: GuildConfig): boolean {
	return Boolean(config.diplomacy_enabled);
}

export function normalizeAllianceTag(tag: string): string {
	return tag.trim().toUpperCase();
}

export function slugDiplomacyChannelName(tag: string, template?: string | null): string {
	const raw = (template?.trim() || 'diplomacy-{tag}').replaceAll('{tag}', tag.trim());
	return (
		raw
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 90) || `diplomacy-${tag.toLowerCase()}`
	);
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
		// Additive view roles still get view (no send) when everyone can already view —
		// harmless; useful if you later flip everyone_can_view off.
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

/**
 * Ensure a diplomacy channel exists for an alliance tag (create or refresh perms).
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
			if (existing && existing.type === 0) {
				await applyDiplomacyChannelPermissions(token, guildId, existingId, config);
				return { ok: true, channelId: existingId, created: false, tag };
			}
		}

		const botUserId = await getBotUserId(token);
		const name = slugDiplomacyChannelName(tag, config.diplomacy_name_template);
		const channel = await createGuildTextChannel(token, guildId, name, {
			parentId: config.diplomacy_category_id ?? undefined,
			topic: `Diplomacy channel for [${tag}]`,
			permissionOverwrites: buildCreateOverwrites(guildId, botUserId, config),
		});
		return { ok: true, channelId: channel.id, created: true, tag };
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
	opts?: { applyPermissions?: boolean },
): Promise<DiplomacyChannelResult> {
	const tag = normalizeAllianceTag(allianceTag);
	if (!tag) return { ok: false, error: 'Missing alliance tag.' };

	const channel = await getGuildChannel(token, channelId);
	if (!channel || channel.type !== 0) {
		return { ok: false, error: 'Channel not found or is not a text channel.' };
	}

	try {
		if (opts?.applyPermissions !== false) {
			await applyDiplomacyChannelPermissions(token, guildId, channelId, config);
		}
		return { ok: true, channelId, created: false, tag };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : 'unknown error' };
	}
}

export function formatDiplomacyChannelMap(map: Record<string, string>): string {
	const entries = Object.entries(map);
	if (entries.length === 0) return 'none';
	return entries.map(([tag, id]) => `[${tag}]→<#${id}>`).join(', ');
}
