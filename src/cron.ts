import {
	listConfiguredGuilds,
	listActiveVerifiedPlayers,
	cancelDemotionQueueEntry,
	getGuildConfig,
} from './guild-db';
import { lookupPlayerByIdOrName } from './stfc-utils';
import { syncVerifiedPlayer } from './verification';
import { playerMatchesGuildAlliance } from './verification-access';
import { runDemotionRecheck } from './demotion-policy';
import { syncGuildMembers } from './member-sync';
import { wakeDiscordGateway } from './discord-gateway/wake';
import { AuditColor, postAuditLog } from './audit-log';
import { listSurveysDueToClose, updateSurvey } from './survey-db';
import { sendChannelMessage } from './discord-api';
import { formatSurveyDeliveryTitle } from './survey-service';
import { lookupPlayerFromAllianceRoster } from './alliance-roster-sync';
import {
	continueDailyPlayerSync,
	runDailyPlayerSync,
} from './daily-player-sync';

export { runDailyPlayerSync, continueDailyPlayerSync } from './daily-player-sync';

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
						{ autoDemoteOnMismatch: false, deferSyncAudit: true },
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

export async function runCloseExpiredSurveys(env: Env): Promise<void> {
	const due = await listSurveysDueToClose(env.STFC_DB);
	if (!due.length) return;

	const closedAt = new Date().toISOString();
	for (const survey of due) {
		await updateSurvey(env.STFC_DB, survey.id, {
			status: 'closed',
			closed_at: closedAt,
		});

		const config = await getGuildConfig(env.STFC_DB, survey.guild_id);
		const title = formatSurveyDeliveryTitle(survey, 'en');
		if (env.DISCORD_BOT_TOKEN && survey.log_channel_id) {
			try {
				await sendChannelMessage(
					env.DISCORD_BOT_TOKEN,
					survey.log_channel_id,
					`🔒 **Survey #${survey.id} closed** (auto) — ${title}`,
				);
			} catch (err) {
				console.error(`Survey ${survey.id} close log failed:`, err);
			}
		}
		if (config) {
			await postAuditLog(env, config, {
				title: 'Survey auto-closed',
				description: `Survey #${survey.id} — ${title}`,
				source: 'cron',
				color: AuditColor.warn,
			});
		}
	}

	console.log(`Cron: auto-closed ${due.length} survey(s)`);
}

export async function handleScheduledEvent(
	env: Env,
	cron: string,
	ctx?: ExecutionContext,
): Promise<void> {
	await wakeDiscordGateway(env);

	switch (cron) {
		case '*/5 * * * *':
			await runMemberPoll(env);
			await runCloseExpiredSurveys(env);
			await continueDailyPlayerSync(env, ctx);
			break;
		case '0 */6 * * *':
			await runPendingVerificationPoll(env);
			break;
		case '0 6 * * *':
			await runDailyPlayerSync(env, { startFresh: true, ctx });
			break;
		case '30 * * * *':
			await runDemotionRecheck(env);
			break;
		default:
			console.log(`Unknown cron: ${cron}`);
	}
}
