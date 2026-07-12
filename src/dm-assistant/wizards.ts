import { getGuildConfig, upsertGuildConfig, clearDmSession, upsertDmSession } from '../guild-db';
import { createVerificationLogChannel } from '../verification-log';
import { AuditColor, createAuditLogChannel, postAuditLog } from '../audit-log';
import { formatServerStatus } from '../format-server-status';
import { sendChannelMessage, sendMessageWithComponents } from '../discord-api';
import type { GuildMode, StfcRegion } from '../types';
import { badgey } from './persona';
import {
	adminMenuMessage,
	buildAdminMenuComponents,
	buildCancelRow,
	buildChannelLogMenuComponents,
	buildSetupConfirmComponents,
	buildSetupModeComponents,
	buildSetupRegionComponents,
} from './menu';

export async function sendAdminMenu(
	env: Env,
	token: string,
	channelId: string,
	userId: string,
	guildId: string,
	locale: string,
): Promise<void> {
	await upsertDmSession(env.STFC_DB, {
		discord_user_id: userId,
		guild_id: guildId,
		flow: 'admin_menu',
		step: 'menu',
		payload: {},
	});
	await sendMessageWithComponents(token, channelId, {
		content: adminMenuMessage(locale),
		components: buildAdminMenuComponents(locale),
	});
}

export async function runServerStatusWizard(
	env: Env,
	token: string,
	channelId: string,
	guildId: string,
	locale: string,
): Promise<void> {
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		await sendChannelMessage(token, channelId, badgey(locale, 'dm.wizard.not_configured'));
		return;
	}
	await sendChannelMessage(
		token,
		channelId,
		`${badgey(locale, 'dm.wizard.status_intro')}\n\n${formatServerStatus(config)}`,
	);
}

export async function startSetupWizard(
	env: Env,
	token: string,
	channelId: string,
	userId: string,
	guildId: string,
	locale: string,
): Promise<void> {
	await upsertDmSession(env.STFC_DB, {
		discord_user_id: userId,
		guild_id: guildId,
		flow: 'server_setup',
		step: 'mode',
		payload: {},
	});
	await sendMessageWithComponents(token, channelId, {
		content: badgey(locale, 'dm.wizard.setup.ask_mode'),
		components: buildSetupModeComponents(locale),
	});
}

export async function continueSetupWizardText(
	env: Env,
	token: string,
	channelId: string,
	userId: string,
	locale: string,
	session: { guild_id: string | null; step: string; payload: Record<string, unknown> },
	content: string,
): Promise<boolean> {
	const guildId = session.guild_id;
	if (!guildId) return false;

	const payload = { ...session.payload };
	const text = content.trim();

	if (session.step === 'server') {
		const server = Number(text);
		if (!Number.isFinite(server) || server <= 0) {
			await sendMessageWithComponents(token, channelId, {
				content: badgey(locale, 'dm.wizard.setup.ask_server'),
				components: buildCancelRow(locale),
			});
			return true;
		}
		payload.stfc_server = server;
		await upsertDmSession(env.STFC_DB, {
			discord_user_id: userId,
			guild_id: guildId,
			flow: 'server_setup',
			step: 'region',
			payload,
		});
		await sendMessageWithComponents(token, channelId, {
			content: badgey(locale, 'dm.wizard.setup.ask_region'),
			components: buildSetupRegionComponents(locale),
		});
		return true;
	}

	if (session.step === 'alliance_tag') {
		payload.alliance_tag = text.slice(0, 16);
		await upsertDmSession(env.STFC_DB, {
			discord_user_id: userId,
			guild_id: guildId,
			flow: 'server_setup',
			step: 'nickname',
			payload,
		});
		await sendMessageWithComponents(token, channelId, {
			content: badgey(locale, 'dm.wizard.setup.ask_nick'),
			components: buildCancelRow(locale),
		});
		return true;
	}

	if (session.step === 'nickname') {
		const nick = text.toLowerCase() === 'skip' || text === '-' ? null : text.slice(0, 100);
		payload.nickname_template = nick;
		await upsertDmSession(env.STFC_DB, {
			discord_user_id: userId,
			guild_id: guildId,
			flow: 'server_setup',
			step: 'confirm',
			payload,
		});
		await sendMessageWithComponents(token, channelId, {
			content: formatSetupConfirm(locale, payload),
			components: buildSetupConfirmComponents(locale),
		});
		return true;
	}

	if (session.step === 'link_channel') {
		const channelMatch = text.match(/(\d{15,20})/);
		if (!channelMatch) {
			await sendMessageWithComponents(token, channelId, {
				content: badgey(locale, 'dm.wizard.channel.ask_id'),
				components: buildCancelRow(locale),
			});
			return true;
		}
		const channelIdToLink = channelMatch[1];
		const kind = String(payload.channel_kind || 'log') as 'log' | 'audit';
		if (kind === 'log') {
			await upsertGuildConfig(env.STFC_DB, {
				guild_id: guildId,
				verification_log_channel_id: channelIdToLink,
			});
		} else {
			await upsertGuildConfig(env.STFC_DB, {
				guild_id: guildId,
				audit_log_channel_id: channelIdToLink,
			});
			const config = await getGuildConfig(env.STFC_DB, guildId);
			await postAuditLog(env, config, {
				title: 'Audit log channel set',
				description: `Linked <#${channelIdToLink}> via DM wizard.`,
				actorId: userId,
				source: 'admin',
				color: AuditColor.success,
			});
		}
		await clearDmSession(env.STFC_DB, userId);
		await sendChannelMessage(token, channelId, badgey(locale, 'dm.badgey.wizard_done'));
		return true;
	}

	return false;
}

function formatSetupConfirm(locale: string, payload: Record<string, unknown>): string {
	return badgey(locale, 'dm.wizard.setup.confirm', {
		mode: String(payload.mode ?? ''),
		server: String(payload.stfc_server ?? ''),
		region: String(payload.stfc_region ?? ''),
		tag: String(payload.alliance_tag ?? '—'),
		nick: payload.nickname_template ? String(payload.nickname_template) : '(default)',
	});
}

export async function handleSetupButton(
	env: Env,
	token: string,
	channelId: string,
	userId: string,
	locale: string,
	guildId: string,
	action: string,
	value: string | undefined,
	payload: Record<string, unknown>,
): Promise<void> {
	const next = { ...payload };

	if (action === 'mode' && (value === 'single_alliance' || value === 'multi_alliance')) {
		next.mode = value;
		await upsertDmSession(env.STFC_DB, {
			discord_user_id: userId,
			guild_id: guildId,
			flow: 'server_setup',
			step: 'server',
			payload: next,
		});
		await sendMessageWithComponents(token, channelId, {
			content: badgey(locale, 'dm.wizard.setup.ask_server'),
			components: buildCancelRow(locale),
		});
		return;
	}

	if (action === 'region' && (value === 'US' || value === 'EU')) {
		next.stfc_region = value;
		const mode = String(next.mode || 'single_alliance');
		if (mode === 'single_alliance') {
			await upsertDmSession(env.STFC_DB, {
				discord_user_id: userId,
				guild_id: guildId,
				flow: 'server_setup',
				step: 'alliance_tag',
				payload: next,
			});
			await sendMessageWithComponents(token, channelId, {
				content: badgey(locale, 'dm.wizard.setup.ask_tag'),
				components: buildCancelRow(locale),
			});
		} else {
			next.alliance_tag = null;
			await upsertDmSession(env.STFC_DB, {
				discord_user_id: userId,
				guild_id: guildId,
				flow: 'server_setup',
				step: 'nickname',
				payload: next,
			});
			await sendMessageWithComponents(token, channelId, {
				content: badgey(locale, 'dm.wizard.setup.ask_nick'),
				components: buildCancelRow(locale),
			});
		}
		return;
	}

	if (action === 'confirm') {
		const mode = (String(next.mode || 'single_alliance') as GuildMode) || 'single_alliance';
		const stfc_server = Number(next.stfc_server);
		const stfc_region = (String(next.stfc_region || 'US') as StfcRegion) || 'US';
		if (!Number.isFinite(stfc_server) || stfc_server <= 0) {
			await sendChannelMessage(token, channelId, badgey(locale, 'dm.wizard.setup.ask_server'));
			return;
		}
		if (mode === 'single_alliance' && !next.alliance_tag) {
			await sendChannelMessage(token, channelId, badgey(locale, 'dm.wizard.setup.ask_tag'));
			return;
		}

		await upsertGuildConfig(env.STFC_DB, {
			guild_id: guildId,
			mode,
			stfc_server,
			stfc_region,
			alliance_tag: mode === 'single_alliance' ? String(next.alliance_tag) : null,
			nickname_template:
				next.nickname_template != null ? String(next.nickname_template) : null,
			verification_enabled: true,
		});

		if (mode === 'multi_alliance') {
			const { clearGuildAllianceRosterCache } = await import('../alliance-roster-sync');
			await clearGuildAllianceRosterCache(env, guildId);
		}

		const config = await getGuildConfig(env.STFC_DB, guildId);
		await postAuditLog(env, config, {
			title: 'Server setup (DM wizard)',
			description: `Mode **${mode}**, STFC **${stfc_server}** (${stfc_region}).`,
			actorId: userId,
			source: 'admin',
			color: AuditColor.success,
		});

		await clearDmSession(env.STFC_DB, userId);
		await sendChannelMessage(
			token,
			channelId,
			`${badgey(locale, 'dm.badgey.wizard_done')}\n\n${config ? formatServerStatus(config) : ''}`,
		);
	}
}

export async function startChannelLogWizard(
	env: Env,
	token: string,
	channelId: string,
	userId: string,
	guildId: string,
	locale: string,
	kind: 'log' | 'audit',
): Promise<void> {
	const config = await getGuildConfig(env.STFC_DB, guildId);
	const current =
		kind === 'log'
			? config?.verification_log_channel_id
			: config?.audit_log_channel_id;
	await upsertDmSession(env.STFC_DB, {
		discord_user_id: userId,
		guild_id: guildId,
		flow: kind === 'log' ? 'channels_log' : 'channels_audit',
		step: 'menu',
		payload: { channel_kind: kind },
	});
	await sendMessageWithComponents(token, channelId, {
		content: badgey(locale, kind === 'log' ? 'dm.wizard.channel.log_intro' : 'dm.wizard.channel.audit_intro', {
			current: current ? `<#${current}>` : '—',
		}),
		components: buildChannelLogMenuComponents(locale, kind),
	});
}

export async function handleChannelLogButton(
	env: Env,
	token: string,
	channelId: string,
	userId: string,
	locale: string,
	guildId: string,
	kind: 'log' | 'audit',
	action: string,
): Promise<void> {
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		await sendChannelMessage(token, channelId, badgey(locale, 'dm.wizard.not_configured'));
		return;
	}

	if (action === 'clear') {
		if (kind === 'log') {
			await upsertGuildConfig(env.STFC_DB, {
				guild_id: guildId,
				verification_log_channel_id: null,
			});
		} else {
			await upsertGuildConfig(env.STFC_DB, { guild_id: guildId, audit_log_channel_id: null });
		}
		await clearDmSession(env.STFC_DB, userId);
		await sendChannelMessage(token, channelId, badgey(locale, 'dm.badgey.wizard_done'));
		return;
	}

	if (action === 'create') {
		if (!token) return;
		if (kind === 'log') {
			const id = await createVerificationLogChannel(token, guildId, config);
			await upsertGuildConfig(env.STFC_DB, {
				guild_id: guildId,
				verification_log_channel_id: id,
			});
		} else {
			const id = await createAuditLogChannel(token, guildId, config);
			await upsertGuildConfig(env.STFC_DB, { guild_id: guildId, audit_log_channel_id: id });
			const refreshed = await getGuildConfig(env.STFC_DB, guildId);
			await postAuditLog(env, refreshed, {
				title: 'Audit log enabled',
				description: `Created <#${id}> via DM wizard.`,
				actorId: userId,
				source: 'admin',
				color: AuditColor.success,
			});
		}
		await clearDmSession(env.STFC_DB, userId);
		await sendChannelMessage(token, channelId, badgey(locale, 'dm.badgey.wizard_done'));
		return;
	}

	if (action === 'link') {
		await upsertDmSession(env.STFC_DB, {
			discord_user_id: userId,
			guild_id: guildId,
			flow: kind === 'log' ? 'channels_log' : 'channels_audit',
			step: 'link_channel',
			payload: { channel_kind: kind },
		});
		await sendMessageWithComponents(token, channelId, {
			content: badgey(locale, 'dm.wizard.channel.ask_id'),
			components: buildCancelRow(locale),
		});
	}
}
