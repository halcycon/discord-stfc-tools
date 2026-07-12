import { handleDiscordInteraction } from './discord-handlers';
import { handleCoordinateLookup, loadSystemData } from './systemUtils';
import { parseCSV, autoGenerateColumns, generateAsciiTable } from './tableUtils';
import { handleScheduledEvent } from './cron';
import { wakeDiscordGateway, getDiscordGatewayStatus } from './discord-gateway/wake';
import { getStfcSessionStatus } from './stfc-session';
import { findPlayerByIdOrName, scrapeAllianceById } from './stfc-utils';
import { getGuildConfig, listConfiguredGuilds } from './guild-db';
import { syncGuildAllianceRoster } from './alliance-roster-sync';
import { handleAgreementBackfillContinue } from './agreement';

export { DiscordGateway } from './discord-gateway/DiscordGateway';
export { StfcSession } from './stfc-session/StfcSession';

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/discord' && request.method === 'POST') {
			// Keep Gateway WebSocket alive when Discord interaction traffic arrives.
			// (Cron also keeps it running; limiting wake reduces cross-test Durable Object noise.)
			if (env.DISCORD_GATEWAY && env.DISCORD_BOT_TOKEN) {
				ctx.waitUntil(
					wakeDiscordGateway(env).catch((err) => {
						console.error('Gateway wake failed (non-fatal):', err);
					}),
				);
			}
			return handleDiscordInteraction(request, env, ctx);
		}

		if (url.pathname === '/internal/agreement-backfill' && request.method === 'POST') {
			return handleAgreementBackfillContinue(request, env, ctx);
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

		if (url.pathname === '/stfc-session/status' && request.method === 'GET') {
			const status = await getStfcSessionStatus(env);
			return Response.json(status ?? { error: 'STFC_SESSION binding not configured' });
		}

		// Diagnostic: HTML profile lookup using guild server/region (numeric ID preferred).
		if (url.pathname === '/stfc-session/ping' && request.method === 'GET') {
			try {
				const guilds = await listConfiguredGuilds(env.STFC_DB);
				const defaultGuild = guilds[0];
				const server = Number(url.searchParams.get('server') || defaultGuild?.stfc_server || 0);
				const region = (url.searchParams.get('region') || defaultGuild?.stfc_region || 'US').toUpperCase();
				const search = url.searchParams.get('search') || '3563194597';
				if (!server) {
					return Response.json(
						{ ok: false, error: 'No stfc_server configured (run /server setup or pass ?server=)' },
						{ status: 400 },
					);
				}

				const started = Date.now();
				const searchTerm = /^\d+$/.test(search) ? Number(search) : search;
				const player = await findPlayerByIdOrName(env, searchTerm, server, region);
				const lookupMs = Date.now() - started;

				return Response.json(
					{
						ok: Boolean(player),
						lookupMs,
						path: 'html-first-for-numeric-ids',
						guildDefault: defaultGuild
							? {
									guild_id: defaultGuild.guild_id,
									stfc_server: defaultGuild.stfc_server,
									stfc_region: defaultGuild.stfc_region,
									alliance_tag: defaultGuild.alliance_tag,
								}
							: null,
						query: { server, region, search: searchTerm },
						lookup: player
							? {
									found: true,
									playerId: player.playerId,
									name: player.name,
									tag: player.allianceTag,
									rank: player.rank,
									level: player.level,
									power: player.power,
									server: player.server,
									region: player.region,
								}
							: { found: false },
					},
					{ headers: { 'Cache-Control': 'no-store' } },
				);
			} catch (error) {
				return Response.json(
					{ ok: false, error: error instanceof Error ? error.message : String(error) },
					{ status: 500, headers: { 'Cache-Control': 'no-store' } },
				);
			}
		}

		// Diagnostic: scrape alliance HTML roster (optionally persist to D1 for a guild).
		if (url.pathname === '/alliance-roster/ping' && request.method === 'GET') {
			try {
				const guildId = url.searchParams.get('guild_id') || undefined;
				const persist = url.searchParams.get('persist') === '1';
				const config = guildId ? await getGuildConfig(env.STFC_DB, guildId) : null;
				const guilds = config ? [config] : await listConfiguredGuilds(env.STFC_DB);
				const guild = guilds.find((g) => g.mode === 'single_alliance' && g.alliance_tag) ?? guilds[0];

				if (persist) {
					if (!guild) {
						return Response.json({ ok: false, error: 'No configured guild' }, { status: 400 });
					}
					if (guild.mode !== 'single_alliance' || !guild.alliance_tag) {
						return Response.json(
							{
								ok: false,
								error: 'Alliance roster persist is only for single_alliance guilds',
								guild_id: guild.guild_id,
								mode: guild.mode,
							},
							{ status: 400 },
						);
					}
					const started = Date.now();
					const result = await syncGuildAllianceRoster(env, guild);
					return Response.json(
						{
							ok: result.ok,
							persist: true,
							ms: Date.now() - started,
							guild_id: guild.guild_id,
							...(result.ok
								? {
										allianceId: result.scrape.allianceId,
										allianceTag: result.scrape.allianceTag,
										playerCount: result.scrape.players.length,
										sample: result.scrape.players.slice(0, 3).map((p) => ({
											playerId: p.playerId,
											name: p.name,
											rank: p.rank,
											level: p.level,
											power: p.power,
										})),
									}
								: { reason: result.reason }),
						},
						{ headers: { 'Cache-Control': 'no-store' } },
					);
				}

				const allianceId =
					url.searchParams.get('alliance_id') ||
					guild?.stfc_alliance_id ||
					'2990767785';
				const server = Number(url.searchParams.get('server') || guild?.stfc_server || 108);
				const region = (url.searchParams.get('region') || guild?.stfc_region || 'EU').toUpperCase();
				const started = Date.now();
				const scrape = await scrapeAllianceById(allianceId, server, region);
				return Response.json(
					{
						ok: Boolean(scrape?.players.length),
						ms: Date.now() - started,
						query: { allianceId, server, region },
						scrape: scrape
							? {
									allianceId: scrape.allianceId,
									allianceTag: scrape.allianceTag,
									allianceName: scrape.allianceName,
									playerCount: scrape.players.length,
									sample: scrape.players.slice(0, 3).map((p) => ({
										playerId: p.playerId,
										name: p.name,
										rank: p.rank,
										level: p.level,
										power: p.power,
									})),
								}
							: null,
					},
					{ headers: { 'Cache-Control': 'no-store' } },
				);
			} catch (error) {
				return Response.json(
					{ ok: false, error: error instanceof Error ? error.message : String(error) },
					{ status: 500, headers: { 'Cache-Control': 'no-store' } },
				);
			}
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
- GET /stfc-session/status — Anonymous stfc.pro session / token cache status
- GET /stfc-session/ping — HTML player lookup smoke test
- GET /alliance-roster/ping — Alliance HTML roster scrape smoke test (?persist=1&guild_id=…)

Discord commands:
- /lookup, /table, /tablehelp — coordinate lookup and tables
- /player — stfc.pro player lookup (requires /server setup)
- /verify — verify your STFC account
- /server setup|status — guild configuration (admin)

Scheduled jobs:
- */5 * * * * — wake Gateway + member poll fallback
- 0 */6 * * * — re-check guest verifications (alliance tag polling)
- 0 6 * * * — daily ops/power/alliance sync
- 30 * * * * — demotion recheck queue (YOLO missing-player delay)
`,
			{ headers: { 'Content-Type': 'text/plain' } },
		);
	},

	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(handleScheduledEvent(env, controller.cron));
	},
} satisfies ExportedHandler<Env>;
