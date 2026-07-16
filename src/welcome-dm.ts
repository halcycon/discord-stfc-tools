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
import {
	gateWelcomeDmAttempt,
	WELCOME_DM_MAX_AUTO_ATTEMPTS,
} from './welcome-dm-gate';
import type { GuildConfig } from './types';

export { WELCOME_DM_MAX_AUTO_ATTEMPTS, gateWelcomeDmAttempt } from './welcome-dm-gate';

const DISCORD_MESSAGE_LIMIT = 2000;

function formatWelcomeFailure(err: unknown): string {
	if (err && typeof err === 'object' && 'status' in err && 'message' in err) {
		const e = err as { status?: number; message?: string; body?: string };
		const body =
			typeof e.body === 'string' && e.body.trim()
				? ` ${e.body.trim().slice(0, 120)}`
				: '';
		return `${e.message ?? 'error'}${e.status != null ? ` (HTTP ${e.status})` : ''}${body}`;
	}
	return err instanceof Error ? err.message : String(err);
}

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

export type SendWelcomeDmOpts = {
	/** Admin / manual: do not send. */
	skip?: boolean;
	/** Bypass attempt cap (failed sends only; already-sent still skipped). */
	force?: boolean;
};

/**
 * Send once after full member access (agreement satisfied or disabled).
 * Soft-fails; stamps welcome_dm_sent_at only on success.
 * Auto-retries at most once (2 attempts total) unless `force` is set.
 */
export async function sendWelcomeDmIfNeeded(
	env: Env,
	config: GuildConfig,
	guildId: string,
	discordUserId: string,
	personalChannelId: string | null | undefined,
	opts?: SendWelcomeDmOpts,
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
	const gate = gateWelcomeDmAttempt({
		sentAt: player?.welcome_dm_sent_at,
		attempts: player?.welcome_dm_attempts ?? 0,
		force: opts?.force,
		skip: opts?.skip,
	});
	if (!gate.allow) {
		if (gate.reason === 'skip') {
			return { sent: false, note: 'welcome DM skipped (admin)' };
		}
		// already_sent / max_attempts: silent (avoid daily audit spam)
		return { sent: false };
	}

	const locale = resolveLocale(player?.preferred_locale);
	const channelId = personalChannelId ?? player?.personal_channel_id ?? null;
	const nextAttempts = (player?.welcome_dm_attempts ?? 0) + 1;

	// Count the attempt before the network call so crashes still consume a slot.
	await upsertVerifiedPlayer(env.STFC_DB, {
		guild_id: guildId,
		discord_user_id: discordUserId,
		welcome_dm_attempts: nextAttempts,
	});

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
			return {
				sent: false,
				note: `welcome DM skipped (empty source message; attempt ${nextAttempts}/${WELCOME_DM_MAX_AUTO_ATTEMPTS})`,
			};
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
		const detail = formatWelcomeFailure(err);
		const exhausted = nextAttempts >= WELCOME_DM_MAX_AUTO_ATTEMPTS;
		return {
			sent: false,
			note:
				`Failed to send Welcome DM (attempt ${nextAttempts}/${WELCOME_DM_MAX_AUTO_ATTEMPTS})` +
				(exhausted ? '; no further auto-retries — use `/server welcome send_user:… force:true`' : '') +
				` — ${detail}`,
		};
	}
}

/** Per member-poll batch size so large go-live backlogs drain without timing out. */
export const WELCOME_FLUSH_PER_POLL = 40;

/**
 * Send pending welcome DMs for full members (go-live backlog + failed retries).
 * Caps per call; remaining drain on later member polls. Morning sync still retries as a safety net.
 */
export async function flushPendingWelcomeDms(
	env: Env,
	config: GuildConfig,
	opts?: { limit?: number },
): Promise<{ sent: number; failed: number; remaining: number }> {
	if (!welcomeDmConfigured(config) || shouldSkipOutboundDm(config)) {
		return { sent: 0, failed: 0, remaining: 0 };
	}

	const { listPlayersNeedingWelcomeDm } = await import('./guild-db');
	const { needsAgreementBeforeFullAccess } = await import('./agreement');

	const candidates = await listPlayersNeedingWelcomeDm(
		env.STFC_DB,
		config.guild_id,
		WELCOME_DM_MAX_AUTO_ATTEMPTS,
	);
	const eligible = candidates.filter((p) => !needsAgreementBeforeFullAccess(config, p));
	const limit = Math.max(1, Math.floor(opts?.limit ?? WELCOME_FLUSH_PER_POLL));
	const batch = eligible.slice(0, limit);
	let sent = 0;
	let failed = 0;

	for (const player of batch) {
		const result = await sendWelcomeDmIfNeeded(
			env,
			config,
			config.guild_id,
			player.discord_user_id,
			player.personal_channel_id,
		);
		if (result.sent) sent++;
		else if (result.note && /failed/i.test(result.note)) failed++;
	}

	return {
		sent,
		failed,
		remaining: Math.max(0, eligible.length - batch.length),
	};
}
