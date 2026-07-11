/**
 * Discord role/channel access after stfc.pro verification.
 * Kept separate from agreement.ts to avoid circular imports.
 */
import {
	addGuildMemberRole,
	DiscordApiError,
	getGuildMember,
	removeGuildMemberRole,
	setGuildMemberNickname,
} from './discord-api';
import { getVerifiedPlayer, upsertGuildConfig, upsertVerifiedPlayer } from './guild-db';
import { ensurePersonalChannel } from './personal-channels';
import { ensureDiplomacyChannel, diplomacyChannelsEnabled } from './diplomacy-channels';
import { buildMemberNickname, normalizeAllianceRank } from './nickname-utils';
import { resolveLocale, t } from './i18n';
import type { GuildConfig, PlayerData, VerifiedPlayer } from './types';
import { findPlayerByIdOrName } from './stfc-utils';

export interface RoleChangeResult {
	/** Role IDs newly granted. */
	added: string[];
	/** Role IDs removed. */
	removed: string[];
	/** Desired roles the member already had (skipped). */
	unchanged: string[];
}

/** Human-readable note for verification / audit logs (Discord role mentions). */
export function formatRoleChangeNote(result: RoleChangeResult): string {
	if (result.added.length === 0 && result.removed.length === 0) {
		return 'Roles: no changes';
	}
	const parts: string[] = [];
	if (result.added.length > 0) {
		parts.push(`+${result.added.map((id) => `<@&${id}>`).join(' ')}`);
	}
	if (result.removed.length > 0) {
		parts.push(`−${result.removed.map((id) => `<@&${id}>`).join(' ')}`);
	}
	return `Roles: ${parts.join('; ')}`;
}

function getOverlayRoleIdsForRank(config: GuildConfig, playerRank: string | undefined): string[] {
	const rankKey = normalizeAllianceRank(playerRank);
	if (!rankKey) return [];

	const wanted = rankKey.toLowerCase();
	const out = new Set<string>();
	for (const bucket of Object.values(config.overlay_buckets ?? {})) {
		const ranks = bucket.ranks ?? [];
		const matches = ranks.some((r) => String(r).trim().toLowerCase() === wanted);
		if (!matches) continue;
		for (const id of bucket.role_ids ?? []) out.add(id);
	}
	return Array.from(out);
}

function getMemberRoleIdsForRank(config: GuildConfig, playerRank: string | undefined): string[] {
	const rankKey = normalizeAllianceRank(playerRank);
	const rankRoles =
		rankKey === 'Operative'
			? config.operative_role_ids
			: rankKey === 'Agent'
				? config.agent_role_ids
				: rankKey === 'Premier'
					? config.premier_role_ids
					: rankKey === 'Commodore'
						? config.commodore_role_ids
						: rankKey === 'Admiral'
							? config.admiral_role_ids
							: [];

	const all = new Set<string>();
	for (const id of config.member_role_ids) all.add(id);
	for (const id of rankRoles) all.add(id);
	for (const id of getOverlayRoleIdsForRank(config, playerRank)) all.add(id);
	return Array.from(all);
}

function getAllMemberRoleIds(config: GuildConfig): string[] {
	const overlayRoleIds = Object.values(config.overlay_buckets ?? {}).flatMap((b) => b.role_ids ?? []);
	return [
		...config.member_role_ids,
		...config.operative_role_ids,
		...config.agent_role_ids,
		...config.premier_role_ids,
		...config.commodore_role_ids,
		...config.admiral_role_ids,
		...overlayRoleIds,
	];
}

export async function applyMemberRoles(
	token: string,
	config: GuildConfig,
	guildId: string,
	userId: string,
	playerRank: string | undefined,
): Promise<RoleChangeResult> {
	const desired = getMemberRoleIdsForRank(config, playerRank).filter((id) => /^\d{15,20}$/.test(id));
	const member = await getGuildMember(token, guildId, userId);
	const current = new Set(member?.roles ?? []);

	const added: string[] = [];
	const unchanged: string[] = [];
	const removed: string[] = [];

	for (const roleId of desired) {
		if (current.has(roleId)) {
			unchanged.push(roleId);
			continue;
		}
		await addGuildMemberRole(token, guildId, userId, roleId);
		added.push(roleId);
		current.add(roleId);
	}

	if (config.guest_role_id && /^\d{15,20}$/.test(config.guest_role_id) && current.has(config.guest_role_id)) {
		await removeGuildMemberRole(token, guildId, userId, config.guest_role_id);
		removed.push(config.guest_role_id);
	}

	return { added, removed, unchanged };
}

export async function applyGuestRole(
	token: string,
	config: GuildConfig,
	guildId: string,
	userId: string,
): Promise<RoleChangeResult> {
	const member = await getGuildMember(token, guildId, userId);
	const current = new Set(member?.roles ?? []);
	const added: string[] = [];
	const unchanged: string[] = [];
	const removed: string[] = [];

	if (config.guest_role_id && /^\d{15,20}$/.test(config.guest_role_id)) {
		if (current.has(config.guest_role_id)) {
			unchanged.push(config.guest_role_id);
		} else {
			await addGuildMemberRole(token, guildId, userId, config.guest_role_id);
			added.push(config.guest_role_id);
			current.add(config.guest_role_id);
		}
	}

	const memberRoleIds = getAllMemberRoleIds(config).filter((id) => /^\d{15,20}$/.test(id));
	for (const roleId of memberRoleIds) {
		if (!current.has(roleId)) continue;
		await removeGuildMemberRole(token, guildId, userId, roleId);
		removed.push(roleId);
	}

	return { added, removed, unchanged };
}

export async function applyPersonalChannelForMember(
	token: string,
	config: GuildConfig,
	guildId: string,
	discordUserId: string,
	playerName: string,
	existingChannelId?: string | null,
): Promise<string | null> {
	const result = await ensurePersonalChannel(
		token,
		config,
		guildId,
		discordUserId,
		playerName,
		existingChannelId,
	);
	if (!result.ok) {
		console.error('Personal channel setup failed:', result.error);
		return null;
	}
	return result.channelId;
}

export async function applyDiplomacyForAlliance(
	env: Env,
	token: string,
	config: GuildConfig,
	guildId: string,
	allianceTag: string,
): Promise<string | null> {
	if (config.mode !== 'multi_alliance' || !diplomacyChannelsEnabled(config) || !allianceTag) {
		return null;
	}
	const result = await ensureDiplomacyChannel(token, config, guildId, allianceTag);
	if (!result.ok) {
		console.error('Diplomacy channel setup failed:', result.error);
		return null;
	}
	if (result.created || !config.diplomacy_channel_map[result.tag]) {
		const nextMap = { ...config.diplomacy_channel_map, [result.tag]: result.channelId };
		await upsertGuildConfig(env.STFC_DB, {
			guild_id: guildId,
			diplomacy_channel_map: nextMap,
		});
		config.diplomacy_channel_map = nextMap;
	}
	return result.channelId;
}

export function nicknameForPlayer(config: GuildConfig, player: PlayerData): string {
	return buildMemberNickname(config.nickname_template, config.mode, {
		name: player.name,
		allianceTag: player.allianceTag,
		rank: player.rank,
	});
}

/**
 * Grant full Discord access for an already-verified player (after agreement accept).
 * Active → member roles + nick + channels; guest → guest role only.
 */
export async function grantFullAccessForVerifiedPlayer(
	env: Env,
	config: GuildConfig,
	guildId: string,
	discordUserId: string,
	record: VerifiedPlayer,
): Promise<{ message: string; auditNotes: string[] }> {
	const token = env.DISCORD_BOT_TOKEN;
	const locale = resolveLocale(record.preferred_locale);
	if (!token) {
		return { message: t(locale, 'agree.result.access_failed'), auditNotes: [] };
	}

	const auditNotes: string[] = ['Agreement accepted'];

	if (record.verification_status === 'guest') {
		const roleChanges = await applyGuestRole(token, config, guildId, discordUserId);
		auditNotes.push(formatRoleChangeNote(roleChanges));
		return { message: t(locale, 'agree.result.guest_ok'), auditNotes };
	}

	if (record.verification_status !== 'active') {
		return { message: t(locale, 'agree.result.continue_verify'), auditNotes };
	}

	let player: PlayerData | null = null;
	if (record.player_id) {
		player = await findPlayerByIdOrName(record.player_id, config.stfc_server, config.stfc_region);
	}
	const rank = player?.rank ?? record.alliance_rank ?? undefined;
	const name = player?.name ?? record.player_name ?? 'Unknown';
	const allianceTag = player?.allianceTag ?? record.alliance_tag ?? '';

	const roleChanges = await applyMemberRoles(token, config, guildId, discordUserId, rank);
	auditNotes.push(formatRoleChangeNote(roleChanges));

	if (player) {
		try {
			const nick = nicknameForPlayer(config, player);
			await setGuildMemberNickname(token, guildId, discordUserId, nick);
			auditNotes.push(`Nick: ${nick}`);
		} catch (err) {
			console.error('Nickname after agreement failed:', err);
			auditNotes.push('Nick failed');
		}
	}

	const existing = await getVerifiedPlayer(env.STFC_DB, guildId, discordUserId);
	const channelId = await applyPersonalChannelForMember(
		token,
		config,
		guildId,
		discordUserId,
		name,
		existing?.personal_channel_id,
	);
	if (channelId) {
		await upsertVerifiedPlayer(env.STFC_DB, {
			guild_id: guildId,
			discord_user_id: discordUserId,
			personal_channel_id: channelId,
		});
		auditNotes.push(`Channel <#${channelId}>`);
	}

	if (allianceTag) {
		const diplomacyId = await applyDiplomacyForAlliance(env, token, config, guildId, allianceTag);
		if (diplomacyId) auditNotes.push(`Diplomacy <#${diplomacyId}>`);
	}

	return {
		message: t(locale, 'agree.result.access_granted', { name }),
		auditNotes,
	};
}

export function formatDiscordApiFailure(err: unknown): string {
	if (err instanceof DiscordApiError) {
		const bodySnippet =
			typeof err.body === 'string' && err.body.trim()
				? `\n${err.body.trim().slice(0, 250)}${err.body.trim().length > 250 ? '…' : ''}`
				: '';
		return `${err.message} (HTTP ${err.status})${bodySnippet}`;
	}
	return err instanceof Error ? err.message : 'unknown error';
}
