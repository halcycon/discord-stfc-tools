import { verifyKey } from 'discord-interactions';
import {
	deferredResponse,
	editInteractionResponse,
	editChannelMessage,
	interactionResponse,
	updateMessageResponse,
	listGuildRoles,
	listGuildChannels,
	createGuildRole,
	sendChannelMessageWithEmbed,
	sendMessageWithComponents,
	pinChannelMessage,
	getBotUserId,
	fetchGuildChannel,
} from './discord-api';
import {
	getGuildConfig,
	upsertGuildConfig,
	recordGuildMember,
	markMemberInvited,
	resetVerification,
	upsertVerifiedPlayer,
	findVerifiedPlayersForLink,
	getVerifiedPlayer,
	listPlayersForPersonalChannels,
	listActiveVerifiedPlayers,
	excludeGuildUser,
	unexcludeGuildUser,
	listExcludedUsers,
	isUserExcluded,
} from './guild-db';
import { findPlayerByIdOrName, formatPlayerSummary } from './stfc-utils';
import { inviteNewMember, processVerification } from './verification';
import { handleRosterCommand } from './roster-handlers';
import { requireGuildAdmin, resolveTargetUserId, resolveRequiredUserOption } from './discord-admin';
import { AuditColor, createAuditLogChannel, postAuditLog } from './audit-log';
import { withDeployModeContext, shouldSkipOutboundDm } from './deploy-mode';
import type { DeployMode, GuildConfig, GuildMode, StfcRegion } from './types';
import { createUrgentNotifyChannel, postUrgentNotify } from './urgent-notify';
import { getDiscordGatewayStatus } from './discord-gateway/wake';
import { parseCSV, autoGenerateColumns, generateAsciiTable } from './tableUtils';
import {
	handleCoordinateLookup,
	parseCoordinateLink,
	parseMultipleCoordinates,
} from './systemUtils';
import { parseCategoryMapInput, formatCategoryMap, personalChannelsEnabled, slugPersonalChannelName } from './channel-utils';
import {
	linkExistingPersonalChannel,
	planPersonalChannels,
	rebalancePersonalChannels,
} from './personal-channels';
import {
	auditPersonalChannelPermissions,
	formatPermissionAuditReportText,
	formatPermissionAuditSummaryMessage,
} from './channel-permission-audit';
import {
	formatBulkPermReportText,
	formatBulkPermSummary,
	runBulkPermApply,
	type BulkPermPreset,
	type BulkPermScope,
	type BulkPermTarget,
} from './channel-permissions-bulk';
import {
	capturePersonalChannelPermTemplate,
	formatEffectivePersonalChannelPermTemplate,
	formatPersonalChannelPermTemplate,
} from './personal-channel-perm-template';
import { DEFAULT_SOFT_LIMIT } from './personal-channel-plan';
import { defaultNicknameTemplate, parseNicknameDisplayRanks } from './nickname-utils';
import { createVerificationLogChannel } from './verification-log';
import {
	diplomacyChannelsEnabled,
	ensureDiplomacyChannel,
	ensureDiplomacySpecialChannel,
	formatDiplomacyChannelMap,
	formatDiplomacyGapsReport,
	formatDiplomacySpecialStatus,
	linkDiplomacyChannel,
	linkDiplomacySpecialChannel,
	normalizeDiplomacySpecialPlacement,
	parseArchiveSourceCategoryIds,
	planDiplomacyArchiveChannels,
	planDiplomacyChannels,
	rebalanceDiplomacyArchiveChannels,
	rebalanceDiplomacyChannels,
	resolveDiplomacySoftLimit,
	resolveDiplomacySpecialName,
	withDiplomacyPreferredLocales,
} from './diplomacy-channels';
import { persistDiplomacySoftLimit } from './diplomacy-maintenance';
import { formatLocaleFlagSuffix, parseDiplomacyLanguagesOption } from './i18n/locales';

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
				const player = await findPlayerByIdOrName(env, searchTerm, server, region);
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
			const content = typeof result === 'string' ? result : result.content;
			await editInteractionResponse(appId, interaction.token, content, true);
		})(),
	);

	return deferred;
}

async function handleServerSetupCommand(
	env: Env,
	interaction: { guild_id?: string; member?: { permissions?: string; user?: { id: string } } },
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
	const nicknameRanksRaw = getOptionValue(data.options, 'nickname_ranks');
	const nicknameRanksProvided = nicknameRanksRaw !== undefined && nicknameRanksRaw !== null;

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
			alliance_tag: mode === 'single_alliance' ? (allianceTag ?? null) : null,
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
			...(nicknameRanksProvided
				? { nickname_display_ranks: parseNicknameDisplayRanks(String(nicknameRanksRaw)) }
				: {}),
		});

		if (mode === 'multi_alliance') {
			const { clearGuildAllianceRosterCache } = await import('./alliance-roster-sync');
			await clearGuildAllianceRosterCache(env, guildId);
		}

		const effectiveNick =
			nicknameTemplateProvided
				? String(nicknameTemplateRaw).trim() || defaultNicknameTemplate(mode)
				: (existingConfig?.nickname_template?.trim() || defaultNicknameTemplate(mode));

		const refreshed = await getGuildConfig(env.STFC_DB, guildId);
		const actorId = interaction.member?.user?.id;
		await postAuditLog(env, refreshed, {
			title: 'Server setup updated',
			description: `Mode **${mode}** · STFC **${server}** (${region})` +
				(mode === 'single_alliance' ? ` · tag **${allianceTag}**` : ''),
			actorId,
			source: 'admin',
			color: AuditColor.success,
			fields: [
				{ name: 'Nickname', value: `\`${effectiveNick}\``, inline: false },
				{
					name: 'Roles',
					value: `member ${memberRoleIds.length} · guest ${guestRoleId ? 'set' : 'none'} · ranks ${operativeRoleIds.length}/${agentRoleIds.length}/${premierRoleIds.length}/${commodoreRoleIds.length}/${admiralRoleIds.length}`,
					inline: false,
				},
			],
		});

		return interactionResponse(
			`✅ Server configured!\n` +
				`• Mode: **${mode}**\n` +
				`• Deploy mode: **${refreshed?.deploy_mode ?? 'testing'}**` +
				((refreshed?.deploy_mode ?? 'testing') === 'testing'
					? ` — safe setup; go live with \`/server deploy mode:live\`\n`
					: `\n`) +
				`• STFC: server **${server}** (${region})\n` +
				(mode === 'single_alliance' ? `• Alliance tag: **${allianceTag}**\n` : '') +
				`• Nickname template: \`${effectiveNick}\`\n` +
				`• Nickname ranks: ${(refreshed?.nickname_display_ranks ?? []).join(', ') || 'all'}\n` +
				`• Member roles: ${memberRoleIds.length ? memberRoleIds.join(', ') : 'none yet'}\n` +
				`• Guest role: ${guestRoleId ?? 'not set'}\n` +
				`• Operative/Agent/Premier/Commodore/Admiral roles set: ` +
				`${operativeRoleIds.length}/${agentRoleIds.length}/${premierRoleIds.length}/${commodoreRoleIds.length}/${admiralRoleIds.length}\n\n` +
				`New members will receive a verification DM. They can also run \`/verify\`.\n` +
				`Nickname placeholders: \`{player_name}\` \`{alliance_tag}\` \`{rank}\` \`{rank_prefix}\` \`{rank_paren}\`\n` +
				`Tip: set \`/channels audit create:true\` for a staff audit trail, and \`/channels log\` for verification screenshots.`,
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

	const { formatServerStatus } = await import('./format-server-status');
	return interactionResponse(formatServerStatus(config), true);
}

async function handleServerDeployCommand(
	env: Env,
	interaction: { guild_id?: string; member?: { permissions?: string; user?: { id: string } } },
	sub: { options?: Array<{ name: string; value?: unknown }> },
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction);
	if (adminError) return adminError;

	const guildId = interaction.guild_id!;
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return interactionResponse('❌ Server not configured. Run `/server setup` first.', true);
	}

	const { collectGoLiveDmPreview, formatGoLiveDmPreview } = await import('./go-live-dm-preview');
	const previewRaw = getOptionValue(sub.options, 'preview');
	const wantPreview = previewRaw === true || previewRaw === 'true';

	const modeRaw = getOptionValue(sub.options, 'mode') as string | undefined;
	if (modeRaw === 'testing' || modeRaw === 'live') {
		const mode = modeRaw as DeployMode;
		await upsertGuildConfig(env.STFC_DB, { guild_id: guildId, deploy_mode: mode });
		await postAuditLog(env, { ...config, deploy_mode: mode }, {
			title: 'Deploy mode updated',
			description: `Deploy mode set to **${mode}**.`,
			actorId: interaction.member?.user?.id,
			source: 'admin',
			color: mode === 'live' ? AuditColor.success : AuditColor.warn,
		});
		// Reply under the *new* mode so going live isn't still prefixed [TESTING].
		return withDeployModeContext({ deploy_mode: mode }, async () => {
			if (mode === 'testing') {
				return interactionResponse(
					`✅ Deploy mode: **testing**\n` +
						`• Slash command replies are prefixed with \`[TESTING]\`\n` +
						`• Automated demotions / leave queues are dry-run only (morning cron still reports + lists would-have actions)\n` +
						`• Outbound DMs are off — use \`/test-dm\` to preview to yourself or a nominated user\n` +
						`• Manual \`/roster set-guest\` is blocked until you go live\n\n` +
						`Litmus test: \`/server deploy preview:true\`\n` +
						`When ready: \`/server deploy mode:live\``,
					true,
				);
			}
			const preview = await collectGoLiveDmPreview(env.STFC_DB, { ...config, deploy_mode: 'live' });
			const backlog =
				preview.inviteCount + preview.welcomeCount > 0
					? `\n\n${formatGoLiveDmPreview(preview)}`
					: `\n\n📬 No invite/welcome DMs pending in D1 — member poll and morning sync will only DM new activity.`;
			return interactionResponse(
				`✅ Deploy mode: **live**\n` +
					`Full automation is on (demotions follow your leave-detection policy; invite/welcome DMs resume).` +
					backlog,
				true,
			);
		});
	}

	const preview = await collectGoLiveDmPreview(env.STFC_DB, config);
	const previewBlock = `\n\n${formatGoLiveDmPreview(preview)}`;

	if (wantPreview) {
		return withDeployModeContext(config, async () =>
			interactionResponse(
				`🚀 **Deploy mode:** **${config.deploy_mode}**\n` + previewBlock.trimStart(),
				true,
			),
		);
	}

	return withDeployModeContext(config, async () =>
		interactionResponse(
			`🚀 **Deploy mode:** **${config.deploy_mode}**\n` +
				(config.deploy_mode === 'testing'
					? `• Safe setup: no automated demotions; replies prefixed \`[TESTING]\`\n` +
						`• Outbound DMs off — preview with \`/test-dm\`\n` +
						`• Morning cron still syncs/reports and lists actions it **would** take\n`
					: `• Full automation enabled\n`) +
				`\nSet: \`/server deploy mode:testing\` or \`mode:live\`` +
				`\nLitmus test: \`/server deploy preview:true\`` +
				previewBlock,
			true,
		),
	);
}

async function handleServerDemotionCommand(
	env: Env,
	interaction: { guild_id?: string; member?: { permissions?: string; user?: { id: string } } },
	sub: { options?: Array<{ name: string; value?: unknown }> },
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction);
	if (adminError) return adminError;

	const guildId = interaction.guild_id!;
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return interactionResponse('❌ Server not configured. Run `/server setup` first.', true);
	}

	const policyRaw = getOptionValue(sub.options, 'policy') as string | undefined;
	const listRaw = getOptionValue(sub.options, 'list');
	const list = listRaw === true || listRaw === 'true';

	if (policyRaw === 'approval' || policyRaw === 'yolo') {
		await upsertGuildConfig(env.STFC_DB, {
			guild_id: guildId,
			demotion_policy: policyRaw,
		});
		await postAuditLog(env, { ...config, demotion_policy: policyRaw }, {
			title: 'Demotion policy updated',
			description: `Policy set to **${policyRaw}**.`,
			actorId: interaction.member?.user?.id,
			source: 'admin',
			color: AuditColor.info,
		});
		const note =
			policyRaw === 'approval'
				? 'Confirmed leaves and missing players go to the urgent channel for Approve/Reject.'
				: 'Confirmed mismatches apply guest immediately; missing players recheck after 1 hour, then apply guest if still gone.';
		return interactionResponse(`✅ Demotion policy: **${policyRaw}**\n${note}`, true);
	}

	if (list) {
		const { formatDemotionQueueList } = await import('./demotion-policy');
		return interactionResponse(await formatDemotionQueueList(env, guildId), true);
	}

	return interactionResponse(
		`🛡 **Leave-detection policy:** **${config.demotion_policy}**\n` +
			`• \`approval\` (default) — queue confirmed leaves / missing players for urgent-channel approval\n` +
			`• \`yolo\` (auto) — apply guest on confirmed mismatches; missing players wait 1h then apply guest if still gone\n` +
			`• Transport errors never change roles\n` +
			`• Multi-alliance empty tags are never leave-detection candidates\n\n` +
			`Set: \`/server demotion policy:approval\` or \`policy:yolo\`\n` +
			`Queue: \`/server demotion list:true\``,
		true,
	);
}

async function handleServerAssistantCommand(
	env: Env,
	interaction: { guild_id?: string; member?: { permissions?: string } },
	sub: { options?: Array<{ name: string; value?: unknown }> },
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction);
	if (adminError) return adminError;

	const guildId = interaction.guild_id!;
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return interactionResponse('❌ Server not configured. Run `/server setup` first.', true);
	}

	const rolesRaw = getOptionValue(sub.options, 'roles') as string | undefined;
	const aiRaw = getOptionValue(sub.options, 'ai');
	const patch: Partial<GuildConfig> & { guild_id: string } = { guild_id: guildId };

	if (rolesRaw !== undefined) {
		const trimmed = String(rolesRaw).trim();
		if (!trimmed) {
			patch.dm_query_role_ids = [];
		} else {
			const tokens = trimmed.split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean);
			const ids: string[] = [];
			for (const tok of tokens) {
				const m = tok.match(/^(?:<@&)?(\d{15,20})>?$/);
				if (m) ids.push(m[1]);
			}
			if (ids.length === 0 && env.DISCORD_BOT_TOKEN) {
				const roles = await listGuildRoles(env.DISCORD_BOT_TOKEN, guildId);
				for (const tok of tokens) {
					const found = roles.find((r) => r.name.toLowerCase() === tok.toLowerCase());
					if (found) ids.push(found.id);
				}
			}
			patch.dm_query_role_ids = ids;
		}
	}

	if (aiRaw === true || aiRaw === 'true') patch.dm_ai_enabled = true;
	if (aiRaw === false || aiRaw === 'false') patch.dm_ai_enabled = false;

	if (rolesRaw === undefined && aiRaw === undefined) {
		return interactionResponse(
			`🤖 **DM assistant**\n` +
				`• Query roles: ${config.dm_query_role_ids.map((id) => `<@&${id}>`).join(', ') || 'Administrators only'}\n` +
				`• Guild AI flag: ${config.dm_ai_enabled ? 'on' : 'off'} (also needs env \`DM_AI_ENABLED=true\` + AI binding)\n\n` +
				`Admins can DM the bot and say **menu** for guided setup.\n` +
				`Set roles: \`/server assistant roles:@Officer,@Leadership\`\n` +
				`Clear roles: \`/server assistant roles:\` (empty = admins only)`,
			true,
		);
	}

	await upsertGuildConfig(env.STFC_DB, patch);
	const refreshed = await getGuildConfig(env.STFC_DB, guildId);
	await postAuditLog(env, refreshed, {
		title: 'DM assistant settings updated',
		description:
			`Query roles: ${refreshed?.dm_query_role_ids.map((id) => `<@&${id}>`).join(', ') || 'Administrators only'}\n` +
			`AI: ${refreshed?.dm_ai_enabled ? 'on' : 'off'}`,
		source: 'admin',
		color: AuditColor.info,
	});

	return interactionResponse(
		`✅ DM assistant updated.\n` +
			`• Query roles: ${refreshed?.dm_query_role_ids.map((id) => `<@&${id}>`).join(', ') || 'Administrators only'}\n` +
			`• Guild AI flag: ${refreshed?.dm_ai_enabled ? 'on' : 'off'}`,
		true,
	);
}

async function handleServerConsentCommand(
	env: Env,
	interaction: { guild_id?: string; member?: { permissions?: string } },
	sub: { options?: Array<{ name: string; value?: unknown }> },
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction);
	if (adminError) return adminError;

	const guildId = interaction.guild_id!;
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return interactionResponse('❌ Server not configured. Run `/server setup` first.', true);
	}

	const enabledRaw = getOptionValue(sub.options, 'enabled');
	const versionRaw = getOptionValue(sub.options, 'version') as string | undefined;
	const anyOpt = enabledRaw !== undefined || versionRaw !== undefined;

	if (!anyOpt) {
		return interactionResponse(
			`🔐 **Data-processing consent** (before verify)\n` +
				`• Enabled: ${config.data_consent_enabled ? 'yes' : 'no'}\n` +
				`• Version: \`${config.data_consent_version ?? '1'}\`\n\n` +
				`Members must accept linking Discord ↔ stfc.pro before verification runs.\n` +
				`Optional CoC remains under \`/server agreement\` (after verify).\n\n` +
				`Example:\n\`/server consent enabled:true version:2026-07\``,
			true,
		);
	}

	const patch: Partial<import('./types').GuildConfig> & { guild_id: string } = { guild_id: guildId };
	if (enabledRaw === true || enabledRaw === 'true') patch.data_consent_enabled = true;
	if (enabledRaw === false || enabledRaw === 'false') patch.data_consent_enabled = false;
	if (versionRaw !== undefined) {
		patch.data_consent_version = String(versionRaw).trim() || '1';
	}

	await upsertGuildConfig(env.STFC_DB, patch);
	const refreshed = await getGuildConfig(env.STFC_DB, guildId);
	await postAuditLog(env, refreshed, {
		title: 'Data consent settings updated',
		description:
			`Enabled: **${refreshed?.data_consent_enabled ? 'yes' : 'no'}** · ` +
			`Version: \`${refreshed?.data_consent_version ?? '1'}\``,
		source: 'admin',
		color: AuditColor.info,
	});

	return interactionResponse(
		`✅ Data consent settings updated.\n` +
			`• Enabled: ${refreshed?.data_consent_enabled ? 'yes' : 'no'}\n` +
			`• Version: \`${refreshed?.data_consent_version ?? '1'}\``,
		true,
	);
}

async function handleServerAgreementCommand(
	env: Env,
	ctx: ExecutionContext,
	interaction: {
		guild_id?: string;
		application_id?: string;
		token?: string;
		member?: { permissions?: string; user?: { id?: string } };
		user?: { id?: string };
	},
	sub: { options?: Array<{ name: string; value?: unknown }> },
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction);
	if (adminError) return adminError;

	const guildId = interaction.guild_id!;
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return interactionResponse('❌ Server not configured. Run `/server setup` first.', true);
	}

	const enabledRaw = getOptionValue(sub.options, 'enabled');
	const timingRaw = getOptionValue(sub.options, 'timing') as string | undefined;
	const modeRaw = getOptionValue(sub.options, 'mode') as string | undefined;
	const channelRaw = getOptionValue(sub.options, 'channel');
	const messageIdRaw = getOptionValue(sub.options, 'message_id') as string | undefined;
	const versionRaw = getOptionValue(sub.options, 'version') as string | undefined;
	const clearChannel = getOptionValue(sub.options, 'clear_channel') === true;
	const backfill = getOptionValue(sub.options, 'backfill') === true;
	const grantUserRaw = getOptionValue(sub.options, 'user');

	const anyConfigOpt =
		enabledRaw !== undefined ||
		timingRaw !== undefined ||
		modeRaw !== undefined ||
		channelRaw !== undefined ||
		messageIdRaw !== undefined ||
		versionRaw !== undefined ||
		clearChannel;

	if (!anyConfigOpt && !backfill && grantUserRaw == null) {
		return interactionResponse(
			`📜 **Code of conduct / Discord agreement** (after verify)\n` +
				`• Enabled: ${config.agreement_enabled ? 'yes' : 'no'}\n` +
				`• Timing: \`${config.agreement_timing}\` (use after_verify for CoC; data consent is \`/server consent\`)\n` +
				`• Mode: \`${config.agreement_mode}\`\n` +
				`• Channel: ${config.agreement_channel_id ? `<#${config.agreement_channel_id}>` : 'not set'}\n` +
				`• Message ID: ${config.agreement_message_id ?? '—'}\n` +
				`• Version: ${config.agreement_version ?? '—'}\n\n` +
				`Config: \`/server agreement enabled:true timing:after_verify channel:#code-of-conduct version:2026-07\`\n` +
				`Existing members stuck as guest until CoC: \`/server agreement backfill:true\` or \`user:@Them\``,
			true,
		);
	}

	let refreshed = config;
	if (anyConfigOpt) {
		const patch: Partial<GuildConfig> & { guild_id: string } = { guild_id: guildId };
		if (enabledRaw === true || enabledRaw === 'true') patch.agreement_enabled = true;
		if (enabledRaw === false || enabledRaw === 'false') patch.agreement_enabled = false;
		if (timingRaw === 'before_verify' || timingRaw === 'after_verify') {
			patch.agreement_timing = timingRaw;
		}
		if (modeRaw === 'dm_button' || modeRaw === 'channel_react') {
			patch.agreement_mode = modeRaw;
		}
		if (clearChannel) {
			patch.agreement_channel_id = null;
			patch.agreement_message_id = null;
		} else if (channelRaw != null && channelRaw !== '') {
			patch.agreement_channel_id = String(channelRaw);
		}
		if (messageIdRaw !== undefined) {
			const mid = String(messageIdRaw).trim();
			patch.agreement_message_id = mid || null;
		}
		if (versionRaw !== undefined) {
			patch.agreement_version = String(versionRaw).trim() || null;
		}

		await upsertGuildConfig(env.STFC_DB, patch);
		refreshed = (await getGuildConfig(env.STFC_DB, guildId)) ?? config;
		await postAuditLog(env, refreshed, {
			title: 'Agreement settings updated',
			description:
				`Enabled: **${refreshed.agreement_enabled ? 'yes' : 'no'}** · ` +
				`Timing: \`${refreshed.agreement_timing}\` · Mode: \`${refreshed.agreement_mode}\``,
			source: 'admin',
			color: AuditColor.info,
		});
	}

	if (!backfill && grantUserRaw == null) {
		return interactionResponse(
			`✅ Agreement settings updated.\n` +
				`• Enabled: ${refreshed.agreement_enabled ? 'yes' : 'no'}\n` +
				`• Timing: \`${refreshed.agreement_timing}\`\n` +
				`• Mode: \`${refreshed.agreement_mode}\`\n` +
				`• Channel: ${refreshed.agreement_channel_id ? `<#${refreshed.agreement_channel_id}>` : '—'}\n` +
				`• Version: ${refreshed.agreement_version ?? '—'}`,
			true,
		);
	}

	const actorId = interaction.member?.user?.id ?? interaction.user?.id;
	const appId = interaction.application_id ?? env.DISCORD_APPLICATION_ID;
	if (!appId || !interaction.token) {
		return interactionResponse('❌ Missing application id / interaction token for deferred backfill.', true);
	}
	if (!env.DISCORD_BOT_TOKEN) {
		return interactionResponse('❌ DISCORD_BOT_TOKEN is not configured.', true);
	}

	const grantUserId =
		grantUserRaw != null && String(grantUserRaw).trim() !== ''
			? String(grantUserRaw).trim()
			: undefined;

	const deferred = deferredResponse();
	const configSnapshot = refreshed;
	ctx.waitUntil(
		(async () => {
			try {
				const {
					startAgreementBackfillJob,
					runAgreementBackfillWithContinuation,
				} = await import('./agreement');
				const job = await startAgreementBackfillJob(env, configSnapshot, guildId, {
					appId,
					interactionToken: interaction.token!,
					actorId,
					userId: grantUserId,
					configNote: anyConfigOpt ? 'Settings saved. ' : '',
				});
				await runAgreementBackfillWithContinuation(env, configSnapshot, job);
			} catch (err) {
				console.error('Agreement backfill aborted:', err);
				const msg = err instanceof Error ? err.message : 'unknown error';
				await editInteractionResponse(
					appId,
					interaction.token!,
					`❌ Agreement backfill failed: ${msg.slice(0, 400)}`,
					true,
				);
			}
		})(),
	);
	return deferred;
}

async function handleServerVerifyPanelCommand(
	env: Env,
	interaction: {
		guild_id?: string;
		member?: { permissions?: string; user?: { id?: string } };
		user?: { id?: string };
	},
	sub: { name?: string; options?: Array<{ name: string; value?: unknown }> } | undefined,
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction);
	if (adminError) return adminError;

	const guildId = interaction.guild_id!;
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return interactionResponse('❌ Server not configured. Run `/server setup` first.', true);
	}

	const action = sub?.name ?? 'show';
	const statusBlock = (c: typeof config) => {
		const msgLink =
			c.verify_panel_channel_id && c.verify_panel_message_id
				? `https://discord.com/channels/${guildId}/${c.verify_panel_channel_id}/${c.verify_panel_message_id}`
				: '—';
		const inviteOn = c.verification_invite_mode !== 'channel_panel';
		return (
			`🪪 **Verification panel**\n` +
			`• Invite DM on join: **${inviteOn ? 'on' : 'off'}**` +
			` (\`${c.verification_invite_mode}\`` +
			(inviteOn
				? ' — bot DMs new members to start verify'
				: ' — no Invite DM; members use **Start verification**') +
			`)` +
			`\n` +
			`• Panel channel: ${c.verify_panel_channel_id ? `<#${c.verify_panel_channel_id}>` : '—'}\n` +
			`• Panel message: ${msgLink}\n` +
			`• Demotion notify: **${c.demotion_notify}**\n` +
			`_Invite DM ≠ \`/server welcome\` (post-verify welcome)._`
		);
	};

	if (action === 'show' || !action) {
		return interactionResponse(statusBlock(config), true);
	}

	if (action === 'mode') {
		const invite = getOptionValue(sub?.options, 'invite') as string | undefined;
		if (invite !== 'dm' && invite !== 'channel_panel') {
			return interactionResponse('❌ Choose invite: `dm` or `channel_panel`.', true);
		}
		await upsertGuildConfig(env.STFC_DB, {
			guild_id: guildId,
			verification_invite_mode: invite,
		});
		const refreshed = await getGuildConfig(env.STFC_DB, guildId);
		await postAuditLog(env, refreshed, {
			title: 'Invite DM mode updated',
			description:
				`Invite DM on join → **${invite === 'dm' ? 'on' : 'off'}** (\`${invite}\`)`,
			source: 'admin',
			color: AuditColor.info,
		});
		return interactionResponse(statusBlock(refreshed ?? config), true);
	}

	if (action === 'demotion-notify') {
		const mode = getOptionValue(sub?.options, 'mode') as string | undefined;
		if (mode !== 'dm' && mode !== 'channel' && mode !== 'none') {
			return interactionResponse('❌ Choose mode: `dm`, `channel`, or `none`.', true);
		}
		if (mode === 'channel' && !config.verify_panel_channel_id) {
			return interactionResponse(
				'⚠️ Set a verify panel channel first with `/server verify-panel post`, then set demotion-notify to **channel**.',
				true,
			);
		}
		await upsertGuildConfig(env.STFC_DB, {
			guild_id: guildId,
			demotion_notify: mode,
		});
		const refreshed = await getGuildConfig(env.STFC_DB, guildId);
		await postAuditLog(env, refreshed, {
			title: 'Demotion notify mode updated',
			description: `demotion_notify → **${mode}**`,
			source: 'admin',
			color: AuditColor.info,
		});
		return interactionResponse(statusBlock(refreshed ?? config), true);
	}

	if (action === 'post') {
		const channelRaw = getOptionValue(sub?.options, 'channel');
		const channelId = channelRaw != null ? String(channelRaw) : '';
		if (!/^\d{15,20}$/.test(channelId)) {
			return interactionResponse('❌ Provide a valid text channel.', true);
		}
		const setInviteRaw = getOptionValue(sub?.options, 'set_invite_mode');
		const setInviteMode = setInviteRaw !== false && setInviteRaw !== 'false';

		if (!env.DISCORD_BOT_TOKEN) {
			return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
		}

		const {
			buildVerifyPanelContent,
			verifyStartCustomId,
		} = await import('./verification-access');
		const content = buildVerifyPanelContent(config);
		const components = [
			{
				type: 1 as const,
				components: [
					{
						type: 2 as const,
						style: 1 as const,
						label: 'Start verification',
						custom_id: verifyStartCustomId(guildId),
					},
				],
			},
		];

		let messageId = config.verify_panel_message_id;
		const sameChannel =
			config.verify_panel_channel_id === channelId &&
			messageId &&
			/^\d{15,20}$/.test(messageId);

		try {
			if (sameChannel && messageId) {
				await editChannelMessage(env.DISCORD_BOT_TOKEN, channelId, messageId, {
					content,
					components,
				});
			} else {
				const msg = await sendMessageWithComponents(env.DISCORD_BOT_TOKEN, channelId, {
					content,
					components,
				});
				messageId = msg.id;
				try {
					await pinChannelMessage(env.DISCORD_BOT_TOKEN, channelId, messageId);
				} catch (err) {
					console.warn('Pin verify panel failed:', err);
				}
			}
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			return interactionResponse(`❌ Failed to post panel: ${detail.slice(0, 300)}`, true);
		}

		await upsertGuildConfig(env.STFC_DB, {
			guild_id: guildId,
			verify_panel_channel_id: channelId,
			verify_panel_message_id: messageId ?? null,
			...(setInviteMode ? { verification_invite_mode: 'channel_panel' as const } : {}),
		});
		const refreshed = await getGuildConfig(env.STFC_DB, guildId);
		await postAuditLog(env, refreshed, {
			title: 'Verification panel posted',
			description:
				`Panel in <#${channelId}>` +
				(messageId ? ` · message \`${messageId}\`` : '') +
				(setInviteMode ? ' · Invite DM on join → **off** (`channel_panel`)' : ''),
			source: 'admin',
			color: AuditColor.info,
		});
		return interactionResponse(
			`✅ Verification panel ${sameChannel ? 'updated' : 'posted'} in <#${channelId}>.` +
				(setInviteMode ? ' Invite DM on join is **off**.' : '') +
				`\n\n` +
				statusBlock(refreshed ?? config),
			true,
		);
	}

	return interactionResponse('❌ Unknown verify-panel action. Use show / post / mode / demotion-notify.', true);
}

async function handleServerWelcomeCommand(
	env: Env,
	interaction: {
		guild_id?: string;
		member?: { permissions?: string; user?: { id?: string } };
		user?: { id?: string };
	},
	sub: { options?: Array<{ name: string; value?: unknown }> },
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction);
	if (adminError) return adminError;

	const guildId = interaction.guild_id!;
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return interactionResponse('❌ Server not configured. Run `/server setup` first.', true);
	}

	const enabledRaw = getOptionValue(sub.options, 'enabled');
	const messageLinkRaw = getOptionValue(sub.options, 'message_link') as string | undefined;
	const channelRaw = getOptionValue(sub.options, 'channel');
	const messageIdRaw = getOptionValue(sub.options, 'message_id') as string | undefined;
	const clear = getOptionValue(sub.options, 'clear') === true;
	const preview = getOptionValue(sub.options, 'preview') === true;
	const sendUserRaw = getOptionValue(sub.options, 'send_user');
	const force = getOptionValue(sub.options, 'force') === true || getOptionValue(sub.options, 'force') === 'true';

	const anyOpt =
		enabledRaw !== undefined ||
		messageLinkRaw !== undefined ||
		channelRaw !== undefined ||
		messageIdRaw !== undefined ||
		clear ||
		preview ||
		sendUserRaw != null;

	const statusBlock = (c: typeof config) =>
		`📬 **Welcome DM**\n` +
		`• Enabled: ${c.welcome_dm_enabled ? 'yes' : 'no'}\n` +
		`• Source: ${
			c.welcome_dm_channel_id && c.welcome_dm_message_id
				? `https://discord.com/channels/${guildId}/${c.welcome_dm_channel_id}/${c.welcome_dm_message_id}`
				: 'not set'
		}\n` +
		`• Channel: ${c.welcome_dm_channel_id ? `<#${c.welcome_dm_channel_id}>` : '—'}\n` +
		`• Message ID: ${c.welcome_dm_message_id ?? '—'}\n` +
		`• Auto retries: max **2** attempts per player (then stops; use \`send_user\` + \`force:true\`)\n\n` +
		`Edit the linked Discord post to change recommended channels (use \`<#…>\` mentions). ` +
		`The bot appends the member’s personal channel after full access (and after agreement if required).\n\n` +
		`Example:\n\`/server welcome enabled:true message_link:https://discord.com/channels/…/…/…\`\n` +
		`Manual send: \`/server welcome send_user:@Member force:true\``;

	if (!anyOpt) {
		return interactionResponse(statusBlock(config), true);
	}

	if (sendUserRaw != null && sendUserRaw !== '') {
		const userId = String(sendUserRaw);
		if (!/^\d{15,20}$/.test(userId)) {
			return interactionResponse('❌ `send_user` must be a Discord member.', true);
		}
		if (!env.DISCORD_BOT_TOKEN) {
			return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
		}
		const player = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
		if (!player) {
			return interactionResponse(`❌ <@${userId}> is not on the verified roster.`, true);
		}
		const { sendWelcomeDmIfNeeded, welcomeDmConfigured } = await import('./welcome-dm');
		if (!welcomeDmConfigured(config)) {
			return interactionResponse(
				'❌ Welcome DM is not fully configured. Set `enabled:true` and a `message_link` first.',
				true,
			);
		}
		if (player.welcome_dm_sent_at && !force) {
			return interactionResponse(
				`ℹ️ <@${userId}> already has welcome DM stamped (<t:${Math.floor(Date.parse(player.welcome_dm_sent_at) / 1000)}:R>). ` +
					`Force does not re-send after success.`,
				true,
			);
		}
		if (!force && (player.welcome_dm_attempts ?? 0) >= 2) {
			return interactionResponse(
				`⚠️ <@${userId}> already used **${player.welcome_dm_attempts}** auto attempts. ` +
					`Re-run with \`force:true\` to try again.`,
				true,
			);
		}
		const welcome = await sendWelcomeDmIfNeeded(
			env,
			config,
			guildId,
			userId,
			player.personal_channel_id,
			{ force: true },
		);
		await postAuditLog(env, config, {
			title: 'Welcome DM manual send',
			description:
				`<@${userId}> **${player.player_name ?? '—'}**` +
				(welcome.note ? ` — ${welcome.note}` : welcome.sent ? ' — sent' : ' — not sent'),
			actorId: interaction.member?.user?.id ?? interaction.user?.id,
			source: 'admin',
			color: welcome.sent ? AuditColor.success : AuditColor.warn,
		});
		return interactionResponse(
			welcome.sent
				? `✅ Welcome DM sent to <@${userId}>.`
				: `❌ Welcome DM not sent${welcome.note ? `: ${welcome.note}` : '.'}`,
			true,
		);
	}

	const { parseDiscordMessageLink, previewWelcomeDm } = await import('./welcome-dm');
	const patch: Partial<import('./types').GuildConfig> & { guild_id: string } = { guild_id: guildId };

	if (clear) {
		patch.welcome_dm_channel_id = null;
		patch.welcome_dm_message_id = null;
	} else if (messageLinkRaw !== undefined && String(messageLinkRaw).trim()) {
		const parsed = parseDiscordMessageLink(String(messageLinkRaw));
		if (!parsed) {
			return interactionResponse(
				'❌ Invalid `message_link`. Use **Copy Message Link** from Discord (…/channels/guild/channel/message).',
				true,
			);
		}
		if (parsed.guildId !== guildId) {
			return interactionResponse('❌ That message link is for a different Discord server.', true);
		}
		patch.welcome_dm_channel_id = parsed.channelId;
		patch.welcome_dm_message_id = parsed.messageId;
	} else {
		if (channelRaw != null && channelRaw !== '') {
			patch.welcome_dm_channel_id = String(channelRaw);
		}
		if (messageIdRaw !== undefined) {
			const mid = String(messageIdRaw).trim();
			if (mid && !/^\d{15,20}$/.test(mid)) {
				return interactionResponse('❌ `message_id` must be a Discord snowflake.', true);
			}
			patch.welcome_dm_message_id = mid || null;
		}
	}

	if (enabledRaw === true || enabledRaw === 'true') patch.welcome_dm_enabled = true;
	if (enabledRaw === false || enabledRaw === 'false') patch.welcome_dm_enabled = false;

	const configTouched =
		Object.prototype.hasOwnProperty.call(patch, 'welcome_dm_enabled') ||
		Object.prototype.hasOwnProperty.call(patch, 'welcome_dm_channel_id') ||
		Object.prototype.hasOwnProperty.call(patch, 'welcome_dm_message_id');

	if (configTouched) {
		await upsertGuildConfig(env.STFC_DB, patch);
		const refreshed = await getGuildConfig(env.STFC_DB, guildId);
		await postAuditLog(env, refreshed, {
			title: 'Welcome DM settings updated',
			description:
				`Enabled: **${refreshed?.welcome_dm_enabled ? 'yes' : 'no'}** · ` +
				`Source: ${
					refreshed?.welcome_dm_channel_id && refreshed?.welcome_dm_message_id
						? `<#${refreshed.welcome_dm_channel_id}> / \`${refreshed.welcome_dm_message_id}\``
						: 'cleared'
				}`,
			source: 'admin',
			color: AuditColor.info,
		});
	}

	const refreshed = await getGuildConfig(env.STFC_DB, guildId);
	if (!refreshed) {
		return interactionResponse('❌ Failed to reload config.', true);
	}

	if (preview) {
		if (!env.DISCORD_BOT_TOKEN) {
			return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
		}
		const userId = interaction.member?.user?.id ?? interaction.user?.id;
		const player = userId ? await getVerifiedPlayer(env.STFC_DB, guildId, userId) : null;
		const { resolveLocale } = await import('./i18n');
		const locale = resolveLocale(player?.preferred_locale);
		const result = await previewWelcomeDm(
			env.DISCORD_BOT_TOKEN,
			refreshed,
			locale,
			player?.personal_channel_id ?? '000000000000000000',
		);
		if (!result.ok) {
			return interactionResponse(`❌ Preview failed: ${result.error}\n\n${statusBlock(refreshed)}`, true);
		}
		const embedNote = result.embeds?.length
			? `\n_(Source has ${result.embeds.length} embed(s) — those are forwarded in the real DM.)_`
			: '';
		return interactionResponse(
			`**Welcome DM preview**${embedNote}\n\n${result.content || '_(empty content — embeds only)_'}\n\n---\n${statusBlock(refreshed)}`,
			true,
		);
	}

	return interactionResponse(
		(configTouched ? '✅ Welcome DM settings updated.\n\n' : '') + statusBlock(refreshed),
		true,
	);
}

async function handleServerOnboardingCommand(
	env: Env,
	interaction: { guild_id?: string; member?: { permissions?: string } },
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction);
	if (adminError) return adminError;

	const guildId = interaction.guild_id!;
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return interactionResponse('❌ Server not configured. Run `/server setup` first.', true);
	}

	const { formatOnboardingPath } = await import('./onboarding-path');
	return interactionResponse(formatOnboardingPath(config), true);
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

async function handleServerVerifyCommand(
	env: Env,
	ctx: ExecutionContext,
	interaction: {
		guild_id?: string;
		member?: { permissions?: string; user?: { id: string } };
		token: string;
		application_id?: string;
	},
	sub: {
		options?: Array<{ name: string; value?: unknown; type?: number }>;
	},
	resolved?: {
		attachments?: Record<string, { url: string; filename?: string }>;
	},
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction as any);
	if (adminError) return adminError;

	const guildId = interaction.guild_id!;
	const adminId = interaction.member?.user?.id;
	const targetUserId = resolveRequiredUserOption(sub.options);
	if (!targetUserId) {
		return interactionResponse('❌ Provide `user:` — the Discord member to verify.', true);
	}

	const link = getOptionValue(sub.options, 'link') as string | undefined;
	if (!link?.trim()) {
		return interactionResponse('❌ Provide `link:` — their stfc.pro profile URL.', true);
	}

	const sendWelcomeRaw = getOptionValue(sub.options, 'send_welcome');
	const sendWelcomeDm = sendWelcomeRaw === true || sendWelcomeRaw === 'true';

	let screenshotUrl: string | undefined;
	const screenshotOption = sub.options?.find((opt) => opt.name === 'screenshot');
	if (screenshotOption?.value && resolved?.attachments) {
		const attachment = resolved.attachments[String(screenshotOption.value)];
		if (attachment?.url) screenshotUrl = attachment.url;
	}

	const appId = interaction.application_id ?? env.DISCORD_APPLICATION_ID;
	if (!appId) {
		return interactionResponse('❌ DISCORD_APPLICATION_ID not configured.', true);
	}

	const deferred = deferredResponse();
	ctx.waitUntil(
		(async () => {
			const result = await processVerification(
				env,
				guildId,
				targetUserId,
				link.trim(),
				screenshotUrl,
				adminId
					? { manualByUserId: adminId, sendWelcomeDm, offerReassignConfirm: true }
					: undefined,
			);
			const content = typeof result === 'string' ? result : result.content;
			const components = typeof result === 'string' ? undefined : result.components;
			await editInteractionResponse(appId, interaction.token, content, true, {
				components,
			});
		})(),
	);

	return deferred;
}

async function handleServerTestInviteCommand(
	env: Env,
	interaction: { guild_id?: string; member?: { permissions?: string; user?: { id: string } } },
	sub: { options?: Array<{ name: string; value?: unknown; type?: number }> },
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction as any);
	if (adminError) return adminError;

	const guildId = interaction.guild_id!;
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return interactionResponse('❌ Server not configured. Run `/server setup` first.', true);
	}
	if (shouldSkipOutboundDm(config)) {
		return interactionResponse(
			`[TESTING] Live invite DMs are disabled in **testing** mode.\n` +
				`Preview with \`/test-dm kind:invite user:@Them\` (defaults to you).\n` +
				`Go live when ready: \`/server deploy mode:live\``,
			true,
		);
	}

	const userId = resolveTargetUserId(interaction as any, sub.options);
	if (!userId) return interactionResponse('❌ Could not resolve target user.', true);

	if (await isUserExcluded(env.STFC_DB, guildId, userId)) {
		return interactionResponse(
			`⚠️ <@${userId}> is on the exclude list — no invite DM will be sent.\n` +
				`Remove them first with \`/server exclude-remove user:@Them\`.`,
			true,
		);
	}

	const before = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
	const alreadyOnboarded =
		before &&
		(before.verification_status === 'active' ||
			before.verification_status === 'guest' ||
			before.verification_status === 'verified');

	if (alreadyOnboarded) {
		return interactionResponse(
			`ℹ️ <@${userId}> is already **${before!.verification_status}** — \`/server test-invite\` will not re-send or reset them.\n` +
				`Use \`/test-dm kind:invite user:@Them\` to preview the invite DM without changing status.\n` +
				`Or \`/server test-reset\` first if you truly want a live re-onboarding.`,
			true,
		);
	}

	await recordGuildMember(env.STFC_DB, guildId, userId, null);
	const dm = await inviteNewMember(env, guildId, userId, 'user');
	if (dm.ok) {
		await markMemberInvited(env.STFC_DB, guildId, userId);
		return interactionResponse(
			`✅ Live verification invite sent to <@${userId}>.\n` +
				`Note: this may set status to \`pending_screenshot\` for not-yet-verified users.\n` +
				`For previews without status changes, use \`/test-dm\`.`,
			true,
		);
	}

	return interactionResponse(
		`❌ Failed to send DM: ${dm.errorMessage}${typeof dm.status === 'number' ? ` (HTTP ${dm.status})` : ''}`,
		true,
	);
}

async function handleServerTestDmCommand(
	env: Env,
	interaction: {
		guild_id?: string;
		member?: { permissions?: string; user?: { id: string } };
	},
	sub: { options?: Array<{ name: string; value?: unknown; type?: number }> },
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction as any);
	if (adminError) return adminError;

	const guildId = interaction.guild_id!;
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return interactionResponse('❌ Server not configured. Run `/server setup` first.', true);
	}
	if (!env.DISCORD_BOT_TOKEN) {
		return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
	}

	const kindRaw = String(getOptionValue(sub.options, 'kind') ?? '');
	const { isTestDmKind, sendTestDms } = await import('./test-dms');
	if (!isTestDmKind(kindRaw)) {
		return interactionResponse(
			'❌ Provide `kind:` invite | agreement | welcome | demote_mismatch | demote_missing | all',
			true,
		);
	}

	const userId = resolveTargetUserId(interaction as any, sub.options);
	if (!userId) return interactionResponse('❌ Could not resolve target user.', true);

	try {
		const { sent, skipped } = await sendTestDms(env, config, userId, kindRaw);
		return interactionResponse(
			`📬 **Test DM** to <@${userId}> (no verification status change)\n` +
				(sent.length ? `• Sent: ${sent.join(', ')}\n` : '• Sent: _(none)_\n') +
				(skipped.length ? `• Skipped:\n${skipped.map((s) => `  – ${s}`).join('\n')}` : ''),
			true,
		);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return interactionResponse(`❌ Test DM failed: ${msg}`, true);
	}
}

async function handleServerExcludeCommand(
	env: Env,
	interaction: { guild_id?: string; member?: { permissions?: string; user?: { id: string } } },
	sub: {
		name: string;
		options?: Array<{ name: string; value?: unknown; type?: number }>;
	},
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction as any);
	if (adminError) return adminError;

	const guildId = interaction.guild_id!;
	const action =
		sub.name === 'exclude-add'
			? 'add'
			: sub.name === 'exclude-remove'
				? 'remove'
				: sub.name === 'exclude-list'
					? 'list'
					: null;
	if (!action) {
		return interactionResponse(
			'Use `/server exclude-add`, `/server exclude-remove`, or `/server exclude-list`.',
			true,
		);
	}

	const opts = sub.options;
	const actorId = interaction.member?.user?.id;

	if (action === 'list') {
		const rows = await listExcludedUsers(env.STFC_DB, guildId);
		if (rows.length === 0) {
			return interactionResponse(
				'No excluded users. Discord bots are skipped automatically without being listed here.',
				true,
			);
		}
		const lines = rows.slice(0, 50).map((r) => {
			const reason = r.reason ? ` — ${r.reason}` : '';
			const by = r.excluded_by ? ` · by <@${r.excluded_by}>` : '';
			return `• <@${r.discord_user_id}>${reason}${by}`;
		});
		const extra = rows.length > 50 ? `\n…and ${rows.length - 50} more` : '';
		return interactionResponse(
			`🚫 **Excluded users** (${rows.length}) — skipped for invites & unverified stats\n` +
				`${lines.join('\n')}${extra}`,
			true,
		);
	}

	const userId = resolveRequiredUserOption(opts);
	if (!userId) {
		return interactionResponse('❌ Provide `user:`.', true);
	}

	if (action === 'add') {
		const reason = (getOptionValue(opts, 'reason') as string | undefined)?.trim() || null;
		await excludeGuildUser(env.STFC_DB, guildId, userId, {
			reason,
			excludedBy: actorId ?? null,
		});
		await recordGuildMember(env.STFC_DB, guildId, userId, null);
		await markMemberInvited(env.STFC_DB, guildId, userId);

		const config = await getGuildConfig(env.STFC_DB, guildId);
		await postAuditLog(env, config, {
			title: 'User excluded from verification',
			description:
				`<@${userId}> will not receive verification DMs and is omitted from unverified roster stats.` +
				(reason ? `\nReason: ${reason}` : ''),
			actorId,
			source: 'admin',
			color: AuditColor.warn,
		});

		return interactionResponse(
			`✅ Excluded <@${userId}> from verification invites and unverified stats.` +
				(reason ? `\nReason: ${reason}` : ''),
			true,
		);
	}

	if (action === 'remove') {
		const removed = await unexcludeGuildUser(env.STFC_DB, guildId, userId);
		if (!removed) {
			return interactionResponse(`ℹ️ <@${userId}> was not on the exclude list.`, true);
		}
		const config = await getGuildConfig(env.STFC_DB, guildId);
		await postAuditLog(env, config, {
			title: 'User un-excluded',
			description: `<@${userId}> can receive verification invites again (use \`/server test-invite\` if needed).`,
			actorId,
			source: 'admin',
			color: AuditColor.info,
		});
		return interactionResponse(
			`✅ Removed <@${userId}> from the exclude list. Use \`/server test-invite\` to send a verification DM.`,
			true,
		);
	}

	return interactionResponse('❌ Unknown exclude action.', true);
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
			`\n\nUse with \`/channels map category_map:A-F=<id>\`.`,
		true,
	);
}

async function handleDiplomacyChannelsCommand(
	env: Env,
	ctx: ExecutionContext,
	interaction: {
		application_id?: string;
		token: string;
		member?: { user?: { id?: string } };
		data?: {
			resolved?: {
				channels?: Record<
					string,
					{
						id: string;
						name?: string;
						type?: number;
						parent_id?: string | null;
						guild_id?: string | null;
					}
				>;
			};
		};
	},
	guildId: string,
	config: GuildConfig,
	options: Array<{ name: string; value?: unknown }> | undefined,
): Promise<Response> {
	const actorId = interaction.member?.user?.id;
	const resolvedChannels = interaction.data?.resolved?.channels;
	const disableRaw = getOptionValue(options, 'disable');
	const disable = disableRaw === true || disableRaw === 'true';
	const enableRaw = getOptionValue(options, 'enable');
	const enable = enableRaw === true || enableRaw === 'true';
	const syncAllRaw = getOptionValue(options, 'sync_all');
	const syncAll = syncAllRaw === true || syncAllRaw === 'true';
	const createMissingRaw = getOptionValue(options, 'create_missing');
	const createMissing = createMissingRaw === true || createMissingRaw === 'true';
	const createTagRaw = (getOptionValue(options, 'create_tag') as string | undefined)?.trim();
	const linkTagRaw = (getOptionValue(options, 'link_tag') as string | undefined)?.trim();
	const channelOpt = getOptionValue(options, 'channel');
	const languagesRaw = getOptionValue(options, 'languages');
	const languagesProvided = languagesRaw !== undefined && languagesRaw !== null;
	const applyPermsRaw = getOptionValue(options, 'apply_permissions');
	const everyoneRaw = getOptionValue(options, 'everyone_can_view');
	const categoryOpt = getOptionValue(options, 'category');
	const viewRolesRaw = getOptionValue(options, 'view_roles');
	const writeRolesRaw = getOptionValue(options, 'write_roles');
	const writeRanksRaw = getOptionValue(options, 'write_ranks') as string | undefined;
	const nameTemplateRaw = getOptionValue(options, 'name_template');

	// sync_all defaults to skip per-channel permission rewrites (move/rename only).
	// create/link still default to applying permissions unless apply_permissions:false.
	const applyPermissions =
		applyPermsRaw === undefined || applyPermsRaw === null
			? !syncAll
			: applyPermsRaw === true || applyPermsRaw === 'true';

	let languagesForTag: string[] | undefined;
	if (languagesProvided) {
		const parsed = parseDiplomacyLanguagesOption(String(languagesRaw));
		if (!parsed.ok) {
			return interactionResponse(`❌ ${parsed.error}`, true);
		}
		languagesForTag = parsed.locales;
	}

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
		await postAuditLog(env, { ...config, diplomacy_enabled: false }, {
			title: 'Diplomacy channels disabled',
			actorId,
			source: 'admin',
			color: AuditColor.warn,
		});
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
		await postAuditLog(env, config, {
			title: enable ? 'Diplomacy channels enabled/updated' : 'Diplomacy config updated',
			actorId,
			source: 'admin',
			color: AuditColor.info,
		});
	}

	const gapsRaw = getOptionValue(options, 'gaps');
	const gaps = gapsRaw === true || gapsRaw === 'true';
	if (gaps) {
		const players = await listActiveVerifiedPlayers(env.STFC_DB, guildId);
		const verifiedTags = players
			.map((p) => p.alliance_tag?.trim())
			.filter((t): t is string => Boolean(t));
		const report = formatDiplomacyGapsReport({
			trackedTags: config.tracked_alliance_tags ?? [],
			diplomacyTags: Object.keys(config.diplomacy_channel_map ?? {}),
			verifiedTags,
		});
		return interactionResponse(report.summary, true);
	}

	const specialAction = String(getOptionValue(options, 'special') ?? '')
		.trim()
		.toLowerCase();
	const specialClear = specialAction === 'clear';
	const specialCreate = specialAction === 'create';
	const specialLink = specialAction === 'link';
	const specialNameRaw = (getOptionValue(options, 'special_name') as string | undefined)?.trim();
	const specialPlacementRaw = (getOptionValue(options, 'special_placement') as string | undefined)
		?.trim();
	const specialCategoryOpt = getOptionValue(options, 'special_category');

	if (specialAction && !specialClear && !specialCreate && !specialLink) {
		return interactionResponse(
			'❌ `special:` must be `create`, `link`, or `clear`.',
			true,
		);
	}

	if (specialClear) {
		await upsertGuildConfig(env.STFC_DB, {
			guild_id: guildId,
			diplomacy_special_channel_id: null,
			diplomacy_special_category_id: null,
		});
		await postAuditLog(env, config, {
			title: 'Diplomacy special channel cleared',
			description: 'Unlinked non-listed alliances channel (Discord channel kept).',
			actorId,
			source: 'admin',
			color: AuditColor.warn,
		});
		return interactionResponse(
			'✅ Cleared special (non-listed) diplomacy channel link. Discord channel was not deleted.',
			true,
		);
	}

	if (specialCreate || specialLink) {
		if (!env.DISCORD_BOT_TOKEN) {
			return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
		}
		if (!diplomacyChannelsEnabled(config)) {
			await upsertGuildConfig(env.STFC_DB, { guild_id: guildId, diplomacy_enabled: true });
			config = (await getGuildConfig(env.STFC_DB, guildId))!;
		}

		const placement = specialPlacementRaw
			? normalizeDiplomacySpecialPlacement(specialPlacementRaw)
			: normalizeDiplomacySpecialPlacement(config.diplomacy_special_placement);
		const categoryId =
			specialCategoryOpt != null && /^\d{15,20}$/.test(String(specialCategoryOpt))
				? String(specialCategoryOpt)
				: undefined;

		if (specialNameRaw || specialPlacementRaw || categoryId) {
			await upsertGuildConfig(env.STFC_DB, {
				guild_id: guildId,
				...(specialNameRaw
					? { diplomacy_special_name: resolveDiplomacySpecialName(config, specialNameRaw) }
					: {}),
				...(specialPlacementRaw ? { diplomacy_special_placement: placement } : {}),
				...(categoryId ? { diplomacy_special_category_id: categoryId } : {}),
			});
			config = (await getGuildConfig(env.STFC_DB, guildId))!;
		}

		let result;
		if (specialLink) {
			const channelId = channelOpt != null ? String(channelOpt) : '';
			if (!/^\d{15,20}$/.test(channelId)) {
				return interactionResponse(
					'❌ `special_link` requires a valid `channel:`.',
					true,
				);
			}
			result = await linkDiplomacySpecialChannel(
				env.DISCORD_BOT_TOKEN,
				config,
				guildId,
				channelId,
				{
					name: specialNameRaw,
					placement,
					categoryId,
					applyPermissions,
					knownChannel: (() => {
						const ch = resolvedChannels?.[channelId];
						if (!ch) return null;
						return {
							id: ch.id,
							name: ch.name ?? '',
							type: ch.type ?? -1,
							parent_id: ch.parent_id ?? null,
							guild_id: ch.guild_id ?? guildId,
						};
					})(),
				},
			);
		} else {
			result = await ensureDiplomacySpecialChannel(
				env.DISCORD_BOT_TOKEN,
				config,
				guildId,
				{
					name: specialNameRaw,
					placement,
					categoryId,
					applyPermissions,
				},
			);
		}

		if (!result.ok) {
			return interactionResponse(`❌ Special channel failed: ${result.error}`, true);
		}

		await upsertGuildConfig(env.STFC_DB, {
			guild_id: guildId,
			diplomacy_enabled: true,
			diplomacy_special_channel_id: result.channelId,
			diplomacy_special_name: result.name,
			diplomacy_special_placement: result.placement,
			diplomacy_special_category_id:
				result.placement === 'special_category' ? result.categoryId : null,
		});
		await postAuditLog(env, config, {
			title: specialLink ? 'Diplomacy special channel linked' : 'Diplomacy special channel updated',
			description: `<#${result.channelId}> (\`${result.name}\`, ${result.placement})`,
			actorId,
			source: 'admin',
			color: AuditColor.success,
		});
		return interactionResponse(
			`✅ ${result.created ? 'Created' : specialLink ? 'Linked' : 'Updated'} special diplomacy channel: <#${result.channelId}>` +
				` (\`${result.name}\`, ${result.placement})` +
				(result.renamed ? ' (renamed)' : '') +
				(result.moved ? ' (moved)' : '') +
				(applyPermissions
					? ' Applied view/write permissions.'
					: ' Left permissions unchanged where possible.'),
			true,
		);
	}

	if (createTagRaw) {
		if (!env.DISCORD_BOT_TOKEN) return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
		if (!diplomacyChannelsEnabled(config)) {
			await upsertGuildConfig(env.STFC_DB, { guild_id: guildId, diplomacy_enabled: true });
			config = (await getGuildConfig(env.STFC_DB, guildId))!;
		}
		let preferredLocales = config.diplomacy_preferred_locales ?? {};
		if (languagesForTag !== undefined) {
			preferredLocales = withDiplomacyPreferredLocales(
				preferredLocales,
				createTagRaw,
				languagesForTag,
			);
			config = { ...config, diplomacy_preferred_locales: preferredLocales };
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
			diplomacy_preferred_locales: preferredLocales,
		});
		const flags = formatLocaleFlagSuffix(preferredLocales[result.tag] ?? []);
		await postAuditLog(env, { ...config, diplomacy_channel_map: nextMap }, {
			title: result.created ? 'Diplomacy channel created' : 'Diplomacy channel updated',
			description:
				`**[${result.tag}]** → <#${result.channelId}>` + (flags ? ` ${flags}` : ''),
			actorId,
			source: 'admin',
			color: AuditColor.success,
		});
		return interactionResponse(
			`✅ ${result.created ? 'Created' : 'Updated'} diplomacy channel for **[${result.tag}]**: <#${result.channelId}>` +
				(flags ? ` ${flags}` : '') +
				(result.renamed ? ' (renamed)' : '') +
				(result.moved ? ' (moved to category)' : '') +
				`\nView: ${config.diplomacy_everyone_can_view ? '@everyone' : 'role-restricted'}; ` +
				`write roles/ranks applied from config.` +
				(languagesForTag !== undefined
					? `\nLanguages: ${flags || 'none (cleared)'}.`
					: ''),
			true,
		);
	}

	if (linkTagRaw) {
		if (!env.DISCORD_BOT_TOKEN) return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
		const channelId = channelOpt != null ? String(channelOpt) : '';
		if (!/^\d{15,20}$/.test(channelId)) {
			return interactionResponse('❌ `link_tag` requires a valid `channel:`.', true);
		}
		let preferredLocales = config.diplomacy_preferred_locales ?? {};
		if (languagesForTag !== undefined) {
			preferredLocales = withDiplomacyPreferredLocales(
				preferredLocales,
				linkTagRaw,
				languagesForTag,
			);
			config = { ...config, diplomacy_preferred_locales: preferredLocales };
		}
		const result = await linkDiplomacyChannel(
			env.DISCORD_BOT_TOKEN,
			config,
			guildId,
			linkTagRaw,
			channelId,
			{
				applyPermissions,
				knownChannel: (() => {
					const ch = resolvedChannels?.[channelId];
					if (!ch) return null;
					return {
						id: ch.id,
						name: ch.name ?? '',
						type: ch.type ?? -1,
						parent_id: ch.parent_id ?? null,
						guild_id: ch.guild_id ?? guildId,
					};
				})(),
			},
		);
		if (!result.ok) {
			return interactionResponse(`❌ Failed to link diplomacy channel: ${result.error}`, true);
		}
		const nextMap = { ...config.diplomacy_channel_map, [result.tag]: result.channelId };
		await upsertGuildConfig(env.STFC_DB, {
			guild_id: guildId,
			diplomacy_enabled: true,
			diplomacy_channel_map: nextMap,
			diplomacy_preferred_locales: preferredLocales,
		});
		const flags = formatLocaleFlagSuffix(preferredLocales[result.tag] ?? []);
		await postAuditLog(env, { ...config, diplomacy_channel_map: nextMap }, {
			title: 'Diplomacy channel linked',
			description:
				`**[${result.tag}]** → <#${result.channelId}>` + (flags ? ` ${flags}` : ''),
			actorId,
			source: 'admin',
			color: AuditColor.info,
		});
		return interactionResponse(
			`✅ Linked <#${result.channelId}> as diplomacy for **[${result.tag}]**.` +
				(flags ? ` ${flags}` : '') +
				(result.renamed ? ' Renamed to slug.' : '') +
				(result.moved ? ' Moved to diplomacy category.' : '') +
				(applyPermissions
					? ' Applied configured view/write permissions.'
					: ' Left existing channel permissions unchanged.') +
				(languagesForTag !== undefined
					? `\nLanguages: ${flags || 'none (cleared)'}.`
					: ''),
			true,
		);
	}

	if (languagesForTag !== undefined) {
		return interactionResponse(
			'❌ `languages:` requires `create_tag:` or `link_tag:` ' +
				'(e.g. `/diplomacy create_tag:ABCD languages:en,fr`).',
			true,
		);
	}

	const archiveSyncRaw = getOptionValue(options, 'archive_sync');
	const archiveSync = archiveSyncRaw === true || archiveSyncRaw === 'true';
	if (archiveSync) {
		if (!env.DISCORD_BOT_TOKEN) {
			return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
		}
		if (!diplomacyChannelsEnabled(config)) {
			return interactionResponse(
				'❌ Diplomacy is disabled. Enable first: `/diplomacy enable:true`',
				true,
			);
		}

		const softLimitRaw = getOptionValue(options, 'soft_limit');
		const softLimitProvided =
			softLimitRaw != null && Number.isFinite(Number(softLimitRaw));
		const softLimit = resolveDiplomacySoftLimit(
			config,
			softLimitProvided ? Number(softLimitRaw) : null,
		);
		if (softLimitProvided) {
			await persistDiplomacySoftLimit(env, guildId, softLimit);
			config.diplomacy_soft_limit = softLimit;
		}
		const categoryNameTemplate = (
			(getOptionValue(options, 'category_name_template') as string | undefined)?.trim() ||
			'Diplomacy Archive {range}'
		);
		const planOnlyRaw = getOptionValue(options, 'plan');
		const planOnly = planOnlyRaw === true || planOnlyRaw === 'true';
		const archiveCategoryOpt = getOptionValue(options, 'archive_category');
		const archiveSourcesRaw = getOptionValue(options, 'archive_sources') as string | undefined;

		const sourceCategoryIds = parseArchiveSourceCategoryIds(archiveSourcesRaw, [
			archiveCategoryOpt != null ? String(archiveCategoryOpt) : null,
			config.diplomacy_archive_category_id,
			...Object.values(config.diplomacy_archive_category_map ?? {}),
		]);

		if (sourceCategoryIds.length === 0) {
			return interactionResponse(
				'❌ Provide `archive_category:` (and/or configured archive map). ' +
					'Re-run once per existing archive pile; later runs include the archive map automatically.',
				true,
			);
		}

		if (planOnly) {
			try {
				const channels = await listGuildChannels(env.DISCORD_BOT_TOKEN, guildId);
				const preview = planDiplomacyArchiveChannels(channels, sourceCategoryIds, config, {
					softLimit,
				});
				return interactionResponse(
					`${preview.summary}\n\n` +
						`**Preview only** (plan:true).\n` +
						`• Category name template: \`${categoryNameTemplate}\`\n` +
						`• Soft limit: ${softLimit}\n\n` +
						`Run \`/diplomacy archive_sync:true\` (without plan) to apply.`,
					true,
				);
			} catch (error) {
				return interactionResponse(
					`❌ Archive plan failed: ${error instanceof Error ? error.message : 'unknown error'}`,
					true,
				);
			}
		}

		const appId = interaction.application_id ?? env.DISCORD_APPLICATION_ID;
		if (!appId) {
			return interactionResponse('❌ DISCORD_APPLICATION_ID not configured.', true);
		}

		const deferred = deferredResponse();
		ctx.waitUntil(
			(async () => {
				try {
					await postAuditLog(env, config, {
						title: 'Diplomacy archive sync started',
						description: `Sources: ${sourceCategoryIds.map((id) => `<#${id}>`).join(', ')}`,
						actorId,
						source: 'admin',
						color: AuditColor.info,
					});

					const result = await rebalanceDiplomacyArchiveChannels(
						env.DISCORD_BOT_TOKEN!,
						config,
						guildId,
						{
							sourceCategoryIds,
							softLimit,
							categoryNameTemplate,
							onProgress: async (message) => {
								await editInteractionResponse(appId, interaction.token, message, true);
							},
							onArchiveCategoriesReady: async (archiveCategoryMap) => {
								await upsertGuildConfig(env.STFC_DB, {
									guild_id: guildId,
									diplomacy_archive_category_map: archiveCategoryMap,
									diplomacy_archive_category_id:
										Object.values(archiveCategoryMap)[0] ?? null,
								});
							},
						},
					);

					await upsertGuildConfig(env.STFC_DB, {
						guild_id: guildId,
						diplomacy_archive_category_map: result.archiveCategoryMap,
						diplomacy_archive_category_id: result.archiveCategoryId,
					});
					const after = await getGuildConfig(env.STFC_DB, guildId);
					await postAuditLog(env, after, {
						title: 'Diplomacy archive sync complete',
						description: result.summary.slice(0, 1500),
						actorId,
						source: 'admin',
						color: result.ok ? AuditColor.success : AuditColor.warn,
					});
					await editInteractionResponse(appId, interaction.token, result.summary, true);
				} catch (error) {
					const errMsg = error instanceof Error ? error.message : 'unknown error';
					try {
						await postAuditLog(env, config, {
							title: 'Diplomacy archive sync failed',
							description: errMsg.slice(0, 1500),
							actorId,
							source: 'admin',
							color: AuditColor.danger,
						});
					} catch {
						/* ignore */
					}
					await editInteractionResponse(
						appId,
						interaction.token,
						`❌ Diplomacy archive sync failed: ${errMsg}`,
						true,
					);
				}
			})(),
		);
		return deferred;
	}

	if (syncAll) {
		if (!env.DISCORD_BOT_TOKEN) {
			return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
		}
		if (!diplomacyChannelsEnabled(config)) {
			return interactionResponse(
				'❌ Diplomacy is disabled. Enable first: `/diplomacy enable:true`',
				true,
			);
		}

		const softLimitRaw = getOptionValue(options, 'soft_limit');
		const softLimitProvided =
			softLimitRaw != null && Number.isFinite(Number(softLimitRaw));
		const softLimit = resolveDiplomacySoftLimit(
			config,
			softLimitProvided ? Number(softLimitRaw) : null,
		);
		if (softLimitProvided) {
			await persistDiplomacySoftLimit(env, guildId, softLimit);
			config.diplomacy_soft_limit = softLimit;
		}
		const categoryNameTemplate = (
			getOptionValue(options, 'category_name_template') as string | undefined
		)?.trim();
		const planOnlyRaw = getOptionValue(options, 'plan');
		const planOnly = planOnlyRaw === true || planOnlyRaw === 'true';
		const renameRaw = getOptionValue(options, 'rename_categories');
		const renameCategories =
			renameRaw === undefined || renameRaw === null
				? true
				: renameRaw === true || renameRaw === 'true';
		const createCatsRaw = getOptionValue(options, 'create_categories');
		const createCategories =
			createCatsRaw === undefined || createCatsRaw === null
				? true
				: createCatsRaw === true || createCatsRaw === 'true';
		const archiveUnlinkedRaw = getOptionValue(options, 'archive_unlinked');
		const archiveUnlinked =
			archiveUnlinkedRaw === undefined || archiveUnlinkedRaw === null
				? true
				: archiveUnlinkedRaw === true || archiveUnlinkedRaw === 'true';
		const archiveCategoryOpt = getOptionValue(options, 'archive_category');
		const archiveCategoryId =
			archiveCategoryOpt != null ? String(archiveCategoryOpt) : undefined;
		const archiveName = (getOptionValue(options, 'archive_name') as string | undefined)?.trim();

		let createMissingTags: string[] | undefined;
		if (createMissing || planOnly) {
			const players = await listActiveVerifiedPlayers(env.STFC_DB, guildId);
			createMissingTags = [
				...new Set(
					players
						.map((p) => p.alliance_tag?.trim())
						.filter((t): t is string => Boolean(t)),
				),
			];
		}

		if (planOnly) {
			const preview = planDiplomacyChannels(config, {
				softLimit,
				createMissingTags: createMissing ? createMissingTags : undefined,
			});
			const templateNote = categoryNameTemplate || 'Diplomacy Channels {range}';
			return interactionResponse(
				`${preview.summary}\n\n` +
					`**Preview only** (plan:true).\n` +
					`• Category name template: \`${templateNote}\`\n` +
					`• Soft limit: ${softLimit}\n` +
					`• Rename categories: ${renameCategories ? 'yes' : 'no'}\n` +
					`• Create categories: ${createCategories ? 'yes' : 'no'}\n` +
					`• Create missing channels: ${createMissing ? 'yes' : 'no'}\n` +
					`• Archive unlinked: ${archiveUnlinked ? 'yes' : 'no'}\n\n` +
					`Run \`/diplomacy sync_all:true\` (without plan) to apply.`,
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
					await postAuditLog(env, config, {
						title: 'Diplomacy sync started',
						description: `Triggered by <@${actorId ?? 'unknown'}>.`,
						actorId,
						source: 'admin',
						color: AuditColor.info,
					});

					// Accumulate map in memory; flush to D1 every few tags (not every channel).
					let pendingChannelMap = { ...config.diplomacy_channel_map };
					let mappedSinceFlush = 0;
					const flushChannelMap = async () => {
						if (mappedSinceFlush === 0) return;
						await upsertGuildConfig(env.STFC_DB, {
							guild_id: guildId,
							diplomacy_channel_map: pendingChannelMap,
						});
						mappedSinceFlush = 0;
					};

					const result = await rebalanceDiplomacyChannels(
						env.DISCORD_BOT_TOKEN!,
						config,
						guildId,
						{
							createMissingTags: createMissing ? createMissingTags : undefined,
							softLimit,
							categoryNameTemplate,
							renameCategories,
							createCategories,
							archiveUnlinked,
							archiveCategoryId,
							archiveName,
							applyPermissions,
							onProgress: async (message) => {
								await editInteractionResponse(appId, interaction.token, message, true);
							},
							onCategoriesReady: async (categoryMap, archiveId) => {
								await upsertGuildConfig(env.STFC_DB, {
									guild_id: guildId,
									diplomacy_category_map: categoryMap,
									diplomacy_archive_category_id: archiveId,
								});
							},
							onChannelMapped: async (tag, channelId) => {
								pendingChannelMap = { ...pendingChannelMap, [tag]: channelId };
								mappedSinceFlush++;
								if (mappedSinceFlush >= 5) await flushChannelMap();
							},
						},
					);
					await flushChannelMap();

					await upsertGuildConfig(env.STFC_DB, {
						guild_id: guildId,
						diplomacy_channel_map: result.channelMap,
						diplomacy_category_map: result.categoryMap,
						diplomacy_archive_category_id: result.archiveCategoryId,
						...(result.specialChannelId !== undefined
							? { diplomacy_special_channel_id: result.specialChannelId }
							: {}),
						...(result.specialCategoryId !== undefined
							? { diplomacy_special_category_id: result.specialCategoryId }
							: {}),
					});
					const after = await getGuildConfig(env.STFC_DB, guildId);
					await postAuditLog(env, after, {
						title: 'Diplomacy sync complete',
						description: result.summary.slice(0, 1500),
						actorId,
						source: 'admin',
						color: result.ok ? AuditColor.success : AuditColor.warn,
					});
					await editInteractionResponse(appId, interaction.token, result.summary, true);
				} catch (error) {
					const errMsg = error instanceof Error ? error.message : 'unknown error';
					try {
						await postAuditLog(env, config, {
							title: 'Diplomacy sync failed',
							description: errMsg.slice(0, 1500),
							actorId,
							source: 'admin',
							color: AuditColor.danger,
						});
					} catch {
						/* ignore */
					}
					await editInteractionResponse(
						appId,
						interaction.token,
						`❌ Diplomacy sync failed: ${errMsg}`,
						true,
					);
				}
			})(),
		);
		return deferred;
	}

	// Status / config summary
	const refreshed = (await getGuildConfig(env.STFC_DB, guildId))!;
	const categoryMapLine =
		Object.keys(refreshed.diplomacy_category_map).length > 0
			? formatCategoryMap(refreshed.diplomacy_category_map)
			: refreshed.diplomacy_category_id
				? `legacy <#${refreshed.diplomacy_category_id}>`
				: 'none';
	return interactionResponse(
		`🤝 **Diplomacy channels**\n` +
			`• Enabled: ${diplomacyChannelsEnabled(refreshed) ? 'yes' : 'no'}\n` +
			`• Everyone can view: ${refreshed.diplomacy_everyone_can_view ? 'yes' : 'no'}\n` +
			`• Category map: ${categoryMapLine}\n` +
			`• Archive map: ${
				Object.keys(refreshed.diplomacy_archive_category_map ?? {}).length
					? formatCategoryMap(refreshed.diplomacy_archive_category_map)
					: refreshed.diplomacy_archive_category_id
						? `legacy <#${refreshed.diplomacy_archive_category_id}>`
						: 'none'
			}\n` +
			`• Channel name template: \`${refreshed.diplomacy_name_template?.trim() || 'diplomacy-{tag}'}\`\n` +
			`• View roles: ${refreshed.diplomacy_view_role_ids.map((id) => `<@&${id}>`).join(', ') || 'none'}\n` +
			`• Write roles: ${refreshed.diplomacy_write_role_ids.map((id) => `<@&${id}>`).join(', ') || 'none'}\n` +
			`• Write ranks: ${refreshed.diplomacy_write_ranks.join(', ') || 'none'}\n` +
			`• Soft limit: **${resolveDiplomacySoftLimit(refreshed)}** (persisted; used by sync_all + auto-rebalance)\n` +
			`• Special (non-listed): ${formatDiplomacySpecialStatus(refreshed)}\n` +
			`• Channels: ${formatDiplomacyChannelMap(refreshed.diplomacy_channel_map, refreshed.diplomacy_preferred_locales)}\n\n` +
			`Examples:\n` +
			`\`/diplomacy enable:true write_roles:Diplomat write_ranks:Commodore,Admiral everyone_can_view:true\`\n` +
			`\`/diplomacy gaps:true\` — tracked/verified vs channel map\n` +
			`\`/diplomacy create_tag:ABCD\`\n` +
			`\`/diplomacy link_tag:ABCD channel:#abcd-diplo languages:en,de apply_permissions:false\`\n` +
			`\`/diplomacy special:create special_placement:special_category\`\n` +
			`\`/diplomacy archive_sync:true archive_category:#old-archive plan:true\` — organise archive piles\n` +
			`\`/diplomacy sync_all:true create_missing:true\` — letter buckets + rename/move/A–Z sort\n` +
			`\`/diplomacy sync_all:true plan:true soft_limit:40\` — preview + persist soft limit`,
		true,
	);
}

async function handleServerChannelsCommand(
	env: Env,
	ctx: ExecutionContext,
	interaction: {
		guild_id?: string;
		member?: { permissions?: string; user?: { id: string } };
		token: string;
		application_id?: string;
		data?: {
			resolved?: {
				channels?: Record<
					string,
					{
						id: string;
						name?: string;
						type?: number;
						parent_id?: string | null;
						guild_id?: string | null;
						permission_overwrites?: Array<{
							id: string;
							type?: number;
							allow?: string | number;
							deny?: string | number;
						}>;
					}
				>;
			};
		};
	},
	channelsGroup: {
		options?: Array<{
			name: string;
			value?: unknown;
			type?: number;
			options?: Array<{
				name: string;
				value?: unknown;
				type?: number;
				options?: Array<{ name: string; value?: unknown; type?: number }>;
			}>;
		}>;
	},
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

		let occupancyBlock = '';
		if (env.DISCORD_BOT_TOKEN && personalChannelsEnabled(config)) {
			try {
				const planPlayers = await listPlayersForPersonalChannels(env.STFC_DB, guildId);
				const planned = await planPersonalChannels(env.DISCORD_BOT_TOKEN, guildId, config, {
					players: planPlayers,
				});
				if (planned.currentOccupancy.length > 0) {
					occupancyBlock =
						`\n**Occupancy**\n` +
						planned.currentOccupancy
							.map((o) => {
								const mark = o.discordChildren >= DEFAULT_SOFT_LIMIT ? ' ⚠' : '';
								return `• \`${o.range}\` <#${o.categoryId}> — ${o.discordChildren}/${DEFAULT_SOFT_LIMIT}${mark}`;
							})
							.join('\n');
				}
			} catch {
				/* status still useful without occupancy */
			}
		}

		return interactionResponse(
			`📂 **Personal channel configuration**\n` +
				`• Enabled: ${personalChannelsEnabled(config) ? 'yes' : 'no (set category map or run rebalance)'}\n` +
				`• Category map: ${formatCategoryMap(config.channel_category_map)}\n` +
				`• Extra roles: ${config.personal_channel_extra_roles.join(', ') || 'none'}\n` +
				`• Perm template: ${config.personal_channel_perm_template ? `locked (from <#${config.personal_channel_perm_template.source_channel_id ?? '—'}> )` : 'built-in default'}\n` +
				`• Verification log: ${config.verification_log_channel_id ? `<#${config.verification_log_channel_id}>` : 'not set'}\n` +
				`• Audit log: ${config.audit_log_channel_id ? `<#${config.audit_log_channel_id}>` : 'not set'}\n` +
				`• Urgent alerts: ${config.urgent_notify_channel_id ? `<#${config.urgent_notify_channel_id}>` : 'not set'}\n` +
				`• Diplomacy: ${diplomacyChannelsEnabled(config) ? 'enabled' : 'disabled'} — ${formatDiplomacyChannelMap(config.diplomacy_channel_map, config.diplomacy_preferred_locales)}\n` +
				`• Linked member channels: ${players?.count ?? 0}` +
				(config.personal_channel_archive_category_id
					? `\n• Archive category: <#${config.personal_channel_archive_category_id}>`
					: '') +
				occupancyBlock +
				`\n\nBuckets use first letter (A–Z; non-letters → \`#\`). ` +
				`Plan: \`/channels plan\`. Apply: \`/channels rebalance apply:true\`.`,
			true,
		);
	}

	if (sub.name === 'permissions-audit') {
		if (!env.DISCORD_BOT_TOKEN) {
			return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
		}

		const appId = interaction.application_id ?? env.DISCORD_APPLICATION_ID;
		if (!appId) {
			return interactionResponse('❌ DISCORD_APPLICATION_ID not configured.', true);
		}

		const deferred = deferredResponse();
		ctx.waitUntil(
			(async () => {
				try {
					const players = await listPlayersForPersonalChannels(env.STFC_DB, guildId);
					const report = await auditPersonalChannelPermissions(
						env.DISCORD_BOT_TOKEN!,
						guildId,
						config,
						players,
					);
					const summary = formatPermissionAuditSummaryMessage(report);
					const fullText = formatPermissionAuditReportText(report);

					if (config.audit_log_channel_id && env.DISCORD_BOT_TOKEN) {
						try {
							const bytes = new TextEncoder().encode(fullText);
							await sendChannelMessageWithEmbed(env.DISCORD_BOT_TOKEN, config.audit_log_channel_id, {
								content: `🔎 Personal channel permission audit — ${report.channelCount} channels, ${report.flaggedCount} flagged`,
								embeds: [
									{
										title: 'Personal channel permissions audit',
										description: report.summaryLines.join('\n').slice(0, 4000),
										color: report.flaggedCount ? AuditColor.warn : AuditColor.success,
										timestamp: report.auditedAt,
									},
								],
								file: {
									bytes,
									filename: `channel-perms-${guildId}-${Date.now()}.txt`,
									contentType: 'text/plain; charset=utf-8',
								},
							});
						} catch (err) {
							console.error('Permission audit log post failed:', err);
						}
					}

					await postAuditLog(env, config, {
						title: 'Personal channel permissions audited',
						description:
							`${report.channelCount} channels scanned · ${report.flaggedCount} flagged · ` +
							`${report.inaccessibleCount} inaccessible (read-only; no sync/rewrite)`,
						actorId: interaction.member?.user?.id,
						source: 'admin',
						color: report.flaggedCount ? AuditColor.warn : AuditColor.success,
					});

					await editInteractionResponse(appId, interaction.token, summary, true);
				} catch (error) {
					await editInteractionResponse(
						appId,
						interaction.token,
						`❌ Permission audit failed: ${error instanceof Error ? error.message : 'unknown error'}`,
						true,
					);
				}
			})(),
		);
		return deferred;
	}

	if (sub.name === 'permissions-apply') {
		if (!env.DISCORD_BOT_TOKEN) {
			return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
		}
		const appId = interaction.application_id ?? env.DISCORD_APPLICATION_ID;
		if (!appId) {
			return interactionResponse('❌ DISCORD_APPLICATION_ID not configured.', true);
		}

		const targetRaw = (getOptionValue(sub.options, 'target') as string | undefined) || '';
		const target = targetRaw as BulkPermTarget;
		if (!['bot', 'role', 'extra_roles', 'template_roles'].includes(target)) {
			return interactionResponse(
				'❌ `target:` must be bot, role, extra_roles, or template_roles.',
				true,
			);
		}

		const scopeRaw = ((getOptionValue(sub.options, 'scope') as string) || 'personal') as BulkPermScope;
		if (!['personal', 'diplomacy', 'staff_logs', 'survey_logs', 'all'].includes(scopeRaw)) {
			return interactionResponse('❌ Invalid `scope:`.', true);
		}

		const presetRaw = getOptionValue(sub.options, 'preset') as string | undefined;
		let preset: BulkPermPreset =
			target === 'bot' ? 'bot' : 'member';
		if (presetRaw === 'bot' || presetRaw === 'member' || presetRaw === 'view_send') {
			preset = presetRaw;
		}

		const roleOpt = getOptionValue(sub.options, 'role');
		const roleId = roleOpt != null ? String(roleOpt) : null;
		if (target === 'role' && (!roleId || !/^\d{15,20}$/.test(roleId))) {
			return interactionResponse('❌ Provide `role:` when target is role.', true);
		}

		const dryRaw = getOptionValue(sub.options, 'dry_run');
		const dryRun =
			dryRaw === undefined || dryRaw === null
				? true
				: !(dryRaw === false || dryRaw === 'false');

		const missingRaw = getOptionValue(sub.options, 'only_missing');
		const onlyMissing =
			missingRaw === undefined || missingRaw === null
				? true
				: !(missingRaw === false || missingRaw === 'false');

		const deferred = deferredResponse();
		ctx.waitUntil(
			(async () => {
				try {
					const players = await listPlayersForPersonalChannels(env.STFC_DB, guildId);
					const report = await runBulkPermApply({
						token: env.DISCORD_BOT_TOKEN!,
						db: env.STFC_DB,
						guildId,
						config,
						players,
						scope: scopeRaw,
						target,
						preset,
						roleId,
						dryRun,
						onlyMissing,
					});

					const summary = formatBulkPermSummary(report);
					const fullText = formatBulkPermReportText(report);

					if (config.audit_log_channel_id && env.DISCORD_BOT_TOKEN) {
						try {
							const bytes = new TextEncoder().encode(fullText);
							await sendChannelMessageWithEmbed(env.DISCORD_BOT_TOKEN, config.audit_log_channel_id, {
								content:
									`🔧 Channel permissions ${dryRun ? 'dry-run' : 'apply'} — ` +
									`${report.channelCount} channels`,
								embeds: [
									{
										title: dryRun
											? 'Permissions apply (dry-run)'
											: 'Permissions apply (applied)',
										description: report.summaryLines.join('\n').slice(0, 4000),
										color: report.failed ? AuditColor.warn : AuditColor.success,
										timestamp: new Date().toISOString(),
									},
								],
								file: {
									bytes,
									filename: `perms-apply-${guildId}-${Date.now()}.txt`,
									contentType: 'text/plain; charset=utf-8',
								},
							});
						} catch (err) {
							console.error('Permissions apply audit post failed:', err);
						}
					}

					await postAuditLog(env, config, {
						title: dryRun ? 'Permissions apply dry-run' : 'Permissions apply',
						description: report.summaryLines.slice(0, 2).join('\n'),
						actorId: interaction.member?.user?.id,
						source: 'admin',
						color: report.failed ? AuditColor.warn : AuditColor.info,
					});

					await editInteractionResponse(appId, interaction.token, summary, true);
				} catch (error) {
					await editInteractionResponse(
						appId,
						interaction.token,
						`❌ Permissions apply failed: ${error instanceof Error ? error.message : 'unknown error'}`,
						true,
					);
				}
			})(),
		);
		return deferred;
	}

	if (sub.name === 'permissions-template-show') {
		return interactionResponse(formatEffectivePersonalChannelPermTemplate(config), true);
	}

	if (sub.name === 'permissions-template-clear') {
		await upsertGuildConfig(env.STFC_DB, {
			guild_id: guildId,
			personal_channel_perm_template: null,
		});
		await postAuditLog(env, config, {
			title: 'Personal channel permission template cleared',
			description: 'New/linked channels will use built-in defaults again.',
			actorId: interaction.member?.user?.id,
			source: 'admin',
			color: AuditColor.warn,
		});
		return interactionResponse(
			'✅ Cleared locked permission template. New channels use the built-in default again.\n' +
				formatEffectivePersonalChannelPermTemplate({
					personal_channel_perm_template: null,
					personal_channel_extra_roles: config.personal_channel_extra_roles,
				}),
			true,
		);
	}

	if (sub.name === 'permissions-template-from') {
		if (!env.DISCORD_BOT_TOKEN) {
			return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
		}
		const channelId = getOptionValue(sub.options, 'channel') as string | undefined;
		if (!channelId || !/^\d{15,20}$/.test(channelId)) {
			return interactionResponse('❌ Provide a valid text `channel:`.', true);
		}

		const syncExtraRaw = getOptionValue(sub.options, 'sync_extra_roles');
		const syncExtraRoles =
			syncExtraRaw === undefined || syncExtraRaw === null
				? true
				: syncExtraRaw === true || syncExtraRaw === 'true';

		const memberOpt = getOptionValue(sub.options, 'member');
		let memberUserId = memberOpt != null ? String(memberOpt) : undefined;

		if (!memberUserId) {
			const linked = await env.STFC_DB.prepare(
				`SELECT discord_user_id FROM verified_players
				 WHERE guild_id = ? AND personal_channel_id = ?
				 LIMIT 1`,
			)
				.bind(guildId, channelId)
				.first<{ discord_user_id: string }>();
			memberUserId = linked?.discord_user_id;
		}

		if (!memberUserId) {
			return interactionResponse(
				'❌ Could not tell which Discord user is the channel owner.\n' +
					'Link the channel first (`/channels link`) or pass `member:@Them`.',
				true,
			);
		}

		const known = interaction.data?.resolved?.channels?.[channelId];
		let overwrites = known?.permission_overwrites;
		if (!overwrites) {
			const fetched = await fetchGuildChannel(env.DISCORD_BOT_TOKEN, channelId);
			if (!fetched.ok) {
				return interactionResponse(`❌ ${fetched.error}`, true);
			}
			overwrites = fetched.channel.permission_overwrites ?? [];
		}

		const botUserId = await getBotUserId(env.DISCORD_BOT_TOKEN);
		const template = capturePersonalChannelPermTemplate({
			guildId,
			botUserId,
			memberUserId,
			channelId,
			overwrites: overwrites.map((o) => ({
				id: o.id,
				type: (o.type === 1 ? 1 : 0) as 0 | 1,
				allow: String(o.allow ?? '0'),
				deny: String(o.deny ?? '0'),
			})),
			capturedBy: interaction.member?.user?.id ?? null,
		});

		const patch: Parameters<typeof upsertGuildConfig>[1] = {
			guild_id: guildId,
			personal_channel_perm_template: template,
		};
		if (syncExtraRoles) {
			patch.personal_channel_extra_roles = template.roles.map((r) => r.role_id);
		}
		await upsertGuildConfig(env.STFC_DB, patch);

		await postAuditLog(env, { ...config, personal_channel_perm_template: template }, {
			title: 'Personal channel permission template locked',
			description:
				`Captured from <#${channelId}> (member slot <@${memberUserId}>). ` +
				`New/linked channels will use this pattern.` +
				(syncExtraRoles ? ` Extra-roles synced (${template.roles.length}).` : ''),
			actorId: interaction.member?.user?.id,
			source: 'admin',
			color: AuditColor.success,
		});

		return interactionResponse(
			`✅ Locked permission template from <#${channelId}>.\n` +
				`Member slot: <@${memberUserId}>\n` +
				(syncExtraRoles
					? `Extra-roles updated from role overwrites (${template.roles.length}).\n\n`
					: '\n') +
				formatPersonalChannelPermTemplate(template) +
				`\n\n_Existing channels are unchanged. New creates / \`link\` with apply_permissions will use this template._`,
			true,
		);
	}

	if (sub.name === 'plan' || sub.name === 'rebalance') {
		const softLimitRaw = getOptionValue(sub.options, 'soft_limit');
		const softLimit =
			softLimitRaw != null && Number.isFinite(Number(softLimitRaw))
				? Math.max(10, Math.min(50, Number(softLimitRaw)))
				: DEFAULT_SOFT_LIMIT;

		if (sub.name === 'plan') {
			if (!env.DISCORD_BOT_TOKEN) {
				return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
			}
			const players = await listPlayersForPersonalChannels(env.STFC_DB, guildId);
			const result = await planPersonalChannels(env.DISCORD_BOT_TOKEN, guildId, config, {
				players,
				softLimit,
			});
			return interactionResponse(
				`${result.summary}\n\nPreview only. Run \`/channels rebalance apply:true\` to apply.`,
				true,
			);
		}

		// rebalance
		const applyRaw = getOptionValue(sub.options, 'apply');
		const apply = applyRaw === true || applyRaw === 'true';
		const nameTemplate = (getOptionValue(sub.options, 'name_template') as string | undefined)?.trim();
		const renameRaw = getOptionValue(sub.options, 'rename_categories');
		const renameCategories =
			renameRaw === undefined || renameRaw === null
				? true
				: renameRaw === true || renameRaw === 'true';
		const createRaw = getOptionValue(sub.options, 'create_categories');
		const createCategories =
			createRaw === undefined || createRaw === null
				? true
				: createRaw === true || createRaw === 'true';
		const createMissingRaw = getOptionValue(sub.options, 'create_missing');
		const createMissing = createMissingRaw === true || createMissingRaw === 'true';
		const archiveUnlinkedRaw = getOptionValue(sub.options, 'archive_unlinked');
		const archiveUnlinked =
			archiveUnlinkedRaw === undefined || archiveUnlinkedRaw === null
				? true
				: archiveUnlinkedRaw === true || archiveUnlinkedRaw === 'true';
		const archiveCategoryOpt = getOptionValue(sub.options, 'archive_category');
		const archiveCategoryId =
			archiveCategoryOpt != null ? String(archiveCategoryOpt) : undefined;
		const archiveName = (getOptionValue(sub.options, 'archive_name') as string | undefined)?.trim();

		if (!apply) {
			if (!env.DISCORD_BOT_TOKEN) {
				return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
			}
			const players = await listPlayersForPersonalChannels(env.STFC_DB, guildId);
			const result = await planPersonalChannels(env.DISCORD_BOT_TOKEN, guildId, config, {
				players,
				softLimit,
			});
			const templateNote = nameTemplate || 'Member Channels {range}';
			return interactionResponse(
				`${result.summary}\n\n` +
					`**Preview only** (apply:false).\n` +
					`• Name template: \`${templateNote}\`\n` +
					`• Rename categories: ${renameCategories ? 'yes' : 'no'}\n` +
					`• Create categories: ${createCategories ? 'yes' : 'no'}\n` +
					`• Create missing channels: ${createMissing ? 'yes' : 'no'}\n` +
					`• Archive unlinked: ${archiveUnlinked ? 'yes' : 'no'}\n` +
					`• Archive target: ${
						archiveCategoryId
							? `<#${archiveCategoryId}>`
							: archiveName
								? `\`${archiveName}\``
								: config.personal_channel_archive_category_id
									? `<#${config.personal_channel_archive_category_id}>`
									: '`Member Channels Archive` (create if needed)'
					}\n\n` +
					`Run again with \`apply:true\` to create/rename categories, update the map, move/create channels, and archive unlinked.`,
				true,
			);
		}

		if (!env.DISCORD_BOT_TOKEN) {
			return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
		}
		if (config.mode !== 'single_alliance') {
			return interactionResponse(
				'❌ Personal channel rebalance is for single-alliance servers. Current mode: multi_alliance.',
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
				const actorId = interaction.member?.user?.id;
				try {
					await postAuditLog(env, config, {
						title: 'Personal channels rebalance started',
						description:
							`Triggered by <@${actorId ?? 'unknown'}>. ` +
							`Progress updates appear on the slash command; a completion summary will post here when finished.`,
						actorId,
						source: 'admin',
						color: AuditColor.info,
					});

					const players = await listPlayersForPersonalChannels(env.STFC_DB, guildId);
					const result = await rebalancePersonalChannels(env.DISCORD_BOT_TOKEN!, guildId, config, {
						players,
						softLimit,
						nameTemplate,
						renameCategories,
						createCategories,
						createMissing,
						archiveUnlinked,
						archiveCategoryId,
						archiveName,
						onChannelCreated: async (player, channelId) => {
							await upsertVerifiedPlayer(env.STFC_DB, {
								guild_id: guildId,
								discord_user_id: player.discord_user_id,
								personal_channel_id: channelId,
							});
						},
						onCategoriesReady: async (newMap, archiveId) => {
							const patch: Parameters<typeof upsertGuildConfig>[1] = {
								guild_id: guildId,
							};
							if (Object.keys(newMap).length > 0) {
								patch.channel_category_map = newMap;
							}
							if (archiveId) {
								patch.personal_channel_archive_category_id = archiveId;
							}
							if (patch.channel_category_map || patch.personal_channel_archive_category_id) {
								await upsertGuildConfig(env.STFC_DB, patch);
							}
						},
						onProgress: async (message) => {
							await editInteractionResponse(appId, interaction.token, message, true);
						},
					});
					const patch: Parameters<typeof upsertGuildConfig>[1] = {
						guild_id: guildId,
					};
					if (Object.keys(result.newMap).length > 0) {
						patch.channel_category_map = result.newMap;
					}
					if (result.archiveCategoryId) {
						patch.personal_channel_archive_category_id = result.archiveCategoryId;
					}
					if (patch.channel_category_map || patch.personal_channel_archive_category_id) {
						await upsertGuildConfig(env.STFC_DB, patch);
					}
					const refreshed = await getGuildConfig(env.STFC_DB, guildId);
					await postAuditLog(env, refreshed, {
						title: 'Personal channels rebalanced',
						description: result.summary.slice(0, 1500),
						actorId,
						source: 'admin',
						color: result.ok ? AuditColor.success : AuditColor.warn,
					});
					await editInteractionResponse(appId, interaction.token, result.summary, true);
				} catch (error) {
					const errMsg = error instanceof Error ? error.message : 'unknown error';
					try {
						await postAuditLog(env, config, {
							title: 'Personal channels rebalance failed',
							description: errMsg.slice(0, 1500),
							actorId,
							source: 'admin',
							color: AuditColor.danger,
						});
					} catch {
						/* ignore */
					}
					await editInteractionResponse(
						appId,
						interaction.token,
						`❌ Rebalance failed: ${errMsg}\n\n` +
							`Partial moves may already be applied. Re-run \`/channels rebalance apply:true\` to continue (idempotent for already-placed channels).`,
						true,
					);
				}
			})(),
		);
		return deferred;
	}

	if (sub.name === 'diplomacy') {
		return handleDiplomacyChannelsCommand(env, ctx, interaction, guildId, config, sub.options);
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
					: 'No extra viewer roles yet — set `/channels extra-roles` then recreate, or edit channel permissions manually.';
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

	if (sub.name === 'audit') {
		const clearRaw = getOptionValue(sub.options, 'clear');
		const clear = clearRaw === true || clearRaw === 'true';
		const createRaw = getOptionValue(sub.options, 'create');
		const create = createRaw === true || createRaw === 'true';
		const channelOpt = getOptionValue(sub.options, 'channel');
		const nameOpt = (getOptionValue(sub.options, 'name') as string | undefined)?.trim();
		const actorId = interaction.member?.user?.id;

		if (clear) {
			await upsertGuildConfig(env.STFC_DB, {
				guild_id: guildId,
				audit_log_channel_id: null,
			});
			return interactionResponse('✅ Audit log channel cleared.', true);
		}

		if (!env.DISCORD_BOT_TOKEN) {
			return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
		}

		if (create) {
			try {
				const channelId = await createAuditLogChannel(
					env.DISCORD_BOT_TOKEN,
					guildId,
					config,
					nameOpt || 'bot-audit-log',
				);
				await upsertGuildConfig(env.STFC_DB, {
					guild_id: guildId,
					audit_log_channel_id: channelId,
				});
				const refreshed = await getGuildConfig(env.STFC_DB, guildId);
				await postAuditLog(env, refreshed, {
					title: 'Audit log enabled',
					description: `This channel will receive admin and automated bot events.\nVerification screenshots still go to \`/channels log\`.`,
					actorId,
					source: 'admin',
					color: AuditColor.success,
				});
				const viewerNote = config.personal_channel_extra_roles.length
					? `Viewer roles (from channel extra-roles): ${config.personal_channel_extra_roles.map((id) => `<@&${id}>`).join(', ')}`
					: 'No extra viewer roles yet — set `/channels extra-roles`, then recreate or edit permissions.';
				return interactionResponse(
					`✅ Created private audit log <#${channelId}>.\n` +
						`• @everyone cannot view\n` +
						`• ${viewerNote}\n\n` +
						`Admin commands and automated bot actions will post here.`,
					true,
				);
			} catch (error) {
				return interactionResponse(
					`❌ Failed to create audit channel: ${error instanceof Error ? error.message : 'unknown error'}`,
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
			audit_log_channel_id: channelId,
		});
		const refreshed = await getGuildConfig(env.STFC_DB, guildId);
		await postAuditLog(env, refreshed, {
			title: 'Audit log channel set',
			description: `Audit events will post to <#${channelId}>.`,
			actorId,
			source: 'admin',
			color: AuditColor.success,
		});
		return interactionResponse(
			`✅ Audit log channel set to <#${channelId}>.\n` +
				`Make sure the bot can **View Channel**, **Send Messages**, and **Embed Links** there.`,
			true,
		);
	}

	if (sub.name === 'urgent') {
		const clearRaw = getOptionValue(sub.options, 'clear');
		const clear = clearRaw === true || clearRaw === 'true';
		const createRaw = getOptionValue(sub.options, 'create');
		const create = createRaw === true || createRaw === 'true';
		const channelOpt = getOptionValue(sub.options, 'channel');
		const nameOpt = (getOptionValue(sub.options, 'name') as string | undefined)?.trim();
		const actorId = interaction.member?.user?.id;

		if (clear) {
			await upsertGuildConfig(env.STFC_DB, {
				guild_id: guildId,
				urgent_notify_channel_id: null,
			});
			return interactionResponse('✅ Urgent notify channel cleared.', true);
		}

		if (!env.DISCORD_BOT_TOKEN) {
			return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
		}

		if (create) {
			try {
				const channelId = await createUrgentNotifyChannel(
					env.DISCORD_BOT_TOKEN,
					guildId,
					config,
					nameOpt || 'bot-urgent',
				);
				await upsertGuildConfig(env.STFC_DB, {
					guild_id: guildId,
					urgent_notify_channel_id: channelId,
				});
				const refreshed = await getGuildConfig(env.STFC_DB, guildId);
				await postUrgentNotify(env, refreshed, {
					content:
						'✅ Urgent alerts channel online! I will ping here when something needs admin attention ' +
						'(for example: I cannot DM a member because their privacy settings block server DMs). ' +
						'The full audit trail still goes to the audit log.',
					title: 'Urgent alerts enabled',
					actorId,
					color: AuditColor.success,
				});
				const viewerNote = config.personal_channel_extra_roles.length
					? `Viewer roles (from channel extra-roles): ${config.personal_channel_extra_roles.map((id) => `<@&${id}>`).join(', ')}`
					: 'No extra viewer roles yet — set `/channels extra-roles`, then recreate or edit permissions.';
				return interactionResponse(
					`✅ Created private urgent alerts <#${channelId}>.\n` +
						`• @everyone cannot view\n` +
						`• ${viewerNote}\n\n` +
						`High-signal events (e.g. verification DM blocked) post here. Full detail stays on \`/channels audit\`.`,
					true,
				);
			} catch (error) {
				return interactionResponse(
					`❌ Failed to create urgent channel: ${error instanceof Error ? error.message : 'unknown error'}`,
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
			urgent_notify_channel_id: channelId,
		});
		const refreshed = await getGuildConfig(env.STFC_DB, guildId);
		await postUrgentNotify(env, refreshed, {
			content: `✅ Urgent alerts will post to <#${channelId}>. Standing by for actionable incidents!`,
			title: 'Urgent notify channel set',
			actorId,
			color: AuditColor.success,
		});
		return interactionResponse(
			`✅ Urgent notify channel set to <#${channelId}>.\n` +
				`Make sure the bot can **View Channel**, **Send Messages**, and **Embed Links** there.`,
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
			await postAuditLog(env, { ...config, channel_category_map: {} }, {
				title: 'Personal channel map cleared',
				actorId: interaction.member?.user?.id,
				source: 'admin',
				color: AuditColor.warn,
			});
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
		await postAuditLog(env, { ...config, channel_category_map: nextMap }, {
			title: 'Personal channel map updated',
			description: formatCategoryMap(nextMap),
			actorId: interaction.member?.user?.id,
			source: 'admin',
			color: AuditColor.info,
		});
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
			const cleared = {
				...config,
				personal_channel_extra_roles: [] as string[],
			};
			await postAuditLog(env, cleared, {
				title: 'Channel extra-roles cleared',
				actorId: interaction.member?.user?.id,
				source: 'admin',
				color: AuditColor.warn,
			});
			return interactionResponse(
				'✅ Channel extra roles cleared.\n\n' +
					formatEffectivePersonalChannelPermTemplate(cleared) +
					'\n\n_Existing channels are unchanged until create/link with apply_permissions._',
				true,
			);
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
			const updated = { ...config, personal_channel_extra_roles: resolved.ids };
			await postAuditLog(env, updated, {
				title: 'Channel extra-roles updated',
				description: resolved.ids.map((id) => `<@&${id}>`).join(', ') || 'none',
				actorId: interaction.member?.user?.id,
				source: 'admin',
				color: AuditColor.info,
			});
			const note = config.personal_channel_perm_template?.roles.length
				? '\n\n_Note: a locked template with its own role list is in use; those role overwrites take precedence for personal channels. Extra-roles still apply to log/audit/urgent channels._'
				: '\n\n_Applied to the built-in default (no sample lock needed). Existing channels unchanged until create/link with apply_permissions._';
			return interactionResponse(
				`✅ Channel extra roles updated (${resolved.ids.length}): ${resolved.ids.map((id) => `<@&${id}>`).join(', ')}\n\n` +
					formatEffectivePersonalChannelPermTemplate(updated) +
					note,
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
		let playerName = '';

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
			playerName = matches[0].player_name?.trim() || '';
			matchLabel = matches[0].player_name
				? `**${matches[0].player_name}** (<@${discordUserId}>)`
				: `<@${discordUserId}>`;
		} else if (userOpt != null) {
			discordUserId = String(userOpt);
			matchLabel = `<@${discordUserId}>`;
			const linked = await getVerifiedPlayer(env.STFC_DB, guildId, discordUserId);
			playerName = linked?.player_name?.trim() || '';
			if (playerName) matchLabel = `**${playerName}** (<@${discordUserId}>)`;
		} else {
			return interactionResponse(
				'❌ Provide `player:` (in-game name or STFC ID) and/or `user:@Member`, plus `channel:`.',
				true,
			);
		}

		if (!playerName) {
			return interactionResponse(
				'❌ That member has no stored in-game name yet — verify them first, then link.',
				true,
			);
		}

		const result = await linkExistingPersonalChannel(
			env.DISCORD_BOT_TOKEN,
			config,
			guildId,
			discordUserId,
			channelId,
			playerName,
			{
				applyPermissions,
				knownChannel: (() => {
					const ch = interaction.data?.resolved?.channels?.[channelId];
					if (!ch) return null;
					return {
						id: ch.id,
						name: ch.name ?? '',
						type: ch.type ?? -1,
						parent_id: ch.parent_id ?? null,
						guild_id: ch.guild_id ?? guildId,
					};
				})(),
			},
		);
		if (!result.ok) {
			return interactionResponse(`❌ Failed to link channel: ${result.error}`, true);
		}

		await upsertVerifiedPlayer(env.STFC_DB, {
			guild_id: guildId,
			discord_user_id: discordUserId,
			personal_channel_id: channelId,
		});

		const renameNote = result.renamed
			? ` Renamed to \`#${slugPersonalChannelName(playerName, discordUserId)}\`.`
			: '';
		const moveNote = result.moved ? ' Moved to the matching letter category.' : '';

		await postAuditLog(env, config, {
			title: 'Personal channel linked',
			description: `<#${channelId}> → ${matchLabel}${renameNote}${moveNote}`,
			actorId: interaction.member?.user?.id,
			source: 'admin',
			color: result.permissionWarnings?.length ? AuditColor.warn : AuditColor.info,
			fields: [
				{
					name: 'Permissions',
					value: !applyPermissions
						? 'left unchanged'
						: result.permissionWarnings?.length
							? `partial — ${result.permissionWarnings.slice(0, 3).join('; ')}`
							: 'rewritten (bot + member + extra-roles)',
					inline: true,
				},
			],
		});

		const permNote = !applyPermissions
			? ' Left existing channel permissions unchanged.'
			: result.permissionWarnings?.length
				? `\n⚠️ Linked, but some permission overwrites failed:\n` +
					result.permissionWarnings.map((w) => `• ${w}`).join('\n') +
					`\n\nGrant the bot **Manage Channels** + **View Channel** on this channel (or its category), then re-run link — or edit overwrites manually so the bot can **View** and **Send**.`
				: ' Applied permissions (bot can post here; member + extra-roles can view/send).';

		return interactionResponse(
			`✅ Linked <#${channelId}> to ${matchLabel}.${renameNote}${moveNote}${permNote}`,
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

	const guildId = interaction.guild_id as string | undefined;
	const guildConfig = guildId ? await getGuildConfig(env.STFC_DB, guildId) : null;

	return withDeployModeContext(guildConfig, async () => {
		return dispatchDiscordInteraction(env, ctx, interaction);
	});
}

async function dispatchDiscordInteraction(
	env: Env,
	ctx: ExecutionContext,
	interaction: any,
): Promise<Response> {
	if (interaction.type === 3) {
		const customId = interaction.data?.custom_id as string | undefined;
		if (customId?.startsWith('locale:')) {
			const { handleLocaleComponent } = await import('./i18n/language-picker');
			return handleLocaleComponent(env, interaction);
		}
		if (customId?.startsWith('survey:')) {
			const { handleSurveyComponent } = await import('./survey-handlers');
			return handleSurveyComponent(env, ctx, interaction);
		}
		if (customId?.startsWith('exch:')) {
			const { handleExchangeComponent } = await import('./exchange-handlers');
			return handleExchangeComponent(env, ctx, interaction);
		}
		if (customId?.startsWith('dma:')) {
			const { handleDmAssistantComponent } = await import('./dm-assistant');
			return handleDmAssistantComponent(env, interaction);
		}
		if (customId?.startsWith('consent-preview:')) {
			return updateMessageResponse(
				'✅ Preview only — data consent was **not** recorded. Status unchanged.',
				{ components: [] },
			);
		}
		if (customId?.startsWith('consent:')) {
			const { handleDataConsentComponent } = await import('./data-consent');
			return handleDataConsentComponent(env, interaction);
		}
		if (customId?.startsWith('agree:preview:')) {
			const { handleAgreePreviewComponent } = await import('./test-dms');
			return handleAgreePreviewComponent(env, interaction);
		}
		if (customId?.startsWith('agree:')) {
			const { handleAgreeComponent } = await import('./agreement');
			return handleAgreeComponent(env, interaction);
		}
		if (customId?.startsWith('verify:restart-preview:')) {
			const { handleVerifyRestartPreviewComponent } = await import('./test-dms');
			return handleVerifyRestartPreviewComponent(env, interaction);
		}
		if (customId?.startsWith('verify:start:')) {
			const { handleVerifyStartComponent } = await import('./verification-access');
			return handleVerifyStartComponent(env, ctx, interaction);
		}
		if (customId?.startsWith('verify:restart:')) {
			const { handleVerifyRestartComponent } = await import('./verification-access');
			return handleVerifyRestartComponent(env, interaction);
		}
		if (customId?.startsWith('demote:')) {
			const { handleDemoteComponent } = await import('./demotion-policy');
			return handleDemoteComponent(env, interaction);
		}
		if (customId?.startsWith('vre:')) {
			const { handleVerifyReassignComponent } = await import('./verification');
			return handleVerifyReassignComponent(env, ctx, interaction);
		}
		if (customId?.startsWith('rst:')) {
			const { handleRosterListComponent } = await import('./roster-list-view');
			return handleRosterListComponent(env, ctx, interaction);
		}
		if (customId?.startsWith('actc:')) {
			const { handleActivityConfirmComponent } = await import('./activity-adjust');
			return handleActivityConfirmComponent(env, interaction);
		}
		if (customId?.startsWith('aresync:')) {
			const { handleAllianceResyncComponent } = await import('./alliance-handlers');
			return handleAllianceResyncComponent(env, ctx, interaction);
		}
		if (customId?.startsWith('alink:')) {
			const { handleAllianceLinkComponent } = await import('./alliance-handlers');
			return handleAllianceLinkComponent(env, ctx, interaction);
		}
		return interactionResponse('❌ Unknown button.', true);
	}

	if (interaction.type === 2) {
		const { data } = interaction;

		if (data.name === 'language') {
			const guildId = interaction.guild_id as string | undefined;
			if (!guildId) {
				return interactionResponse('❌ Run `/language` inside the server.', true);
			}
			const { languagePickerInteractionResponse } = await import('./i18n/language-picker');
			return languagePickerInteractionResponse(guildId);
		}

		if (data.name === 'survey') {
			const { handleSurveyCommand } = await import('./survey-handlers');
			return handleSurveyCommand(env, ctx, interaction, data);
		}

		if (data.name === 'exchange') {
			const { handleExchangeCommand } = await import('./exchange-handlers');
			return handleExchangeCommand(env, ctx, interaction, data);
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

		if (data.name === 'roster') {
			return handleRosterCommand(env, ctx, interaction as any, data);
		}
		if (data.name === 'alliance') {
			const { handleAllianceCommand } = await import('./alliance-handlers');
			return handleAllianceCommand(env, ctx, interaction as any);
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
			if (sub?.name === 'deploy') {
				return handleServerDeployCommand(env, interaction as any, sub);
			}
			if (sub?.name === 'demotion') {
				return handleServerDemotionCommand(env, interaction as any, sub);
			}
			if (sub?.name === 'assistant') {
				return handleServerAssistantCommand(env, interaction as any, sub);
			}
			if (sub?.name === 'consent') {
				return handleServerConsentCommand(env, interaction as any, sub);
			}
			if (sub?.name === 'agreement') {
				return handleServerAgreementCommand(env, ctx, interaction as any, sub);
			}
			if (sub?.name === 'welcome') {
				return handleServerWelcomeCommand(env, interaction as any, sub);
			}
			if (sub?.name === 'verify-panel') {
				const nested = (sub as { options?: Array<{ name?: string; options?: Array<{ name: string; value?: unknown }> }> })
					.options?.[0];
				return handleServerVerifyPanelCommand(env, interaction as any, nested);
			}
			if (sub?.name === 'onboarding') {
				return handleServerOnboardingCommand(env, interaction as any);
			}
			if (sub?.name === 'verify') {
				return handleServerVerifyCommand(env, ctx, interaction, sub, data.resolved);
			}
			if (sub?.name === 'test-invite') {
				return handleServerTestInviteCommand(env, interaction as any, sub);
			}
			if (sub?.name === 'exclude-add' || sub?.name === 'exclude-remove' || sub?.name === 'exclude-list') {
				return handleServerExcludeCommand(env, interaction as any, sub);
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
				return handleServerChannelsCommand(env, ctx, interaction as any, sub);
			}
		}

		if (data.name === 'channels') {
			return handleServerChannelsCommand(env, ctx, interaction as any, data);
		}

		if (data.name === 'test-dm') {
			return handleServerTestDmCommand(env, interaction as any, data);
		}

		if (data.name === 'diplomacy') {
			const adminError = requireGuildAdmin(interaction as any);
			if (adminError) return adminError;
			const guildId = interaction.guild_id as string | undefined;
			if (!guildId) {
				return interactionResponse('❌ Run `/diplomacy` inside the server.', true);
			}
			const config = await getGuildConfig(env.STFC_DB, guildId);
			if (!config) {
				return interactionResponse('❌ Server not configured. Run `/server setup` first.', true);
			}
			return handleDiplomacyChannelsCommand(
				env,
				ctx,
				interaction as any,
				guildId,
				config,
				data.options,
			);
		}

		if (data.name === 'table') {
			const csvInput = getOptionValue(data.options, 'csv_data') as string | undefined;
			const csvFileOption = data.options?.find((opt: { name: string; value?: unknown }) => opt.name === 'csv_file');
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
