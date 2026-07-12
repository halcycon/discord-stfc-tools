/**
 * Hybrid welcome DM: fetch a configured Discord message body, append personal channel.
 */
import {
	getChannelMessage,
	openUserDmChannel,
	sendMessageWithComponents,
	type DiscordEmbed,
} from './discord-api';
import { getVerifiedPlayer, upsertVerifiedPlayer } from './guild-db';
import { resolveLocale, t } from './i18n';
import { shouldSkipOutboundDm } from './deploy-mode';
import type { GuildConfig } from './types';

const DISCORD_MESSAGE_LIMIT = 2000;

export type ParsedDiscordMessageLink = {
	guildId: string;
	channelId: string;
	messageId: string;
};

/** Parse https://discord.com/channels/{guild}/{channel}/{message} (also discordapp.com / ptb / canary). */
export function parseDiscordMessageLink(input: string): ParsedDiscordMessageLink | null {
	const trimmed = input.trim();
	const match = trimmed.match(
		/^https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{15,20})\/(\d{15,20})\/(\d{15,20})\/?$/i,
	);
	if (!match) return null;
	return { guildId: match[1], channelId: match[2], messageId: match[3] };
}

export function buildWelcomeDmContent(opts: {
	content: string;
	personalChannelId: string | null | undefined;
	locale: string;
}): string {
	let body = (opts.content ?? '').trim();
	const channelId = opts.personalChannelId?.trim() || null;

	if (channelId) {
		body = body.replaceAll('{personal_channel}', `<#${channelId}>`);
		const append = t(opts.locale, 'welcome.dm.personal_channel', { channelId });
		body = body ? `${body}\n\n${append}` : append;
	} else {
		body = body.replaceAll('{personal_channel}', '').replace(/[ \t]{2,}/g, ' ').trim();
	}

	if (body.length > DISCORD_MESSAGE_LIMIT) {
		body = body.slice(0, DISCORD_MESSAGE_LIMIT - 1) + '…';
	}
	return body;
}

export function welcomeDmConfigured(config: Pick<
	GuildConfig,
	'welcome_dm_enabled' | 'welcome_dm_channel_id' | 'welcome_dm_message_id'
>): boolean {
	return Boolean(
		config.welcome_dm_enabled &&
			config.welcome_dm_channel_id &&
			/^\d{15,20}$/.test(config.welcome_dm_channel_id) &&
			config.welcome_dm_message_id &&
			/^\d{15,20}$/.test(config.welcome_dm_message_id),
	);
}

/** Preview body for admins (does not send or stamp sent_at). */
export async function previewWelcomeDm(
	token: string,
	config: GuildConfig,
	locale: string,
	samplePersonalChannelId?: string | null,
): Promise<{ ok: true; content: string; embeds?: DiscordEmbed[] } | { ok: false; error: string }> {
	if (!welcomeDmConfigured(config)) {
		return { ok: false, error: 'Welcome DM is not fully configured (enabled + channel + message).' };
	}
	try {
		const msg = await getChannelMessage(
			token,
			config.welcome_dm_channel_id!,
			config.welcome_dm_message_id!,
		);
		const content = buildWelcomeDmContent({
			content: msg.content ?? '',
			personalChannelId: samplePersonalChannelId ?? null,
			locale,
		});
		if (!content && !(msg.embeds && msg.embeds.length > 0)) {
			return { ok: false, error: 'Source message has no content (and no embeds).' };
		}
		return { ok: true, content, embeds: msg.embeds };
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		return { ok: false, error: t(locale, 'welcome.dm.fetch_failed', { detail }) };
	}
}

/**
 * Send once after full member access (agreement satisfied or disabled).
 * Soft-fails; stamps welcome_dm_sent_at only on success.
 */
export async function sendWelcomeDmIfNeeded(
	env: Env,
	config: GuildConfig,
	guildId: string,
	discordUserId: string,
	personalChannelId: string | null | undefined,
): Promise<{ sent: boolean; note?: string }> {
	if (!welcomeDmConfigured(config)) {
		return { sent: false };
	}
	if (shouldSkipOutboundDm(config)) {
		return { sent: false, note: 'welcome DM skipped (deploy_mode=testing)' };
	}
	const token = env.DISCORD_BOT_TOKEN;
	if (!token) {
		return { sent: false, note: 'welcome DM skipped (no bot token)' };
	}

	const player = await getVerifiedPlayer(env.STFC_DB, guildId, discordUserId);
	if (player?.welcome_dm_sent_at) {
		return { sent: false };
	}

	const locale = resolveLocale(player?.preferred_locale);
	const channelId = personalChannelId ?? player?.personal_channel_id ?? null;

	try {
		const msg = await getChannelMessage(
			token,
			config.welcome_dm_channel_id!,
			config.welcome_dm_message_id!,
		);
		const content = buildWelcomeDmContent({
			content: msg.content ?? '',
			personalChannelId: channelId,
			locale,
		});
		const embeds = msg.embeds?.length ? msg.embeds.slice(0, 10) : undefined;
		if (!content && !embeds?.length) {
			return { sent: false, note: 'welcome DM skipped (empty source message)' };
		}

		const dmChannelId = await openUserDmChannel(token, discordUserId);
		await sendMessageWithComponents(token, dmChannelId, {
			content: content || undefined,
			embeds,
		});

		const now = new Date().toISOString();
		await upsertVerifiedPlayer(env.STFC_DB, {
			guild_id: guildId,
			discord_user_id: discordUserId,
			welcome_dm_sent_at: now,
		});
		return { sent: true, note: 'welcome DM sent' };
	} catch (err) {
		console.error('Welcome DM failed:', err);
		return { sent: false, note: 'welcome DM failed' };
	}
}
