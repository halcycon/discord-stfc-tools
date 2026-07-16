/**
 * `/alliance` — multi-alliance track + link suggestions.
 */
import {
	deferredResponse,
	editInteractionResponse,
	interactionResponse,
	listAllGuildMembers,
} from './discord-api';
import { requireGuildAdmin } from './discord-admin';
import {
	getExcludedUserIds,
	getGuildConfig,
	getVerifiedDiscordUserIds,
	listActiveVerifiedPlayers,
	listAllianceMembersMissingVerify,
} from './guild-db';
import { collectTrackedAllianceTags, isMultiAllianceGuild } from './alliance-roster-sync';
import { trackAndScrapeAlliance, untrackAllianceTag } from './alliance-track';
import {
	formatLinkSuggestions,
	suggestRosterDiscordLinks,
} from './link-suggest';
import { AuditColor, postAuditLog } from './audit-log';

function getOptionValue(
	options: Array<{ name: string; value?: unknown }> | undefined,
	name: string,
): unknown {
	return options?.find((o) => o.name === name)?.value;
}

export async function handleAllianceCommand(
	env: Env,
	ctx: ExecutionContext,
	interaction: {
		guild_id?: string;
		application_id?: string;
		token: string;
		member?: { permissions?: string; user?: { id: string } };
		data?: {
			options?: Array<{
				name: string;
				type?: number;
				value?: unknown;
				options?: Array<{ name: string; value?: unknown }>;
			}>;
		};
	},
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction);
	if (adminError) return adminError;

	const guildId = interaction.guild_id;
	if (!guildId) {
		return interactionResponse('❌ Run this command inside your server.', true);
	}

	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return interactionResponse('❌ Server not configured. Run `/server setup` first.', true);
	}
	if (!isMultiAllianceGuild(config)) {
		return interactionResponse(
			'❌ `/alliance` is for **multi_alliance** servers. Switch with `/server setup mode:multi_alliance`.',
			true,
		);
	}

	const sub = interaction.data?.options?.[0];
	const subName = sub?.name;
	const opts = sub?.options;

	if (subName === 'list') {
		const verified = await listActiveVerifiedPlayers(env.STFC_DB, guildId);
		const all = [...collectTrackedAllianceTags(config, verified)].sort();
		const explicit = (config.tracked_alliance_tags ?? []).slice().sort();
		const diplomacy = Object.keys(config.diplomacy_channel_map ?? {})
			.map((t) => t.toUpperCase())
			.sort();
		return interactionResponse(
			`🏷 **Tracked alliances** (morning scrape)\n` +
				`• Combined: ${all.length ? all.map((t) => `\`${t}\``).join(', ') : '_none_'}\n` +
				`• Explicit (\`/alliance track\`): ${explicit.length ? explicit.map((t) => `\`${t}\``).join(', ') : '_none_'}\n` +
				`• Diplomacy map: ${diplomacy.length ? diplomacy.map((t) => `\`${t}\``).join(', ') : '_none_'}\n` +
				`• Plus any tags on verified players\n\n` +
				`Track + scrape now: \`/alliance track tag:TAG\``,
			true,
		);
	}

	if (subName === 'untrack') {
		const tag = String(getOptionValue(opts, 'tag') ?? '');
		const result = await untrackAllianceTag(env, config, tag);
		if (!result.ok) return interactionResponse(`❌ ${result.error}`, true);
		await postAuditLog(env, config, {
			title: 'Alliance untracked',
			description: `Removed **${tag.trim().toUpperCase()}** from explicit track list.`,
			actorId: interaction.member?.user?.id,
			source: 'admin',
			color: AuditColor.info,
		});
		return interactionResponse(
			`✅ Untracked **${tag.trim().toUpperCase()}** from explicit list.\n` +
				`Still tracked if on diplomacy map or a verified player: ` +
				`${result.trackedTags.length ? result.trackedTags.map((t) => `\`${t}\``).join(', ') : '_none explicit_'}`,
			true,
		);
	}

	if (subName === 'track') {
		const tag = getOptionValue(opts, 'tag') as string | undefined;
		const allianceId = getOptionValue(opts, 'alliance_id') as string | undefined;
		const appId = interaction.application_id ?? env.DISCORD_APPLICATION_ID;
		if (!appId) {
			return interactionResponse('❌ DISCORD_APPLICATION_ID not configured.', true);
		}

		const deferred = deferredResponse();
		ctx.waitUntil(
			(async () => {
				const result = await trackAndScrapeAlliance(env, config, {
					tag: tag ?? null,
					allianceId: allianceId ?? null,
				});
				if (!result.ok) {
					await editInteractionResponse(appId, interaction.token, `❌ ${result.error}`, true);
					return;
				}
				await postAuditLog(env, config, {
					title: 'Alliance tracked + scraped',
					description:
						`**[${result.allianceTag}]** \`${result.allianceId}\` · **${result.playerCount}** players` +
						(result.allianceName ? ` · ${result.allianceName}` : ''),
					actorId: interaction.member?.user?.id,
					source: 'admin',
					color: AuditColor.success,
				});
				const unlinked = result.playerCount - result.alreadyVerifiedOnRoster;
				await editInteractionResponse(
					appId,
					interaction.token,
					`✅ Tracked **[${result.allianceTag}]**` +
						(result.allianceName ? ` (${result.allianceName})` : '') +
						`\n` +
						`• Alliance id: \`${result.allianceId}\`\n` +
						`• Players on roster: **${result.playerCount}**` +
						` (${result.alreadyVerifiedOnRoster} already verified, ~**${unlinked}** unlinked)\n` +
						`• Guild missing-verify total: **${result.missingVerify}**\n` +
						`• All tracked tags: ${result.trackedTags.map((t) => `\`${t}\``).join(', ') || '—'}\n\n` +
						`Next: \`/alliance suggest tag:${result.allianceTag}\` to match Discord nicks, ` +
						`or \`/roster missing-verify\`.`,
					true,
				);
			})(),
		);
		return deferred;
	}

	if (subName === 'suggest') {
		const tagFilter = (getOptionValue(opts, 'tag') as string | undefined)?.trim() || null;
		const appId = interaction.application_id ?? env.DISCORD_APPLICATION_ID;
		if (!appId || !env.DISCORD_BOT_TOKEN) {
			return interactionResponse('❌ Bot token / application id missing.', true);
		}

		const deferred = deferredResponse();
		ctx.waitUntil(
			(async () => {
				try {
					const [verifiedIds, excluded, members, missing] = await Promise.all([
						getVerifiedDiscordUserIds(env.STFC_DB, guildId),
						getExcludedUserIds(env.STFC_DB, guildId),
						listAllGuildMembers(env.DISCORD_BOT_TOKEN!, guildId),
						listAllianceMembersMissingVerify(env.STFC_DB, guildId, { limit: 200, sort: 'name' }),
					]);

					const discordCandidates = members
						.filter((m) => !m.user.bot)
						.filter((m) => !verifiedIds.has(m.user.id))
						.filter((m) => !excluded.has(m.user.id))
						.map((m) => ({
							discordUserId: m.user.id,
							username: m.user.username,
							nick: m.nick,
						}));

					const roster = missing
						.filter((r) =>
							tagFilter
								? (r.alliance_tag ?? '').toUpperCase() === tagFilter.toUpperCase()
								: true,
						)
						.map((r) => ({
							playerId: r.player_id,
							playerName: r.player_name ?? '',
							allianceTag: r.alliance_tag,
							opsLevel: r.ops_level,
						}))
						.filter((r) => r.playerName);

					const suggestions = suggestRosterDiscordLinks(discordCandidates, roster, {
						tagFilter,
						limit: 30,
					});
					let text = formatLinkSuggestions(suggestions, { tag: tagFilter });
					if (text.length > 1900) {
						text = text.slice(0, 1890) + '\n…';
					}
					await editInteractionResponse(appId, interaction.token, text, true);
				} catch (err) {
					await editInteractionResponse(
						appId,
						interaction.token,
						`❌ Suggest failed: ${err instanceof Error ? err.message : String(err)}`,
						true,
					);
				}
			})(),
		);
		return deferred;
	}

	return interactionResponse(
		`🏷 **Alliance** (multi)\n` +
			`• \`/alliance track tag:TAG\` — scrape now + keep in morning sync\n` +
			`• \`/alliance suggest [tag:]\` — match unverified Discord members to roster\n` +
			`• \`/alliance list\` · \`/alliance untrack tag:\``,
		true,
	);
}
