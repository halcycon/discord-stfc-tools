/**
 * GDPR-style consent to process Discord ↔ STFC player data (before verification).
 * Separate from optional CoC in agreement.ts (after verify).
 */
import {
	openUserDmChannel,
	sendDirectMessage,
	sendMessageWithComponents,
	updateMessageResponse,
	type DiscordActionRow,
} from './discord-api';
import { getGuildConfig, getVerifiedPlayer, upsertVerifiedPlayer } from './guild-db';
import { resolveLocale, t } from './i18n';
import { AuditColor, postAuditLog } from './audit-log';
import { shouldSkipOutboundDm, TESTING_OUTBOUND_DM_SKIP } from './deploy-mode';
import type { GuildConfig, VerifiedPlayer } from './types';

export const CONSENT_YES_PREFIX = 'consent:yes:';
export const CONSENT_NO_PREFIX = 'consent:no:';

export type DataConsentPlayer = Pick<
	VerifiedPlayer,
	'data_consent_at' | 'data_consent_version' | 'data_consent_choice'
>;

export function consentYesCustomId(guildId: string): string {
	return `${CONSENT_YES_PREFIX}${guildId}`;
}

export function consentNoCustomId(guildId: string): string {
	return `${CONSENT_NO_PREFIX}${guildId}`;
}

export function parseConsentCustomId(
	customId: string,
): { guildId: string; choice: 'accepted' | 'declined' } | null {
	if (customId.startsWith(CONSENT_YES_PREFIX)) {
		const guildId = customId.slice(CONSENT_YES_PREFIX.length);
		return /^\d{15,20}$/.test(guildId) ? { guildId, choice: 'accepted' } : null;
	}
	if (customId.startsWith(CONSENT_NO_PREFIX)) {
		const guildId = customId.slice(CONSENT_NO_PREFIX.length);
		return /^\d{15,20}$/.test(guildId) ? { guildId, choice: 'declined' } : null;
	}
	return null;
}

export function requiredDataConsentVersion(config: GuildConfig): string {
	return (config.data_consent_version ?? '1').trim() || '1';
}

export function playerHasDataConsent(
	config: GuildConfig,
	player: DataConsentPlayer | null | undefined,
): boolean {
	if (!config.data_consent_enabled) return true;
	if (player?.data_consent_choice !== 'accepted' || !player.data_consent_at) return false;
	return (player.data_consent_version?.trim() || '') === requiredDataConsentVersion(config);
}

/** Block screenshot / stfc.pro verify until consent is accepted. */
export function needsDataConsent(
	config: GuildConfig,
	player: DataConsentPlayer | null | undefined,
): boolean {
	return config.data_consent_enabled && !playerHasDataConsent(config, player);
}

export function dataConsentDmContent(config: GuildConfig, locale: string): string {
	const version = requiredDataConsentVersion(config);
	return [
		t(locale, 'consent.dm.body'),
		t(locale, 'consent.dm.details'),
		t(locale, 'consent.dm.version', { version }),
	].join('\n\n');
}

export function buildDataConsentComponents(guildId: string, locale: string): DiscordActionRow[] {
	return [
		{
			type: 1,
			components: [
				{
					type: 2,
					style: 3,
					label: t(locale, 'consent.btn.yes').slice(0, 80),
					custom_id: consentYesCustomId(guildId),
				},
				{
					type: 2,
					style: 4,
					label: t(locale, 'consent.btn.no').slice(0, 80),
					custom_id: consentNoCustomId(guildId),
				},
			],
		},
	];
}

export async function sendDataConsentDm(
	token: string,
	userId: string,
	config: GuildConfig,
	locale: string,
): Promise<void> {
	if (shouldSkipOutboundDm(config)) {
		throw new Error(TESTING_OUTBOUND_DM_SKIP);
	}
	const channelId = await openUserDmChannel(token, userId);
	await sendMessageWithComponents(token, channelId, {
		content: dataConsentDmContent(config, locale),
		components: buildDataConsentComponents(config.guild_id, locale),
	});
}

export async function promptDataConsentIfNeeded(
	env: Env,
	guildId: string,
	userId: string,
): Promise<boolean> {
	const token = env.DISCORD_BOT_TOKEN;
	if (!token) return false;
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config?.data_consent_enabled) return false;
	if (shouldSkipOutboundDm(config)) return false;
	const player = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
	if (playerHasDataConsent(config, player)) return false;
	const locale = resolveLocale(player?.preferred_locale);
	try {
		await sendDataConsentDm(token, userId, config, locale);
		return true;
	} catch (err) {
		console.error('Data consent DM failed:', err);
		try {
			await sendDirectMessage(token, userId, dataConsentDmContent(config, locale));
		} catch {
			/* ignore */
		}
		return false;
	}
}

export async function handleDataConsentComponent(
	env: Env,
	interaction: {
		member?: { user?: { id: string } };
		user?: { id: string };
		data?: { custom_id?: string };
	},
): Promise<Response> {
	const parsed = parseConsentCustomId(interaction.data?.custom_id ?? '');
	if (!parsed) {
		return updateMessageResponse('❌ Unknown consent button.');
	}

	const userId = interaction.member?.user?.id ?? interaction.user?.id;
	if (!userId) {
		return updateMessageResponse('❌ Could not resolve user.');
	}

	const { guildId, choice } = parsed;
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return updateMessageResponse('❌ Server not configured.');
	}

	const player = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
	const locale = resolveLocale(player?.preferred_locale);

	if (!config.data_consent_enabled) {
		return updateMessageResponse(t(locale, 'consent.result.not_required'), { components: [] });
	}

	if (choice === 'accepted' && playerHasDataConsent(config, player)) {
		return updateMessageResponse(t(locale, 'consent.result.already'), { components: [] });
	}

	const now = new Date().toISOString();
	const version = requiredDataConsentVersion(config);
	await upsertVerifiedPlayer(env.STFC_DB, {
		guild_id: guildId,
		discord_user_id: userId,
		data_consent_at: now,
		data_consent_version: version,
		data_consent_choice: choice,
		data_consent_method: 'dm_button',
		verification_status: player?.verification_status ?? 'pending_screenshot',
	});

	await postAuditLog(env, config, {
		title: choice === 'accepted' ? 'Data consent accepted' : 'Data consent declined',
		description:
			`<@${userId}> ${choice === 'accepted' ? 'accepted' : 'declined'} data-processing consent` +
			` (v${version}) via DM button.`,
		actorId: userId,
		source: 'member',
		color: choice === 'accepted' ? AuditColor.success : AuditColor.warn,
		fields: [
			{ name: 'Choice', value: choice, inline: true },
			{ name: 'Version', value: version, inline: true },
		],
	});

	if (choice === 'declined') {
		return updateMessageResponse(t(locale, 'consent.result.declined'), { components: [] });
	}

	if (env.DISCORD_BOT_TOKEN) {
		const configForDm = await getGuildConfig(env.STFC_DB, guildId);
		if (!shouldSkipOutboundDm(configForDm)) {
			try {
				await sendDirectMessage(env.DISCORD_BOT_TOKEN, userId, t(locale, 'verify.invite.welcome'));
			} catch (err) {
				console.error('Post-consent verify invite DM failed:', err);
			}
		}
	}

	return updateMessageResponse(
		`${t(locale, 'consent.result.accepted')}\n\n${t(locale, 'consent.result.continue_verify')}`,
		{ components: [] },
	);
}
