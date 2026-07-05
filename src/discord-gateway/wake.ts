/** Ensure the Discord Gateway Durable Object WebSocket is connected. */
export async function wakeDiscordGateway(env: Env): Promise<{ ready: boolean; lastEventAt: string | null } | null> {
	if (!env.DISCORD_GATEWAY || !env.DISCORD_BOT_TOKEN) return null;
	const stub = env.DISCORD_GATEWAY.get(env.DISCORD_GATEWAY.idFromName('main'));
	return stub.ensureConnected();
}

export async function getDiscordGatewayStatus(env: Env) {
	if (!env.DISCORD_GATEWAY) return null;
	const stub = env.DISCORD_GATEWAY.get(env.DISCORD_GATEWAY.idFromName('main'));
	return stub.getStatus();
}
