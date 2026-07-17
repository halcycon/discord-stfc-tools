import {
	DiscordApiError,
	deferredComponentResponse,
	editInteractionResponse,
	sendDirectMessage,
	setGuildMemberNickname,
	updateMessageResponse,
	type DiscordActionRow,
} from './discord-api';
import { opsLevelToGrade } from './grade-utils';
import { applyActivityObservation } from './activity-utils';
import { isGuildAdministrator } from './discord-admin';
import {
	createVerifyReassignSession,
	deleteVerifyReassignSession,
	findOtherVerifiedPlayersByPlayerId,
	getGuildConfig,
	getVerifiedPlayer,
	getVerifyReassignSession,
	isUserExcluded,
	markMemberInvited,
	recordGuildMember,
	recordPlayerStats,
	recordScreenshot,
	resetVerification,
	setVerifiedPlayerActivity,
	upsertVerifiedPlayer,
} from './guild-db';
import { lookupPlayerFromAllianceRoster } from './alliance-roster-sync';
import {
	isDeployTesting,
	shouldSkipOutboundDm,
} from './deploy-mode';
import { parseStfcProUrl, resolveSearchTerm } from './stfc-url';
import { findPlayerByIdOrName } from './stfc-utils';
import { postVerificationLog } from './verification-log';
import { AuditColor, postAuditLog } from './audit-log';
import { postUrgentNotify } from './urgent-notify';
import { DEFAULT_LOCALE, resolveLocale, t } from './i18n';
import {
	shouldDeferUntrackedAdmiralRoles,
	shouldDeferUntrackedDiplomacy,
} from './tracked-alliance-tags';
import { ensureLocaleAfterVerify, sendLanguagePickerDm } from './i18n/language-picker';
import {
	needsAgreementBeforeFullAccess,
	playerHasAcceptedAgreement,
	sendAgreementDm,
} from './agreement';
import {
	needsDataConsent,
	sendDataConsentDm,
} from './data-consent';
import {
	applyDiplomacyForAlliance,
	applyGuestRole,
	applyMemberRoles,
	applyPersonalChannelForMember,
	archivePersonalChannelOnDemotion,
	demotePlayerToGuest,
	formatDiscordApiFailure,
	formatRoleChangeNote,
	nicknameForPlayer,
	playerMatchesGuildAlliance,
} from './verification-access';
import type { GuildConfig, PlayerData } from './types';

export type DmResult =
	| { ok: true; skippedTesting?: boolean }
	| { ok: false; errorMessage: string; status?: number };

async function playerLocale(env: Env, guildId: string, discordUserId: string): Promise<string> {
	const row = await getVerifiedPlayer(env.STFC_DB, guildId, discordUserId);
	return resolveLocale(row?.preferred_locale);
}

function localizedPlayerSummary(locale: string, player: PlayerData): string {
	const power = player.power ? player.power.toLocaleString() : player.rss;
	const rank = player.rank?.trim() ? player.rank.trim() : '—';
	return t(locale, 'verify.player_summary', {
		name: player.name,
		id: player.playerId,
		alliance: player.allianceTag || '—',
		rank,
		ops: player.level,
		power,
		server: player.server,
		region: player.region,
	});
}

export async function lookupPlayerFromUrl(
	env: Env,
	url: string,
	config: GuildConfig,
	locale: string = DEFAULT_LOCALE,
): Promise<{ player: PlayerData | null; error?: string }> {
	const parsed = parseStfcProUrl(url);
	if (!parsed) {
		return { player: null, error: t(locale, 'verify.error.invalid_url') };
	}

	const server = parsed.server ?? config.stfc_server;
	const region = parsed.region ?? config.stfc_region;
	if (!server) {
		return { player: null, error: t(locale, 'verify.error.no_server') };
	}

	const searchTerm = resolveSearchTerm(parsed);
	if (!searchTerm) {
		return { player: null, error: t(locale, 'verify.error.no_player_id') };
	}

	// Prefer today's alliance roster when the player is already on it (skips stfc.pro).
	const fromRoster = await lookupPlayerFromAllianceRoster(env, config, searchTerm);
	const player = fromRoster ?? (await findPlayerByIdOrName(env, searchTerm, server, region));
	if (!player) {
		return {
			player: null,
			error: t(locale, 'verify.error.player_not_found', { server, region }),
		};
	}

	// Single-alliance: membership in the home tag is required.
	// Multi-alliance: unaffiliated players may verify (member roles; no diplomacy channel).
	if (!player.allianceTag?.trim() && config.mode !== 'multi_alliance') {
		return { player: null, error: t(locale, 'verify.error.no_alliance') };
	}

	return { player };
}

function discordPermissionHint(err: unknown, locale: string): string {
	const body = err instanceof DiscordApiError ? err.body ?? '' : '';
	const message = err instanceof Error ? err.message : '';
	const isMissingPerms =
		(err instanceof DiscordApiError && err.status === 403) ||
		body.includes('50013') ||
		body.includes('Missing Permissions');
	if (!isMissingPerms) return '';

	const roleAssign =
		message.includes('/roles/') ||
		body.includes('/roles/') ||
		(/members\/\d+\/roles\//.test(message) || /members\/\d+\/roles\//.test(body));
	if (roleAssign) {
		return t(locale, 'verify.hint.role_permissions');
	}
	return t(locale, 'verify.hint.nickname_permissions');
}

export interface ProcessVerificationOpts {
	/** When set, archive log notes include "Manual by <@id>" (admin verify). */
	manualByUserId?: string;
	/**
	 * Manual verify only: send welcome DM when true (default false for `/server verify`).
	 * Self-verify / DM verify always attempt welcome (subject to attempt cap).
	 */
	sendWelcomeDm?: boolean;
	/**
	 * `/server verify` only: when the player ID is already linked elsewhere,
	 * return Approve/Reject buttons instead of a hard block.
	 */
	offerReassignConfirm?: boolean;
	/** After admin Approve — skip the duplicate player-ID guard. */
	forcePlayerIdReassign?: boolean;
}

/** Most paths return a plain string; admin reassign confirm includes buttons. */
export type ProcessVerificationResult =
	| string
	| { content: string; components: DiscordActionRow[] };

export function verificationContent(result: ProcessVerificationResult): string {
	return typeof result === 'string' ? result : result.content;
}

function reassignConfirmComponents(token: string): DiscordActionRow[] {
	return [
		{
			type: 1,
			components: [
				{
					type: 2,
					style: 3,
					label: 'Approve new link',
					custom_id: `vre:ok:${token}`,
				},
				{
					type: 2,
					style: 4,
					label: 'Reject',
					custom_id: `vre:no:${token}`,
				},
			],
		},
	];
}

export async function processVerification(
	env: Env,
	guildId: string,
	discordUserId: string,
	stfcProUrl: string,
	screenshotUrl?: string,
	opts?: ProcessVerificationOpts,
): Promise<ProcessVerificationResult> {
	const locale = await playerLocale(env, guildId, discordUserId);
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return t(locale, 'verify.result.not_configured');
	}

	const existingPlayer = await getVerifiedPlayer(env.STFC_DB, guildId, discordUserId);
	if (needsDataConsent(config, existingPlayer) && !shouldSkipOutboundDm(config)) {
		if (env.DISCORD_BOT_TOKEN) {
			try {
				await sendDataConsentDm(env.DISCORD_BOT_TOKEN, discordUserId, config, locale);
			} catch (err) {
				console.error('Data consent DM (verify gate) failed:', err);
			}
		}
		return t(locale, 'consent.gate.required');
	}

	let archivedR2Key: string | undefined;
	if (screenshotUrl) {
		if (env.VERIFICATION_ASSETS) {
			archivedR2Key = `verifications/${guildId}/${discordUserId}/${Date.now()}.png`;
			const imageResponse = await fetch(screenshotUrl);
			if (imageResponse.ok) {
				await env.VERIFICATION_ASSETS.put(archivedR2Key, await imageResponse.arrayBuffer(), {
					httpMetadata: { contentType: imageResponse.headers.get('content-type') ?? 'image/png' },
				});
			} else {
				archivedR2Key = undefined;
			}
		}
		await recordScreenshot(env.STFC_DB, guildId, discordUserId, screenshotUrl, archivedR2Key);
	}

	const { player, error } = await lookupPlayerFromUrl(env, stfcProUrl, config, locale);
	if (!player || error) {
		await upsertVerifiedPlayer(env.STFC_DB, {
			guild_id: guildId,
			discord_user_id: discordUserId,
			stfc_pro_url: stfcProUrl,
			verification_status: 'failed',
		});
		return `❌ ${error ?? t(locale, 'verify.error.lookup_failed')}`;
	}

	const existingOwners =
		opts?.forcePlayerIdReassign === true
			? []
			: await findOtherVerifiedPlayersByPlayerId(
					env.STFC_DB,
					guildId,
					player.playerId,
					discordUserId,
				);
	if (existingOwners.length > 0) {
		const owner = existingOwners[0]!;
		const ownerLabel = existingOwners
			.map((p) => `<@${p.discord_user_id}> (${p.verification_status})`)
			.join(', ');
		const isAdminManual = Boolean(opts?.manualByUserId);
		const extraOwners =
			existingOwners.length > 1
				? `\nAlso linked to: ${existingOwners
						.slice(1)
						.map((p) => `<@${p.discord_user_id}>`)
						.join(', ')}`
				: '';

		await postAuditLog(env, config, {
			title: 'Duplicate player link attempt',
			description: isAdminManual
				? `Admin <@${opts!.manualByUserId}> tried to link **${player.name}** (ID ${player.playerId}) to <@${discordUserId}>, but it is already linked to ${ownerLabel}.`
				: `<@${discordUserId}> tried to verify as **${player.name}** (ID ${player.playerId}), already linked to ${ownerLabel}.`,
			actorId: opts?.manualByUserId ?? discordUserId,
			source: isAdminManual ? 'admin' : 'member',
			color: AuditColor.warn,
			fields: [
				{ name: 'Player ID', value: String(player.playerId), inline: true },
				{ name: 'Existing Discord', value: `<@${owner.discord_user_id}>`, inline: true },
				{ name: 'Attempted Discord', value: `<@${discordUserId}>`, inline: true },
			],
		});

		if (!isAdminManual) {
			await postUrgentNotify(env, config, {
				content: `⚠️ Duplicate player link: <@${discordUserId}> tried to verify as **${player.name}** (ID ${player.playerId}), already linked to <@${owner.discord_user_id}>.`,
				title: 'Duplicate player link',
				actorId: discordUserId,
				color: AuditColor.warn,
				fields: [
					{ name: 'Player', value: `${player.name} (${player.playerId})`, inline: true },
					{ name: 'Existing link', value: `<@${owner.discord_user_id}>`, inline: true },
				],
			});
			return t(locale, 'verify.error.player_id_in_use_member');
		}

		const adminMsg = t(DEFAULT_LOCALE, 'verify.error.player_id_in_use_admin', {
			playerName: player.name,
			playerId: player.playerId,
			existingUserId: owner.discord_user_id,
			existingStatus: owner.verification_status,
			targetUserId: discordUserId,
			extraOwners,
		});

		if (opts?.offerReassignConfirm && opts.manualByUserId) {
			const session = await createVerifyReassignSession(env.STFC_DB, {
				guildId,
				adminUserId: opts.manualByUserId,
				targetDiscordUserId: discordUserId,
				existingDiscordUserIds: existingOwners.map((p) => p.discord_user_id),
				playerId: player.playerId,
				playerName: player.name,
				stfcProUrl,
				screenshotUrl: screenshotUrl ?? null,
				sendWelcomeDm: opts.sendWelcomeDm === true,
			});
			return {
				content: adminMsg,
				components: reassignConfirmComponents(session.token),
			};
		}

		// Alliance Approve etc.: warn with details; do not overwrite.
		return adminMsg;
	}

	const grade = opsLevelToGrade(player.level);
	const now = new Date().toISOString();
	const allianceTag = player.allianceTag?.trim() || null;
	// Unaffiliated players have no alliance rank — ignore stale/mis-parsed rankdesc.
	const allianceRank = allianceTag ? player.rank?.trim() || null : null;
	const tagMatches = playerMatchesGuildAlliance(config, allianceTag);
	const tagLabel = allianceTag ?? '—';

	const status = tagMatches ? 'active' : 'guest';
	await upsertVerifiedPlayer(env.STFC_DB, {
		guild_id: guildId,
		discord_user_id: discordUserId,
		player_id: player.playerId,
		player_name: player.name,
		alliance_tag: allianceTag,
		alliance_rank: allianceRank,
		ops_level: player.level,
		power: player.power,
		grade,
		stfc_pro_url: stfcProUrl,
		verification_status: status,
		verified_at: now,
		last_synced_at: now,
	});

	if (player.consecutiveDaysActive != null && Number.isFinite(player.consecutiveDaysActive)) {
		const snap = applyActivityObservation(null, 0, player.consecutiveDaysActive);
		await setVerifiedPlayerActivity(env.STFC_DB, guildId, discordUserId, {
			activity_streak: snap.activityStreak,
			days_inactive: snap.daysInactive,
			activity_updated_at: now,
		});
	}

	// Stop cron invite retries (manual verify often left verification_invited_at NULL).
	await recordGuildMember(env.STFC_DB, guildId, discordUserId, null);
	await markMemberInvited(env.STFC_DB, guildId, discordUserId);

	const verified = await getVerifiedPlayer(env.STFC_DB, guildId, discordUserId);
	if (verified) {
		await recordPlayerStats(env.STFC_DB, verified.id, player.level, player.power, player.allianceTag);
	}

	const summary = localizedPlayerSummary(locale, player);

	if (!env.DISCORD_BOT_TOKEN) {
		return t(locale, 'verify.result.verified_no_token', { name: player.name, summary });
	}

	const token = env.DISCORD_BOT_TOKEN;
	const notes: string[] = [];
	const auditNotes: string[] = [];
	if (opts?.manualByUserId) {
		notes.push(t(locale, 'verify.note.manual', { userId: opts.manualByUserId }));
		auditNotes.push(`Manual by <@${opts.manualByUserId}>`);
	}

	const postLog = async (status: 'active' | 'guest', logNotes: string[]) => {
		await postVerificationLog(env, config, {
			guildId,
			discordUserId,
			player,
			stfcProUrl,
			status,
			screenshotUrl,
			r2Key: archivedR2Key,
			notes: logNotes,
		});
	};

	const finishLocale = async () => {
		await ensureLocaleAfterVerify(env, guildId, discordUserId);
	};

	try {
		if (tagMatches) {
			const verifiedForAgree = await getVerifiedPlayer(env.STFC_DB, guildId, discordUserId);
			if (needsAgreementBeforeFullAccess(config, verifiedForAgree)) {
				const roleChanges = await applyGuestRole(token, config, guildId, discordUserId);
				auditNotes.push(formatRoleChangeNote(roleChanges));
				auditNotes.push('Guest/lounge until agreement accepted');
				notes.push(formatRoleChangeNote(roleChanges));
				notes.push(t(locale, 'verify.note.agreement_pending'));
				try {
					if (!shouldSkipOutboundDm(config)) {
						await sendAgreementDm(token, discordUserId, config, locale);
					} else {
						auditNotes.push('Agreement DM skipped (deploy_mode=testing)');
					}
				} catch (err) {
					console.error('Agreement DM (after verify) failed:', err);
				}
				await postLog('active', auditNotes);
				await postAuditLog(env, config, {
					title: 'Member verified (awaiting agreement)',
					description: `<@${discordUserId}> → **${player.name}** [${tagLabel}] — lounge/guest until agreement`,
					actorId: opts?.manualByUserId ?? discordUserId,
					source: opts?.manualByUserId ? 'admin' : 'member',
					color: AuditColor.warn,
					fields: [
						{ name: 'Ops', value: String(player.level), inline: true },
						{ name: 'Notes', value: auditNotes.join(' · ') || '—', inline: false },
					],
				});
				await finishLocale();
				return t(locale, 'verify.result.needs_agreement', {
					name: player.name,
					tag: tagLabel,
					level: player.level,
					summary,
				});
			}

			const roleChanges = await applyMemberRoles(
				token,
				config,
				guildId,
				discordUserId,
				allianceRank ?? undefined,
				allianceTag,
			);
			const roleNote = formatRoleChangeNote(roleChanges);
			notes.push(roleNote);
			auditNotes.push(roleNote);

			if (shouldDeferUntrackedAdmiralRoles(config, allianceTag, allianceRank)) {
				auditNotes.push('Admiral roles deferred (alliance not tracked)');
				await postAuditLog(env, config, {
					title: 'Admiral of untracked alliance',
					description:
						`<@${discordUserId}> → **${player.name}** [${tagLabel}] is an **Admiral** of an untracked alliance. ` +
						`Admiral Discord roles were **not** assigned. Track with \`/alliance track tag:${tagLabel}\` to apply roles and diplomacy.`,
					actorId: opts?.manualByUserId ?? discordUserId,
					source: opts?.manualByUserId ? 'admin' : 'member',
					color: AuditColor.warn,
					fields: [
						{ name: 'Player ID', value: String(player.playerId), inline: true },
						{ name: 'Rank', value: allianceRank ?? 'Admiral', inline: true },
					],
				});
			}

			const nick = nicknameForPlayer(config, {
				...player,
				allianceTag: allianceTag ?? '',
				rank: allianceRank ?? '',
			});
			try {
				await setGuildMemberNickname(token, guildId, discordUserId, nick);
				notes.push(t(locale, 'verify.note.nick', { nick }));
				auditNotes.push(`Nick: ${nick}`);
			} catch (nickErr) {
				console.error('Nickname update failed:', nickErr);
				notes.push(t(locale, 'verify.note.nick_failed'));
				auditNotes.push('Nick failed (hierarchy/owner?)');
			}

			const channelResult = await applyPersonalChannelForMember(
				token,
				config,
				guildId,
				discordUserId,
				player.name,
				verified?.personal_channel_id,
			);
			if (channelResult) {
				await upsertVerifiedPlayer(env.STFC_DB, {
					guild_id: guildId,
					discord_user_id: discordUserId,
					personal_channel_id: channelResult.channelId,
					verification_status: 'active',
				});
				notes.push(t(locale, 'verify.note.channel', { channelId: channelResult.channelId }));
				auditNotes.push(`Channel <#${channelResult.channelId}>`);
			}

			const diplomacyId = allianceTag
				? await applyDiplomacyForAlliance(env, token, config, guildId, allianceTag)
				: null;
			if (diplomacyId) {
				notes.push(t(locale, 'verify.note.diplomacy', { channelId: diplomacyId }));
				auditNotes.push(`Diplomacy <#${diplomacyId}>`);
			} else if (
				allianceTag &&
				config.mode === 'multi_alliance' &&
				shouldDeferUntrackedDiplomacy(config, allianceTag)
			) {
				auditNotes.push('Diplomacy deferred (alliance not tracked)');
			}

			const personalChannelId =
				channelResult?.channelId ?? verified?.personal_channel_id ?? null;
			const { sendWelcomeDmIfNeeded } = await import('./welcome-dm');
			const welcomeOpts =
				opts?.manualByUserId != null
					? opts.sendWelcomeDm === true
						? { force: true as const }
						: { skip: true as const }
					: undefined;
			const welcome = await sendWelcomeDmIfNeeded(
				env,
				config,
				guildId,
				discordUserId,
				personalChannelId,
				welcomeOpts,
			);
			if (welcome.note) auditNotes.push(welcome.note);

			await postLog('active', auditNotes);
			await postAuditLog(env, config, {
				title: 'Member verified (active)',
				description: `<@${discordUserId}> → **${player.name}** [${tagLabel}]`,
				actorId: opts?.manualByUserId ?? discordUserId,
				source: opts?.manualByUserId ? 'admin' : 'member',
				color: AuditColor.success,
				fields: [
					{ name: 'Ops', value: String(player.level), inline: true },
					{ name: 'Notes', value: auditNotes.join(' · ') || '—', inline: false },
				],
			});

			await finishLocale();
			const notesBlock = notes.map((n) => `• ${n}`).join('\n');
			return t(locale, 'verify.result.active', {
				name: player.name,
				tag: tagLabel,
				level: player.level,
				notes: notesBlock,
				summary,
			});
		}

		const guestRoleChanges = await applyGuestRole(token, config, guildId, discordUserId);
		const guestRoleNote = formatRoleChangeNote(guestRoleChanges);
		auditNotes.push(guestRoleNote);
		notes.push(guestRoleNote);
		const guestRecord = await getVerifiedPlayer(env.STFC_DB, guildId, discordUserId);
		if (config.agreement_enabled && !playerHasAcceptedAgreement(config, guestRecord)) {
			try {
				if (!shouldSkipOutboundDm(config)) {
					await sendAgreementDm(token, discordUserId, config, locale);
					auditNotes.push('Agreement DM sent');
				} else {
					auditNotes.push('Agreement DM skipped (deploy_mode=testing)');
				}
			} catch (err) {
				console.error('Agreement DM (guest) failed:', err);
			}
		}
		await postLog('guest', auditNotes);
		await postAuditLog(env, config, {
			title: 'Member verified (guest)',
			description: `<@${discordUserId}> → **${player.name}** [${player.allianceTag}] (expected ${config.alliance_tag ?? '—'})`,
			actorId: opts?.manualByUserId ?? discordUserId,
			source: opts?.manualByUserId ? 'admin' : 'member',
			color: AuditColor.warn,
			fields: [{ name: 'Notes', value: auditNotes.join(' · ') || '—', inline: false }],
		});
		await finishLocale();
		const expected = config.alliance_tag ?? '—';
		return t(locale, 'verify.result.guest', {
			name: player.name,
			tag: player.allianceTag,
			expected,
			hours: config.poll_interval_hours,
			summary,
		});
	} catch (err) {
		console.error('Discord role update failed:', err);
		await postLog(tagMatches ? 'active' : 'guest', ['Discord role update failed']);
		await postAuditLog(env, config, {
			title: 'Verification Discord update failed',
			description: `<@${discordUserId}> → **${player.name}**: ${formatDiscordApiFailure(err)}`,
			actorId: opts?.manualByUserId ?? discordUserId,
			source: opts?.manualByUserId ? 'admin' : 'member',
			color: AuditColor.danger,
		});
		await finishLocale();
		return t(locale, 'verify.result.discord_failed', {
			error: formatDiscordApiFailure(err),
			nickHint: discordPermissionHint(err, locale),
			summary,
		});
	}
}

/**
 * Clear prior Discord owners of an STFC player ID so a new link can be applied.
 * Best-effort guest roles + channel archive; always resets the verified_players row.
 */
async function releasePlayerIdOwners(
	env: Env,
	config: GuildConfig,
	guildId: string,
	playerId: number,
	excludeDiscordUserId: string,
	actorId: string,
): Promise<{ released: string[]; notes: string[] }> {
	const owners = await findOtherVerifiedPlayersByPlayerId(
		env.STFC_DB,
		guildId,
		playerId,
		excludeDiscordUserId,
	);
	const released: string[] = [];
	const notes: string[] = [];

	for (const owner of owners) {
		const uid = owner.discord_user_id;
		if (env.DISCORD_BOT_TOKEN && !isDeployTesting(config)) {
			try {
				const roleChanges = await applyGuestRole(
					env.DISCORD_BOT_TOKEN,
					config,
					guildId,
					uid,
				);
				notes.push(`<@${uid}> ${formatRoleChangeNote(roleChanges)}`);
			} catch (err) {
				notes.push(`<@${uid}> role update failed: ${formatDiscordApiFailure(err)}`);
			}
			try {
				const archived = await archivePersonalChannelOnDemotion(
					env.DISCORD_BOT_TOKEN,
					config,
					owner.personal_channel_id,
				);
				if (archived && owner.personal_channel_id) {
					notes.push(`<@${uid}> channel archived <#${owner.personal_channel_id}>`);
				}
			} catch (err) {
				console.warn('Archive personal channel on reassign failed:', err);
			}
		}
		await resetVerification(env.STFC_DB, guildId, uid);
		released.push(uid);
	}

	if (released.length > 0) {
		await postAuditLog(env, config, {
			title: 'Player link reassigned — prior owners cleared',
			description:
				`STFC player ID **${playerId}** released from ${released.map((id) => `<@${id}>`).join(', ')} ` +
				`so <@${excludeDiscordUserId}> can be linked.`,
			actorId,
			source: 'admin',
			color: AuditColor.warn,
			fields: notes.length
				? [{ name: 'Notes', value: notes.join(' · ').slice(0, 1024), inline: false }]
				: undefined,
		});
	}

	return { released, notes };
}

/** Approve / Reject buttons from `/server verify` duplicate-player warning. */
export async function handleVerifyReassignComponent(
	env: Env,
	ctx: ExecutionContext,
	interaction: {
		guild_id?: string;
		application_id?: string;
		token: string;
		member?: { permissions?: string; user?: { id: string } };
		data?: { custom_id?: string };
	},
): Promise<Response> {
	const customId = interaction.data?.custom_id ?? '';
	const match = customId.match(/^vre:(ok|no):([a-f0-9]+)$/i);
	if (!match) {
		return updateMessageResponse('❌ Unknown reassign button.', { components: [] });
	}

	if (!isGuildAdministrator(interaction.member?.permissions)) {
		return updateMessageResponse('❌ Administrator required.', { components: [] });
	}

	const guildId = interaction.guild_id;
	if (!guildId) {
		return updateMessageResponse('❌ Run this inside the server.', { components: [] });
	}

	const action = match[1]!;
	const token = match[2]!;
	const session = await getVerifyReassignSession(env.STFC_DB, token);
	if (!session || session.guild_id !== guildId) {
		return updateMessageResponse(
			'❌ This confirmation expired or was already used. Run `/server verify` again.',
			{ components: [] },
		);
	}

	const actorId = interaction.member?.user?.id ?? session.admin_user_id;
	const config = await getGuildConfig(env.STFC_DB, guildId);

	if (action === 'no') {
		await deleteVerifyReassignSession(env.STFC_DB, token);
		if (config) {
			await postAuditLog(env, config, {
				title: 'Duplicate player link rejected',
				description:
					`Admin <@${actorId}> rejected linking **${session.player_name ?? session.player_id}** ` +
					`(ID ${session.player_id}) to <@${session.target_discord_user_id}>. ` +
					`Existing: ${session.existing_discord_user_ids.map((id) => `<@${id}>`).join(', ') || '—'}`,
				actorId,
				source: 'admin',
				color: AuditColor.info,
			});
		}
		return updateMessageResponse(
			`❌ **Rejected** — left <@${session.existing_discord_user_ids[0] ?? 'unknown'}> linked to ` +
				`**${session.player_name ?? session.player_id}** (ID \`${session.player_id}\`). ` +
				`No changes for <@${session.target_discord_user_id}>.`,
			{ components: [] },
		);
	}

	const appId = interaction.application_id ?? env.DISCORD_APPLICATION_ID;
	if (!appId) {
		return updateMessageResponse('❌ DISCORD_APPLICATION_ID not configured.', { components: [] });
	}

	const deferred = deferredComponentResponse();
	ctx.waitUntil(
		(async () => {
			try {
				await editInteractionResponse(
					appId,
					interaction.token,
					`⏳ Approving reassignment of **${session.player_name ?? session.player_id}** ` +
						`(ID \`${session.player_id}\`) → <@${session.target_discord_user_id}>…`,
					true,
					{ components: [], config },
				);

				if (config) {
					await releasePlayerIdOwners(
						env,
						config,
						guildId,
						session.player_id,
						session.target_discord_user_id,
						actorId,
					);
				} else {
					for (const uid of session.existing_discord_user_ids) {
						await resetVerification(env.STFC_DB, guildId, uid);
					}
				}

				await deleteVerifyReassignSession(env.STFC_DB, token);

				const result = await processVerification(
					env,
					guildId,
					session.target_discord_user_id,
					session.stfc_pro_url,
					session.screenshot_url ?? undefined,
					{
						manualByUserId: actorId,
						sendWelcomeDm: session.send_welcome_dm,
						forcePlayerIdReassign: true,
					},
				);
				const content = verificationContent(result);
				const prefix =
					`✅ Reassigned **${session.player_name ?? session.player_id}** ` +
					`(ID \`${session.player_id}\`) from ` +
					`${session.existing_discord_user_ids.map((id) => `<@${id}>`).join(', ') || '—'} ` +
					`→ <@${session.target_discord_user_id}>.\n\n`;
				await editInteractionResponse(appId, interaction.token, prefix + content, true, {
					components: [],
					config,
				});
			} catch (err) {
				console.error('Verify reassign approve failed:', err);
				await editInteractionResponse(
					appId,
					interaction.token,
					`❌ Reassign failed: ${err instanceof Error ? err.message : String(err)}`,
					true,
					{ components: [], config },
				);
			}
		})(),
	);

	return deferred;
}

export async function inviteNewMember(
	env: Env,
	guildId: string,
	userId: string,
	username: string,
): Promise<DmResult> {
	if (await isUserExcluded(env.STFC_DB, guildId, userId)) {
		await recordGuildMember(env.STFC_DB, guildId, userId, username);
		await markMemberInvited(env.STFC_DB, guildId, userId);
		return { ok: true };
	}

	const existing = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
	const config = await getGuildConfig(env.STFC_DB, guildId);
	const alreadyDone =
		existing &&
		(existing.verification_status === 'active' ||
			existing.verification_status === 'guest' ||
			existing.verification_status === 'verified');

	// Manually verified (or already onboarded) — never reset status or spam invite DMs.
	if (alreadyDone) {
		await recordGuildMember(env.STFC_DB, guildId, userId, username);
		await markMemberInvited(env.STFC_DB, guildId, userId);
		return { ok: true };
	}

	if (shouldSkipOutboundDm(config)) {
		await recordGuildMember(env.STFC_DB, guildId, userId, username);
		// Do not mark invited — after go-live, member poll / test-invite can send for real.
		console.log(
			`inviteNewMember skipped (testing) guild=${guildId} user=${userId} (${username})`,
		);
		return { ok: true, skippedTesting: true };
	}

	// Older invite bug reset status to pending_* while leaving player_id / verified_at.
	// Restore without forcing a re-verify or another DM attempt.
	const clobbered =
		existing &&
		existing.player_id != null &&
		existing.verified_at &&
		(existing.verification_status === 'pending_screenshot' ||
			existing.verification_status === 'pending_link' ||
			existing.verification_status === 'pending_invite');
	if (clobbered && existing) {
		const tagMatches = !config || playerMatchesGuildAlliance(config, existing.alliance_tag);
		await upsertVerifiedPlayer(env.STFC_DB, {
			guild_id: guildId,
			discord_user_id: userId,
			verification_status: tagMatches ? 'active' : 'guest',
		});
		await recordGuildMember(env.STFC_DB, guildId, userId, username);
		await markMemberInvited(env.STFC_DB, guildId, userId);
		return { ok: true };
	}

	await upsertVerifiedPlayer(env.STFC_DB, {
		guild_id: guildId,
		discord_user_id: userId,
		verification_status: 'pending_screenshot',
	});

	if (!env.DISCORD_BOT_TOKEN) {
		console.warn('DISCORD_BOT_TOKEN not set — cannot send verification DM');
		return { ok: false, errorMessage: 'DISCORD_BOT_TOKEN not configured' };
	}

	try {
		const locale = resolveLocale(existing?.preferred_locale);
		if (!existing?.preferred_locale) {
			await sendLanguagePickerDm(env.DISCORD_BOT_TOKEN, userId, guildId);
		} else if (config && needsDataConsent(config, existing)) {
			await sendDataConsentDm(env.DISCORD_BOT_TOKEN, userId, config, locale);
		} else {
			await sendDirectMessage(env.DISCORD_BOT_TOKEN, userId, t(locale, 'verify.invite.welcome'));
		}
		await markMemberInvited(env.STFC_DB, guildId, userId);
		await postAuditLog(env, config, {
			title: 'Verification invite sent',
			description: `DM sent to <@${userId}> (${username})` +
				(!existing?.preferred_locale
					? ' · language picker'
					: config && needsDataConsent(config, existing)
						? ' · data consent'
						: ` · locale ${locale}`),
			actorId: userId,
			source: 'automated',
			color: AuditColor.info,
		});
		return { ok: true };
	} catch (error) {
		const maybeDiscordErr = error as { status?: number; body?: string; message?: string };
		const status = typeof maybeDiscordErr.status === 'number' ? maybeDiscordErr.status : undefined;

		let errorMessage = error instanceof Error ? error.message : 'Unknown error';
		if (maybeDiscordErr.body) {
			const body = String(maybeDiscordErr.body);
			errorMessage += `: ${body.slice(0, 180)}${body.length > 180 ? '…' : ''}`;
		}

		console.error(`Failed to DM ${userId}:`, errorMessage);
		const is403 = status === 403 || /DM open failed:\s*403/i.test(errorMessage);
		// Stop retrying forever when privacy blocks DMs — they can /verify in-channel.
		if (is403) {
			await markMemberInvited(env.STFC_DB, guildId, userId);
		}
		const privacyHint = is403
			? '\n\nLikely cause: their Discord privacy settings block DMs from server members (or they blocked the bot). Ask them to enable **Allow direct messages from server members** for this server, then use `/server test-invite` or `/verify` in-channel.'
			: '';
		await postAuditLog(env, config, {
			title: 'Verification invite failed',
			description: `Could not DM <@${userId}> (${username}): ${errorMessage.slice(0, 400)}${privacyHint}`,
			actorId: userId,
			source: 'automated',
			color: AuditColor.danger,
		});
		if (is403) {
			await postUrgentNotify(env, config, {
				content:
					`🚨 Attention, administrators! I couldn't DM <@${userId}> (**${username}**) — ` +
					`their Discord privacy settings likely block DMs from server members (or they blocked me).\n\n` +
					`Ask them to enable **Allow direct messages from server members** for this server, then run ` +
					`\`/server test-invite\` — or have them use \`/verify\` in-channel. Standing by!`,
				title: 'Verification DM blocked',
				description: errorMessage.slice(0, 500),
				actorId: userId,
				color: AuditColor.danger,
				fields: [{ name: 'Username', value: username.slice(0, 100), inline: true }],
			});
		}
		return { ok: false, errorMessage, status };
	}
}

export async function syncVerifiedPlayer(
	env: Env,
	config: GuildConfig,
	guildId: string,
	discordUserId: string,
	player: PlayerData,
	opts?: {
		autoDemoteOnMismatch?: boolean;
		/**
		 * When true, do not post per-player "Player sync update" audits.
		 * Caller (daily cron) batches activity / welcome / material changes.
		 */
		deferSyncAudit?: boolean;
	},
): Promise<{
	outcome: 'synced' | 'demoted' | 'mismatch_deferred';
	changeSummary?: string[];
	activity?: ReturnType<typeof applyActivityObservation>;
	welcomeNote?: string;
	welcomeSent?: boolean;
}> {
	if (!env.DISCORD_BOT_TOKEN) return { outcome: 'synced' };

	const token = env.DISCORD_BOT_TOKEN;
	const previous = await getVerifiedPlayer(env.STFC_DB, guildId, discordUserId);
	const allianceTag = (player.allianceTag ?? '').trim();
	const allianceRank = allianceTag ? player.rank?.trim() || null : null;
	const tagMatches = playerMatchesGuildAlliance(config, allianceTag);
	const autoDemote = opts?.autoDemoteOnMismatch !== false;
	const deferAudit = opts?.deferSyncAudit === true;

	const grade = opsLevelToGrade(player.level);
	const now = new Date().toISOString();
	const playerForRoles: PlayerData = {
		...player,
		allianceTag,
		rank: allianceRank ?? '',
	};
	const nextStatus = tagMatches ? 'active' : 'guest';

	const applyObservedActivity = async (): Promise<
		ReturnType<typeof applyActivityObservation> | undefined
	> => {
		if (player.consecutiveDaysActive == null || !Number.isFinite(player.consecutiveDaysActive)) {
			return undefined;
		}
		const snap = applyActivityObservation(
			previous?.activity_streak,
			previous?.days_inactive,
			player.consecutiveDaysActive,
		);
		await setVerifiedPlayerActivity(env.STFC_DB, guildId, discordUserId, {
			activity_streak: snap.activityStreak,
			days_inactive: snap.daysInactive,
			activity_updated_at: now,
		});
		return snap;
	};

	const maybePostSyncAudit = async (changes: string[]) => {
		if (deferAudit || changes.length === 0) return;
		await postAuditLog(env, config, {
			title: 'Player sync update',
			description: `<@${discordUserId}> **${player.name}**`,
			source: 'cron',
			color: changes.some(
				(c) => c.startsWith('status') || c.startsWith('alliance') || c.includes('inactive'),
			)
				? AuditColor.warn
				: AuditColor.info,
			fields: [{ name: 'Changes', value: changes.join('\n').slice(0, 1000), inline: false }],
		});
	};

	if (!tagMatches) {
		if (!autoDemote || isDeployTesting(config)) {
			await upsertVerifiedPlayer(env.STFC_DB, {
				guild_id: guildId,
				discord_user_id: discordUserId,
				player_name: player.name,
				alliance_tag: allianceTag || null,
				alliance_rank: allianceRank,
				ops_level: player.level,
				power: player.power,
				grade,
				last_synced_at: now,
			});
			const activity = await applyObservedActivity();
			return { outcome: 'mismatch_deferred', activity };
		}

		const demote = await demotePlayerToGuest(env, config, guildId, discordUserId, {
			reason: 'alliance_mismatch',
			player: playerForRoles,
			source: 'cron',
			skipAudit: true,
		});
		const activity = await applyObservedActivity();
		const changes: string[] = [...demote.notes];
		if (previous?.verification_status && previous.verification_status !== 'guest') {
			changes.unshift(`status ${previous.verification_status} → guest`);
		}
		// Notable inactivity only — routine streak bumps are batched by cron activity report.
		if (activity?.becameInactive) changes.push('became inactive');
		else if (activity?.returnedActive) changes.push('returned active');
		else if (activity?.inactiveDayAdded) changes.push(`still inactive ${activity.daysInactive}d`);

		await maybePostSyncAudit(changes);
		return { outcome: 'demoted', changeSummary: changes, activity };
	}

	await upsertVerifiedPlayer(env.STFC_DB, {
		guild_id: guildId,
		discord_user_id: discordUserId,
		player_name: player.name,
		alliance_tag: allianceTag || null,
		alliance_rank: allianceRank,
		ops_level: player.level,
		power: player.power,
		grade,
		last_synced_at: now,
		verification_status: nextStatus,
	});

	const activity = await applyObservedActivity();

	const changes: string[] = [];
	if (previous?.verification_status && previous.verification_status !== nextStatus) {
		changes.push(`status ${previous.verification_status} → ${nextStatus}`);
	}
	if (previous?.alliance_tag && previous.alliance_tag !== allianceTag) {
		changes.push(`alliance ${previous.alliance_tag} → ${allianceTag || '(none)'}`);
	}
	if ((previous?.alliance_rank || null) !== allianceRank) {
		if (previous?.alliance_rank || allianceRank) {
			changes.push(`rank ${previous?.alliance_rank ?? '—'} → ${allianceRank ?? '—'}`);
		}
	}

	let welcomeNote: string | undefined;
	let welcomeSent: boolean | undefined;

	const current = await getVerifiedPlayer(env.STFC_DB, guildId, discordUserId);
	if (needsAgreementBeforeFullAccess(config, current)) {
		const roleChanges = await applyGuestRole(token, config, guildId, discordUserId);
		changes.push(formatRoleChangeNote(roleChanges));
		if (changes.length > 0) {
			changes.push('held at guest until agreement');
		}
	} else {
		const roleChanges = await applyMemberRoles(
			token,
			config,
			guildId,
			discordUserId,
			allianceRank ?? undefined,
			allianceTag,
		);
		const roleNote = formatRoleChangeNote(roleChanges);
		if (roleChanges.added.length > 0 || roleChanges.removed.length > 0) {
			changes.push(roleNote);
		}
		if (shouldDeferUntrackedAdmiralRoles(config, allianceTag, allianceRank)) {
			changes.push('Admiral roles deferred (alliance not tracked)');
		}
		try {
			await setGuildMemberNickname(
				token,
				guildId,
				discordUserId,
				nicknameForPlayer(config, playerForRoles),
			);
		} catch (nickErr) {
			console.error('Nickname sync failed:', nickErr);
		}

		if (previous?.player_name && previous.player_name !== player.name) {
			changes.push(`name ${previous.player_name} → ${player.name}`);
		}

		const existing = await getVerifiedPlayer(env.STFC_DB, guildId, discordUserId);
		const channelResult = await applyPersonalChannelForMember(
			token,
			config,
			guildId,
			discordUserId,
			player.name,
			existing?.personal_channel_id,
		);
		if (channelResult) {
			await upsertVerifiedPlayer(env.STFC_DB, {
				guild_id: guildId,
				discord_user_id: discordUserId,
				personal_channel_id: channelResult.channelId,
			});
			if (channelResult.created || !previous?.personal_channel_id) {
				changes.push(`channel <#${channelResult.channelId}>`);
			} else {
				if (channelResult.renamed) {
					changes.push(`channel renamed <#${channelResult.channelId}>`);
				}
				if (channelResult.moved) {
					changes.push(`channel moved <#${channelResult.channelId}>`);
				}
			}
		}

		if (allianceTag) {
			await applyDiplomacyForAlliance(env, token, config, guildId, allianceTag);
		}

		const personalChannelId =
			channelResult?.channelId ?? existing?.personal_channel_id ?? previous?.personal_channel_id ?? null;
		const { sendWelcomeDmIfNeeded } = await import('./welcome-dm');
		const welcome = await sendWelcomeDmIfNeeded(
			env,
			config,
			guildId,
			discordUserId,
			personalChannelId,
		);
		if (welcome.note) {
			welcomeNote = welcome.note;
			welcomeSent = welcome.sent;
			if (!deferAudit) changes.push(welcome.note);
		}
	}

	// Notable inactivity only in change summary — cron already tables became/returned/still.
	if (activity?.becameInactive) changes.push('became inactive');
	else if (activity?.returnedActive) changes.push('returned active');
	else if (activity?.inactiveDayAdded && activity.daysInactive >= 3) {
		changes.push(`still inactive ${activity.daysInactive}d`);
	}

	await maybePostSyncAudit(changes);
	return {
		outcome: 'synced',
		changeSummary: changes,
		activity,
		welcomeNote,
		welcomeSent,
	};
}
