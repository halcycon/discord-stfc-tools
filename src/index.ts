import { handleDiscordInteraction } from './discord-handlers';
import { handleCoordinateLookup, loadSystemData } from './systemUtils';
import { parseCSV, autoGenerateColumns, generateAsciiTable } from './tableUtils';
import { handleScheduledEvent } from './cron';
import { wakeDiscordGateway, getDiscordGatewayStatus } from './discord-gateway/wake';
import { getStfcSessionStatus } from './stfc-session';
import { findPlayerByIdOrName, scrapeAllianceById, scrapeServerAlliances } from './stfc-utils';
import { getGuildConfig } from './guild-db';
import {
	isMultiAllianceGuild,
	syncGuildAllianceRoster,
} from './alliance-roster-sync';
import { runAllianceResync } from './alliance-resync';
import { handleAgreementBackfillContinue } from './agreement';
import { handleAdminApi } from './admin-api';

export { DiscordGateway } from './discord-gateway/DiscordGateway';
export { StfcSession } from './stfc-session/StfcSession';

function requireBotOrAdminSecret(request: Request, env: Env): boolean {
	const auth = request.headers.get('Authorization') || '';
	if (env.DISCORD_BOT_TOKEN && auth === `Bot ${env.DISCORD_BOT_TOKEN}`) return true;
	if (env.ADMIN_SESSION_SECRET && auth === `Bearer ${env.ADMIN_SESSION_SECRET}`) return true;
	return false;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname.startsWith('/api/admin')) {
			return handleAdminApi(request, env, ctx);
		}

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

		if (url.pathname === '/internal/daily-sync-continue' && request.method === 'POST') {
			const { handleDailySyncContinue } = await import('./daily-player-sync');
			return handleDailySyncContinue(request, env, ctx);
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
			if (!requireBotOrAdminSecret(request, env)) {
				return Response.json({ error: 'Unauthorized' }, { status: 401 });
			}
			const result = await wakeDiscordGateway(env);
			return Response.json(result ?? { error: 'Gateway not configured' });
		}

		if (url.pathname === '/stfc-session/status' && request.method === 'GET') {
			const status = await getStfcSessionStatus(env);
			return Response.json(status ?? { error: 'STFC_SESSION binding not configured' });
		}

		// Diagnostic: HTML profile lookup — requires explicit ?server=&region=&search=
		if (url.pathname === '/stfc-session/ping' && request.method === 'GET') {
			try {
				const serverRaw = url.searchParams.get('server');
				const regionRaw = url.searchParams.get('region');
				const search = url.searchParams.get('search')?.trim() || '';
				const server = Number(serverRaw);
				const region = (regionRaw || '').toUpperCase();
				if (!serverRaw || !Number.isFinite(server) || server <= 0 || !region || !search) {
					return Response.json(
						{
							ok: false,
							error: 'Required query params: server, region, search (numeric player id preferred)',
							example:
								'/stfc-session/ping?server=108&region=EU&search=1234567890',
						},
						{ status: 400, headers: { 'Cache-Control': 'no-store' } },
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
				if (persist && !requireBotOrAdminSecret(request, env)) {
					return Response.json({ error: 'Unauthorized — persist requires Bot or Bearer ADMIN_SESSION_SECRET' }, { status: 401 });
				}

				if (persist) {
					if (!guildId) {
						return Response.json(
							{
								ok: false,
								error: 'persist=1 requires guild_id=',
								example: '/alliance-roster/ping?persist=1&guild_id=…',
							},
							{ status: 400, headers: { 'Cache-Control': 'no-store' } },
						);
					}
					const guild = await getGuildConfig(env.STFC_DB, guildId);
					if (!guild) {
						return Response.json({ ok: false, error: 'Guild not configured' }, { status: 400 });
					}
					const started = Date.now();
					if (isMultiAllianceGuild(guild)) {
						const result = await runAllianceResync(env, guild, {
							source: 'system',
							postAudit: false,
							fullSync: true,
						});
						if (!result.ok) {
							return Response.json(
								{
									ok: false,
									persist: true,
									mode: 'multi_alliance',
									ms: Date.now() - started,
									guild_id: guild.guild_id,
									reason: result.error,
								},
								{ headers: { 'Cache-Control': 'no-store' } },
							);
						}
						if (result.mode !== 'multi_alliance') {
							return Response.json(
								{
									ok: false,
									persist: true,
									reason: 'unexpected resync mode',
									guild_id: guild.guild_id,
								},
								{ status: 500, headers: { 'Cache-Control': 'no-store' } },
							);
						}
						return Response.json(
							{
								ok: true,
								persist: true,
								mode: 'multi_alliance',
								ms: Date.now() - started,
								guild_id: guild.guild_id,
								directoryCount: result.directoryCount,
								trackedTags: result.trackedTags,
								scrapedAlliances: result.scrapedAlliances,
								skippedTags: result.skippedTags,
								failedTags: result.failedTags,
								tagRenames: result.tagRenames,
								remapped: result.remapped,
								rebalanced: result.rebalanced,
								remapErrors: result.remapErrors,
							},
							{ headers: { 'Cache-Control': 'no-store' } },
						);
					}
					if (guild.mode !== 'single_alliance' || !guild.alliance_tag) {
						return Response.json(
							{
								ok: false,
								error: 'Persist needs single_alliance (with tag) or multi_alliance',
								guild_id: guild.guild_id,
								mode: guild.mode,
							},
							{ status: 400 },
						);
					}
					const result = await syncGuildAllianceRoster(env, guild);
					return Response.json(
						{
							ok: result.ok,
							persist: true,
							mode: 'single_alliance',
							ms: Date.now() - started,
							guild_id: guild.guild_id,
							...(result.ok
								? {
										allianceId: result.scrape.allianceId,
										allianceTag: result.scrape.allianceTag,
										playerCount: result.scrape.players.length,
										diff: {
											isInitial: result.diff.isInitial,
											joined: result.diff.joined.length,
											left: result.diff.left.length,
											tagMoved: result.diff.tagMoved.length,
											opsUp: result.diff.opsUp.length,
											opsDown: result.diff.opsDown.length,
											rankChanged: result.diff.rankChanged.length,
											renamed: result.diff.renamed.length,
										},
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

				const serverOnly = url.searchParams.get('server_directory') === '1';
				if (serverOnly) {
					const serverRaw = url.searchParams.get('server');
					const regionRaw = url.searchParams.get('region');
					const server = Number(serverRaw);
					const region = (regionRaw || '').toUpperCase();
					if (!serverRaw || !Number.isFinite(server) || server <= 0 || !region) {
						return Response.json(
							{
								ok: false,
								error: 'Required query params: server, region',
								example: '/alliance-roster/ping?server_directory=1&server=108&region=EU',
							},
							{ status: 400, headers: { 'Cache-Control': 'no-store' } },
						);
					}
					const started = Date.now();
					const directory = await scrapeServerAlliances(server, region);
					return Response.json(
						{
							ok: directory.length > 0,
							ms: Date.now() - started,
							query: { server, region },
							count: directory.length,
							sample: directory.slice(0, 5),
						},
						{ headers: { 'Cache-Control': 'no-store' } },
					);
				}

				const allianceId = url.searchParams.get('alliance_id')?.trim() || '';
				const serverRaw = url.searchParams.get('server');
				const regionRaw = url.searchParams.get('region');
				const server = Number(serverRaw);
				const region = (regionRaw || '').toUpperCase();
				if (
					!allianceId ||
					!serverRaw ||
					!Number.isFinite(server) ||
					server <= 0 ||
					!region
				) {
					return Response.json(
						{
							ok: false,
							error: 'Required query params: alliance_id, server, region',
							example:
								'/alliance-roster/ping?alliance_id=123&server=108&region=EU',
						},
						{ status: 400, headers: { 'Cache-Control': 'no-store' } },
					);
				}
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
- GET /stfc-session/ping — HTML player lookup (?server=&region=&search= required)
- GET /alliance-roster/ping — Alliance HTML scrape (?alliance_id=&server=&region= required; ?persist=1&guild_id=…)

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
		ctx.waitUntil(handleScheduledEvent(env, controller.cron, ctx));
	},
} satisfies ExportedHandler<Env>;
