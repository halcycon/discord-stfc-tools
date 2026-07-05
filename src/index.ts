import { handleDiscordInteraction } from './discord-handlers';
import { handleCoordinateLookup, loadSystemData } from './systemUtils';
import { parseCSV, autoGenerateColumns, generateAsciiTable } from './tableUtils';
import { handleScheduledEvent } from './cron';
import { wakeDiscordGateway, getDiscordGatewayStatus } from './discord-gateway/wake';

export { DiscordGateway } from './discord-gateway/DiscordGateway';

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Keep Gateway WebSocket alive (Durable Object singleton)
		if (env.DISCORD_GATEWAY && env.DISCORD_BOT_TOKEN) {
			ctx.waitUntil(wakeDiscordGateway(env));
		}

		if (url.pathname === '/discord' && request.method === 'POST') {
			return handleDiscordInteraction(request, env, ctx);
		}

		if (url.pathname === '/lookup' && request.method === 'POST') {
			const body = await request.json() as { message: string };
			return Response.json({ result: handleCoordinateLookup(body.message) });
		}

		if (url.pathname === '/lookup' && request.method === 'GET') {
			const message = url.searchParams.get('message');
			if (!message) return new Response('Missing message parameter', { status: 400 });
			return new Response(handleCoordinateLookup(message), {
				headers: { 'Content-Type': 'text/plain' },
			});
		}

		if (url.pathname === '/table' && request.method === 'POST') {
			try {
				const body = await request.json() as { csv: string };
				const tableData = parseCSV(body.csv);
				const columns = autoGenerateColumns(tableData);
				return new Response(generateAsciiTable(tableData, columns), {
					headers: { 'Content-Type': 'text/plain' },
				});
			} catch (error) {
				return new Response(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, {
					status: 400,
					headers: { 'Content-Type': 'text/plain' },
				});
			}
		}

		if (url.pathname === '/gateway/status' && request.method === 'GET') {
			const status = await getDiscordGatewayStatus(env);
			return Response.json(status ?? { error: 'DISCORD_GATEWAY binding not configured' });
		}

		if (url.pathname === '/gateway/wake' && request.method === 'POST') {
			const result = await wakeDiscordGateway(env);
			return Response.json(result ?? { error: 'Gateway not configured' });
		}

		if (url.pathname === '/systems' && request.method === 'GET') {
			try {
				const systems = loadSystemData();
				return Response.json({ count: systems.length, systems: systems.slice(0, 10) });
			} catch (error) {
				return Response.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
			}
		}

		return new Response(
			`STFC Tools Bot

Endpoints:
- POST /discord — Discord interactions webhook
- POST /lookup — Coordinate lookup API
- POST /table — ASCII table from CSV

- GET /gateway/status — Discord Gateway DO connection status
- POST /gateway/wake — Force Gateway reconnect

Discord commands:
- /lookup, /table, /tablehelp — coordinate lookup and tables
- /player — stfc.pro player lookup (requires /server setup)
- /verify — verify your STFC account
- /server setup|status — guild configuration (admin)

Scheduled jobs:
- */5 * * * * — wake Gateway + member poll fallback
- 0 */6 * * * — re-check guest verifications (alliance tag polling)
- 0 6 * * * — daily ops/power/alliance sync
`,
			{ headers: { 'Content-Type': 'text/plain' } },
		);
	},

	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(handleScheduledEvent(env, controller.cron));
	},
} satisfies ExportedHandler<Env>;
