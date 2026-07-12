import {
	sendDirectMessage,
	sendMessageWithComponents,
	updateMessageResponse,
	type DiscordActionRow,
} from './discord-api';
import {
	getGuildConfig,
	getVerifiedPlayer,
	listPlayersMissingAgreement,
	upsertVerifiedPlayer,
} from './guild-db';
import { resolveLocale, t } from './i18n';
import { AuditColor, postAuditLog } from './audit-log';
import { postVerificationLog } from './verification-log';
import type { GuildConfig, VerifiedPlayer } from './types';
import { findPlayerByIdOrName } from './stfc-utils';
import { grantFullAccessForVerifiedPlayer } from './verification-access';

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export const AGREE_CUSTOM_ID_PREFIX = 'agree:';

/** `agree:{guildId}` */
export function agreeCustomId(guildId: string): string {
	return `${AGREE_CUSTOM_ID_PREFIX}${guildId}`;
}

export function parseAgreeCustomId(customId: string): { guildId: string } | null {
	if (!customId.startsWith(AGREE_CUSTOM_ID_PREFIX)) return null;
	const guildId = customId.slice(AGREE_CUSTOM_ID_PREFIX.length);
	if (!/^\d{15,20}$/.test(guildId)) return null;
	return { guildId };
}

export function hasMatchingAgreementVersion(
	config: Pick<GuildConfig, 'agreement_version'>,
	player: Pick<VerifiedPlayer, 'agreement_accepted_at' | 'agreement_version'> | null | undefined,
): boolean {
	if (!player?.agreement_accepted_at) return false;
	const required = config.agreement_version?.trim();
	if (!required) return true;
	return (player.agreement_version?.trim() || '') === required;
}

export function playerHasAcceptedAgreement(
	config: GuildConfig,
	player: Pick<VerifiedPlayer, 'agreement_accepted_at' | 'agreement_version'> | null | undefined,
): boolean {
	if (!config.agreement_enabled) return true;
	return hasMatchingAgreementVersion(config, player);
}

export function needsAgreementBeforeVerify(
	_config: GuildConfig,
	_player: Pick<VerifiedPlayer, 'agreement_accepted_at' | 'agreement_version'> | null | undefined,
): boolean {
	// Pre-verify gating is handled by data-consent.ts (GDPR). CoC uses after_verify only.
	return false;
}

/** After stfc.pro verify: withhold full member access (lounge/guest) until agree. */
export function needsAgreementBeforeFullAccess(
	config: GuildConfig,
	player: Pick<VerifiedPlayer, 'agreement_accepted_at' | 'agreement_version'> | null | undefined,
): boolean {
	return (
		config.agreement_enabled &&
		config.agreement_timing === 'after_verify' &&
		!playerHasAcceptedAgreement(config, player)
	);
}

export function buildAgreementComponents(guildId: string, locale: string): DiscordActionRow[] {
	return [
		{
			type: 1,
			components: [
				{
					type: 2,
					style: 3,
					label: t(locale, 'agree.btn.accept').slice(0, 80),
					custom_id: agreeCustomId(guildId),
				},
			],
		},
	];
}

export function agreementDmContent(config: GuildConfig, locale: string): string {
	const channelHint = config.agreement_channel_id
		? t(locale, 'agree.dm.channel_link', { channelId: config.agreement_channel_id })
		: '';
	const versionHint = config.agreement_version
		? t(locale, 'agree.dm.version', { version: config.agreement_version })
		: '';
	return [t(locale, 'agree.dm.body'), channelHint, versionHint].filter(Boolean).join('\n\n');
}

export async function sendAgreementDm(
	token: string,
	userId: string,
	config: GuildConfig,
	locale: string,
): Promise<void> {
	const channelResponse = await fetch('https://discord.com/api/v10/users/@me/channels', {
		method: 'POST',
		headers: {
			Authorization: `Bot ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ recipient_id: userId }),
	});
	if (!channelResponse.ok) {
		throw new Error(`DM open failed: ${channelResponse.status}`);
	}
	const channel = (await channelResponse.json()) as { id: string };

	if (config.agreement_mode === 'channel_react') {
		// v1: still send DM button; reaction mode is stubbed for a follow-up.
		await sendMessageWithComponents(token, channel.id, {
			content:
				agreementDmContent(config, locale) +
				'\n\n' +
				t(locale, 'agree.dm.react_coming_soon'),
			components: buildAgreementComponents(config.guild_id, locale),
		});
		return;
	}

	await sendMessageWithComponents(token, channel.id, {
		content: agreementDmContent(config, locale),
		components: buildAgreementComponents(config.guild_id, locale),
	});
}

/**
 * Record CoC acceptance and grant Discord access (same outcome as the Agree button).
 * Used by the member button and by admin backfill.
 */
export async function acceptAgreementAndGrantAccess(
	env: Env,
	config: GuildConfig,
	guildId: string,
	userId: string,
	opts: {
		method: 'dm_button' | 'admin_backfill';
		actorId?: string;
		/** Skip per-user audit when doing bulk backfill (caller posts one summary). */
		skipAudit?: boolean;
	},
): Promise<{ alreadyAccepted: boolean; accessNote: string; ok: boolean; error?: string }> {
	const player = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
	if (hasMatchingAgreementVersion(config, player)) {
		return { alreadyAccepted: true, accessNote: '', ok: true };
	}

	const now = new Date().toISOString();
	const version = config.agreement_version ?? now.slice(0, 10);
	await upsertVerifiedPlayer(env.STFC_DB, {
		guild_id: guildId,
		discord_user_id: userId,
		agreement_accepted_at: now,
		agreement_version: version,
		agreement_method: opts.method,
		verification_status: player?.verification_status ?? 'pending_screenshot',
	});

	if (!opts.skipAudit) {
		await postAuditLog(env, config, {
			title: 'Agreement accepted',
			description:
				`<@${userId}> accepted the Discord agreement` +
				(config.agreement_version ? ` (v${config.agreement_version})` : '') +
				(opts.method === 'admin_backfill'
					? ` via admin backfill${opts.actorId ? ` by <@${opts.actorId}>` : ''}.`
					: ' via DM button.'),
			actorId: opts.method === 'admin_backfill' ? opts.actorId : userId,
			source: opts.method === 'admin_backfill' ? 'admin' : 'member',
			color: AuditColor.success,
			fields: [
				{ name: 'Method', value: opts.method, inline: true },
				{ name: 'Timing', value: config.agreement_timing, inline: true },
			],
		});
	}

	const refreshed = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
	let accessNote = '';
	// DM Agree: promote only for after_verify lounge hold. Admin backfill always restores roles.
	const shouldGrantAccess =
		opts.method === 'admin_backfill' || config.agreement_timing === 'after_verify';
	if (
		shouldGrantAccess &&
		refreshed &&
		(refreshed.verification_status === 'active' || refreshed.verification_status === 'guest') &&
		env.DISCORD_BOT_TOKEN
	) {
		try {
			const result = await grantFullAccessForVerifiedPlayer(
				env,
				config,
				guildId,
				userId,
				refreshed,
			);
			accessNote = result.message;
			if (refreshed.player_id && refreshed.player_name && opts.method === 'dm_button') {
				const stfcPlayer = await findPlayerByIdOrName(
					refreshed.player_id,
					config.stfc_server,
					config.stfc_region,
				);
				if (stfcPlayer) {
					await postVerificationLog(env, config, {
						guildId,
						discordUserId: userId,
						player: stfcPlayer,
						stfcProUrl: refreshed.stfc_pro_url ?? '',
						status: refreshed.verification_status === 'guest' ? 'guest' : 'active',
						notes: ['Agreement accepted (DM button)', ...(result.auditNotes ?? [])],
					});
				}
			}
		} catch (err) {
			console.error('Post-agreement access grant failed:', err);
			const locale = resolveLocale(refreshed?.preferred_locale);
			accessNote = t(locale, 'agree.result.access_failed');
			return {
				alreadyAccepted: false,
				accessNote,
				ok: false,
				error: err instanceof Error ? err.message : 'access grant failed',
			};
		}
	}

	return { alreadyAccepted: false, accessNote, ok: true };
}

/** Admin: mark agreement accepted + restore roles for one or many verified members. */
export async function runAgreementBackfill(
	env: Env,
	config: GuildConfig,
	guildId: string,
	opts: {
		actorId?: string;
		/** If set, only this Discord user; otherwise all missing agreement. */
		userId?: string;
		onProgress?: (done: number, total: number, ok: number, failed: number) => Promise<void>;
	},
): Promise<{ total: number; ok: number; failed: number; skipped: number; errors: string[] }> {
	let targets: VerifiedPlayer[];
	if (opts.userId) {
		const one = await getVerifiedPlayer(env.STFC_DB, guildId, opts.userId);
		if (!one?.player_id) {
			return {
				total: 0,
				ok: 0,
				failed: 0,
				skipped: 0,
				errors: [`<@${opts.userId}> has no verified STFC player link.`],
			};
		}
		targets = hasMatchingAgreementVersion(config, one) ? [] : [one];
		if (targets.length === 0) {
			return { total: 0, ok: 0, failed: 0, skipped: 1, errors: [] };
		}
	} else {
		targets = await listPlayersMissingAgreement(env.STFC_DB, guildId, config.agreement_version);
	}

	let ok = 0;
	let failed = 0;
	let skipped = 0;
	const errors: string[] = [];

	for (let i = 0; i < targets.length; i++) {
		const p = targets[i];
		if (opts.onProgress && (i === 0 || (i + 1) % 10 === 0 || i + 1 === targets.length)) {
			await opts.onProgress(i + 1, targets.length, ok, failed);
		}
		try {
			const result = await acceptAgreementAndGrantAccess(env, config, guildId, p.discord_user_id, {
				method: 'admin_backfill',
				actorId: opts.actorId,
				skipAudit: true,
			});
			if (result.alreadyAccepted) skipped++;
			else if (result.ok) ok++;
			else {
				failed++;
				if (errors.length < 8) {
					errors.push(`<@${p.discord_user_id}>: ${result.error ?? 'failed'}`);
				}
			}
		} catch (err) {
			failed++;
			console.error(`Agreement backfill failed for ${p.discord_user_id}:`, err);
			if (errors.length < 8) {
				const msg = err instanceof Error ? err.message : 'unknown error';
				errors.push(`<@${p.discord_user_id}>: ${msg.slice(0, 180)}`);
			}
		}
		await sleep(350);
	}

	return { total: targets.length, ok, failed, skipped, errors };
}

/** Send agreement prompt if still required (no-op if accepted / disabled). */
export async function promptAgreementIfNeeded(
	env: Env,
	guildId: string,
	userId: string,
): Promise<boolean> {
	const token = env.DISCORD_BOT_TOKEN;
	if (!token) return false;
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config?.agreement_enabled) return false;
	const player = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
	if (playerHasAcceptedAgreement(config, player)) return false;
	const locale = resolveLocale(player?.preferred_locale);
	try {
		await sendAgreementDm(token, userId, config, locale);
		return true;
	} catch (err) {
		console.error('Agreement DM failed:', err);
		try {
			await sendDirectMessage(token, userId, agreementDmContent(config, locale));
		} catch {
			/* ignore */
		}
		return false;
	}
}

export async function handleAgreeComponent(
	env: Env,
	interaction: {
		member?: { user?: { id: string } };
		user?: { id: string };
		data?: { custom_id?: string };
	},
): Promise<Response> {
	const customId = interaction.data?.custom_id ?? '';
	const parsed = parseAgreeCustomId(customId);
	if (!parsed) {
		return updateMessageResponse('❌ Unknown agreement button.');
	}

	const userId = interaction.member?.user?.id ?? interaction.user?.id;
	if (!userId) {
		return updateMessageResponse('❌ Could not resolve user.');
	}

	const { guildId } = parsed;
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return updateMessageResponse('❌ Server not configured.');
	}

	const player = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
	const locale = resolveLocale(player?.preferred_locale);

	if (!config.agreement_enabled) {
		return updateMessageResponse(t(locale, 'agree.result.not_required'), { components: [] });
	}

	if (playerHasAcceptedAgreement(config, player)) {
		return updateMessageResponse(t(locale, 'agree.result.already'), { components: [] });
	}

	const result = await acceptAgreementAndGrantAccess(env, config, guildId, userId, {
		method: 'dm_button',
	});

	return updateMessageResponse(
		`${t(locale, 'agree.result.accepted')}${result.accessNote ? `\n\n${result.accessNote}` : ''}`,
		{ components: [] },
	);
}
