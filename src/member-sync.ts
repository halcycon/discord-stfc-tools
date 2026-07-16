import { listAllGuildMembers } from './discord-api';
import {
	getExcludedUserIds,
	getKnownMemberIds,
	getMembersNeedingInvite,
	listConfiguredGuilds,
	markMemberInvited,
	recordGuildMember,
} from './guild-db';
import { inviteNewMember } from './verification';
import { shouldSkipOutboundDm } from './deploy-mode';
import { flushPendingWelcomeDms } from './welcome-dm';

export async function syncGuildMembers(env: Env): Promise<void> {
	if (!env.DISCORD_BOT_TOKEN) {
		console.warn('DISCORD_BOT_TOKEN not set — skipping member sync');
		return;
	}

	const guilds = await listConfiguredGuilds(env.STFC_DB);
	const token = env.DISCORD_BOT_TOKEN;

	for (const config of guilds) {
		if (shouldSkipOutboundDm(config)) {
			if (!config.verification_enabled) continue;
			console.log(
				`Member sync: skipping invite/welcome DMs for guild ${config.guild_id} (deploy_mode=testing)`,
			);
			// Still record new members so go-live can invite them, but do not DM.
			try {
				const knownIds = await getKnownMemberIds(env.STFC_DB, config.guild_id);
				const members = await listAllGuildMembers(token, config.guild_id);
				const excludedIds = await getExcludedUserIds(env.STFC_DB, config.guild_id);
				for (const member of members) {
					const userId = member.user.id;
					const username = member.user.username;
					if (knownIds.has(userId)) continue;
					await recordGuildMember(env.STFC_DB, config.guild_id, userId, username);
					if (member.user.bot || excludedIds.has(userId)) {
						await markMemberInvited(env.STFC_DB, config.guild_id, userId);
					}
				}
			} catch (error) {
				console.error(`Member sync (testing record-only) failed for guild ${config.guild_id}:`, error);
			}
			continue;
		}

		try {
			if (config.verification_enabled) {
				const excludedIds = await getExcludedUserIds(env.STFC_DB, config.guild_id);

				// First retry any previously-uninvited members (DM may have failed earlier).
				const needingInvite = await getMembersNeedingInvite(env.STFC_DB, config.guild_id);
				for (const record of needingInvite) {
					if (excludedIds.has(record.discord_user_id)) {
						await markMemberInvited(env.STFC_DB, config.guild_id, record.discord_user_id);
						continue;
					}
					const dm = await inviteNewMember(
						env,
						config.guild_id,
						record.discord_user_id,
						record.username ?? 'user',
					);
					if (dm.ok) {
						await markMemberInvited(env.STFC_DB, config.guild_id, record.discord_user_id);
					}
				}

				const knownIds = await getKnownMemberIds(env.STFC_DB, config.guild_id);
				const members = await listAllGuildMembers(token, config.guild_id);

				for (const member of members) {
					const userId = member.user.id;
					const username = member.user.username;

					// Discord bots never verify — don't invite or count as pending.
					if (member.user.bot) {
						if (!knownIds.has(userId)) {
							await recordGuildMember(env.STFC_DB, config.guild_id, userId, username);
							await markMemberInvited(env.STFC_DB, config.guild_id, userId);
						}
						continue;
					}

					if (excludedIds.has(userId)) {
						if (!knownIds.has(userId)) {
							await recordGuildMember(env.STFC_DB, config.guild_id, userId, username);
							await markMemberInvited(env.STFC_DB, config.guild_id, userId);
						}
						continue;
					}

					if (!knownIds.has(userId)) {
						await recordGuildMember(env.STFC_DB, config.guild_id, userId, username);
						const dm = await inviteNewMember(env, config.guild_id, userId, username);
						if (dm.ok) {
							await markMemberInvited(env.STFC_DB, config.guild_id, userId);
						}
						console.log(
							`New member ${username} (${userId}) in guild ${config.guild_id} — verification invited`,
						);
					}
				}
			}

			// Go-live / retry backlog: welcome DMs for full members who never got one.
			const welcome = await flushPendingWelcomeDms(env, config);
			if (welcome.sent || welcome.failed || welcome.remaining) {
				console.log(
					`Member sync welcome flush guild=${config.guild_id}: sent=${welcome.sent} failed=${welcome.failed} remaining=${welcome.remaining}`,
				);
			}
		} catch (error) {
			console.error(`Member sync failed for guild ${config.guild_id}:`, error);
		}
	}
}
