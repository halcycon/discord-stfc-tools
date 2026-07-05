import { DurableObject } from 'cloudflare:workers';
import { getGatewayBotUrl } from '../discord-api';
import { getGuildConfig, recordGuildMember, markMemberInvited } from '../guild-db';
import { inviteNewMember } from '../verification';
import { handleDirectMessage } from './events';
import {
	GATEWAY_INTENTS,
	GATEWAY_VERSION,
	GatewayOpcode,
	type GatewayHello,
	type GatewayPayload,
	type DiscordMessage,
} from './protocol';

const GATEWAY_STORAGE_KEY = 'gateway_state';

interface GatewayState {
	sessionId: string | null;
	sequence: number;
	heartbeatInterval: number;
	ready: boolean;
	lastEventAt: string | null;
	reconnectAttempts: number;
}

const DEFAULT_STATE: GatewayState = {
	sessionId: null,
	sequence: 0,
	heartbeatInterval: 41250,
	ready: false,
	lastEventAt: null,
	reconnectAttempts: 0,
};

export class DiscordGateway extends DurableObject<Env> {
	private socket: WebSocket | null = null;
	private state: GatewayState = { ...DEFAULT_STATE };
	private initialized = false;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	private async loadState(): Promise<void> {
		if (this.initialized) return;
		const stored = await this.ctx.storage.get<GatewayState>(GATEWAY_STORAGE_KEY);
		if (stored) this.state = { ...DEFAULT_STATE, ...stored };
		this.initialized = true;
	}

	private async saveState(): Promise<void> {
		await this.ctx.storage.put(GATEWAY_STORAGE_KEY, this.state);
	}

	private sendOpcode(op: number, data?: unknown): void {
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
		this.socket.send(JSON.stringify({ op, d: data ?? null }));
	}

	private async identify(): Promise<void> {
		if (!this.env.DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN not configured');
		this.sendOpcode(GatewayOpcode.IDENTIFY, {
			token: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
			intents: GATEWAY_INTENTS,
			properties: { os: 'linux', browser: 'cloudflare-workers', device: 'cloudflare-workers' },
		});
	}

	private async resume(): Promise<void> {
		if (!this.env.DISCORD_BOT_TOKEN || !this.state.sessionId) {
			await this.identify();
			return;
		}
		this.sendOpcode(GatewayOpcode.RESUME, {
			token: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
			session_id: this.state.sessionId,
			seq: this.state.sequence,
		});
	}

	private scheduleHeartbeat(): void {
		const interval = Math.max(this.state.heartbeatInterval, 1000);
		this.ctx.storage.setAlarm(Date.now() + interval);
	}

	private scheduleReconnect(delayMs = 5000): void {
		this.state.reconnectAttempts += 1;
		const backoff = Math.min(delayMs * this.state.reconnectAttempts, 60_000);
		this.ctx.storage.setAlarm(Date.now() + backoff);
	}

	private attachSocketHandlers(ws: WebSocket): void {
		ws.addEventListener('open', () => {
			console.log('Discord Gateway WebSocket open');
		});

		ws.addEventListener('message', (event) => {
			this.ctx.waitUntil(this.handleGatewayMessage(event.data as string));
		});

		ws.addEventListener('close', (event) => {
			console.log(`Discord Gateway closed: ${event.code} ${event.reason}`);
			this.socket = null;
			this.state.ready = false;
			this.ctx.waitUntil(this.saveState().then(() => this.scheduleReconnect()));
		});

		ws.addEventListener('error', (event) => {
			console.error('Discord Gateway WebSocket error:', event);
		});
	}

	private async connect(): Promise<void> {
		if (!this.env.DISCORD_BOT_TOKEN) {
			throw new Error('DISCORD_BOT_TOKEN not configured');
		}

		if (this.socket && this.socket.readyState === WebSocket.OPEN) return;

		const gateway = await getGatewayBotUrl(this.env.DISCORD_BOT_TOKEN);
		const url = `${gateway.url}/?v=${GATEWAY_VERSION}&encoding=json`;
		const ws = new WebSocket(url);
		this.socket = ws;
		this.attachSocketHandlers(ws);
	}

	private async handleGatewayMessage(raw: string): Promise<void> {
		const payload = JSON.parse(raw) as GatewayPayload;

		if (payload.s != null) {
			this.state.sequence = payload.s;
		}

		switch (payload.op) {
			case GatewayOpcode.HELLO: {
				const hello = payload.d as GatewayHello;
				this.state.heartbeatInterval = hello.heartbeat_interval;
				if (this.state.sessionId) {
					await this.resume();
				} else {
					await this.identify();
				}
				this.scheduleHeartbeat();
				break;
			}
			case GatewayOpcode.HEARTBEAT:
				this.sendOpcode(GatewayOpcode.HEARTBEAT, this.state.sequence);
				break;
			case GatewayOpcode.HEARTBEAT_ACK:
				break;
			case GatewayOpcode.RECONNECT:
				this.socket?.close(4000, 'Discord requested reconnect');
				break;
			case GatewayOpcode.INVALID_SESSION: {
				const canResume = Boolean(payload.d);
				if (!canResume) {
					this.state.sessionId = null;
					this.state.sequence = 0;
				}
				this.socket?.close(4001, 'Invalid session');
				break;
			}
			case GatewayOpcode.DISPATCH:
				await this.handleDispatch(payload.t, payload.d);
				this.state.lastEventAt = new Date().toISOString();
				this.state.reconnectAttempts = 0;
				await this.saveState();
				break;
		}
	}

	private async handleDispatch(event: string | undefined, data: unknown): Promise<void> {
		if (!event || !data) return;

		switch (event) {
			case 'READY': {
				const ready = data as { session_id: string };
				this.state.sessionId = ready.session_id;
				this.state.ready = true;
				console.log('Discord Gateway READY');
				break;
			}
			case 'GUILD_MEMBER_ADD':
				await this.handleGuildMemberAdd(data as { guild_id: string; user: { id: string; username: string } });
				break;
			case 'MESSAGE_CREATE':
				await this.handleMessageCreate(data as DiscordMessage);
				break;
		}
	}

	private async handleGuildMemberAdd(data: {
		guild_id: string;
		user: { id: string; username: string };
	}): Promise<void> {
		const config = await getGuildConfig(this.env.STFC_DB, data.guild_id);
		if (!config?.verification_enabled) return;

		await recordGuildMember(this.env.STFC_DB, data.guild_id, data.user.id, data.user.username);
		await inviteNewMember(this.env, data.guild_id, data.user.id, data.user.username);
		await markMemberInvited(this.env.STFC_DB, data.guild_id, data.user.id);
	}

	private async handleMessageCreate(message: DiscordMessage): Promise<void> {
		// MESSAGE_CREATE in DMs may not include channel type — fetch if guild_id absent
		if (message.guild_id) return;

		// DM channels have no guild_id on the message
		await handleDirectMessage(this.env, message);
	}

	async ensureConnected(): Promise<{ ready: boolean; lastEventAt: string | null }> {
		await this.loadState();
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
			await this.connect();
		}
		this.scheduleHeartbeat();
		return { ready: this.state.ready, lastEventAt: this.state.lastEventAt };
	}

	async getStatus(): Promise<GatewayState & { socketOpen: boolean }> {
		await this.loadState();
		return {
			...this.state,
			socketOpen: this.socket?.readyState === WebSocket.OPEN,
		};
	}

	async alarm(): Promise<void> {
		await this.loadState();

		if (this.socket?.readyState === WebSocket.OPEN) {
			this.sendOpcode(GatewayOpcode.HEARTBEAT, this.state.sequence);
			this.scheduleHeartbeat();
			return;
		}

		try {
			await this.connect();
			this.scheduleHeartbeat();
		} catch (error) {
			console.error('Gateway reconnect failed:', error);
			await this.saveState();
			this.scheduleReconnect();
		}
	}
}
