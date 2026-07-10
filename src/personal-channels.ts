import {
	createGuildTextChannel,
	getGuildChannel,
	patchGuildChannel,
	setChannelPermission,
} from './discord-api';
import { categoryForPlayerName, personalChannelsEnabled, slugPersonalChannelName } from './channel-utils';
import type { GuildConfig } from './types';

const VIEW_CHANNEL = '1024';
const SEND_MESSAGES = '2048';
const READ_HISTORY = '65536';
const MEMBER_PERMS = VIEW_CHANNEL | SEND_MESSAGES | READ_HISTORY;

export type PersonalChannelResult =
	| { ok: true; channelId: string; created: boolean; moved: boolean; renamed: boolean }
	| { ok: false; error: string };

async function applyPersonalChannelPermissions(
	token: string,
	guildId: string,
	channelId: string,
	userId: string,
	config: GuildConfig,
): Promise<void> {
	// Deny @everyone — guild snowflake doubles as the @everyone role ID.
	await setChannelPermission(token, channelId, guildId, '0', VIEW_CHANNEL, 0);
	await setChannelPermission(token, channelId, userId, MEMBER_PERMS, '0', 1);
	for (const roleId of config.personal_channel_extra_roles) {
		if (!/^\d{15,20}$/.test(roleId)) continue;
		await setChannelPermission(token, channelId, roleId, MEMBER_PERMS, '0', 0);
	}
}

/**
 * Create or update a verified member's personal channel.
 * Skips creation when personal channels are not configured.
 */
export async function ensurePersonalChannel(
	token: string,
	config: GuildConfig,
	guildId: string,
	userId: string,
	playerName: string,
	existingChannelId?: string | null,
): Promise<PersonalChannelResult> {
	if (config.mode !== 'single_alliance' || !personalChannelsEnabled(config)) {
		return { ok: false, error: 'Personal channels are not configured for this server.' };
	}

	const targetCategoryId = categoryForPlayerName(config, playerName);
	const channelName = slugPersonalChannelName(playerName, userId);

	try {
		if (existingChannelId) {
			const existing = await getGuildChannel(token, existingChannelId);
			if (existing && existing.type === 0) {
				let moved = false;
				let renamed = false;

				if (targetCategoryId && existing.parent_id !== targetCategoryId) {
					await patchGuildChannel(token, existingChannelId, { parent_id: targetCategoryId });
					moved = true;
				}
				if (existing.name !== channelName) {
					await patchGuildChannel(token, existingChannelId, { name: channelName });
					renamed = true;
				}

				await applyPersonalChannelPermissions(token, guildId, existingChannelId, userId, config);
				return { ok: true, channelId: existingChannelId, created: false, moved, renamed };
			}
		}

		const channel = await createGuildTextChannel(token, guildId, channelName, targetCategoryId);
		await applyPersonalChannelPermissions(token, guildId, channel.id, userId, config);
		return { ok: true, channelId: channel.id, created: true, moved: false, renamed: false };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'unknown error';
		return { ok: false, error: message };
	}
}

/** Link an existing guild text channel to a member and apply permissions. */
export async function linkExistingPersonalChannel(
	token: string,
	config: GuildConfig,
	guildId: string,
	userId: string,
	channelId: string,
): Promise<PersonalChannelResult> {
	const channel = await getGuildChannel(token, channelId);
	if (!channel || channel.type !== 0) {
		return { ok: false, error: 'Channel not found or is not a text channel.' };
	}

	try {
		await applyPersonalChannelPermissions(token, guildId, channelId, userId, config);
		return { ok: true, channelId, created: false, moved: false, renamed: false };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'unknown error';
		return { ok: false, error: message };
	}
}
