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
	const response = await fetch(`${DISCORD_API}${path}`, {
		...init,
		headers: {
			Authorization: `Bot ${token}`,
			'Content-Type': 'application/json',
			...init.headers,
		},
	});

	if (!response.ok) {
		const body = await response.text();
		throw new DiscordApiError(`Discord API ${path} failed`, response.status, body);
	}

	return response;
}

export interface DiscordGuildMember {
	user: { id: string; username: string; discriminator?: string };
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
	// Not all fields are typed; we keep it minimal for formatting.
}

export interface DiscordChannel {
	id: string;
	name: string;
	type: number;
	parent_id?: string | null;
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

export async function listGuildChannels(token: string, guildId: string): Promise<DiscordChannel[]> {
	const response = await discordFetch(token, `/guilds/${guildId}/channels`, { method: 'GET' });
	return (await response.json()) as DiscordChannel[];
}

export async function getGuildChannel(token: string, channelId: string): Promise<DiscordChannel | null> {
	try {
		const response = await discordFetch(token, `/channels/${channelId}`, { method: 'GET' });
		return (await response.json()) as DiscordChannel;
	} catch {
		return null;
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
	return msgResponse.json() as Promise<{ channel_id: string; id: string }>;
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
	await discordFetch(token, `/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
		method: 'DELETE',
	});
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
	parentId?: string,
): Promise<{ id: string }> {
	const body: Record<string, unknown> = {
		name,
		type: 0,
	};
	if (parentId) body.parent_id = parentId;

	const response = await discordFetch(token, `/guilds/${guildId}/channels`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
	return response.json() as Promise<{ id: string }>;
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

/** Deferred interaction follow-up (for slow stfc.pro lookups). */
export async function editInteractionResponse(
	applicationId: string,
	interactionToken: string,
	content: string,
	ephemeral = false,
): Promise<void> {
	const url = `${DISCORD_API}/webhooks/${applicationId}/${interactionToken}/messages/@original`;
	await fetch(url, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			content,
			...(ephemeral ? { flags: 64 } : {}),
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
