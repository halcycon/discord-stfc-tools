import { verifyKey } from 'discord-interactions';
import {
	deferredResponse,
	editInteractionResponse,
	interactionResponse,
	listGuildRoles,
	listGuildChannels,
	createGuildRole,
} from './discord-api';
import {
	getGuildConfig,
	upsertGuildConfig,
	recordGuildMember,
	markMemberInvited,
	resetVerification,
	upsertVerifiedPlayer,
	findVerifiedPlayersForLink,
} from './guild-db';
import { findPlayerByIdOrName, formatPlayerSummary } from './stfc-utils';
import { inviteNewMember, processVerification } from './verification';
import { requireGuildAdmin, resolveTargetUserId } from './discord-admin';
import { getDiscordGatewayStatus } from './discord-gateway/wake';
import { parseCSV, autoGenerateColumns, generateAsciiTable } from './tableUtils';
import {
	handleCoordinateLookup,
	parseCoordinateLink,
	parseMultipleCoordinates,
} from './systemUtils';
import type { GuildMode, StfcRegion, GuildConfig } from './types';
import { parseCategoryMapInput, formatCategoryMap, personalChannelsEnabled } from './channel-utils';
import { linkExistingPersonalChannel } from './personal-channels';
import { defaultNicknameTemplate } from './nickname-utils';
import { createVerificationLogChannel } from './verification-log';
import {
	diplomacyChannelsEnabled,
	ensureDiplomacyChannel,
	formatDiplomacyChannelMap,
	linkDiplomacyChannel,
} from './diplomacy-channels';

function getOptionValue(options: Array<{ name: string; value?: unknown }> | undefined, name: string): unknown {
	return options?.find((opt) => opt.name === name)?.value;
}

type RoleToken =
	| { type: 'id'; id: string }
	| { type: 'name'; name: string };

function parseRoleToken(raw: unknown): RoleToken | null {
	const s = typeof raw === 'string' ? raw.trim() : raw === undefined || raw === null ? '' : String(raw).trim();
	if (!s) return null;

	const mentionMatch = s.match(/^<@&(\d{15,20})>$/);
	if (mentionMatch) return { type: 'id', id: mentionMatch[1] };

	if (/^\d{15,20}$/.test(s)) return { type: 'id', id: s };

	// Treat everything else as a role name.
	return { type: 'name', name: s };
}

function parseRoleTokensCsv(raw: unknown): RoleToken[] {
	if (!raw) return [];
	const s = typeof raw === 'string' ? raw : String(raw);
	if (!s.trim()) return [];
	return s
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean)
		.map((t) => parseRoleToken(t))
		.filter((t): t is RoleToken => Boolean(t));
}

type StoredRoleRef = { id: string; name?: string };

type ResolvedRoles = {
	ids: string[];
	names: string[];
	renamed: Array<{ configuredName: string; currentDiscordName: string; id: string }>;
};

function bucketStoredRefs(bucket?: { role_ids: string[]; role_names?: string[] }): StoredRoleRef[] {
	if (!bucket) return [];
	return bucket.role_ids.map((id, index) => ({
		id,
		name: bucket.role_names?.[index],
	}));
}

async function resolveRoleTokensToIds(
	env: Env,
	guildId: string,
	tokens: RoleToken[],
	createIfMissing: boolean,
	previouslyStored: StoredRoleRef[] = [],
): Promise<ResolvedRoles> {
	if (tokens.length === 0) {
		return { ids: [], names: [], renamed: [] };
	}

	const allIds = tokens.filter((t) => t.type === 'id') as Array<{ type: 'id'; id: string }>;
	const allNames = tokens.filter((t) => t.type === 'name') as Array<{ type: 'name'; name: string }>;

	// Fast path: snowflakes/mentions only — no Discord API calls needed.
	if (allNames.length === 0 && previouslyStored.length === 0) {
		const ids = Array.from(
			new Set(
				allIds
					.map((t) => t.id)
					.filter((id) => /^\d{15,20}$/.test(id)),
			),
		);
		return { ids, names: ids.map(() => ''), renamed: [] };
	}

	if (!env.DISCORD_BOT_TOKEN) {
		throw new Error('DISCORD_BOT_TOKEN not configured (required to resolve role names). Provide role IDs/mentions instead.');
	}

	const token = env.DISCORD_BOT_TOKEN;
	const roles = await listGuildRoles(token, guildId);
	const nameToId = new Map<string, string>();
	const idToName = new Map<string, string>();
	for (const role of roles) {
		const key = role.name.toLowerCase();
		if (!nameToId.has(key)) nameToId.set(key, role.id);
		idToName.set(role.id, role.name);
	}

	const storedByConfiguredName = new Map<string, string>();
	for (const ref of previouslyStored) {
		if (!ref.name || !/^\d{15,20}$/.test(ref.id)) continue;
		const key = ref.name.toLowerCase();
		if (!storedByConfiguredName.has(key)) storedByConfiguredName.set(key, ref.id);
	}

	const validStoredIds = new Set(
		previouslyStored.map((ref) => ref.id).filter((id) => /^\d{15,20}$/.test(id) && idToName.has(id)),
	);

	const out: string[] = [];
	const names: string[] = [];
	const outSet = new Set<string>();
	const renamed: ResolvedRoles['renamed'] = [];

	for (const t of tokens) {
		if (t.type === 'id') {
			if (/^\d{15,20}$/.test(t.id) && !outSet.has(t.id)) {
				outSet.add(t.id);
				out.push(t.id);
				names.push(idToName.get(t.id) ?? '');
			}
			continue;
		}

		const key = t.name.toLowerCase();
		const existingId = nameToId.get(key);
		if (existingId) {
			if (!outSet.has(existingId)) {
				outSet.add(existingId);
				out.push(existingId);
				names.push(t.name);
			}
			continue;
		}

		// Configured name no longer exists in Discord — reuse stored snowflake if it still exists.
		const storedId = storedByConfiguredName.get(key);
		if (storedId && validStoredIds.has(storedId) && !outSet.has(storedId)) {
			const currentDiscordName = idToName.get(storedId)!;
			outSet.add(storedId);
			out.push(storedId);
			names.push(t.name);
			if (currentDiscordName.toLowerCase() !== key) {
				renamed.push({
					configuredName: t.name,
					currentDiscordName,
					id: storedId,
				});
			}
			continue;
		}

		if (!createIfMissing) {
			throw new Error(`Role not found: "${t.name}". Enable role creation or provide a role ID/mention.`);
		}

		const created = await createGuildRole(token, guildId, t.name);
		nameToId.set(key, created.id);
		idToName.set(created.id, created.name);
		validStoredIds.add(created.id);
		if (!outSet.has(created.id)) {
			outSet.add(created.id);
			out.push(created.id);
			names.push(t.name);
		}
	}

	return { ids: out, names, renamed };
}

type AllianceRankKey = 'Operative' | 'Agent' | 'Premier' | 'Commodore' | 'Admiral';

function normalizeAllianceRank(rank: string | undefined): AllianceRankKey | null {
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

async function handlePlayerCommand(
	env: Env,
	ctx: ExecutionContext,
	interaction: { token: string; application_id?: string; guild_id?: string },
	data: { options?: Array<{ name: string; value?: unknown }> },
): Promise<Response> {
	const playerName = getOptionValue(data.options, 'name') as string | undefined;
	const guildId = interaction.guild_id;

	if (!playerName) {
		return interactionResponse('Please provide a player name or ID.', true);
	}

	const config = guildId ? await getGuildConfig(env.STFC_DB, guildId) : null;
	const server = config?.stfc_server;
	const region = config?.stfc_region ?? 'US';

	if (!server) {
		return interactionResponse(
			'❌ No STFC server configured for this Discord server. An admin must run `/server setup` first.',
			true,
		);
	}

	const appId = interaction.application_id ?? env.DISCORD_APPLICATION_ID;
	if (!appId) {
		return interactionResponse('❌ DISCORD_APPLICATION_ID not configured.', true);
	}

	const deferred = deferredResponse();

	ctx.waitUntil(
		(async () => {
			try {
				const searchTerm = /^\d+$/.test(playerName) ? parseInt(playerName, 10) : playerName;
				const player = await findPlayerByIdOrName(searchTerm, server, region);
				const content = player
					? `🔍 **Player lookup**\n\n${formatPlayerSummary(player)}`
					: `❌ No player found matching "${playerName}" on server ${server} (${region}).`;
				await editInteractionResponse(appId, interaction.token, content, true);
			} catch (error) {
				await editInteractionResponse(
					appId,
					interaction.token,
					`❌ Lookup failed: ${error instanceof Error ? error.message : 'unknown error'}`,
					true,
				);
			}
		})(),
	);

	return deferred;
}

async function handleVerifyCommand(
	env: Env,
	ctx: ExecutionContext,
	interaction: { guild_id?: string; member?: { user?: { id: string } }; token: string; application_id?: string },
	data: { options?: Array<{ name: string; value?: unknown }>; resolved?: { attachments?: Record<string, { url: string; filename?: string }> } },
): Promise<Response> {
	const guildId = interaction.guild_id;
	const userId = interaction.member?.user?.id;

	if (!guildId || !userId) {
		return interactionResponse('❌ Verification must be run inside a configured Discord server.', true);
	}

	const link = getOptionValue(data.options, 'link') as string | undefined;
	if (!link) {
		return interactionResponse('Please provide your stfc.pro profile link.', true);
	}

	let screenshotUrl: string | undefined;
	const screenshotOption = data.options?.find((opt) => opt.name === 'screenshot');
	if (screenshotOption?.value && data.resolved?.attachments) {
		const attachment = data.resolved.attachments[String(screenshotOption.value)];
		if (attachment?.url) screenshotUrl = attachment.url;
	}

	const appId = interaction.application_id ?? env.DISCORD_APPLICATION_ID;
	if (!appId) {
		return interactionResponse('❌ DISCORD_APPLICATION_ID not configured.', true);
	}

	const deferred = deferredResponse();

	ctx.waitUntil(
		(async () => {
			const result = await processVerification(env, guildId, userId, link, screenshotUrl);
			await editInteractionResponse(appId, interaction.token, result, true);
		})(),
	);

	return deferred;
}

async function handleServerSetupCommand(
	env: Env,
	interaction: { guild_id?: string; member?: { permissions?: string } },
	data: { options?: Array<{ name: string; value?: unknown }> },
): Promise<Response> {
	const guildId = interaction.guild_id;
	if (!guildId) {
		return interactionResponse('❌ This command must be run in a server.', true);
	}

	const permissions = BigInt(interaction.member?.permissions ?? '0');
	if ((permissions & 0x8n) === 0n) {
		return interactionResponse('❌ You need Administrator permission to configure the server.', true);
	}

	const mode = (getOptionValue(data.options, 'mode') as GuildMode | undefined) ?? 'single_alliance';
	const server = getOptionValue(data.options, 'server') as number | undefined;
	const region = (getOptionValue(data.options, 'region') as StfcRegion | undefined) ?? 'US';
	const allianceTag = getOptionValue(data.options, 'alliance_tag') as string | undefined;
	const createMissingRolesRaw = getOptionValue(data.options, 'create_missing_roles');
	const createMissingRoles = createMissingRolesRaw === true || createMissingRolesRaw === 'true';
	const nicknameTemplateRaw = getOptionValue(data.options, 'nickname_template');
	const nicknameTemplateProvided = nicknameTemplateRaw !== undefined && nicknameTemplateRaw !== null;

	const guestRoleToken = parseRoleToken(getOptionValue(data.options, 'guest_role'));
	const memberRoleTokens = parseRoleTokensCsv(getOptionValue(data.options, 'member_roles'));
	const operativeRoleTokens = parseRoleTokensCsv(getOptionValue(data.options, 'operative_roles'));
	const agentRoleTokens = parseRoleTokensCsv(getOptionValue(data.options, 'agent_roles'));
	const premierRoleTokens = parseRoleTokensCsv(getOptionValue(data.options, 'premier_roles'));
	const commodoreRoleTokens = parseRoleTokensCsv(getOptionValue(data.options, 'commodore_roles'));
	const admiralRoleTokens = parseRoleTokensCsv(getOptionValue(data.options, 'admiral_roles'));

	if (!server) {
		return interactionResponse('❌ `server` is required (your STFC server number).', true);
	}

	if (mode === 'single_alliance' && !allianceTag) {
		return interactionResponse('❌ `alliance_tag` is required for single-alliance mode.', true);
	}

	try {
		const existingConfig = await getGuildConfig(env.STFC_DB, guildId);

		const resolvedGuest = guestRoleToken
			? await resolveRoleTokensToIds(
					env,
					guildId,
					[guestRoleToken],
					createMissingRoles,
					existingConfig?.guest_role_id ? [{ id: existingConfig.guest_role_id }] : [],
				)
			: { ids: [], names: [], renamed: [] };

		const guestRoleId = resolvedGuest.ids[0] ?? null;

		const memberRoles = await resolveRoleTokensToIds(
			env,
			guildId,
			memberRoleTokens,
			createMissingRoles,
			existingConfig?.member_role_ids.map((id) => ({ id })) ?? [],
		);
		const operativeRoles = await resolveRoleTokensToIds(
			env,
			guildId,
			operativeRoleTokens,
			createMissingRoles,
			existingConfig?.operative_role_ids.map((id) => ({ id })) ?? [],
		);
		const agentRoles = await resolveRoleTokensToIds(
			env,
			guildId,
			agentRoleTokens,
			createMissingRoles,
			existingConfig?.agent_role_ids.map((id) => ({ id })) ?? [],
		);
		const premierRoles = await resolveRoleTokensToIds(
			env,
			guildId,
			premierRoleTokens,
			createMissingRoles,
			existingConfig?.premier_role_ids.map((id) => ({ id })) ?? [],
		);
		const commodoreRoles = await resolveRoleTokensToIds(
			env,
			guildId,
			commodoreRoleTokens,
			createMissingRoles,
			existingConfig?.commodore_role_ids.map((id) => ({ id })) ?? [],
		);
		const admiralRoles = await resolveRoleTokensToIds(
			env,
			guildId,
			admiralRoleTokens,
			createMissingRoles,
			existingConfig?.admiral_role_ids.map((id) => ({ id })) ?? [],
		);

		const memberRoleIds = memberRoles.ids;
		const operativeRoleIds = operativeRoles.ids;
		const agentRoleIds = agentRoles.ids;
		const premierRoleIds = premierRoles.ids;
		const commodoreRoleIds = commodoreRoles.ids;
		const admiralRoleIds = admiralRoles.ids;

		await upsertGuildConfig(env.STFC_DB, {
			guild_id: guildId,
			mode,
			stfc_server: server,
			stfc_region: region,
			alliance_tag: allianceTag ?? null,
			guest_role_id: guestRoleId,
			member_role_ids: memberRoleIds,
			operative_role_ids: operativeRoleIds,
			agent_role_ids: agentRoleIds,
			premier_role_ids: premierRoleIds,
			commodore_role_ids: commodoreRoleIds,
			admiral_role_ids: admiralRoleIds,
			verification_enabled: true,
			...(nicknameTemplateProvided
				? { nickname_template: String(nicknameTemplateRaw).trim() || null }
				: {}),
		});

		const effectiveNick =
			nicknameTemplateProvided
				? String(nicknameTemplateRaw).trim() || defaultNicknameTemplate(mode)
				: (existingConfig?.nickname_template?.trim() || defaultNicknameTemplate(mode));

		return interactionResponse(
			`✅ Server configured!\n` +
				`• Mode: **${mode}**\n` +
				`• STFC: server **${server}** (${region})\n` +
				(mode === 'single_alliance' ? `• Alliance tag: **${allianceTag}**\n` : '') +
				`• Nickname template: \`${effectiveNick}\`\n` +
				`• Member roles: ${memberRoleIds.length ? memberRoleIds.join(', ') : 'none yet'}\n` +
				`• Guest role: ${guestRoleId ?? 'not set'}\n` +
				`• Operative/Agent/Premier/Commodore/Admiral roles set: ` +
				`${operativeRoleIds.length}/${agentRoleIds.length}/${premierRoleIds.length}/${commodoreRoleIds.length}/${admiralRoleIds.length}\n\n` +
				`New members will receive a verification DM. They can also run \`/verify\`.\n` +
				`Nickname placeholders: \`{player_name}\` \`{alliance_tag}\` \`{rank}\` \`{rank_prefix}\` \`{rank_paren}\``,
			true,
		);
	} catch (error) {
		return interactionResponse(
			`❌ Role resolution failed: ${error instanceof Error ? error.message : 'unknown error'}`,
			true,
		);
	}
}

async function handleServerStatusCommand(env: Env, guildId: string | undefined): Promise<Response> {
	if (!guildId) {
		return interactionResponse('❌ Run this command inside your server.', true);
	}

	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return interactionResponse('❌ Server not configured. Run `/server setup` first.', true);
	}

	return interactionResponse(
		`📋 **Server configuration**\n` +
			`• Mode: ${config.mode}\n` +
			`• STFC server: ${config.stfc_server} (${config.stfc_region})\n` +
			`• Alliance tag: ${config.alliance_tag ?? '—'}\n` +
			`• Nickname template: \`${config.nickname_template?.trim() || defaultNicknameTemplate(config.mode)}\`` +
			`${config.nickname_template?.trim() ? '' : ' (default)'}\n` +
			`• Verification log: ${config.verification_log_channel_id ? `<#${config.verification_log_channel_id}>` : 'not set'}\n` +
			`• Diplomacy channels: ${diplomacyChannelsEnabled(config) ? 'enabled' : 'disabled'}` +
			(diplomacyChannelsEnabled(config)
				? ` (${formatDiplomacyChannelMap(config.diplomacy_channel_map)})`
				: '') +
			`\n` +
			`• Verification: ${config.verification_enabled ? 'enabled' : 'disabled'}\n` +
			`• Poll interval: ${config.poll_interval_hours}h\n` +
			`• Member roles: ${config.member_role_ids.join(', ') || 'none'}\n` +
			`• Guest role: ${config.guest_role_id ?? 'none'}\n` +
			`• Personal channels: ${personalChannelsEnabled(config) ? 'enabled' : 'disabled'}\n` +
			`• Category map: ${formatCategoryMap(config.channel_category_map)}\n` +
			`• Channel extra roles: ${config.personal_channel_extra_roles.join(', ') || 'none'}`,
		true,
	);
}

async function handleServerRolesCommand(env: Env, interaction: { guild_id?: string; member?: { permissions?: string } }, sub: { options?: Array<{ name: string; value?: unknown }> }): Promise<Response> {
	const adminError = requireGuildAdmin(interaction);
	if (adminError) return adminError;

	const guildId = interaction.guild_id!;
	const limitRaw = getOptionValue(sub.options, 'limit');
	const limit = typeof limitRaw === 'number' ? limitRaw : limitRaw ? parseInt(String(limitRaw), 10) : 20;
	const safeLimit = Number.isFinite(limit) ? Math.max(5, Math.min(50, limit)) : 20;

	if (!env.DISCORD_BOT_TOKEN) return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);

	const roles = await listGuildRoles(env.DISCORD_BOT_TOKEN, guildId);
	const shown = roles.slice(0, safeLimit);

	const lines = shown.map((r) => `• ${r.name} (${r.id})`);
	const more = roles.length > shown.length ? `\n… and ${roles.length - shown.length} more` : '';
	return interactionResponse(`📚 Roles (${roles.length})\n${lines.join('\n')}${more}`, true);
}

async function handleServerBucketCommand(
	env: Env,
	interaction: { guild_id?: string; member?: { permissions?: string } },
	sub: { options?: Array<{ name: string; value?: unknown }> },
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction);
	if (adminError) return adminError;

	const guildId = interaction.guild_id!;

	const bucketName = getOptionValue(sub.options, 'name') as string | undefined;
	const ranksRaw = getOptionValue(sub.options, 'ranks') as string | undefined;
	const roleIdsRaw = getOptionValue(sub.options, 'role_ids') as string | undefined;
	const createIfMissingRaw = getOptionValue(sub.options, 'create_if_missing');
	const createIfMissing = createIfMissingRaw === true || createIfMissingRaw === 'true';

	if (!bucketName) return interactionResponse('❌ `name` is required.', true);
	if (!ranksRaw) return interactionResponse('❌ `ranks` is required.', true);

	const ranks = ranksRaw
		.split(',')
		.map((r) => r.trim())
		.filter(Boolean);

	const overlayUpdateTokens = roleIdsRaw ? parseRoleTokensCsv(roleIdsRaw) : [];

	// Preserve existing overlay buckets.
	const existing = await getGuildConfig(env.STFC_DB, guildId);
	const overlay_buckets = { ...(existing?.overlay_buckets ?? {}) };

	if (!roleIdsRaw || overlayUpdateTokens.length === 0) {
		// Clearing the bucket when no role IDs were supplied.
		delete overlay_buckets[bucketName];
		await upsertGuildConfig(env.STFC_DB, { guild_id: guildId, overlay_buckets });
		return interactionResponse(`✅ Bucket \`${bucketName}\` cleared.`, true);
	}

	try {
		const existingBucket = existing?.overlay_buckets[bucketName];
		const resolved = await resolveRoleTokensToIds(
			env,
			guildId,
			overlayUpdateTokens,
			createIfMissing,
			bucketStoredRefs(existingBucket),
		);
		overlay_buckets[bucketName] = {
			ranks,
			role_ids: resolved.ids,
			role_names: resolved.names,
		};
		await upsertGuildConfig(env.STFC_DB, { guild_id: guildId, overlay_buckets });

		const renameNote =
			resolved.renamed.length > 0
				? `\n• Renamed in Discord: ${resolved.renamed
						.map((r) => `"${r.configuredName}" → "${r.currentDiscordName}" (reused ${r.id})`)
						.join('; ')}`
				: '';

		return interactionResponse(
			`✅ Bucket \`${bucketName}\` updated.\n• Ranks: ${ranks.join(', ')}\n• Roles (${resolved.ids.length}): ${resolved.ids.join(', ')}${renameNote}`,
			true,
		);
	} catch (error) {
		return interactionResponse(
			`❌ Failed to resolve/create roles for bucket \`${bucketName}\`: ${
				error instanceof Error ? error.message : 'unknown error'
			}`,
			true,
		);
	}
}

async function handleServerRankRolesCommand(
	env: Env,
	interaction: { guild_id?: string; member?: { permissions?: string } },
	sub: { options?: Array<{ name: string; value?: unknown }> },
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction);
	if (adminError) return adminError;

	const guildId = interaction.guild_id!;
	const rankRaw = getOptionValue(sub.options, 'rank') as string | undefined;
	if (!rankRaw) return interactionResponse('❌ `rank` is required.', true);

	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) return interactionResponse('❌ Server not configured. Run `/server setup` first.', true);

	const rankKey = normalizeAllianceRank(rankRaw);
	if (!rankKey) {
		return interactionResponse('❌ Rank must be one of: Operative, Agent, Premier, Commodore, Admiral.', true);
	}

	const rankSpecific =
		rankKey === 'Operative'
			? config.operative_role_ids
			: rankKey === 'Agent'
				? config.agent_role_ids
				: rankKey === 'Premier'
					? config.premier_role_ids
					: rankKey === 'Commodore'
						? config.commodore_role_ids
						: config.admiral_role_ids;

	const wanted = rankKey.toLowerCase();
	const overlayRoleIds = new Set<string>();
	for (const bucket of Object.values(config.overlay_buckets ?? {})) {
		const matches = (bucket.ranks ?? []).some((r) => String(r).trim().toLowerCase() === wanted);
		if (!matches) continue;
		for (const id of bucket.role_ids ?? []) overlayRoleIds.add(id);
	}

	const memberRoleIds = [
		...config.member_role_ids,
		...rankSpecific,
		...Array.from(overlayRoleIds),
	].filter((id) => /^\d{15,20}$/.test(id));

	if (env.DISCORD_BOT_TOKEN) {
		const roles = await listGuildRoles(env.DISCORD_BOT_TOKEN, guildId);
		const idToName = new Map(roles.map((r) => [r.id, r.name]));
		const pretty = memberRoleIds.map((id) => `${idToName.get(id) ?? 'unknown role'} (${id})`);
		return interactionResponse(`🔎 Roles for rank ${rankKey}\n${pretty.join('\n')}`, true);
	}

	return interactionResponse(`🔎 Roles for rank ${rankKey}\n${memberRoleIds.join(', ') || 'none'}`, true);
}

async function handleServerTestInviteCommand(
	env: Env,
	interaction: { guild_id?: string; member?: { permissions?: string; user?: { id: string } } },
	sub: { options?: Array<{ name: string; value?: unknown; type?: number }> },
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction as any);
	if (adminError) return adminError;

	const guildId = interaction.guild_id!;
	const userId = resolveTargetUserId(interaction as any, sub.options);
	if (!userId) return interactionResponse('❌ Could not resolve target user.', true);

	// Minimal test helper: record member + send DM invitation.
	await recordGuildMember(env.STFC_DB, guildId, userId, null);
	const dm = await inviteNewMember(env, guildId, userId, 'user');
	if (dm.ok) {
		await markMemberInvited(env.STFC_DB, guildId, userId);
		return interactionResponse('✅ DM sent and verification state reset for this user.', true);
	}

	return interactionResponse(
		`❌ Failed to send DM: ${dm.errorMessage}${typeof dm.status === 'number' ? ` (HTTP ${dm.status})` : ''}`,
		true,
	);
}

async function handleServerTestResetCommand(
	env: Env,
	interaction: { guild_id?: string; member?: { permissions?: string; user?: { id: string } } },
	sub: { options?: Array<{ name: string; value?: unknown; type?: number }> },
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction as any);
	if (adminError) return adminError;

	const guildId = interaction.guild_id!;
	const userId = resolveTargetUserId(interaction as any, sub.options);
	if (!userId) return interactionResponse('❌ Could not resolve target user.', true);

	await resetVerification(env.STFC_DB, guildId, userId);
	return interactionResponse(`✅ Verification state reset for user <@${userId}>.`, true);
}

async function handleServerCategoriesCommand(
	env: Env,
	interaction: { guild_id?: string; member?: { permissions?: string } },
	sub: { options?: Array<{ name: string; value?: unknown }> },
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction);
	if (adminError) return adminError;

	const guildId = interaction.guild_id!;
	if (!env.DISCORD_BOT_TOKEN) return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);

	const limitRaw = getOptionValue(sub.options, 'limit');
	const limit = typeof limitRaw === 'number' ? limitRaw : limitRaw ? parseInt(String(limitRaw), 10) : 30;
	const safeLimit = Number.isFinite(limit) ? Math.max(5, Math.min(50, limit)) : 30;

	const channels = await listGuildChannels(env.DISCORD_BOT_TOKEN, guildId);
	const categories = channels.filter((c) => c.type === 4).slice(0, safeLimit);
	const lines = categories.map((c) => `• ${c.name} (${c.id})`);
	const more =
		channels.filter((c) => c.type === 4).length > categories.length
			? `\n… and ${channels.filter((c) => c.type === 4).length - categories.length} more`
			: '';

	return interactionResponse(
		`📁 Categories (${channels.filter((c) => c.type === 4).length})\n` +
			(lines.length ? lines.join('\n') : 'No categories found.') +
			more +
			`\n\nUse with \`/server channels map category_map:A-F=<id>\`.`,
		true,
	);
}

async function handleDiplomacyChannelsCommand(
	env: Env,
	guildId: string,
	config: GuildConfig,
	options: Array<{ name: string; value?: unknown }> | undefined,
): Promise<Response> {
	const disableRaw = getOptionValue(options, 'disable');
	const disable = disableRaw === true || disableRaw === 'true';
	const enableRaw = getOptionValue(options, 'enable');
	const enable = enableRaw === true || enableRaw === 'true';
	const createTagRaw = (getOptionValue(options, 'create_tag') as string | undefined)?.trim();
	const linkTagRaw = (getOptionValue(options, 'link_tag') as string | undefined)?.trim();
	const channelOpt = getOptionValue(options, 'channel');
	const applyPermsRaw = getOptionValue(options, 'apply_permissions');
	const applyPermissions =
		applyPermsRaw === undefined || applyPermsRaw === null
			? true
			: applyPermsRaw === true || applyPermsRaw === 'true';

	const everyoneRaw = getOptionValue(options, 'everyone_can_view');
	const categoryOpt = getOptionValue(options, 'category');
	const viewRolesRaw = getOptionValue(options, 'view_roles');
	const writeRolesRaw = getOptionValue(options, 'write_roles');
	const writeRanksRaw = getOptionValue(options, 'write_ranks') as string | undefined;
	const nameTemplateRaw = getOptionValue(options, 'name_template');

	const configTouched =
		enable ||
		everyoneRaw !== undefined ||
		categoryOpt !== undefined ||
		viewRolesRaw !== undefined ||
		writeRolesRaw !== undefined ||
		writeRanksRaw !== undefined ||
		nameTemplateRaw !== undefined;

	if (disable) {
		await upsertGuildConfig(env.STFC_DB, { guild_id: guildId, diplomacy_enabled: false });
		return interactionResponse(
			'✅ Diplomacy channels disabled. Existing channel links are kept but no new channels will be created.',
			true,
		);
	}

	if (configTouched) {
		const patch: Partial<GuildConfig> & { guild_id: string } = {
			guild_id: guildId,
			diplomacy_enabled: true,
		};

		if (everyoneRaw !== undefined && everyoneRaw !== null) {
			patch.diplomacy_everyone_can_view = everyoneRaw === true || everyoneRaw === 'true';
		}
		if (categoryOpt !== undefined && categoryOpt !== null) {
			const cat = String(categoryOpt);
			patch.diplomacy_category_id = /^\d{15,20}$/.test(cat) ? cat : null;
		}
		if (nameTemplateRaw !== undefined && nameTemplateRaw !== null) {
			patch.diplomacy_name_template = String(nameTemplateRaw).trim() || null;
		}
		if (writeRanksRaw !== undefined) {
			const ranks = writeRanksRaw
				.split(',')
				.map((r) => r.trim())
				.filter(Boolean);
			patch.diplomacy_write_ranks = ranks.length ? ranks : ['Commodore', 'Admiral'];
		}

		try {
			if (viewRolesRaw !== undefined) {
				if (!String(viewRolesRaw).trim()) {
					patch.diplomacy_view_role_ids = [];
				} else {
					const resolved = await resolveRoleTokensToIds(
						env,
						guildId,
						parseRoleTokensCsv(viewRolesRaw),
						false,
						config.diplomacy_view_role_ids.map((id) => ({ id })),
					);
					patch.diplomacy_view_role_ids = resolved.ids;
				}
			}
			if (writeRolesRaw !== undefined) {
				if (!String(writeRolesRaw).trim()) {
					patch.diplomacy_write_role_ids = [];
				} else {
					const resolved = await resolveRoleTokensToIds(
						env,
						guildId,
						parseRoleTokensCsv(writeRolesRaw),
						true,
						config.diplomacy_write_role_ids.map((id) => ({ id })),
					);
					patch.diplomacy_write_role_ids = resolved.ids;
				}
			}
		} catch (error) {
			return interactionResponse(
				`❌ Failed to resolve roles: ${error instanceof Error ? error.message : 'unknown error'}`,
				true,
			);
		}

		await upsertGuildConfig(env.STFC_DB, patch);
		config = (await getGuildConfig(env.STFC_DB, guildId))!;
	}

	if (createTagRaw) {
		if (!env.DISCORD_BOT_TOKEN) return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
		if (!diplomacyChannelsEnabled(config)) {
			await upsertGuildConfig(env.STFC_DB, { guild_id: guildId, diplomacy_enabled: true });
			config = (await getGuildConfig(env.STFC_DB, guildId))!;
		}
		const result = await ensureDiplomacyChannel(
			env.DISCORD_BOT_TOKEN,
			config,
			guildId,
			createTagRaw,
		);
		if (!result.ok) {
			return interactionResponse(`❌ Failed to create diplomacy channel: ${result.error}`, true);
		}
		const nextMap = { ...config.diplomacy_channel_map, [result.tag]: result.channelId };
		await upsertGuildConfig(env.STFC_DB, {
			guild_id: guildId,
			diplomacy_enabled: true,
			diplomacy_channel_map: nextMap,
		});
		return interactionResponse(
			`✅ ${result.created ? 'Created' : 'Updated'} diplomacy channel for **[${result.tag}]**: <#${result.channelId}>\n` +
				`View: ${config.diplomacy_everyone_can_view ? '@everyone' : 'role-restricted'}; ` +
				`write roles/ranks applied from config.`,
			true,
		);
	}

	if (linkTagRaw) {
		if (!env.DISCORD_BOT_TOKEN) return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
		const channelId = channelOpt != null ? String(channelOpt) : '';
		if (!/^\d{15,20}$/.test(channelId)) {
			return interactionResponse('❌ `link_tag` requires a valid `channel:`.', true);
		}
		const result = await linkDiplomacyChannel(
			env.DISCORD_BOT_TOKEN,
			config,
			guildId,
			linkTagRaw,
			channelId,
			{ applyPermissions },
		);
		if (!result.ok) {
			return interactionResponse(`❌ Failed to link diplomacy channel: ${result.error}`, true);
		}
		const nextMap = { ...config.diplomacy_channel_map, [result.tag]: result.channelId };
		await upsertGuildConfig(env.STFC_DB, {
			guild_id: guildId,
			diplomacy_enabled: true,
			diplomacy_channel_map: nextMap,
		});
		return interactionResponse(
			`✅ Linked <#${result.channelId}> as diplomacy for **[${result.tag}]**.` +
				(applyPermissions
					? ' Applied configured view/write permissions.'
					: ' Left existing channel permissions unchanged.'),
			true,
		);
	}

	// Status / config summary
	const refreshed = (await getGuildConfig(env.STFC_DB, guildId))!;
	return interactionResponse(
		`🤝 **Diplomacy channels**\n` +
			`• Enabled: ${diplomacyChannelsEnabled(refreshed) ? 'yes' : 'no'}\n` +
			`• Everyone can view: ${refreshed.diplomacy_everyone_can_view ? 'yes' : 'no'}\n` +
			`• Category: ${refreshed.diplomacy_category_id ? `<#${refreshed.diplomacy_category_id}>` : 'none'}\n` +
			`• Name template: \`${refreshed.diplomacy_name_template?.trim() || 'diplomacy-{tag}'}\`\n` +
			`• View roles: ${refreshed.diplomacy_view_role_ids.map((id) => `<@&${id}>`).join(', ') || 'none'}\n` +
			`• Write roles: ${refreshed.diplomacy_write_role_ids.map((id) => `<@&${id}>`).join(', ') || 'none'}\n` +
			`• Write ranks: ${refreshed.diplomacy_write_ranks.join(', ') || 'none'}\n` +
			`• Channels: ${formatDiplomacyChannelMap(refreshed.diplomacy_channel_map)}\n\n` +
			`Examples:\n` +
			`\`/server channels diplomacy enable:true write_roles:Diplomat write_ranks:Commodore,Admiral everyone_can_view:true\`\n` +
			`\`/server channels diplomacy create_tag:KWSN\`\n` +
			`\`/server channels diplomacy link_tag:KWSN channel:#kwsn-diplo apply_permissions:false\``,
		true,
	);
}

async function handleServerChannelsCommand(
	env: Env,
	interaction: { guild_id?: string; member?: { permissions?: string; user?: { id: string } } },
	channelsGroup: { options?: Array<{ name: string; value?: unknown; type?: number; options?: Array<{ name: string; value?: unknown; type?: number }> }> },
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction);
	if (adminError) return adminError;

	const guildId = interaction.guild_id!;
	const sub = channelsGroup.options?.[0];
	if (!sub) return interactionResponse('❌ Missing channels subcommand.', true);

	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) return interactionResponse('❌ Server not configured. Run `/server setup` first.', true);

	if (sub.name === 'status') {
		const players = await env.STFC_DB.prepare(
			`SELECT COUNT(*) as count FROM verified_players
			 WHERE guild_id = ? AND personal_channel_id IS NOT NULL`,
		)
			.bind(guildId)
			.first<{ count: number }>();

		return interactionResponse(
			`📂 **Personal channel configuration**\n` +
				`• Enabled: ${personalChannelsEnabled(config) ? 'yes' : 'no (set category map)'}\n` +
				`• Category map: ${formatCategoryMap(config.channel_category_map)}\n` +
				`• Extra roles: ${config.personal_channel_extra_roles.join(', ') || 'none'}\n` +
				`• Verification log: ${config.verification_log_channel_id ? `<#${config.verification_log_channel_id}>` : 'not set'}\n` +
				`• Diplomacy: ${diplomacyChannelsEnabled(config) ? 'enabled' : 'disabled'} — ${formatDiplomacyChannelMap(config.diplomacy_channel_map)}\n` +
				`• Linked member channels: ${players?.count ?? 0}\n\n` +
				`Buckets use the member's first letter (e.g. A-F, G-M). Run \`/server categories\` for IDs.\n` +
				`Set log with \`/server channels log\`. Diplomacy: \`/server channels diplomacy\`.`,
			true,
		);
	}

	if (sub.name === 'diplomacy') {
		return handleDiplomacyChannelsCommand(env, guildId, config, sub.options);
	}

	if (sub.name === 'log') {
		const clearRaw = getOptionValue(sub.options, 'clear');
		const clear = clearRaw === true || clearRaw === 'true';
		const createRaw = getOptionValue(sub.options, 'create');
		const create = createRaw === true || createRaw === 'true';
		const channelOpt = getOptionValue(sub.options, 'channel');
		const nameOpt = (getOptionValue(sub.options, 'name') as string | undefined)?.trim();

		if (clear) {
			await upsertGuildConfig(env.STFC_DB, {
				guild_id: guildId,
				verification_log_channel_id: null,
			});
			return interactionResponse('✅ Verification log channel cleared.', true);
		}

		if (!env.DISCORD_BOT_TOKEN) {
			return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
		}

		if (create) {
			try {
				const channelId = await createVerificationLogChannel(
					env.DISCORD_BOT_TOKEN,
					guildId,
					config,
					nameOpt || 'verification-log',
				);
				await upsertGuildConfig(env.STFC_DB, {
					guild_id: guildId,
					verification_log_channel_id: channelId,
				});
				const viewerNote = config.personal_channel_extra_roles.length
					? `Viewer roles (from channel extra-roles): ${config.personal_channel_extra_roles.map((id) => `<@&${id}>`).join(', ')}`
					: 'No extra viewer roles yet — set `/server channels extra-roles` then recreate, or edit channel permissions manually.';
				return interactionResponse(
					`✅ Created private verification log <#${channelId}>.\n` +
						`• @everyone cannot view\n` +
						`• ${viewerNote}\n\n` +
						`Successful verifications will post a summary + screenshot here.`,
					true,
				);
			} catch (error) {
				return interactionResponse(
					`❌ Failed to create log channel: ${error instanceof Error ? error.message : 'unknown error'}`,
					true,
				);
			}
		}

		const channelId = channelOpt != null ? String(channelOpt) : '';
		if (!/^\d{15,20}$/.test(channelId)) {
			return interactionResponse(
				'❌ Provide `channel:` (existing), `create:true`, or `clear:true`.',
				true,
			);
		}

		await upsertGuildConfig(env.STFC_DB, {
			guild_id: guildId,
			verification_log_channel_id: channelId,
		});
		return interactionResponse(
			`✅ Verification log channel set to <#${channelId}>.\n` +
				`Make sure the bot can **View Channel**, **Send Messages**, and **Attach Files** there.`,
			true,
		);
	}

	if (sub.name === 'map') {
		const clearRaw = getOptionValue(sub.options, 'clear');
		const clear = clearRaw === true || clearRaw === 'true';
		const categoryMapRaw = getOptionValue(sub.options, 'category_map') as string | undefined;
		const rangeRaw = getOptionValue(sub.options, 'range') as string | undefined;
		const categoryIdRaw = getOptionValue(sub.options, 'category_id') as string | undefined;

		if (clear) {
			await upsertGuildConfig(env.STFC_DB, { guild_id: guildId, channel_category_map: {} });
			return interactionResponse('✅ Category map cleared. Personal channels are now disabled.', true);
		}

		const nextMap = { ...config.channel_category_map };

		if (categoryMapRaw) {
			const parsed = parseCategoryMapInput(categoryMapRaw);
			if (Object.keys(parsed).length === 0) {
				return interactionResponse(
					'❌ Invalid category_map. Example: `A-F=123456789012345678,G-M=987654321098765432`',
					true,
				);
			}
			Object.assign(nextMap, parsed);
		} else if (rangeRaw && categoryIdRaw) {
			if (!/^\d{15,20}$/.test(categoryIdRaw)) {
				return interactionResponse('❌ category_id must be a valid category snowflake.', true);
			}
			nextMap[rangeRaw.trim().toUpperCase()] = categoryIdRaw;
		} else {
			return interactionResponse(
				'❌ Provide `category_map` (bulk) or `range` + `category_id` (single), or `clear:true`.',
				true,
			);
		}

		await upsertGuildConfig(env.STFC_DB, { guild_id: guildId, channel_category_map: nextMap });
		return interactionResponse(
			`✅ Category map updated.\n• ${formatCategoryMap(nextMap)}\n\nPersonal channels will be created on verify for matching members.`,
			true,
		);
	}

	if (sub.name === 'extra-roles') {
		const rolesRaw = getOptionValue(sub.options, 'roles') as string | undefined;
		const createIfMissingRaw = getOptionValue(sub.options, 'create_if_missing');
		const createIfMissing = createIfMissingRaw === true || createIfMissingRaw === 'true';

		if (!rolesRaw?.trim()) {
			await upsertGuildConfig(env.STFC_DB, { guild_id: guildId, personal_channel_extra_roles: [] });
			return interactionResponse('✅ Channel extra roles cleared.', true);
		}

		try {
			const resolved = await resolveRoleTokensToIds(
				env,
				guildId,
				parseRoleTokensCsv(rolesRaw),
				createIfMissing,
				config.personal_channel_extra_roles.map((id) => ({ id })),
			);
			await upsertGuildConfig(env.STFC_DB, { guild_id: guildId, personal_channel_extra_roles: resolved.ids });
			return interactionResponse(
				`✅ Channel extra roles updated (${resolved.ids.length}): ${resolved.ids.join(', ')}`,
				true,
			);
		} catch (error) {
			return interactionResponse(
				`❌ Failed to resolve roles: ${error instanceof Error ? error.message : 'unknown error'}`,
				true,
			);
		}
	}

	if (sub.name === 'link') {
		if (!env.DISCORD_BOT_TOKEN) return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);

		const channelId = getOptionValue(sub.options, 'channel') as string | undefined;
		if (!channelId || !/^\d{15,20}$/.test(channelId)) {
			return interactionResponse('❌ Provide a valid text `channel:`.', true);
		}

		const playerQuery = (getOptionValue(sub.options, 'player') as string | undefined)?.trim();
		const userOpt = getOptionValue(sub.options, 'user');
		const applyPermsRaw = getOptionValue(sub.options, 'apply_permissions');
		const applyPermissions =
			applyPermsRaw === undefined || applyPermsRaw === null
				? true
				: applyPermsRaw === true || applyPermsRaw === 'true';

		let discordUserId: string | undefined;
		let matchLabel = '';

		if (playerQuery) {
			const matches = await findVerifiedPlayersForLink(env.STFC_DB, guildId, playerQuery);
			if (matches.length === 0) {
				return interactionResponse(
					`❌ No verified player matching \`${playerQuery}\`. Use in-game name, STFC player ID, or Discord user ID — or pass \`user:@Member\`.`,
					true,
				);
			}
			if (matches.length > 1) {
				const list = matches
					.slice(0, 8)
					.map(
						(m) =>
							`• ${m.player_name ?? '—'} (ID ${m.player_id ?? '—'}) → <@${m.discord_user_id}>`,
					)
					.join('\n');
				return interactionResponse(
					`❌ Multiple matches for \`${playerQuery}\`. Be more specific or use \`user:@Member\`:\n${list}`,
					true,
				);
			}
			discordUserId = matches[0].discord_user_id;
			matchLabel = matches[0].player_name
				? `**${matches[0].player_name}** (<@${discordUserId}>)`
				: `<@${discordUserId}>`;
		} else if (userOpt != null) {
			discordUserId = String(userOpt);
			matchLabel = `<@${discordUserId}>`;
		} else {
			return interactionResponse(
				'❌ Provide `player:` (in-game name or STFC ID) and/or `user:@Member`, plus `channel:`.',
				true,
			);
		}

		const result = await linkExistingPersonalChannel(
			env.DISCORD_BOT_TOKEN,
			config,
			guildId,
			discordUserId,
			channelId,
			{ applyPermissions },
		);
		if (!result.ok) {
			return interactionResponse(`❌ Failed to link channel: ${result.error}`, true);
		}

		await upsertVerifiedPlayer(env.STFC_DB, {
			guild_id: guildId,
			discord_user_id: discordUserId,
			personal_channel_id: channelId,
		});

		return interactionResponse(
			`✅ Linked <#${channelId}> to ${matchLabel}.` +
				(applyPermissions
					? ' Applied bot channel permissions (member + extra-roles).'
					: ' Left existing channel permissions unchanged.'),
			true,
		);
	}

	return interactionResponse(`❌ Unknown channels subcommand: ${sub.name}`, true);
}

async function handleServerGatewayCommand(
	env: Env,
	interaction: { guild_id?: string; member?: { permissions?: string } },
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction);
	if (adminError) return adminError;

	const status = await getDiscordGatewayStatus(env);
	return interactionResponse(
		status
			? `🛰️ Gateway status\n• Ready: ${status.ready}\n• Last event: ${status.lastEventAt ?? '—'}`
			: '❌ DISCORD_GATEWAY binding not configured.',
		true,
	);
}

export async function handleDiscordInteraction(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const signature = request.headers.get('X-Signature-Ed25519');
	const timestamp = request.headers.get('X-Signature-Timestamp');
	const body = await request.text();

	if (!signature || !timestamp || !env.DISCORD_PUBLIC_KEY) {
		return new Response('Unauthorized', { status: 401 });
	}

	if (!verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY)) {
		return new Response('Invalid signature', { status: 401 });
	}

	const interaction = JSON.parse(body);

	if (interaction.type === 1) {
		return Response.json({ type: 1 });
	}

	if (interaction.type === 3) {
		const customId = interaction.data?.custom_id as string | undefined;
		if (customId?.startsWith('survey:')) {
			const { handleSurveyComponent } = await import('./survey-handlers');
			return handleSurveyComponent(env, ctx, interaction);
		}
		return interactionResponse('❌ Unknown button.', true);
	}

	if (interaction.type === 2) {
		const { data } = interaction;

		if (data.name === 'survey') {
			const { handleSurveyCommand } = await import('./survey-handlers');
			return handleSurveyCommand(env, ctx, interaction, data);
		}

		if (data.name === 'lookup') {
			const coordinateLink = data.options?.[0]?.value as string | undefined;
			if (!coordinateLink) return interactionResponse('Please provide a coordinate link.', true);

			const coordinates = parseMultipleCoordinates(coordinateLink);
			const parsed = parseCoordinateLink(coordinateLink);
			if (coordinates.length === 0 && !parsed) {
				return interactionResponse('Invalid coordinate format. Expected: [[ALLIANCE] Player S:12345 X:123.456 Y:789.012]', true);
			}
			return interactionResponse(handleCoordinateLookup(coordinateLink));
		}

		if (data.name === 'tablehelp') {
			return interactionResponse(
				`**📊 Table Command Help**\n\n` +
					`• \`/table csv_data:Name,Age\\nJohn,25\`\n` +
					`• Upload a .csv file with the csv_file option (max 1MB)\n` +
					`• Use \\\\n for rows, | for multi-line cells`,
				true,
			);
		}

		if (data.name === 'player') {
			return handlePlayerCommand(env, ctx, interaction, data);
		}

		if (data.name === 'verify') {
			return handleVerifyCommand(env, ctx, interaction, data);
		}

		if (data.name === 'server') {
			const sub = data.options?.[0];
			if (sub?.name === 'setup') {
				return handleServerSetupCommand(env, interaction, sub);
			}
			if (sub?.name === 'status') {
				return handleServerStatusCommand(env, interaction.guild_id);
			}
			if (sub?.name === 'test-invite') {
				return handleServerTestInviteCommand(env, interaction as any, sub);
			}
			if (sub?.name === 'test-reset') {
				return handleServerTestResetCommand(env, interaction as any, sub);
			}
			if (sub?.name === 'gateway') {
				return handleServerGatewayCommand(env, interaction as any);
			}
			if (sub?.name === 'roles') {
				return handleServerRolesCommand(env, interaction as any, sub);
			}
			if (sub?.name === 'bucket') {
				return handleServerBucketCommand(env, interaction as any, sub);
			}
			if (sub?.name === 'rank-roles') {
				return handleServerRankRolesCommand(env, interaction as any, sub);
			}
			if (sub?.name === 'categories') {
				return handleServerCategoriesCommand(env, interaction as any, sub);
			}
			if (sub?.name === 'channels') {
				return handleServerChannelsCommand(env, interaction as any, sub);
			}
		}

		if (data.name === 'table') {
			const csvInput = getOptionValue(data.options, 'csv_data') as string | undefined;
			const csvFileOption = data.options?.find((opt) => opt.name === 'csv_file');
			let csvFile = null;
			if (csvFileOption?.value) {
				csvFile = interaction.data.resolved?.attachments?.[String(csvFileOption.value)];
			}

			if (!csvInput && !csvFile) {
				return interactionResponse('Provide csv_data or upload a csv_file. See `/tablehelp`.', true);
			}

			try {
				let csvData = '';
				if (csvFile) {
					if (!csvFile.filename?.toLowerCase().endsWith('.csv')) {
						return interactionResponse('Error: upload a .csv file only.', true);
					}
					if (csvFile.size && csvFile.size > 1048576) {
						return interactionResponse('Error: file too large (max 1MB).', true);
					}
					const fileResponse = await fetch(csvFile.url);
					if (!fileResponse.ok) throw new Error(`HTTP ${fileResponse.status}`);
					csvData = await fileResponse.text();
				} else {
					csvData = csvInput!;
				}

				if (!csvData.trim()) return interactionResponse('Error: empty CSV data.', true);

				const tableData = parseCSV(csvData);
				const columns = autoGenerateColumns(tableData);
				const asciiTable = generateAsciiTable(tableData, columns);

				if (asciiTable.length > 1900) {
					return interactionResponse('Table too large. Reduce data or column widths.', true);
				}
				return interactionResponse('```\n' + asciiTable + '\n```');
			} catch (error) {
				return interactionResponse(
					`Error parsing CSV: ${error instanceof Error ? error.message : 'unknown error'}. See /tablehelp.`,
					true,
				);
			}
		}
	}

	return new Response('Unknown interaction', { status: 400 });
}
