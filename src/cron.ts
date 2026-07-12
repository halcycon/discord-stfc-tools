import {
	listConfiguredGuilds,
	listActiveVerifiedPlayers,
	recordPlayerStats,
	cancelDemotionQueueEntry,
} from './guild-db';
import { lookupPlayerByIdOrName } from './stfc-utils';
import { syncVerifiedPlayer } from './verification';
import { playerMatchesGuildAlliance } from './verification-access';
import {
	handleAutomatedDemotionCandidate,
	postDemotionApprovalDigest,
	runDemotionRecheck,
} from './demotion-policy';
import { syncGuildMembers } from './member-sync';
import { wakeDiscordGateway } from './discord-gateway/wake';
import { AuditColor, postAuditLog } from './audit-log';
import {
	loadRosterPlayerMap,
	lookupPlayerFromAllianceRoster,
	shouldUseAllianceRoster,
	syncGuildAllianceRoster,
} from './alliance-roster-sync';
import type { PlayerData } from './types';

export async function runMemberPoll(env: Env): Promise<void> {
	console.log('Cron: member poll starting');
	await wakeDiscordGateway(env);
	await syncGuildMembers(env);
	try {
		const { cleanupStaleDmSessions } = await import('./guild-db');
		const n = await cleanupStaleDmSessions(env.STFC_DB);
		if (n > 0) console.log(`Cron: cleaned ${n} stale DM sessions`);
	} catch (err) {
		console.error('DM session cleanup failed (non-fatal):', err);
	}
	console.log('Cron: member poll complete');
}

export async function runPendingVerificationPoll(env: Env): Promise<void> {
	console.log('Cron: pending verification poll starting');

	const guilds = await listConfiguredGuilds(env.STFC_DB);

	for (const config of guilds) {
		if (config.mode !== 'single_alliance' || !config.alliance_tag) continue;

		const players = await listActiveVerifiedPlayers(env.STFC_DB, config.guild_id);
		let promoted = 0;

		for (const record of players) {
			if (record.verification_status !== 'guest' || !record.player_id) continue;

			try {
				const fromRoster = await lookupPlayerFromAllianceRoster(env, config, record.player_id);
				const player =
					fromRoster ??
					(await (async () => {
						const lookup = await lookupPlayerByIdOrName(
							env,
							record.player_id!,
							config.stfc_server,
							config.stfc_region,
						);
						return lookup.status === 'ok' ? lookup.player : null;
					})());
				if (!player) continue;

				if (playerMatchesGuildAlliance(config, player.allianceTag)) {
					await syncVerifiedPlayer(
						env,
						config,
						config.guild_id,
						record.discord_user_id,
						player,
						{ autoDemoteOnMismatch: false },
					);
					await cancelDemotionQueueEntry(
						env.STFC_DB,
						config.guild_id,
						record.discord_user_id,
					);
					promoted++;
					console.log(`Guest ${record.discord_user_id} now matches alliance ${config.alliance_tag}`);
				}
			} catch (error) {
				console.error(`Pending verification check failed for ${record.discord_user_id}:`, error);
			}
		}

		if (promoted > 0) {
			await postAuditLog(env, config, {
				title: 'Guest re-check complete',
				description: `Promoted **${promoted}** guest(s) to active (alliance match).`,
				source: 'cron',
				color: AuditColor.success,
			});
		}
	}

	console.log('Cron: pending verification poll complete');
}

export async function runDailyPlayerSync(env: Env): Promise<void> {
	console.log('Cron: daily player sync starting');

	const guilds = await listConfiguredGuilds(env.STFC_DB);

	for (const config of guilds) {
		const players = await listActiveVerifiedPlayers(env.STFC_DB, config.guild_id);
		let synced = 0;
		let failed = 0;
		let demoted = 0;
		let queued = 0;
		let unavailable = 0;
		let missing = 0;
		let tagChanges = 0;
		let rosterHits = 0;
		let liveLookups = 0;

		let rosterMap: Map<number, PlayerData> | null = null;
		let rosterOk = false;

		if (shouldUseAllianceRoster(config)) {
			const rosterResult = await syncGuildAllianceRoster(env, config);
			if (rosterResult.ok) {
				rosterOk = true;
				rosterMap = await loadRosterPlayerMap(env, config);
				await postAuditLog(env, config, {
					title: 'Alliance roster scraped',
					description:
						`Cached **${rosterResult.scrape.players.length}** members` +
						` for **${rosterResult.scrape.allianceTag || config.alliance_tag}**` +
						` (id \`${config.stfc_alliance_id ?? rosterResult.scrape.allianceId}\`).`,
					source: 'cron',
					color: AuditColor.info,
				});
			} else {
				console.warn(
					`Alliance roster scrape failed for guild ${config.guild_id}: ${rosterResult.reason} — falling back to per-player lookups`,
				);
			}
		}

		for (const record of players) {
			if (!record.player_id) continue;

			try {
				let player: PlayerData | null = null;
				let notFound = false;
				let error = false;

				if (rosterMap) {
					player = rosterMap.get(record.player_id) ?? null;
					if (player) {
						rosterHits++;
					} else if (rosterOk && config.mode === 'single_alliance') {
						// Fresh scrape succeeded and player is not on the alliance page → left / wrong tag.
						notFound = true;
					}
				}

				if (!player && !notFound) {
					liveLookups++;
					const lookup = await lookupPlayerByIdOrName(
						env,
						record.player_id,
						config.stfc_server,
						config.stfc_region,
					);
					if (lookup.status === 'error') {
						unavailable++;
						continue;
					}
					if (lookup.status === 'not_found') {
						notFound = true;
					} else {
						player = lookup.player;
					}
				}

				if (notFound || !player) {
					missing++;
					if (config.mode === 'single_alliance') {
						const result = await handleAutomatedDemotionCandidate(
							env,
							config,
							record,
							rosterOk ? 'alliance_mismatch' : 'player_missing',
							null,
						);
						if (result === 'demoted') demoted++;
						else if (result === 'queued') queued++;
					}
					continue;
				}

				const prevTag = record.alliance_tag;
				const tagChanged = prevTag && player.allianceTag && prevTag !== player.allianceTag;
				const matches = playerMatchesGuildAlliance(config, player.allianceTag);

				if (!matches && config.mode === 'single_alliance') {
					const result = await handleAutomatedDemotionCandidate(
						env,
						config,
						record,
						'alliance_mismatch',
						player,
					);
					if (result === 'demoted') demoted++;
					else if (result === 'queued') queued++;
					if (tagChanged) tagChanges++;
					continue;
				}

				await syncVerifiedPlayer(
					env,
					config,
					config.guild_id,
					record.discord_user_id,
					player,
					{ autoDemoteOnMismatch: false },
				);
				await recordPlayerStats(
					env.STFC_DB,
					record.id,
					player.level,
					player.power,
					player.allianceTag,
				);
				await cancelDemotionQueueEntry(
					env.STFC_DB,
					config.guild_id,
					record.discord_user_id,
				);
				synced++;

				if (tagChanged) {
					tagChanges++;
					console.log(
						`Alliance change: ${record.player_name} ${prevTag} → ${player.allianceTag} (guild ${config.guild_id})`,
					);
				}
			} catch (error) {
				failed++;
				console.error(`Daily sync failed for player ${record.player_id}:`, error);
			}
		}

		await postDemotionApprovalDigest(env, config);

		if (
			synced > 0 ||
			failed > 0 ||
			demoted > 0 ||
			queued > 0 ||
			unavailable > 0 ||
			missing > 0 ||
			rosterHits > 0
		) {
			await postAuditLog(env, config, {
				title: 'Daily player sync complete',
				description:
					`Synced **${synced}**` +
					(rosterHits ? ` · **${rosterHits}** from alliance roster` : '') +
					(liveLookups ? ` · **${liveLookups}** live stfc.pro` : '') +
					(failed ? ` · **${failed}** failed` : '') +
					(demoted ? ` · **${demoted}** demoted` : '') +
					(queued ? ` · **${queued}** queued for demotion` : '') +
					(missing ? ` · **${missing}** missing / left alliance` : '') +
					(unavailable ? ` · **${unavailable}** stfc.pro unavailable (skipped)` : '') +
					(tagChanges ? ` · **${tagChanges}** alliance change(s)` : '') +
					` · policy **${config.demotion_policy}**`,
				source: 'cron',
				color: failed || demoted || unavailable ? AuditColor.warn : AuditColor.info,
			});
		}
	}

	console.log('Cron: daily player sync complete');
}

export async function handleScheduledEvent(env: Env, cron: string): Promise<void> {
	await wakeDiscordGateway(env);

	switch (cron) {
		case '*/5 * * * *':
			await runMemberPoll(env);
			break;
		case '0 */6 * * *':
			await runPendingVerificationPoll(env);
			break;
		case '0 6 * * *':
			await runDailyPlayerSync(env);
			break;
		case '30 * * * *':
			await runDemotionRecheck(env);
			break;
		default:
			console.log(`Unknown cron: ${cron}`);
	}
}
