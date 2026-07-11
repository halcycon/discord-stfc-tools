import {
	DiscordApiError,
	sendDirectMessage,
	setGuildMemberNickname,
} from './discord-api';
import { opsLevelToGrade } from './grade-utils';
import {
	getGuildConfig,
	getVerifiedPlayer,
	recordPlayerStats,
	recordScreenshot,
	upsertVerifiedPlayer,
} from './guild-db';
import { parseStfcProUrl, resolveSearchTerm } from './stfc-url';
import { findPlayerByIdOrName } from './stfc-utils';
import { postVerificationLog } from './verification-log';
import { AuditColor, postAuditLog } from './audit-log';
import { DEFAULT_LOCALE, resolveLocale, t } from './i18n';
import { ensureLocaleAfterVerify, sendLanguagePickerDm } from './i18n/language-picker';
import {
	needsAgreementBeforeFullAccess,
	needsAgreementBeforeVerify,
	playerHasAcceptedAgreement,
	sendAgreementDm,
} from './agreement';
import {
	applyDiplomacyForAlliance,
	applyGuestRole,
	applyMemberRoles,
	applyPersonalChannelForMember,
	formatDiscordApiFailure,
	nicknameForPlayer,
} from './verification-access';
import type { GuildConfig, PlayerData } from './types';

export type DmResult =
	| { ok: true }
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

	const player = await findPlayerByIdOrName(searchTerm, server, region);
	if (!player) {
		return {
			player: null,
			error: t(locale, 'verify.error.player_not_found', { server, region }),
		};
	}

	if (!player.allianceTag) {
		return { player: null, error: t(locale, 'verify.error.no_alliance') };
	}

	return { player };
}

function nicknamePermissionHint(err: unknown, locale: string): string {
	const body = err instanceof DiscordApiError ? err.body ?? '' : '';
	const isMissingPerms =
		(err instanceof DiscordApiError && err.status === 403) ||
		body.includes('50013') ||
		body.includes('Missing Permissions');
	if (!isMissingPerms) return '';
	return t(locale, 'verify.hint.nickname_permissions');
}

export interface ProcessVerificationOpts {
	/** When set, archive log notes include "Manual by <@id>" (admin verify). */
	manualByUserId?: string;
}

export async function processVerification(
	env: Env,
	guildId: string,
	discordUserId: string,
	stfcProUrl: string,
	screenshotUrl?: string,
	opts?: ProcessVerificationOpts,
): Promise<string> {
	const locale = await playerLocale(env, guildId, discordUserId);
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return t(locale, 'verify.result.not_configured');
	}

	const existingPlayer = await getVerifiedPlayer(env.STFC_DB, guildId, discordUserId);
	if (needsAgreementBeforeVerify(config, existingPlayer)) {
		if (env.DISCORD_BOT_TOKEN) {
			try {
				await sendAgreementDm(env.DISCORD_BOT_TOKEN, discordUserId, config, locale);
			} catch (err) {
				console.error('Agreement DM (before verify) failed:', err);
			}
		}
		return t(locale, 'agree.gate.before_verify');
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

	const { player, error } = await lookupPlayerFromUrl(stfcProUrl, config, locale);
	if (!player || error) {
		await upsertVerifiedPlayer(env.STFC_DB, {
			guild_id: guildId,
			discord_user_id: discordUserId,
			stfc_pro_url: stfcProUrl,
			verification_status: 'failed',
		});
		return `❌ ${error ?? t(locale, 'verify.error.lookup_failed')}`;
	}

	const grade = opsLevelToGrade(player.level);
	const now = new Date().toISOString();
	const tagMatches =
		config.mode === 'multi_alliance' ||
		(config.alliance_tag && player.allianceTag.toUpperCase() === config.alliance_tag.toUpperCase());

	const status = tagMatches ? 'active' : 'guest';
	await upsertVerifiedPlayer(env.STFC_DB, {
		guild_id: guildId,
		discord_user_id: discordUserId,
		player_id: player.playerId,
		player_name: player.name,
		alliance_tag: player.allianceTag,
		alliance_rank: player.rank || null,
		ops_level: player.level,
		power: player.power,
		grade,
		stfc_pro_url: stfcProUrl,
		verification_status: status,
		verified_at: now,
		last_synced_at: now,
	});

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
				await applyGuestRole(token, config, guildId, discordUserId);
				auditNotes.push('Guest/lounge until agreement accepted');
				notes.push(t(locale, 'verify.note.agreement_pending'));
				try {
					await sendAgreementDm(token, discordUserId, config, locale);
				} catch (err) {
					console.error('Agreement DM (after verify) failed:', err);
				}
				await postLog('active', auditNotes);
				await postAuditLog(env, config, {
					title: 'Member verified (awaiting agreement)',
					description: `<@${discordUserId}> → **${player.name}** [${player.allianceTag}] — lounge/guest until agreement`,
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
					tag: player.allianceTag,
					level: player.level,
					summary,
				});
			}

			await applyMemberRoles(token, config, guildId, discordUserId, player.rank);
			notes.push(t(locale, 'verify.note.roles_updated'));
			auditNotes.push('Roles updated');

			const nick = nicknameForPlayer(config, player);
			try {
				await setGuildMemberNickname(token, guildId, discordUserId, nick);
				notes.push(t(locale, 'verify.note.nick', { nick }));
				auditNotes.push(`Nick: ${nick}`);
			} catch (nickErr) {
				console.error('Nickname update failed:', nickErr);
				notes.push(t(locale, 'verify.note.nick_failed'));
				auditNotes.push('Nick failed (hierarchy/owner?)');
			}

			const channelId = await applyPersonalChannelForMember(
				token,
				config,
				guildId,
				discordUserId,
				player.name,
				verified?.personal_channel_id,
			);
			if (channelId) {
				await upsertVerifiedPlayer(env.STFC_DB, {
					guild_id: guildId,
					discord_user_id: discordUserId,
					personal_channel_id: channelId,
					verification_status: 'active',
				});
				notes.push(t(locale, 'verify.note.channel', { channelId }));
				auditNotes.push(`Channel <#${channelId}>`);
			}

			const diplomacyId = await applyDiplomacyForAlliance(
				env,
				token,
				config,
				guildId,
				player.allianceTag,
			);
			if (diplomacyId) {
				notes.push(t(locale, 'verify.note.diplomacy', { channelId: diplomacyId }));
				auditNotes.push(`Diplomacy <#${diplomacyId}>`);
			}

			await postLog('active', auditNotes);
			await postAuditLog(env, config, {
				title: 'Member verified (active)',
				description: `<@${discordUserId}> → **${player.name}** [${player.allianceTag}]`,
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
				tag: player.allianceTag,
				level: player.level,
				notes: notesBlock,
				summary,
			});
		}

		await applyGuestRole(token, config, guildId, discordUserId);
		auditNotes.push('Guest role assigned');
		const guestRecord = await getVerifiedPlayer(env.STFC_DB, guildId, discordUserId);
		if (config.agreement_enabled && !playerHasAcceptedAgreement(config, guestRecord)) {
			try {
				await sendAgreementDm(token, discordUserId, config, locale);
				auditNotes.push('Agreement DM sent');
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
			nickHint: nicknamePermissionHint(err, locale),
			summary,
		});
	}
}

export async function inviteNewMember(
	env: Env,
	guildId: string,
	userId: string,
	username: string,
): Promise<DmResult> {
	const existing = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
	await upsertVerifiedPlayer(env.STFC_DB, {
		guild_id: guildId,
		discord_user_id: userId,
		verification_status: 'pending_screenshot',
	});

	const config = await getGuildConfig(env.STFC_DB, guildId);

	if (!env.DISCORD_BOT_TOKEN) {
		console.warn('DISCORD_BOT_TOKEN not set — cannot send verification DM');
		return { ok: false, errorMessage: 'DISCORD_BOT_TOKEN not configured' };
	}

	try {
		const locale = resolveLocale(existing?.preferred_locale);
		if (!existing?.preferred_locale) {
			await sendLanguagePickerDm(env.DISCORD_BOT_TOKEN, userId, guildId);
		} else {
			await sendDirectMessage(env.DISCORD_BOT_TOKEN, userId, t(locale, 'verify.invite.welcome'));
		}
		await postAuditLog(env, config, {
			title: 'Verification invite sent',
			description: `DM sent to <@${userId}> (${username})` +
				(existing?.preferred_locale ? ` · locale ${locale}` : ' · language picker'),
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
		await postAuditLog(env, config, {
			title: 'Verification invite failed',
			description: `Could not DM <@${userId}> (${username}): ${errorMessage.slice(0, 500)}`,
			actorId: userId,
			source: 'automated',
			color: AuditColor.danger,
		});
		return { ok: false, errorMessage, status };
	}
}

export async function syncVerifiedPlayer(
	env: Env,
	config: GuildConfig,
	guildId: string,
	discordUserId: string,
	player: PlayerData,
): Promise<void> {
	if (!env.DISCORD_BOT_TOKEN || !player.allianceTag) return;

	const token = env.DISCORD_BOT_TOKEN;
	const previous = await getVerifiedPlayer(env.STFC_DB, guildId, discordUserId);
	const tagMatches =
		config.mode === 'multi_alliance' ||
		(config.alliance_tag && player.allianceTag.toUpperCase() === config.alliance_tag.toUpperCase());

	const grade = opsLevelToGrade(player.level);
	const now = new Date().toISOString();
	const nextStatus = tagMatches ? 'active' : 'guest';

	await upsertVerifiedPlayer(env.STFC_DB, {
		guild_id: guildId,
		discord_user_id: discordUserId,
		player_name: player.name,
		alliance_tag: player.allianceTag,
		alliance_rank: player.rank || null,
		ops_level: player.level,
		power: player.power,
		grade,
		last_synced_at: now,
		verification_status: nextStatus,
	});

	const changes: string[] = [];
	if (previous?.verification_status && previous.verification_status !== nextStatus) {
		changes.push(`status ${previous.verification_status} → ${nextStatus}`);
	}
	if (previous?.alliance_tag && previous.alliance_tag !== player.allianceTag) {
		changes.push(`alliance ${previous.alliance_tag} → ${player.allianceTag}`);
	}
	if (previous?.alliance_rank && player.rank && previous.alliance_rank !== player.rank) {
		changes.push(`rank ${previous.alliance_rank} → ${player.rank}`);
	}

	if (tagMatches) {
		const current = await getVerifiedPlayer(env.STFC_DB, guildId, discordUserId);
		if (needsAgreementBeforeFullAccess(config, current)) {
			await applyGuestRole(token, config, guildId, discordUserId);
			if (changes.length > 0) {
				changes.push('held at guest until agreement');
			}
		} else {
			await applyMemberRoles(token, config, guildId, discordUserId, player.rank);
			try {
				await setGuildMemberNickname(token, guildId, discordUserId, nicknameForPlayer(config, player));
			} catch (nickErr) {
				console.error('Nickname sync failed:', nickErr);
			}

			const existing = await getVerifiedPlayer(env.STFC_DB, guildId, discordUserId);
			const channelId = await applyPersonalChannelForMember(
				token,
				config,
				guildId,
				discordUserId,
				player.name,
				existing?.personal_channel_id,
			);
			if (channelId) {
				await upsertVerifiedPlayer(env.STFC_DB, {
					guild_id: guildId,
					discord_user_id: discordUserId,
					personal_channel_id: channelId,
				});
				if (!previous?.personal_channel_id) {
					changes.push(`channel <#${channelId}>`);
				}
			}

			await applyDiplomacyForAlliance(env, token, config, guildId, player.allianceTag);
		}
	} else {
		await applyGuestRole(token, config, guildId, discordUserId);
	}

	if (changes.length > 0) {
		await postAuditLog(env, config, {
			title: 'Player sync update',
			description: `<@${discordUserId}> **${player.name}**`,
			source: 'cron',
			color: changes.some((c) => c.startsWith('status') || c.startsWith('alliance'))
				? AuditColor.warn
				: AuditColor.info,
			fields: [{ name: 'Changes', value: changes.join('\n'), inline: false }],
		});
	}
}
