import {
	sendDirectMessage,
	sendMessageWithComponents,
	updateMessageResponse,
	type DiscordActionRow,
} from './discord-api';
import { getGuildConfig, getVerifiedPlayer, upsertVerifiedPlayer } from './guild-db';
import { resolveLocale, t } from './i18n';
import { AuditColor, postAuditLog } from './audit-log';
import { postVerificationLog } from './verification-log';
import type { GuildConfig, VerifiedPlayer } from './types';
import { findPlayerByIdOrName } from './stfc-utils';
import { grantFullAccessForVerifiedPlayer } from './verification-access';

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

export function playerHasAcceptedAgreement(
	config: GuildConfig,
	player: Pick<VerifiedPlayer, 'agreement_accepted_at' | 'agreement_version'> | null | undefined,
): boolean {
	if (!config.agreement_enabled) return true;
	if (!player?.agreement_accepted_at) return false;
	const required = config.agreement_version?.trim();
	if (!required) return true;
	return (player.agreement_version?.trim() || '') === required;
}

export function needsAgreementBeforeVerify(
	config: GuildConfig,
	player: Pick<VerifiedPlayer, 'agreement_accepted_at' | 'agreement_version'> | null | undefined,
): boolean {
	return (
		config.agreement_enabled &&
		config.agreement_timing === 'before_verify' &&
		!playerHasAcceptedAgreement(config, player)
	);
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

	const now = new Date().toISOString();
	await upsertVerifiedPlayer(env.STFC_DB, {
		guild_id: guildId,
		discord_user_id: userId,
		agreement_accepted_at: now,
		agreement_version: config.agreement_version ?? now.slice(0, 10),
		agreement_method: 'dm_button',
		verification_status: player?.verification_status ?? 'pending_screenshot',
	});

	await postAuditLog(env, config, {
		title: 'Agreement accepted',
		description: `<@${userId}> accepted the Discord agreement` +
			(config.agreement_version ? ` (v${config.agreement_version})` : '') +
			' via DM button.',
		actorId: userId,
		source: 'member',
		color: AuditColor.success,
		fields: [
			{ name: 'Method', value: 'dm_button', inline: true },
			{
				name: 'Timing',
				value: config.agreement_timing,
				inline: true,
			},
		],
	});

	// after_verify: promote to full access if already verified as active
	const refreshed = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
	let accessNote = '';
	if (
		config.agreement_timing === 'after_verify' &&
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
			if (refreshed.player_id && refreshed.player_name) {
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
						notes: [
							'Agreement accepted (DM button)',
							...(result.auditNotes ?? []),
						],
					});
				}
			}
		} catch (err) {
			console.error('Post-agreement access grant failed:', err);
			accessNote = t(locale, 'agree.result.access_failed');
		}
	}

	const beforeHint =
		config.agreement_timing === 'before_verify'
			? `\n\n${t(locale, 'agree.result.continue_verify')}`
			: '';

	return updateMessageResponse(
		`${t(locale, 'agree.result.accepted')}${accessNote ? `\n\n${accessNote}` : ''}${beforeHint}`,
		{ components: [] },
	);
}
