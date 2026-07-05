export const GATEWAY_VERSION = 10;

export const GatewayOpcode = {
	DISPATCH: 0,
	HEARTBEAT: 1,
	IDENTIFY: 2,
	RESUME: 6,
	RECONNECT: 7,
	INVALID_SESSION: 9,
	HELLO: 10,
	HEARTBEAT_ACK: 11,
} as const;

/** GUILDS | GUILD_MEMBERS | DIRECT_MESSAGES | MESSAGE_CONTENT */
export const GATEWAY_INTENTS =
	(1 << 0) | (1 << 1) | (1 << 12) | (1 << 15);

export const ChannelType = {
	GUILD_TEXT: 0,
	DM: 1,
} as const;

export interface GatewayPayload {
	op: number;
	d?: unknown;
	t?: string;
	s?: number;
}

export interface DiscordUser {
	id: string;
	username: string;
	bot?: boolean;
}

export interface DiscordAttachment {
	id: string;
	filename: string;
	url: string;
	proxy_url?: string;
	content_type?: string;
	size: number;
}

export interface DiscordMessage {
	id: string;
	channel_id: string;
	author: DiscordUser;
	content: string;
	attachments?: DiscordAttachment[];
	guild_id?: string;
}

export interface DiscordChannel {
	id: string;
	type: number;
}

export interface GatewayHello {
	heartbeat_interval: number;
}

export interface GatewayIdentify {
	token: string;
	intents: number;
	properties: {
		os: string;
		browser: string;
		device: string;
	};
}

export interface GatewayResume {
	token: string;
	session_id: string;
	seq: number;
}
