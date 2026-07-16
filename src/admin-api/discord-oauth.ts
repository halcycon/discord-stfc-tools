import { ADMINISTRATOR, isGuildAdministrator } from '../discord-admin';
import type { GuildConfig } from '../types';
import type { AdminSession } from './session';

const DISCORD_API = 'https://discord.com/api/v10';

export type DiscordOAuthGuild = {
	id: string;
	name: string;
	icon: string | null;
	owner?: boolean;
	permissions: string;
};

export async function exchangeOAuthCode(
	env: {
		DISCORD_CLIENT_ID?: string;
		DISCORD_APPLICATION_ID?: string;
		DISCORD_CLIENT_SECRET?: string;
		WORKER_URL?: string;
	},
	code: string,
	redirectUri: string,
): Promise<{ access_token: string; token_type: string; expires_in: number } | { error: string }> {
	const clientId = env.DISCORD_CLIENT_ID || env.DISCORD_APPLICATION_ID;
	const clientSecret = env.DISCORD_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		return { error: 'OAuth not configured (DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET)' };
	}
	const body = new URLSearchParams({
		client_id: clientId,
		client_secret: clientSecret,
		grant_type: 'authorization_code',
		code,
		redirect_uri: redirectUri,
	});
	const res = await fetch(`${DISCORD_API}/oauth2/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body,
	});
	if (!res.ok) {
		const text = await res.text();
		return { error: `Token exchange failed (${res.status}): ${text.slice(0, 200)}` };
	}
	return (await res.json()) as { access_token: string; token_type: string; expires_in: number };
}

export async function fetchOAuthUser(accessToken: string): Promise<{
	id: string;
	username: string;
	global_name: string | null;
	avatar: string | null;
} | null> {
	const res = await fetch(`${DISCORD_API}/users/@me`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!res.ok) return null;
	return (await res.json()) as {
		id: string;
		username: string;
		global_name: string | null;
		avatar: string | null;
	};
}

export async function fetchOAuthGuilds(accessToken: string): Promise<DiscordOAuthGuild[]> {
	const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!res.ok) return [];
	return (await res.json()) as DiscordOAuthGuild[];
}

/** Bot REST: member role IDs for role-gate checks. */
export async function fetchMemberRoleIds(
	botToken: string,
	guildId: string,
	userId: string,
): Promise<string[] | null> {
	const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
		headers: { Authorization: `Bot ${botToken}` },
	});
	if (res.status === 404) return [];
	if (!res.ok) return null;
	const member = (await res.json()) as { roles?: string[] };
	return member.roles ?? [];
}

export function oauthAuthorizeUrl(
	env: { DISCORD_CLIENT_ID?: string; DISCORD_APPLICATION_ID?: string },
	redirectUri: string,
	state: string,
): string | null {
	const clientId = env.DISCORD_CLIENT_ID || env.DISCORD_APPLICATION_ID;
	if (!clientId) return null;
	const params = new URLSearchParams({
		client_id: clientId,
		response_type: 'code',
		redirect_uri: redirectUri,
		scope: 'identify guilds',
		state,
		prompt: 'consent',
	});
	return `https://discord.com/api/oauth2/authorize?${params}`;
}

export function oauthRedirectUri(env: { WORKER_URL?: string }, requestUrl: URL): string {
	const base = (env.WORKER_URL || `${requestUrl.origin}`).replace(/\/$/, '');
	return `${base}/api/admin/auth/callback`;
}

export type GuildAccessOk = {
	ok: true;
	via: 'administrator' | 'web_admin_role';
	/** Discord Administrator only — can mutate config / permissions / exchange setup. */
	can_configure: boolean;
};

export async function userCanAccessGuild(
	env: { DISCORD_BOT_TOKEN?: string },
	session: AdminSession,
	config: GuildConfig,
	oauthGuild: DiscordOAuthGuild | undefined,
): Promise<GuildAccessOk | { ok: false; reason: string }> {
	if (oauthGuild && isGuildAdministrator(oauthGuild.permissions)) {
		return { ok: true, via: 'administrator', can_configure: true };
	}
	// Owner often has admin; permissions bit should already cover it.

	const roleIds = config.web_admin_role_ids ?? [];
	if (roleIds.length && env.DISCORD_BOT_TOKEN) {
		const memberRoles = await fetchMemberRoleIds(
			env.DISCORD_BOT_TOKEN,
			config.guild_id,
			session.userId,
		);
		if (memberRoles && roleIds.some((id) => memberRoles.includes(id))) {
			return { ok: true, via: 'web_admin_role', can_configure: false };
		}
	}

	// Fallback: if OAuth guild missing (pagination) but bot can see member + Admin role —
	// still require oauth admin bit or web roles. Without oauth guild, only role gate.
	if (!oauthGuild && roleIds.length === 0) {
		return { ok: false, reason: 'Not an administrator of this guild' };
	}
	if (!oauthGuild) {
		return { ok: false, reason: 'Not allowed for this guild' };
	}
	return { ok: false, reason: 'Need Administrator or a configured web admin role' };
}

export function hasAdministratorBit(permissions: string | undefined): boolean {
	return isGuildAdministrator(permissions);
}

export { ADMINISTRATOR };
