const DISCORD_API = 'https://discord.com/api/v10';

export class DiscordApiError extends Error {
	constructor(
		message: string,
		public status: number,
		public body?: string,
	) {
		super(message);
		this.name = 'DiscordApiError';
	}
}

async function discordFetch(
	token: string,
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	const headers = new Headers(init.headers);
	headers.set('Authorization', `Bot ${token}`);
	// Let the runtime set multipart boundary when body is FormData.
	if (!(init.body instanceof FormData) && !headers.has('Content-Type')) {
		headers.set('Content-Type', 'application/json');
	}

	const response = await fetch(`${DISCORD_API}${path}`, {
		...init,
		headers,
	});

	if (!response.ok) {
		const body = await response.text();
		throw new DiscordApiError(
			`Discord API ${path} failed (HTTP ${response.status})${body ? `: ${body.slice(0, 200)}` : ''}`,
			response.status,
			body,
		);
	}

	return response;
}

export interface DiscordGuildMember {
	user: { id: string; username: string; discriminator?: string; bot?: boolean };
	nick: string | null;
	roles: string[];
	joined_at: string;
}

export interface DiscordRole {
	id: string;
	name: string;
	position: number;
	hoist: boolean;
	managed: boolean;
	mentionable: boolean;
	/** Permission bitfield as decimal string. */
	permissions?: string;
	/** Integration/bot tags when present. */
	tags?: { bot_id?: string; integration_id?: string; premium_subscriber?: null };
}

export interface DiscordGuildInfo {
	id: string;
	name: string;
	owner_id: string;
}

export type ChannelPermissionOverwrite = {
	id: string;
	type: 0 | 1;
	allow: string;
	deny: string;
};

export interface DiscordChannel {
	id: string;
	name: string;
	type: number;
	parent_id?: string | null;
	guild_id?: string | null;
	permission_overwrites?: ChannelPermissionOverwrite[];
}

/** Guild text (0) and announcement (5) — usable as personal/diplomacy channels. */
export function isLinkableGuildTextChannel(type: number): boolean {
	return type === 0 || type === 5;
}

export function describeChannelType(type: number): string {
	const names: Record<number, string> = {
		0: 'text',
		1: 'DM',
		2: 'voice',
		3: 'group DM',
		4: 'category',
		5: 'announcement',
		10: 'announcement thread',
		11: 'public thread',
		12: 'private thread',
		13: 'stage',
		15: 'forum',
		16: 'media',
	};
	return names[type] ?? `type ${type}`;
}

export async function listGuildMembers(
	token: string,
	guildId: string,
	limit = 1000,
	after?: string,
): Promise<DiscordGuildMember[]> {
	const params = new URLSearchParams({ limit: String(limit) });
	if (after) params.set('after', after);

	const response = await discordFetch(token, `/guilds/${guildId}/members?${params}`);
	return response.json() as Promise<DiscordGuildMember[]>;
}

export async function listAllGuildMembers(token: string, guildId: string): Promise<DiscordGuildMember[]> {
	const all: DiscordGuildMember[] = [];
	let after: string | undefined;

	for (let i = 0; i < 10; i++) {
		const batch = await listGuildMembers(token, guildId, 1000, after);
		if (batch.length === 0) break;
		all.push(...batch);
		if (batch.length < 1000) break;
		after = batch[batch.length - 1].user.id;
	}

	return all;
}

export async function getGatewayBotUrl(token: string): Promise<{ url: string }> {
	const response = await discordFetch(token, '/gateway/bot');
	return response.json() as Promise<{ url: string }>;
}

export async function listGuildRoles(
	token: string,
	guildId: string,
): Promise<DiscordRole[]> {
	const response = await discordFetch(token, `/guilds/${guildId}/roles`, {
		method: 'GET',
	});
	return (await response.json()) as DiscordRole[];
}

export async function getGuild(token: string, guildId: string): Promise<DiscordGuildInfo | null> {
	try {
		const response = await discordFetch(token, `/guilds/${guildId}`, { method: 'GET' });
		return (await response.json()) as DiscordGuildInfo;
	} catch {
		return null;
	}
}

export async function getGuildMember(
	token: string,
	guildId: string,
	userId: string,
): Promise<DiscordGuildMember | null> {
	try {
		const response = await discordFetch(token, `/guilds/${guildId}/members/${userId}`, {
			method: 'GET',
		});
		return (await response.json()) as DiscordGuildMember;
	} catch {
		return null;
	}
}

export async function listGuildChannels(token: string, guildId: string): Promise<DiscordChannel[]> {
	const response = await discordFetch(token, `/guilds/${guildId}/channels`, { method: 'GET' });
	return (await response.json()) as DiscordChannel[];
}

export async function getGuildChannel(token: string, channelId: string): Promise<DiscordChannel | null> {
	const result = await fetchGuildChannel(token, channelId);
	return result.ok ? result.channel : null;
}

/** Fetch a channel with a clear error (Missing Access, wrong id, etc.). */
export async function fetchGuildChannel(
	token: string,
	channelId: string,
): Promise<{ ok: true; channel: DiscordChannel } | { ok: false; error: string; status?: number }> {
	try {
		const response = await discordFetch(token, `/channels/${channelId}`, { method: 'GET' });
		const channel = (await response.json()) as DiscordChannel;
		return { ok: true, channel };
	} catch (err) {
		if (err instanceof DiscordApiError) {
			const hint =
				err.status === 403 || err.status === 404
					? ' Bot may lack **View Channel** on that channel (common when @everyone is denied). Grant the bot access, or pick the channel again after fixing permissions.'
					: '';
			const body = err.body ? ` ${err.body.slice(0, 120)}` : '';
			return {
				ok: false,
				error: `Could not fetch channel (HTTP ${err.status}).${hint}${body}`,
				status: err.status,
			};
		}
		return { ok: false, error: err instanceof Error ? err.message : 'Unknown error fetching channel' };
	}
}

export async function patchGuildChannel(
	token: string,
	channelId: string,
	updates: { name?: string; parent_id?: string | null },
): Promise<DiscordChannel> {
	const response = await discordFetch(token, `/channels/${channelId}`, {
		method: 'PATCH',
		body: JSON.stringify(updates),
	});
	return (await response.json()) as DiscordChannel;
}

export async function createGuildRole(
	token: string,
	guildId: string,
	name: string,
): Promise<DiscordRole> {
	// Minimal role creation: no special permissions by default.
	// Admins can always edit role permissions afterwards.
	const response = await discordFetch(token, `/guilds/${guildId}/roles`, {
		method: 'POST',
		body: JSON.stringify({
			name,
			permissions: '0',
			color: 0,
			hoist: false,
			mentionable: false,
		}),
	});

	return (await response.json()) as DiscordRole;
}

export async function sendChannelMessage(
	token: string,
	channelId: string,
	content: string,
): Promise<void> {
	await discordFetch(token, `/channels/${channelId}/messages`, {
		method: 'POST',
		body: JSON.stringify({ content }),
	});
}

export interface DiscordEmbed {
	title?: string;
	description?: string;
	color?: number;
	fields?: Array<{ name: string; value: string; inline?: boolean }>;
	footer?: { text: string };
	timestamp?: string;
	image?: { url: string };
}

export async function sendChannelMessageWithEmbed(
	token: string,
	channelId: string,
	opts: {
		content?: string;
		embeds?: DiscordEmbed[];
		file?: { bytes: ArrayBuffer | Uint8Array; filename: string; contentType?: string };
	},
): Promise<{ id: string }> {
	if (opts.file) {
		const form = new FormData();
		const payload: Record<string, unknown> = {};
		if (opts.content) payload.content = opts.content;
		if (opts.embeds?.length) {
			payload.embeds = opts.embeds.map((e) => ({
				...e,
				image: e.image ?? { url: `attachment://${opts.file!.filename}` },
			}));
		}
		form.append('payload_json', JSON.stringify(payload));
		const blob = new Blob([opts.file.bytes], {
			type: opts.file.contentType ?? 'image/png',
		});
		form.append('files[0]', blob, opts.file.filename);
		const response = await discordFetch(token, `/channels/${channelId}/messages`, {
			method: 'POST',
			body: form,
		});
		return response.json() as Promise<{ id: string }>;
	}

	const response = await discordFetch(token, `/channels/${channelId}/messages`, {
		method: 'POST',
		body: JSON.stringify({
			content: opts.content,
			embeds: opts.embeds,
		}),
	});
	return response.json() as Promise<{ id: string }>;
}

export async function getBotUserId(token: string): Promise<string> {
	const response = await discordFetch(token, '/users/@me');
	const user = (await response.json()) as { id: string };
	return user.id;
}

/**
 * Discord's managed bot role usually has the same id as the bot user / application.
 * Prefer matching `tags.bot_id`, then id === botUserId.
 */
export async function resolveBotManagedRoleId(
	token: string,
	guildId: string,
	botUserId?: string,
): Promise<string> {
	const userId = botUserId ?? (await getBotUserId(token));
	const roles = await listGuildRoles(token, guildId);
	const byTag = roles.find((r) => r.tags?.bot_id === userId);
	if (byTag) return byTag.id;
	const byId = roles.find((r) => r.id === userId);
	if (byId) return byId.id;
	return userId;
}

export async function deleteChannelPermission(
	token: string,
	channelId: string,
	overwriteId: string,
): Promise<void> {
	try {
		await discordFetch(token, `/channels/${channelId}/permissions/${overwriteId}`, {
			method: 'DELETE',
		});
	} catch (err) {
		// Missing overwrite is fine.
		if (err instanceof DiscordApiError && err.status === 404) return;
		throw err;
	}
}

export async function sendDirectMessage(
	token: string,
	userId: string,
	content: string,
): Promise<{ channel_id: string; id: string }> {
	const channelResponse = await discordFetch(token, '/users/@me/channels', {
		method: 'POST',
		body: JSON.stringify({ recipient_id: userId }),
	});
	const channel = await channelResponse.json() as { id: string };

	const msgResponse = await discordFetch(token, `/channels/${channel.id}/messages`, {
		method: 'POST',
		body: JSON.stringify({ content }),
	});
	const msg = await msgResponse.json() as { id: string };
	return { channel_id: channel.id, id: msg.id };
}

export type DiscordButton = {
	type: 2;
	style: number;
	label: string;
	custom_id: string;
	disabled?: boolean;
};

export type DiscordActionRow = {
	type: 1;
	components: DiscordButton[];
};

export async function sendMessageWithComponents(
	token: string,
	channelId: string,
	opts: {
		content?: string;
		embeds?: DiscordEmbed[];
		components?: DiscordActionRow[];
	},
): Promise<{ id: string; channel_id: string }> {
	const response = await discordFetch(token, `/channels/${channelId}/messages`, {
		method: 'POST',
		body: JSON.stringify({
			content: opts.content,
			embeds: opts.embeds,
			components: opts.components,
		}),
	});
	const msg = (await response.json()) as { id: string };
	return { id: msg.id, channel_id: channelId };
}

export function interactionResponseWithComponents(
	content: string,
	opts?: {
		ephemeral?: boolean;
		embeds?: DiscordEmbed[];
		components?: DiscordActionRow[];
	},
): Response {
	return Response.json({
		type: 4,
		data: {
			content,
			embeds: opts?.embeds,
			components: opts?.components,
			...(opts?.ephemeral !== false ? { flags: 64 } : {}),
		},
	});
}

/** Type 6 — defer a component update (then edit later via webhook). */
export function deferredComponentResponse(): Response {
	return Response.json({ type: 6 });
}

/** Type 7 — update the message that contained the component. */
export function updateMessageResponse(
	content: string,
	opts?: { embeds?: DiscordEmbed[]; components?: DiscordActionRow[] },
): Response {
	return Response.json({
		type: 7,
		data: {
			content,
			embeds: opts?.embeds,
			components: opts?.components ?? [],
		},
	});
}

export async function addGuildMemberRole(
	token: string,
	guildId: string,
	userId: string,
	roleId: string,
): Promise<void> {
	await discordFetch(token, `/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
		method: 'PUT',
	});
}

export async function removeGuildMemberRole(
	token: string,
	guildId: string,
	userId: string,
	roleId: string,
): Promise<void> {
	try {
		await discordFetch(token, `/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
			method: 'DELETE',
		});
	} catch (err) {
		// Already absent — not an error for our sync logic.
		if (err instanceof DiscordApiError && err.status === 404) return;
		throw err;
	}
}

export async function setGuildMemberNickname(
	token: string,
	guildId: string,
	userId: string,
	nick: string,
): Promise<void> {
	await discordFetch(token, `/guilds/${guildId}/members/${userId}`, {
		method: 'PATCH',
		body: JSON.stringify({ nick }),
	});
}

export async function createGuildTextChannel(
	token: string,
	guildId: string,
	name: string,
	parentIdOrOpts?: string | {
		parentId?: string;
		topic?: string;
		permissionOverwrites?: ChannelPermissionOverwrite[];
	},
): Promise<{ id: string }> {
	const opts =
		typeof parentIdOrOpts === 'string'
			? { parentId: parentIdOrOpts }
			: parentIdOrOpts ?? {};

	const body: Record<string, unknown> = {
		name,
		type: 0,
	};
	if (opts.parentId) body.parent_id = opts.parentId;
	if (opts.topic) body.topic = opts.topic;
	if (opts.permissionOverwrites?.length) {
		body.permission_overwrites = opts.permissionOverwrites;
	}

	const response = await discordFetch(token, `/guilds/${guildId}/channels`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
	return response.json() as Promise<{ id: string }>;
}

/** Create a guild category (channel type 4). */
export async function createGuildCategory(
	token: string,
	guildId: string,
	name: string,
	opts?: { permissionOverwrites?: ChannelPermissionOverwrite[] },
): Promise<{ id: string; name: string }> {
	const body: Record<string, unknown> = {
		name: name.slice(0, 100),
		type: 4,
	};
	if (opts?.permissionOverwrites?.length) {
		body.permission_overwrites = opts.permissionOverwrites;
	}
	const response = await discordFetch(token, `/guilds/${guildId}/channels`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
	return response.json() as Promise<{ id: string; name: string }>;
}

export async function setChannelPermission(
	token: string,
	channelId: string,
	targetId: string,
	allow: string,
	deny: string,
	type: 0 | 1 = 0,
): Promise<void> {
	await discordFetch(token, `/channels/${channelId}/permissions/${targetId}`, {
		method: 'PUT',
		body: JSON.stringify({ type, allow, deny }),
	});
}

export async function pinChannelMessage(
	token: string,
	channelId: string,
	messageId: string,
): Promise<void> {
	await discordFetch(token, `/channels/${channelId}/pins/${messageId}`, {
		method: 'PUT',
	});
}

export async function unpinChannelMessage(
	token: string,
	channelId: string,
	messageId: string,
): Promise<void> {
	await discordFetch(token, `/channels/${channelId}/pins/${messageId}`, {
		method: 'DELETE',
	});
}

export async function editChannelMessage(
	token: string,
	channelId: string,
	messageId: string,
	opts: {
		content?: string;
		embeds?: DiscordEmbed[];
		components?: DiscordActionRow[];
	},
): Promise<void> {
	await discordFetch(token, `/channels/${channelId}/messages/${messageId}`, {
		method: 'PATCH',
		body: JSON.stringify({
			content: opts.content,
			embeds: opts.embeds,
			components: opts.components,
		}),
	});
}

/** Deferred interaction follow-up (for slow stfc.pro lookups). */
export async function editInteractionResponse(
	applicationId: string,
	interactionToken: string,
	content: string,
	ephemeral = false,
	opts?: { components?: DiscordActionRow[]; embeds?: DiscordEmbed[] },
): Promise<void> {
	const url = `${DISCORD_API}/webhooks/${applicationId}/${interactionToken}/messages/@original`;
	await fetch(url, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			content,
			...(ephemeral ? { flags: 64 } : {}),
			...(opts?.components !== undefined ? { components: opts.components } : {}),
			...(opts?.embeds !== undefined ? { embeds: opts.embeds } : {}),
		}),
	});
}

export function interactionResponse(
	content: string,
	ephemeral = false,
): Response {
	return Response.json({
		type: 4,
		data: {
			content,
			...(ephemeral ? { flags: 64 } : {}),
		},
	});
}

export function deferredResponse(): Response {
	return Response.json({ type: 5, data: { flags: 64 } });
}
