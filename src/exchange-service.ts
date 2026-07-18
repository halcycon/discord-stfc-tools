import {
	addGuildMemberRole,
	createGuildRole,
	createGuildTextChannel,
	editChannelMessage,
	pinChannelMessage,
	removeGuildMemberRole,
	sendMessageWithComponents,
	unpinChannelMessage,
	type DiscordActionRow,
} from './discord-api';
import {
	addExchangeDonor,
	claimExchangeRequest,
	completeExchangeRequest,
	countActiveExchangeRequests,
	countExchangeDonors,
	createExchangeRequest,
	createExchangeResource,
	getActiveRequestForRecipient,
	getExchangeRequest,
	getExchangeResource,
	isExchangeDonor,
	listExchangeDonorIds,
	listOpenExchangeRequests,
	removeExchangeDonor,
	reopenExchangeRequest,
	cancelExchangeRequest,
	updateExchangeResource,
} from './exchange-db';
import type { ExchangeResource } from './exchange-types';
import { getVerifiedPlayer } from './guild-db';
import { resolveLocale, t } from './i18n';
import type { GuildConfig, VerifiedPlayer } from './types';

export function slugifyResourceName(name: string): string {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 80);
	return slug || 'resource';
}

/** Donors eligible to help: different alliance tag, not the recipient. */
export function filterCrossAllianceDonors(
	recipient: VerifiedPlayer,
	donors: VerifiedPlayer[],
): VerifiedPlayer[] {
	const recipTag = (recipient.alliance_tag || '').trim().toUpperCase();
	return donors.filter((d) => {
		if (d.discord_user_id === recipient.discord_user_id) return false;
		const donorTag = (d.alliance_tag || '').trim().toUpperCase();
		if (!recipTag || !donorTag) return false;
		return donorTag !== recipTag;
	});
}

export function buildResourcePinComponents(resourceId: number): DiscordActionRow[] {
	return [
		{
			type: 1,
			components: [
				{
					type: 2,
					style: 3,
					label: 'Register as donor',
					custom_id: `exch:donor:add:${resourceId}`,
				},
				{
					type: 2,
					style: 2,
					label: 'Stop donating',
					custom_id: `exch:donor:rem:${resourceId}`,
				},
				{
					type: 2,
					style: 1,
					label: 'I need this',
					custom_id: `exch:need:${resourceId}`,
				},
				{
					type: 2,
					style: 4,
					label: 'I no longer need this',
					custom_id: `exch:need:cancel:${resourceId}`,
				},
			],
		},
	];
}

export function buildDonorOfferComponents(
	requestId: number,
	locale: string = 'en',
): DiscordActionRow[] {
	return [
		{
			type: 1,
			components: [
				{
					type: 2,
					style: 3,
					label: t(locale, 'exchange.btn.help'),
					custom_id: `exch:help:${requestId}`,
				},
				{
					type: 2,
					style: 2,
					label: t(locale, 'exchange.btn.ignore'),
					custom_id: `exch:ignore:${requestId}`,
				},
			],
		},
	];
}

export function buildRecipientFollowupComponents(
	requestId: number,
	locale: string = 'en',
): DiscordActionRow[] {
	return [
		{
			type: 1,
			components: [
				{
					type: 2,
					style: 3,
					label: t(locale, 'exchange.btn.completed'),
					custom_id: `exch:done:${requestId}`,
				},
				{
					type: 2,
					style: 1,
					label: t(locale, 'exchange.btn.ask_again'),
					custom_id: `exch:again:${requestId}`,
				},
			],
		},
	];
}

function pinContent(
	resource: ExchangeResource,
	donorCount: number,
	activeRequestCount: number,
): string {
	return (
		`**Resource exchange: ${resource.name}**\n\n` +
		`Cross-alliance only — donors and recipients must be in **different** alliances.\n` +
		`• **Register as donor** — get pinged when someone needs this (including queued requests)\n` +
		`• **I need this** — open a request (queued if no donors yet; otherwise donors are DMed)\n` +
		`• **I no longer need this** — cancel your open/claimed request\n` +
		`• First donor to hit **Help** claims the request\n\n` +
		`Registered donors: **${donorCount}**\n` +
		`Active requests: **${activeRequestCount}**\n` +
		`Roles: <@&${resource.donor_role_id}> · <@&${resource.recipient_role_id}>`
	);
}

async function openDmChannel(token: string, userId: string): Promise<string> {
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
	return channel.id;
}

async function dmWithComponents(
	token: string,
	userId: string,
	content: string,
	components: DiscordActionRow[],
): Promise<void> {
	const channelId = await openDmChannel(token, userId);
	await sendMessageWithComponents(token, channelId, { content, components });
}

export async function createResourceWithSetup(
	env: Env,
	config: GuildConfig,
	name: string,
): Promise<ExchangeResource> {
	if (!env.DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN not configured');
	if (!config.exchange_layout) {
		throw new Error('Run `/exchange setup` first (hub or category layout).');
	}
	const token = env.DISCORD_BOT_TOKEN;
	const guildId = config.guild_id;
	const slug = slugifyResourceName(name);
	const displayName = name.trim().slice(0, 80);
	if (!displayName) throw new Error('Resource name is required.');

	const donorRole = await createGuildRole(token, guildId, `${displayName} Donor`);
	const recipientRole = await createGuildRole(token, guildId, `${displayName} Need`);

	let channelId: string;
	if (config.exchange_layout === 'hub') {
		if (!config.exchange_hub_channel_id) {
			throw new Error('Hub layout requires a hub channel (`/exchange setup channel:`).');
		}
		channelId = config.exchange_hub_channel_id;
	} else {
		if (!config.exchange_category_id) {
			throw new Error('Category layout requires a category (`/exchange setup`).');
		}
		const ch = await createGuildTextChannel(token, guildId, slugifyResourceName(displayName), {
			parentId: config.exchange_category_id,
			topic: `Resource exchange: ${displayName} (cross-alliance)`,
		});
		channelId = ch.id;
	}

	const resource = await createExchangeResource(env.STFC_DB, {
		guild_id: guildId,
		name: displayName,
		slug,
		donor_role_id: donorRole.id,
		recipient_role_id: recipientRole.id,
		channel_id: channelId,
	});

	const msg = await sendMessageWithComponents(token, channelId, {
		content: pinContent(resource, 0, 0),
		components: buildResourcePinComponents(resource.id),
	});
	await pinChannelMessage(token, channelId, msg.id);
	await updateExchangeResource(env.STFC_DB, resource.id, { pinned_message_id: msg.id });

	return { ...resource, pinned_message_id: msg.id };
}

async function refreshPin(env: Env, resource: ExchangeResource): Promise<void> {
	if (!env.DISCORD_BOT_TOKEN || !resource.pinned_message_id) return;
	const [donorCount, activeRequestCount] = await Promise.all([
		countExchangeDonors(env.STFC_DB, resource.id),
		countActiveExchangeRequests(env.STFC_DB, resource.id),
	]);
	try {
		await editChannelMessage(
			env.DISCORD_BOT_TOKEN,
			resource.channel_id,
			resource.pinned_message_id,
			{
				content: pinContent(resource, donorCount, activeRequestCount),
				components: resource.active ? buildResourcePinComponents(resource.id) : [],
			},
		);
	} catch (err) {
		console.error('Exchange pin refresh failed:', err);
	}
}

/** DM one donor about a single open request (used when flushing the queue). */
async function notifyDonorOfRequest(
	env: Env,
	resource: ExchangeResource,
	recipient: VerifiedPlayer,
	requestId: number,
	donor: VerifiedPlayer,
): Promise<boolean> {
	if (!env.DISCORD_BOT_TOKEN) return false;
	const locale = resolveLocale(donor.preferred_locale);
	const content = t(locale, 'exchange.dm.need_request', {
		name: recipient.player_name || `<@${recipient.discord_user_id}>`,
		ops: recipient.ops_level ?? '?',
		resource: resource.name,
		tag: recipient.alliance_tag || '—',
	});
	try {
		await dmWithComponents(
			env.DISCORD_BOT_TOKEN,
			donor.discord_user_id,
			content,
			buildDonorOfferComponents(requestId, locale),
		);
		return true;
	} catch (err) {
		console.error(`Exchange donor DM failed for ${donor.discord_user_id}:`, err);
		return false;
	}
}

/**
 * After a new donor registers: DM them about open requests they can help with,
 * oldest first (queue order). Does not re-notify other donors.
 */
async function notifyNewDonorOfQueuedRequests(
	env: Env,
	resource: ExchangeResource,
	donor: VerifiedPlayer,
): Promise<number> {
	const open = await listOpenExchangeRequests(env.STFC_DB, resource.id, 50);
	let sent = 0;
	for (const req of open) {
		const recipient = await getVerifiedPlayer(
			env.STFC_DB,
			resource.guild_id,
			req.recipient_discord_user_id,
		);
		if (!recipient) continue;
		if (filterCrossAllianceDonors(recipient, [donor]).length === 0) continue;
		const ok = await notifyDonorOfRequest(env, resource, recipient, req.id, donor);
		if (ok) sent += 1;
		await new Promise((r) => setTimeout(r, 300));
	}
	return sent;
}

export async function registerDonor(
	env: Env,
	guildId: string,
	resourceId: number,
	userId: string,
): Promise<string> {
	if (!env.DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN not configured');
	const player = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
	if (!player || (player.verification_status !== 'active' && player.verification_status !== 'guest')) {
		return '❌ Verify first with `/verify` (or the DM flow) before donating.';
	}
	const resource = await getExchangeResource(env.STFC_DB, resourceId);
	if (!resource || !resource.active || resource.guild_id !== guildId) {
		return '❌ Resource not found or disabled.';
	}
	await addExchangeDonor(env.STFC_DB, resourceId, userId);
	try {
		await addGuildMemberRole(env.DISCORD_BOT_TOKEN, guildId, userId, resource.donor_role_id);
	} catch (err) {
		console.error('Donor role assign failed:', err);
	}

	let queuedNotice = '';
	if (player.alliance_tag?.trim()) {
		const notified = await notifyNewDonorOfQueuedRequests(env, resource, player);
		if (notified > 0) {
			queuedNotice =
				`\n📬 You were DMed about **${notified}** open request(s) waiting for a donor (oldest first).`;
		}
	}

	await refreshPin(env, resource);
	return `✅ You are now a **${resource.name}** donor.` + queuedNotice;
}

export async function unregisterDonor(
	env: Env,
	guildId: string,
	resourceId: number,
	userId: string,
): Promise<string> {
	if (!env.DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN not configured');
	const resource = await getExchangeResource(env.STFC_DB, resourceId);
	if (!resource || resource.guild_id !== guildId) return '❌ Resource not found.';
	await removeExchangeDonor(env.STFC_DB, resourceId, userId);
	try {
		await removeGuildMemberRole(env.DISCORD_BOT_TOKEN, guildId, userId, resource.donor_role_id);
	} catch (err) {
		console.error('Donor role remove failed:', err);
	}
	await refreshPin(env, resource);
	return `✅ You are no longer a **${resource.name}** donor.`;
}

async function loadDonorPlayers(
	env: Env,
	guildId: string,
	resourceId: number,
): Promise<VerifiedPlayer[]> {
	const ids = await listExchangeDonorIds(env.STFC_DB, resourceId);
	const players: VerifiedPlayer[] = [];
	for (const id of ids) {
		const p = await getVerifiedPlayer(env.STFC_DB, guildId, id);
		if (p) players.push(p);
	}
	return players;
}

export async function notifyEligibleDonors(
	env: Env,
	resource: ExchangeResource,
	recipient: VerifiedPlayer,
	requestId: number,
): Promise<number> {
	if (!env.DISCORD_BOT_TOKEN) return 0;
	const donors = await loadDonorPlayers(env, resource.guild_id, resource.id);
	const eligible = filterCrossAllianceDonors(recipient, donors);
	const name = recipient.player_name || `<@${recipient.discord_user_id}>`;
	const ops = recipient.ops_level ?? '?';
	const tag = recipient.alliance_tag || '—';
	let sent = 0;
	for (const d of eligible) {
		const locale = resolveLocale(d.preferred_locale);
		const content = t(locale, 'exchange.dm.need_request', {
			name,
			ops,
			resource: resource.name,
			tag,
		});
		const components = buildDonorOfferComponents(requestId, locale);
		try {
			await dmWithComponents(env.DISCORD_BOT_TOKEN, d.discord_user_id, content, components);
			sent += 1;
		} catch (err) {
			console.error(`Exchange donor DM failed for ${d.discord_user_id}:`, err);
		}
		await new Promise((r) => setTimeout(r, 300));
	}
	return sent;
}

export async function openNeedRequest(
	env: Env,
	guildId: string,
	resourceId: number,
	userId: string,
): Promise<string> {
	if (!env.DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN not configured');
	const player = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
	if (!player || (player.verification_status !== 'active' && player.verification_status !== 'guest')) {
		return '❌ Verify first with `/verify` before requesting resources.';
	}
	if (!player.alliance_tag?.trim()) {
		return '❌ You need an alliance tag on your verified profile to use exchange.';
	}
	const resource = await getExchangeResource(env.STFC_DB, resourceId);
	if (!resource || !resource.active || resource.guild_id !== guildId) {
		return '❌ Resource not found or disabled.';
	}

	const existing = await getActiveRequestForRecipient(env.STFC_DB, resourceId, userId);
	if (existing) {
		return `❌ You already have an active **${resource.name}** request (#${existing.id}, ${existing.status}).`;
	}

	const donors = await loadDonorPlayers(env, guildId, resourceId);
	const eligible = filterCrossAllianceDonors(player, donors);

	const request = await createExchangeRequest(env.STFC_DB, resourceId, userId);
	try {
		await addGuildMemberRole(env.DISCORD_BOT_TOKEN, guildId, userId, resource.recipient_role_id);
	} catch (err) {
		console.error('Recipient role assign failed:', err);
	}

	await refreshPin(env, resource);

	if (eligible.length === 0) {
		return (
			`✅ Request #${request.id} queued for **${resource.name}**.\n` +
			`No cross-alliance donors yet — you’re in line (FIFO). ` +
			`When a donor registers, they’ll be DMed about open requests oldest-first.`
		);
	}

	const sent = await notifyEligibleDonors(env, resource, player, request.id);
	return (
		`✅ Request #${request.id} opened for **${resource.name}**.\n` +
		`Notified **${sent}** eligible donor(s). They’ll DM you if they claim Help.`
	);
}

export async function cancelNeedRequest(
	env: Env,
	guildId: string,
	resourceId: number,
	userId: string,
): Promise<string> {
	const resource = await getExchangeResource(env.STFC_DB, resourceId);
	if (!resource || resource.guild_id !== guildId) {
		return '❌ Resource not found.';
	}

	const existing = await getActiveRequestForRecipient(env.STFC_DB, resourceId, userId);
	if (!existing) {
		return `❌ You have no active **${resource.name}** request to cancel.`;
	}

	const claimerId = existing.status === 'claimed' ? existing.claimed_by : null;
	await cancelExchangeRequest(env.STFC_DB, existing.id);

	if (env.DISCORD_BOT_TOKEN) {
		try {
			await removeGuildMemberRole(
				env.DISCORD_BOT_TOKEN,
				guildId,
				userId,
				resource.recipient_role_id,
			);
		} catch (err) {
			console.error('Recipient role remove failed:', err);
		}
		if (claimerId) {
			try {
				const channelId = await openDmChannel(env.DISCORD_BOT_TOKEN, claimerId);
				const claimer = await getVerifiedPlayer(env.STFC_DB, guildId, claimerId);
				const locale = resolveLocale(claimer?.preferred_locale);
				await sendMessageWithComponents(env.DISCORD_BOT_TOKEN, channelId, {
					content: t(locale, 'exchange.dm.request_cancelled', {
						userId,
						resource: resource.name,
						id: existing.id,
					}),
					components: [],
				});
			} catch (err) {
				console.error('Claimer cancel notice failed:', err);
			}
		}
	}

	await refreshPin(env, resource);
	return `✅ Cancelled your **${resource.name}** request (#${existing.id}).`;
}

export async function handleHelpClaim(
	env: Env,
	requestId: number,
	donorUserId: string,
): Promise<string> {
	if (!env.DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN not configured');
	const request = await getExchangeRequest(env.STFC_DB, requestId);
	if (!request) return '❌ Request not found.';
	if (request.status !== 'open') {
		return request.status === 'claimed'
			? '✅ Someone already claimed this request.'
			: '❌ This request is no longer open.';
	}

	const resource = await getExchangeResource(env.STFC_DB, request.resource_id);
	if (!resource) return '❌ Resource not found.';

	const donor = await getVerifiedPlayer(env.STFC_DB, resource.guild_id, donorUserId);
	if (!donor) return '❌ You must be verified to help.';
	if (!(await isExchangeDonor(env.STFC_DB, resource.id, donorUserId))) {
		return '❌ You are not registered as a donor for this resource.';
	}

	const recipient = await getVerifiedPlayer(
		env.STFC_DB,
		resource.guild_id,
		request.recipient_discord_user_id,
	);
	if (!recipient) return '❌ Recipient profile missing.';

	const eligible = filterCrossAllianceDonors(recipient, [donor]);
	if (eligible.length === 0) {
		return '❌ Same-alliance exchanges are not allowed.';
	}

	const won = await claimExchangeRequest(env.STFC_DB, requestId, donorUserId);
	if (!won) return '✅ Someone already claimed this request.';

	const donorName = donor.player_name || `<@${donorUserId}>`;
	const recipName = recipient.player_name || `<@${recipient.discord_user_id}>`;
	const recipLocale = resolveLocale(recipient.preferred_locale);
	try {
		await dmWithComponents(
			env.DISCORD_BOT_TOKEN,
			request.recipient_discord_user_id,
			t(recipLocale, 'exchange.dm.claimed', {
				donorName,
				ops: donor.ops_level ?? '?',
				tag: donor.alliance_tag || '—',
				resource: resource.name,
				donorId: donorUserId,
			}),
			buildRecipientFollowupComponents(requestId, recipLocale),
		);
	} catch (err) {
		console.error('Recipient claim DM failed:', err);
	}

	await refreshPin(env, resource);
	return `✅ You claimed **${resource.name}** for **${recipName}**. Contact them: <@${recipient.discord_user_id}>.`;
}

export async function handleRequestCompleted(
	env: Env,
	requestId: number,
	userId: string,
): Promise<string> {
	const request = await getExchangeRequest(env.STFC_DB, requestId);
	if (!request) return '❌ Request not found.';
	if (request.recipient_discord_user_id !== userId) {
		return '❌ Only the recipient can mark this completed.';
	}
	if (request.status !== 'open' && request.status !== 'claimed') {
		return '❌ This request is already closed.';
	}
	await completeExchangeRequest(env.STFC_DB, requestId);
	const resource = await getExchangeResource(env.STFC_DB, request.resource_id);
	if (resource) await refreshPin(env, resource);
	return '✅ Request marked completed. Thanks!';
}

export async function handleAskAgain(
	env: Env,
	requestId: number,
	userId: string,
): Promise<string> {
	const request = await getExchangeRequest(env.STFC_DB, requestId);
	if (!request) return '❌ Request not found.';
	if (request.recipient_discord_user_id !== userId) {
		return '❌ Only the recipient can ask again.';
	}
	if (request.status !== 'claimed' && request.status !== 'open') {
		return '❌ This request cannot be re-opened.';
	}

	const resource = await getExchangeResource(env.STFC_DB, request.resource_id);
	if (!resource || !resource.active) return '❌ Resource not available.';

	const recipient = await getVerifiedPlayer(env.STFC_DB, resource.guild_id, userId);
	if (!recipient) return '❌ Verified profile required.';

	if (request.status === 'claimed') {
		await reopenExchangeRequest(env.STFC_DB, requestId);
	}

	await refreshPin(env, resource);

	const sent = await notifyEligibleDonors(env, resource, recipient, requestId);
	if (sent === 0) {
		return (
			`✅ Request #${requestId} is open again for **${resource.name}**, ` +
			`but no cross-alliance donors are available right now — you’re queued until one registers or Helps.`
		);
	}
	return `✅ Re-notified **${sent}** donor(s) for **${resource.name}**.`;
}

export async function disableExchangeResource(
	env: Env,
	guildId: string,
	resourceId: number,
): Promise<string> {
	const resource = await getExchangeResource(env.STFC_DB, resourceId);
	if (!resource || resource.guild_id !== guildId) return '❌ Resource not found.';
	await updateExchangeResource(env.STFC_DB, resourceId, { active: false });
	const updated = { ...resource, active: false };
	if (env.DISCORD_BOT_TOKEN && resource.pinned_message_id) {
		try {
			await editChannelMessage(
				env.DISCORD_BOT_TOKEN,
				resource.channel_id,
				resource.pinned_message_id,
				{
					content:
						pinContent(
							updated,
							await countExchangeDonors(env.STFC_DB, resourceId),
							await countActiveExchangeRequests(env.STFC_DB, resourceId),
						) + '\n\n**Disabled** — registration closed.',
					components: [],
				},
			);
			await unpinChannelMessage(
				env.DISCORD_BOT_TOKEN,
				resource.channel_id,
				resource.pinned_message_id,
			);
		} catch (err) {
			console.error('Disable resource pin update failed:', err);
		}
	}
	return `✅ Disabled **${resource.name}**.`;
}
