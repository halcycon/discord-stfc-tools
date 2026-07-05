import { listConfiguredGuilds, listActiveVerifiedPlayers, recordPlayerStats } from './guild-db';
import { findPlayerByIdOrName } from './stfc-utils';
import { syncVerifiedPlayer } from './verification';
import { syncGuildMembers } from './member-sync';
import { wakeDiscordGateway } from './discord-gateway/wake';

export async function runMemberPoll(env: Env): Promise<void> {
	console.log('Cron: member poll starting');
	await wakeDiscordGateway(env);
	// REST poll remains as fallback when Gateway is disconnected
	await syncGuildMembers(env);
	console.log('Cron: member poll complete');
}

export async function runPendingVerificationPoll(env: Env): Promise<void> {
	console.log('Cron: pending verification poll starting');

	const guilds = await listConfiguredGuilds(env.STFC_DB);

	for (const config of guilds) {
		if (config.mode !== 'single_alliance' || !config.alliance_tag) continue;

		const players = await listActiveVerifiedPlayers(env.STFC_DB, config.guild_id);

		for (const record of players) {
			if (record.verification_status !== 'guest' || !record.player_id) continue;

			try {
				const player = await findPlayerByIdOrName(record.player_id, config.stfc_server, config.stfc_region);
				if (!player) continue;

				const matches = player.allianceTag.toUpperCase() === config.alliance_tag!.toUpperCase();
				if (matches) {
					await syncVerifiedPlayer(env, config, config.guild_id, record.discord_user_id, player);
					console.log(`Guest ${record.discord_user_id} now matches alliance ${config.alliance_tag}`);
				}
			} catch (error) {
				console.error(`Pending verification check failed for ${record.discord_user_id}:`, error);
			}
		}
	}

	console.log('Cron: pending verification poll complete');
}

export async function runDailyPlayerSync(env: Env): Promise<void> {
	console.log('Cron: daily player sync starting');

	const guilds = await listConfiguredGuilds(env.STFC_DB);

	for (const config of guilds) {
		const players = await listActiveVerifiedPlayers(env.STFC_DB, config.guild_id);

		for (const record of players) {
			if (!record.player_id) continue;

			try {
				const player = await findPlayerByIdOrName(record.player_id, config.stfc_server, config.stfc_region);
				if (!player) continue;

				const prevTag = record.alliance_tag;
				const tagChanged = prevTag && player.allianceTag && prevTag !== player.allianceTag;

				await syncVerifiedPlayer(env, config, config.guild_id, record.discord_user_id, player);
				await recordPlayerStats(env.STFC_DB, record.id, player.level, player.power, player.allianceTag);

				if (tagChanged) {
					console.log(
						`Alliance change: ${record.player_name} ${prevTag} → ${player.allianceTag} (guild ${config.guild_id})`,
					);
				}
			} catch (error) {
				console.error(`Daily sync failed for player ${record.player_id}:`, error);
			}
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
		default:
			console.log(`Unknown cron: ${cron}`);
	}
}
