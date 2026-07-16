/**
 * Discord role/channel access after stfc.pro verification.
 * Kept separate from agreement.ts to avoid circular imports.
 */
import {
	addGuildMemberRole,
	botCanManageMember,
	DiscordApiError,
	getGuildChannel,
	getGuildMember,
	loadBotManageContext,
	openUserDmChannel,
	patchGuildChannel,
	removeGuildMemberRole,
	sendMessageWithComponents,
	setGuildMemberNickname,
	updateMessageResponse,
	type BotManageContext,
} from './discord-api';
import { getVerifiedPlayer, upsertGuildConfig, upsertVerifiedPlayer, getGuildConfig } from './guild-db';
import { ensurePersonalChannel } from './personal-channels';
import { ensureDiplomacyChannel, diplomacyChannelsEnabled } from './diplomacy-channels';
import { buildMemberNickname, normalizeAllianceRank } from './nickname-utils';
import { resolveLocale, t } from './i18n';
import { AuditColor, postAuditLog } from './audit-log';
import { opsLevelToGrade } from './grade-utils';
import type { GuildConfig, PlayerData, VerifiedPlayer } from './types';
import { findPlayerByIdOrName } from './stfc-utils';
import { isDeployTesting, shouldSkipOutboundDm } from './deploy-mode';

export type DemoteReason = 'alliance_mismatch' | 'player_missing' | 'admin' | 'unverified_bulk';

export const VERIFY_RESTART_CUSTOM_ID_PREFIX = 'verify:restart:';

export function verifyRestartCustomId(guildId: string): string {
	return `${VERIFY_RESTART_CUSTOM_ID_PREFIX}${guildId}`;
}

export function parseVerifyRestartCustomId(customId: string): string | null {
	if (!customId.startsWith(VERIFY_RESTART_CUSTOM_ID_PREFIX)) return null;
	const guildId = customId.slice(VERIFY_RESTART_CUSTOM_ID_PREFIX.length);
	return /^\d{15,20}$/.test(guildId) ? guildId : null;
}

/** Multi-alliance always matches; single-alliance requires non-empty tag equal to config.alliance_tag. */
export function playerMatchesGuildAlliance(
	config: Pick<GuildConfig, 'mode' | 'alliance_tag'>,
	allianceTag: string | null | undefined,
): boolean {
	if (config.mode === 'multi_alliance') return true;
	const tag = (allianceTag ?? '').trim();
	return Boolean(
		config.alliance_tag && tag && tag.toUpperCase() === config.alliance_tag.toUpperCase(),
	);
}

export interface DemoteToGuestOptions {
	reason: DemoteReason;
	/** When set, refresh linked player fields on an existing verified_players row. */
	player?: PlayerData | null;
	actorId?: string | null;
	source?: 'automated' | 'admin' | 'member' | 'cron' | 'system';
	skipAudit?: boolean;
	/**
	 * When true (admin / bulk demote), fail if guest_role_id is not configured.
	 * Cron mismatch demotions still strip member roles even without a guest role.
	 */
	requireGuestRole?: boolean;
}

export interface DemoteToGuestResult {
	ok: boolean;
	error?: string;
	roleChanges?: RoleChangeResult;
	channelArchived: boolean;
	hadVerifiedRow: boolean;
	notes: string[];
}

/** Move a personal channel into the configured archive category (no-op if unset / already there). */
export async function archivePersonalChannelOnDemotion(
	token: string,
	config: GuildConfig,
	channelId: string | null | undefined,
): Promise<boolean> {
	const archiveId = config.personal_channel_archive_category_id?.trim();
	if (!channelId || !archiveId || !/^\d{15,20}$/.test(archiveId)) return false;
	try {
		const ch = await getGuildChannel(token, channelId);
		if (!ch || ch.parent_id === archiveId) return false;
		await patchGuildChannel(token, channelId, { parent_id: archiveId });
		return true;
	} catch (error) {
		console.error('Archive personal channel on demotion failed:', error);
		return false;
	}
}

/**
 * Demote a Discord member to guest: strip managed member/rank/overlay roles, assign guest_role,
 * set verification_status=guest when a linked row exists, optionally archive personal channel.
 * Never-verified users: roles only (no new verified_players row).
 */
export async function demotePlayerToGuest(
	env: Env,
	config: GuildConfig,
	guildId: string,
	discordUserId: string,
	opts: DemoteToGuestOptions,
): Promise<DemoteToGuestResult> {
	const notes: string[] = [];
	const requireGuest =
		opts.requireGuestRole === true ||
		opts.reason === 'admin' ||
		opts.reason === 'unverified_bulk';

	if (requireGuest && (!config.guest_role_id || !/^\d{15,20}$/.test(config.guest_role_id))) {
		return {
			ok: false,
			error: 'guest_role is not configured. Set it with `/server setup guest_role:…`.',
			channelArchived: false,
			hadVerifiedRow: false,
			notes,
		};
	}

	if (isDeployTesting(config)) {
		return {
			ok: false,
			error:
				'Deploy mode is **testing** — demotions are blocked. Switch with `/server deploy mode:live` when ready.',
			channelArchived: false,
			hadVerifiedRow: false,
			notes: ['skipped: deploy_mode=testing'],
		};
	}

	if (!env.DISCORD_BOT_TOKEN) {
		return {
			ok: false,
			error: 'DISCORD_BOT_TOKEN not configured.',
			channelArchived: false,
			hadVerifiedRow: false,
			notes,
		};
	}

	const token = env.DISCORD_BOT_TOKEN;
	const existing = await getVerifiedPlayer(env.STFC_DB, guildId, discordUserId);
	const hadVerifiedRow = Boolean(existing);
	const wasAlreadyGuest = existing?.verification_status === 'guest';

	if (existing) {
		const player = opts.player;
		const now = new Date().toISOString();
		await upsertVerifiedPlayer(env.STFC_DB, {
			guild_id: guildId,
			discord_user_id: discordUserId,
			verification_status: 'guest',
			...(player
				? {
						player_name: player.name,
						alliance_tag: player.allianceTag || null,
						alliance_rank: player.rank || null,
						ops_level: player.level,
						power: player.power,
						grade: opsLevelToGrade(player.level),
						last_synced_at: now,
					}
				: {}),
		});
		notes.push('status → guest');
		if (player?.allianceTag != null) {
			notes.push(`alliance ${existing.alliance_tag ?? '—'} → ${player.allianceTag || '(none)'}`);
		}
	}

	let roleChanges: RoleChangeResult | undefined;
	let channelArchived = false;
	try {
		roleChanges = await applyGuestRole(token, config, guildId, discordUserId);
		notes.push(formatRoleChangeNote(roleChanges));

		channelArchived = await archivePersonalChannelOnDemotion(
			token,
			config,
			existing?.personal_channel_id,
		);
		if (channelArchived && existing?.personal_channel_id) {
			notes.push(`channel archived <#${existing.personal_channel_id}>`);
		}
	} catch (error) {
		console.error('Demote Discord access update failed:', error);
		return {
			ok: false,
			error: formatDiscordApiFailure(error),
			roleChanges,
			channelArchived,
			hadVerifiedRow,
			notes,
		};
	}

	if (
		!wasAlreadyGuest &&
		hadVerifiedRow &&
		config.mode === 'single_alliance' &&
		opts.reason !== 'unverified_bulk'
	) {
		try {
			await sendGuestDemotionDm(token, config, discordUserId, existing, opts.reason);
			notes.push('demotion DM sent');
		} catch (error) {
			console.error('Guest demotion DM failed:', error);
			notes.push('demotion DM failed');
		}
	}

	if (!opts.skipAudit) {
		const reasonLabel =
			opts.reason === 'alliance_mismatch'
				? 'Alliance mismatch'
				: opts.reason === 'player_missing'
					? 'Player missing on stfc.pro'
					: opts.reason === 'unverified_bulk'
						? 'Bulk demote unverified'
						: 'Admin demote';
		await postAuditLog(env, config, {
			title: 'Demoted to guest',
			description: `<@${discordUserId}>` +
				(existing?.player_name ? ` **${existing.player_name}**` : '') +
				(opts.player?.name && opts.player.name !== existing?.player_name
					? ` → **${opts.player.name}**`
					: ''),
			actorId: opts.actorId,
			source: opts.source ?? (opts.reason === 'admin' || opts.reason === 'unverified_bulk' ? 'admin' : 'cron'),
			color: AuditColor.warn,
			fields: [
				{ name: 'Reason', value: reasonLabel, inline: true },
				{ name: 'Changes', value: notes.join('\n').slice(0, 1000) || '—', inline: false },
			],
		});
	}

	return {
		ok: true,
		roleChanges,
		channelArchived,
		hadVerifiedRow,
		notes,
	};
}

export async function sendGuestDemotionDm(
	token: string,
	config: GuildConfig,
	discordUserId: string,
	existing: Pick<VerifiedPlayer, 'preferred_locale'> | null,
	reason: DemoteReason,
	opts?: { preview?: boolean },
): Promise<void> {
	// Production demotion DMs blocked in testing; `/test-dm` uses preview: true.
	if (shouldSkipOutboundDm(config) && !opts?.preview) {
		return;
	}
	const locale = resolveLocale(existing?.preferred_locale);
	const tag = (config.alliance_tag ?? '').trim() || '—';
	const body =
		reason === 'player_missing'
			? t(locale, 'verify.demote.dm.missing')
			: t(locale, 'verify.demote.dm.mismatch', { tag });
	const content = opts?.preview
		? `*[Admin preview — verification status is not changed by sending this.]*\n\n${body}\n\n_Preview: the button below does not restart verification._`
		: body;

	const channelId = await openUserDmChannel(token, discordUserId);
	const customId = opts?.preview
		? `verify:restart-preview:${config.guild_id}`
		: verifyRestartCustomId(config.guild_id);
	await sendMessageWithComponents(token, channelId, {
		content,
		components: [
			{
				type: 1,
				components: [
					{
						type: 2,
						style: 1,
						label: t(locale, 'verify.demote.btn.restart').slice(0, 80),
						custom_id: customId,
					},
				],
			},
		],
	});
}

/** Button from guest demotion DM — set pending_screenshot so Gateway accepts screenshot + link. */
export async function handleVerifyRestartComponent(
	env: Env,
	interaction: {
		member?: { user?: { id: string } };
		user?: { id: string };
		data?: { custom_id?: string };
	},
): Promise<Response> {
	const customId = interaction.data?.custom_id ?? '';
	const guildId = parseVerifyRestartCustomId(customId);
	if (!guildId) {
		return updateMessageResponse('❌ Unknown button.');
	}

	const userId = interaction.member?.user?.id ?? interaction.user?.id;
	if (!userId) {
		return updateMessageResponse('❌ Could not resolve user.');
	}

	const player = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
	const locale = resolveLocale(player?.preferred_locale);
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return updateMessageResponse(t(locale, 'verify.demote.restart_failed'), { components: [] });
	}

	try {
		await upsertVerifiedPlayer(env.STFC_DB, {
			guild_id: guildId,
			discord_user_id: userId,
			verification_status: 'pending_screenshot',
		});
		return updateMessageResponse(t(locale, 'verify.demote.restarted'), { components: [] });
	} catch (error) {
		console.error('Verify restart from demotion DM failed:', error);
		return updateMessageResponse(t(locale, 'verify.demote.restart_failed'), { components: [] });
	}
}

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
	const desired = new Set(
		getMemberRoleIdsForRank(config, playerRank).filter((id) => /^\d{15,20}$/.test(id)),
	);
	const managed = getAllMemberRoleIds(config).filter((id) => /^\d{15,20}$/.test(id));
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
		try {
			await addGuildMemberRole(token, guildId, userId, roleId);
			added.push(roleId);
			current.add(roleId);
		} catch (err) {
			// Hierarchy / owner / missing Manage Roles — keep going (bulk backfill must not stall).
			console.warn(`Failed to add role ${roleId} to ${userId}:`, err);
		}
	}

	// Drop managed rank/overlay roles that no longer apply (e.g. unaffiliated → no Premier).
	for (const roleId of managed) {
		if (desired.has(roleId) || !current.has(roleId)) continue;
		try {
			await removeGuildMemberRole(token, guildId, userId, roleId);
			removed.push(roleId);
			current.delete(roleId);
		} catch (err) {
			console.warn(`Failed to remove role ${roleId} from ${userId}:`, err);
		}
	}

	if (config.guest_role_id && /^\d{15,20}$/.test(config.guest_role_id) && current.has(config.guest_role_id)) {
		try {
			await removeGuildMemberRole(token, guildId, userId, config.guest_role_id);
			removed.push(config.guest_role_id);
		} catch (err) {
			console.warn(`Failed to remove guest role from ${userId}:`, err);
		}
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
			try {
				await addGuildMemberRole(token, guildId, userId, config.guest_role_id);
				added.push(config.guest_role_id);
				current.add(config.guest_role_id);
			} catch (err) {
				const hint =
					err instanceof DiscordApiError && (err.status === 403 || err.status === 500)
						? ' Check that the bot’s highest role is **above** the guest role in Server Settings → Roles.'
						: '';
				throw new Error(`Failed to assign guest role <@&${config.guest_role_id}>.${hint} ${formatDiscordApiFailure(err)}`);
			}
		}
	}

	const memberRoleIds = getAllMemberRoleIds(config).filter((id) => /^\d{15,20}$/.test(id));
	for (const roleId of memberRoleIds) {
		if (!current.has(roleId)) continue;
		try {
			await removeGuildMemberRole(token, guildId, userId, roleId);
			removed.push(roleId);
		} catch (err) {
			// Hierarchy / missing perms — keep going so one sticky role doesn't abort demotion.
			console.warn(`Failed to remove role ${roleId} from ${userId}:`, err);
		}
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
): Promise<{ channelId: string; created: boolean; moved: boolean; renamed: boolean } | null> {
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
	return {
		channelId: result.channelId,
		created: result.created,
		moved: result.moved,
		renamed: result.renamed,
	};
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
	}, { displayRanks: config.nickname_display_ranks });
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
	opts?: {
		/** Skip stfc.pro re-fetch (use D1 snapshot). Important for bulk admin backfill. */
		skipStfcLookup?: boolean;
		/** Skip welcome DM (bulk backfill / quarantine-safe). */
		skipWelcomeDm?: boolean;
		/** Skip personal-channel ensure when they already have one. */
		skipPersonalChannelIfExists?: boolean;
		/** Preloaded hierarchy context for bulk jobs. */
		manageContext?: BotManageContext;
	},
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
	if (!opts?.skipStfcLookup && record.player_id) {
		player = await findPlayerByIdOrName(env, record.player_id, config.stfc_server, config.stfc_region);
	}
	const rank = player?.rank ?? record.alliance_rank ?? undefined;
	const name = player?.name ?? record.player_name ?? 'Unknown';
	const allianceTag = player?.allianceTag ?? record.alliance_tag ?? '';

	const manage = await botCanManageMember(
		token,
		guildId,
		discordUserId,
		opts?.manageContext,
	);
	if (!manage.manageable) {
		auditNotes.push(`Discord roles/nick skipped (${manage.reason}) — stamp CoC only`);
		// Still ensure personal channel when possible (does not require managing the member).
		const existing = await getVerifiedPlayer(env.STFC_DB, guildId, discordUserId);
		const existingChannelId = existing?.personal_channel_id ?? record.personal_channel_id ?? null;
		if (!(opts?.skipPersonalChannelIfExists && existingChannelId)) {
			const channelResult = await applyPersonalChannelForMember(
				token,
				config,
				guildId,
				discordUserId,
				name,
				existingChannelId,
			);
			if (channelResult) {
				await upsertVerifiedPlayer(env.STFC_DB, {
					guild_id: guildId,
					discord_user_id: discordUserId,
					personal_channel_id: channelResult.channelId,
				});
				auditNotes.push(`Channel <#${channelResult.channelId}>`);
			}
		} else if (existingChannelId) {
			auditNotes.push(`Channel <#${existingChannelId}> (kept)`);
		}
		return {
			message: t(locale, 'agree.result.access_granted', { name }) + ` _(roles skipped: ${manage.reason})_`,
			auditNotes,
		};
	}

	try {
		const roleChanges = await applyMemberRoles(token, config, guildId, discordUserId, rank);
		auditNotes.push(formatRoleChangeNote(roleChanges));
	} catch (err) {
		console.error('Member roles after agreement failed:', err);
		auditNotes.push(`Roles failed: ${formatDiscordApiFailure(err)}`);
	}

	try {
		const nickSource: PlayerData =
			player ??
			({
				playerId: record.player_id ?? 0,
				name,
				rank: rank ?? '',
				helps: '',
				rss: '',
				power: record.power ?? 0,
				iso: '',
				joinDate: '',
				allianceId: '',
				allianceTag,
				server: config.stfc_server,
				region: config.stfc_region,
				level: record.ops_level ?? 0,
			} satisfies PlayerData);
		const nick = nicknameForPlayer(config, nickSource);
		await setGuildMemberNickname(token, guildId, discordUserId, nick);
		auditNotes.push(`Nick: ${nick}`);
	} catch (err) {
		console.error('Nickname after agreement failed:', err);
		auditNotes.push('Nick failed (hierarchy/owner?)');
	}

	const existing = await getVerifiedPlayer(env.STFC_DB, guildId, discordUserId);
	let channelResult: { channelId: string; created: boolean; moved: boolean; renamed: boolean } | null =
		null;
	const existingChannelId = existing?.personal_channel_id ?? record.personal_channel_id ?? null;
	if (opts?.skipPersonalChannelIfExists && existingChannelId) {
		auditNotes.push(`Channel <#${existingChannelId}> (kept)`);
	} else {
		channelResult = await applyPersonalChannelForMember(
			token,
			config,
			guildId,
			discordUserId,
			name,
			existingChannelId,
		);
		if (channelResult) {
			await upsertVerifiedPlayer(env.STFC_DB, {
				guild_id: guildId,
				discord_user_id: discordUserId,
				personal_channel_id: channelResult.channelId,
			});
			auditNotes.push(`Channel <#${channelResult.channelId}>`);
		}
	}

	if (allianceTag) {
		try {
			const diplomacyId = await applyDiplomacyForAlliance(env, token, config, guildId, allianceTag);
			if (diplomacyId) auditNotes.push(`Diplomacy <#${diplomacyId}>`);
		} catch (err) {
			console.error('Diplomacy after agreement failed:', err);
			auditNotes.push('Diplomacy failed');
		}
	}

	const personalChannelId =
		channelResult?.channelId ?? existing?.personal_channel_id ?? record.personal_channel_id ?? null;
	if (!opts?.skipWelcomeDm) {
		const { sendWelcomeDmIfNeeded } = await import('./welcome-dm');
		const welcome = await sendWelcomeDmIfNeeded(
			env,
			config,
			guildId,
			discordUserId,
			personalChannelId,
		);
		if (welcome.note) auditNotes.push(welcome.note);
	} else {
		auditNotes.push('welcome DM skipped (bulk)');
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
