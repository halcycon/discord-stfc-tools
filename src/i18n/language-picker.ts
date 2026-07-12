import {
	sendDirectMessage,
	sendMessageWithComponents,
	updateMessageResponse,
	interactionResponseWithComponents,
	type DiscordActionRow,
} from '../discord-api';
import { getGuildConfig, getVerifiedPlayer, upsertVerifiedPlayer } from '../guild-db';
import { shouldSkipOutboundDm } from '../deploy-mode';
import {
	DEFAULT_LOCALE,
	LOCALE_NATIVE_LABELS,
	SUPPORTED_LOCALES,
	isLocaleCode,
	t,
	type LocaleCode,
} from './index';

export const LOCALE_CUSTOM_ID_PREFIX = 'locale:';

/** `locale:{guildId}:{code}` */
export function localeCustomId(guildId: string, code: LocaleCode): string {
	return `${LOCALE_CUSTOM_ID_PREFIX}${guildId}:${code}`;
}

export function parseLocaleCustomId(
	customId: string,
): { guildId: string; locale: LocaleCode } | null {
	if (!customId.startsWith(LOCALE_CUSTOM_ID_PREFIX)) return null;
	const rest = customId.slice(LOCALE_CUSTOM_ID_PREFIX.length);
	const colon = rest.lastIndexOf(':');
	if (colon <= 0) return null;
	const guildId = rest.slice(0, colon);
	const code = rest.slice(colon + 1);
	if (!/^\d{15,20}$/.test(guildId) || !isLocaleCode(code)) return null;
	return { guildId, locale: code };
}

export function buildLanguagePickerComponents(guildId: string): DiscordActionRow[] {
	const buttons = SUPPORTED_LOCALES.map((code) => ({
		type: 2 as const,
		style: 2,
		label: LOCALE_NATIVE_LABELS[code].slice(0, 80),
		custom_id: localeCustomId(guildId, code),
	}));
	const rows: DiscordActionRow[] = [];
	for (let i = 0; i < buttons.length; i += 5) {
		rows.push({ type: 1, components: buttons.slice(i, i + 5) });
	}
	return rows;
}

export function languagePickerPrompt(): string {
	return t(DEFAULT_LOCALE, 'locale.picker.prompt');
}

/** Open DM and send language picker (first contact). */
export async function sendLanguagePickerDm(
	token: string,
	userId: string,
	guildId: string,
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
	await sendMessageWithComponents(token, channel.id, {
		content: languagePickerPrompt(),
		components: buildLanguagePickerComponents(guildId),
	});
}

/** Ephemeral slash response with language buttons (e.g. `/language`). */
export function languagePickerInteractionResponse(guildId: string): Response {
	return interactionResponseWithComponents(languagePickerPrompt(), {
		ephemeral: true,
		components: buildLanguagePickerComponents(guildId),
	});
}

export async function handleLocaleComponent(
	env: Env,
	interaction: {
		guild_id?: string;
		channel_id?: string;
		member?: { user?: { id: string } };
		user?: { id: string };
		message?: { id?: string };
		data?: { custom_id?: string };
	},
): Promise<Response> {
	const customId = interaction.data?.custom_id ?? '';
	const parsed = parseLocaleCustomId(customId);
	if (!parsed) {
		return updateMessageResponse('❌ Unknown language button.');
	}

	const userId = interaction.member?.user?.id ?? interaction.user?.id;
	if (!userId) {
		return updateMessageResponse('❌ Could not resolve user.');
	}

	const { guildId, locale } = parsed;
	const label = LOCALE_NATIVE_LABELS[locale];

	const existing = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
	await upsertVerifiedPlayer(env.STFC_DB, {
		guild_id: guildId,
		discord_user_id: userId,
		preferred_locale: locale,
		verification_status: existing?.verification_status ?? 'pending_screenshot',
	});

	const confirm = t(locale, 'locale.picker.confirm', { label });
	const welcome = t(locale, 'verify.invite.welcome');

	const { getGuildConfig } = await import('../guild-db');
	const { needsDataConsent, dataConsentDmContent, buildDataConsentComponents } =
		await import('../data-consent');
	const config = await getGuildConfig(env.STFC_DB, guildId);
	const refreshed = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
	if (config && needsDataConsent(config, refreshed)) {
		return updateMessageResponse(`${confirm}\n\n${dataConsentDmContent(config, locale)}`, {
			components: buildDataConsentComponents(guildId, locale),
		});
	}

	const { needsAgreementBeforeVerify, agreementDmContent, buildAgreementComponents } =
		await import('../agreement');
	if (config && needsAgreementBeforeVerify(config, refreshed)) {
		return updateMessageResponse(`${confirm}\n\n${agreementDmContent(config, locale)}`, {
			components: buildAgreementComponents(guildId, locale),
		});
	}

	return updateMessageResponse(`${confirm}\n\n${welcome}`, { components: [] });
}

/** After verify success without a locale, nudge via DM. */
export async function ensureLocaleAfterVerify(
	env: Env,
	guildId: string,
	userId: string,
): Promise<void> {
	const token = env.DISCORD_BOT_TOKEN;
	if (!token) return;
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (shouldSkipOutboundDm(config)) return;
	const player = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
	if (player?.preferred_locale) return;
	try {
		await sendLanguagePickerDm(token, userId, guildId);
	} catch (err) {
		console.error('Language picker after verify failed:', err);
		try {
			await sendDirectMessage(token, userId, languagePickerPrompt());
		} catch {
			/* ignore */
		}
	}
}
