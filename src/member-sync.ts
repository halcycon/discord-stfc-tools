import { listAllGuildMembers } from './discord-api';
import { getKnownMemberIds, listConfiguredGuilds, markMemberInvited, recordGuildMember } from './guild-db';
import { inviteNewMember } from './verification';

export async function syncGuildMembers(env: Env): Promise<void> {
	if (!env.DISCORD_BOT_TOKEN) {
		console.warn('DISCORD_BOT_TOKEN not set — skipping member sync');
		return;
	}

	const guilds = await listConfiguredGuilds(env.STFC_DB);
	const token = env.DISCORD_BOT_TOKEN;

	for (const config of guilds) {
		if (!config.verification_enabled) continue;

		try {
			const knownIds = await getKnownMemberIds(env.STFC_DB, config.guild_id);
			const members = await listAllGuildMembers(token, config.guild_id);

			for (const member of members) {
				const userId = member.user.id;
				const username = member.user.username;

				if (!knownIds.has(userId)) {
					await recordGuildMember(env.STFC_DB, config.guild_id, userId, username);
					await inviteNewMember(env, config.guild_id, userId, username);
					await markMemberInvited(env.STFC_DB, config.guild_id, userId);
					console.log(`New member ${username} (${userId}) in guild ${config.guild_id} — verification invited`);
				}
			}
		} catch (error) {
			console.error(`Member sync failed for guild ${config.guild_id}:`, error);
		}
	}
}
