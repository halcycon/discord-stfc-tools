import {
	deferredResponse,
	editInteractionResponse,
	interactionResponse,
	listAllGuildMembers,
} from './discord-api';
import {
	countAllianceMembersMissingVerify,
	countPlayersByAlliance,
	countPlayersByAllianceRank,
	countPlayersByGrade,
	countPlayersByStatus,
	getExcludedUserIds,
	getGuildConfig,
	getVerifiedDiscordUserIds,
	getVerifiedPlayer,
	listAllianceMembersMissingVerify,
	listAllianceRosterMeta,
	listRosterPlayers,
	setVerifiedPlayerActivity,
} from './guild-db';
import { shouldUseAllianceRoster, isMultiAllianceGuild } from './alliance-roster-sync';
import { formatActivityBits } from './activity-utils';
import { isGuildAdministrator, resolveTargetUserId } from './discord-admin';
import { demotePlayerToGuest } from './verification-access';
import { AuditColor, postAuditLog } from './audit-log';
import type { GuildConfig, VerifiedPlayer } from './types';

const LIST_CAP = 40;

function canUseRoster(
	interaction: { member?: { permissions?: string; roles?: string[] } },
	config: GuildConfig,
): boolean {
	if (isGuildAdministrator(interaction.member?.permissions)) return true;
	const allowed = config.dm_query_role_ids;
	if (!allowed.length) return false;
	const roles = new Set(interaction.member?.roles ?? []);
	return allowed.some((id) => roles.has(id));
}

function formatPlayerLine(p: VerifiedPlayer): string {
	const name = p.player_name ?? '—';
	const tag = p.alliance_tag ? `[${p.alliance_tag}]` : '';
	const ops = p.ops_level != null ? `Ops ${p.ops_level}` : 'Ops —';
	const grade = p.grade != null ? `G${p.grade}` : 'G—';
	const status = p.verification_status;
	const activity = formatActivityBits({
		activityStreak: p.activity_streak,
		daysInactive: p.days_inactive,
	});
	return (
		`• <@${p.discord_user_id}> **${name}** ${tag} · ${ops} · ${grade} · ${status}` +
		(activity ? ` · ${activity}` : '')
	);
}

function truncateLines(lines: string[], cap = LIST_CAP): string {
	if (lines.length <= cap) return lines.join('\n');
	const shown = lines.slice(0, cap);
	return `${shown.join('\n')}\n…and **${lines.length - cap}** more`;
}

function getOptionValue(
	options: Array<{ name: string; value?: unknown }> | undefined,
	name: string,
): unknown {
	return options?.find((o) => o.name === name)?.value;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

export async function handleRosterCommand(
	env: Env,
	ctx: ExecutionContext,
	interaction: {
		guild_id?: string;
		application_id?: string;
		token?: string;
		member?: { permissions?: string; roles?: string[]; user?: { id: string } };
	},
	data: {
		options?: Array<{
			name: string;
			type?: number;
			value?: unknown;
			options?: Array<{ name: string; value?: unknown; type?: number }>;
		}>;
	},
): Promise<Response> {
	const guildId = interaction.guild_id;
	if (!guildId) {
		return interactionResponse('❌ Run this command inside your server.', true);
	}

	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return interactionResponse('❌ Server not configured. An admin must run `/server setup` first.', true);
	}

	if (!canUseRoster(interaction, config)) {
		return interactionResponse(
			'❌ Roster queries require Administrator, or a role from `/server assistant roles`.',
			true,
		);
	}

	const sub = data.options?.[0];
	if (!sub) {
		return interactionResponse(
			'Use `/roster grades`, `/roster grade`, `/roster ranks`, `/roster rank`, `/roster ops`, `/roster inactive`, `/roster activity`, `/roster set-streak`, `/roster set-inactive`, `/roster unverified`, `/roster missing-verify`, `/roster set-guest`, `/roster status`, or `/roster alliances`.',
			true,
		);
	}

	const opts = sub.options;
	const actorId = interaction.member?.user?.id;

	switch (sub.name) {
		case 'grades': {
			const rows = await countPlayersByGrade(env.STFC_DB, guildId);
			if (rows.length === 0) {
				return interactionResponse('No verified players yet.', true);
			}
			const lines = rows.map((r) => `• **G${r.grade}**: ${r.count}`);
			const total = rows.reduce((n, r) => n + r.count, 0);
			return interactionResponse(`📊 **Grade breakdown** (${total} verified)\n${lines.join('\n')}`, true);
		}
		case 'grade': {
			const gradeRaw = getOptionValue(opts, 'grade');
			const grade = Number(gradeRaw);
			if (!Number.isFinite(grade) || grade < 3 || grade > 7) {
				return interactionResponse('❌ Provide `grade:` 3–7 (e.g. `6` for G6).', true);
			}
			const players = await listRosterPlayers(env.STFC_DB, guildId, { grade, limit: 80 });
			if (players.length === 0) {
				return interactionResponse(`No verified players at **G${grade}**.`, true);
			}
			return interactionResponse(
				`📋 **G${grade}** (${players.length}${players.length >= 80 ? '+' : ''})\n` +
					truncateLines(players.map(formatPlayerLine)),
				true,
			);
		}
		case 'ranks': {
			const rows = await countPlayersByAllianceRank(env.STFC_DB, guildId);
			if (rows.length === 0) {
				return interactionResponse('No verified players yet.', true);
			}
			const lines = rows.map((r) => `• **${r.alliance_rank}**: ${r.count}`);
			const total = rows.reduce((n, r) => n + r.count, 0);
			return interactionResponse(
				`📊 **In-game rank breakdown** (${total} verified)\n${lines.join('\n')}`,
				true,
			);
		}
		case 'rank': {
			const rankRaw = (getOptionValue(opts, 'rank') as string | undefined)?.trim();
			if (!rankRaw) {
				return interactionResponse(
					'❌ Provide `rank:` (e.g. `Operative`, `Agent`, `Premier`, `Commodore`, `Admiral`).',
					true,
				);
			}
			const players = await listRosterPlayers(env.STFC_DB, guildId, {
				allianceRank: rankRaw,
				limit: 80,
			});
			if (players.length === 0) {
				return interactionResponse(`No verified players with rank **${rankRaw}**.`, true);
			}
			return interactionResponse(
				`📋 **Rank ${rankRaw}** (${players.length}${players.length >= 80 ? '+' : ''})\n` +
					truncateLines(players.map(formatPlayerLine)),
				true,
			);
		}
		case 'missing-verify': {
			if (!shouldUseAllianceRoster(config) && !isMultiAllianceGuild(config)) {
				return interactionResponse(
					'❌ `/roster missing-verify` needs **single_alliance** (with tag) or **multi_alliance** and a morning alliance roster.',
					true,
				);
			}
			const metaRows = await listAllianceRosterMeta(env.STFC_DB, guildId);
			const playerCount = metaRows.reduce((n, m) => n + (m.player_count || 0), 0);
			const latestFetched = metaRows
				.map((m) => m.fetched_at)
				.filter(Boolean)
				.sort()
				.at(-1);
			if (!metaRows.length || playerCount <= 0) {
				return interactionResponse(
					'❌ No alliance roster cached yet. It fills on the morning sync (`0 6 * * *` UTC). Ask an admin if the last daily sync failed.',
					true,
				);
			}
			const [totalMissing, missing] = await Promise.all([
				countAllianceMembersMissingVerify(env.STFC_DB, guildId),
				listAllianceMembersMissingVerify(env.STFC_DB, guildId, 80),
			]);
			const when = latestFetched
				? ` · updated <t:${Math.floor(Date.parse(latestFetched) / 1000)}:R>`
				: '';
			const tagLabel = isMultiAllianceGuild(config)
				? `${metaRows.length} tracked alliance(s)`
				: `**${metaRows[0]?.alliance_tag ?? config.alliance_tag}**`;
			const header =
				`🕶 **Alliance members not verified on Discord** (${totalMissing} of ${playerCount}` +
				` · ${tagLabel}${when})\n` +
				`_In-game players on the alliance roster with no active/guest Discord link. Guests count as linked._\n\n`;
			if (totalMissing === 0) {
				return interactionResponse(`${header}Everyone on the alliance roster is linked.`, true);
			}
			const lines = missing.map((m) => {
				const name = m.player_name ?? String(m.player_id);
				const rank = m.alliance_rank ? ` · ${m.alliance_rank}` : '';
				const tag = m.alliance_tag ? ` [${m.alliance_tag}]` : '';
				const ops = m.ops_level != null ? `Ops ${m.ops_level}` : 'Ops —';
				return `• **${name}** (\`${m.player_id}\`)${tag} · ${ops}${rank}`;
			});
			const more =
				totalMissing > missing.length ? `\n…and **${totalMissing - missing.length}** more` : '';
			return interactionResponse(header + truncateLines(lines, 50) + more, true);
		}
		case 'ops': {
			const minRaw = getOptionValue(opts, 'min');
			const maxRaw = getOptionValue(opts, 'max');
			const opsMin = minRaw != null && minRaw !== '' ? Number(minRaw) : undefined;
			const opsMax = maxRaw != null && maxRaw !== '' ? Number(maxRaw) : undefined;
			if (opsMin != null && !Number.isFinite(opsMin)) {
				return interactionResponse('❌ `min` must be a number.', true);
			}
			if (opsMax != null && !Number.isFinite(opsMax)) {
				return interactionResponse('❌ `max` must be a number.', true);
			}
			if (opsMin == null && opsMax == null) {
				return interactionResponse('❌ Provide at least `min:` or `max:` ops level.', true);
			}
			const players = await listRosterPlayers(env.STFC_DB, guildId, {
				opsMin,
				opsMax,
				limit: 80,
			});
			if (players.length === 0) {
				return interactionResponse('No verified players in that ops range.', true);
			}
			const range =
				opsMin != null && opsMax != null
					? `${opsMin}–${opsMax}`
					: opsMin != null
						? `≥ ${opsMin}`
						: `≤ ${opsMax}`;
			return interactionResponse(
				`📋 **Ops ${range}** (${players.length}${players.length >= 80 ? '+' : ''})\n` +
					truncateLines(players.map(formatPlayerLine)),
				true,
			);
		}
		case 'status': {
			const rows = await countPlayersByStatus(env.STFC_DB, guildId);
			if (rows.length === 0) {
				return interactionResponse('No verified players yet.', true);
			}
			const lines = rows.map((r) => `• **${r.verification_status}**: ${r.count}`);
			return interactionResponse(`📊 **Verification status**\n${lines.join('\n')}`, true);
		}
		case 'alliances': {
			const rows = await countPlayersByAlliance(env.STFC_DB, guildId);
			if (rows.length === 0) {
				return interactionResponse('No verified players yet.', true);
			}
			const lines = rows.slice(0, 40).map((r) => `• **[${r.alliance_tag}]**: ${r.count}`);
			const extra = rows.length > 40 ? `\n…and ${rows.length - 40} more alliances` : '';
			return interactionResponse(`📊 **Alliance breakdown**\n${lines.join('\n')}${extra}`, true);
		}
		case 'inactive': {
			const minRaw = getOptionValue(opts, 'min_days');
			const minDays = minRaw != null && minRaw !== '' ? Number(minRaw) : 1;
			if (!Number.isFinite(minDays) || minDays < 0) {
				return interactionResponse('❌ `min_days` must be a non-negative number.', true);
			}
			const players = await listRosterPlayers(env.STFC_DB, guildId, {
				daysInactiveMin: minDays,
				limit: 80,
			});
			if (players.length === 0) {
				return interactionResponse(
					`No verified players with **≥ ${minDays}** day(s) inactive.`,
					true,
				);
			}
			return interactionResponse(
				`😴 **Inactive ≥ ${minDays}d** (${players.length}${players.length >= 80 ? '+' : ''})\n` +
					`_From morning sync of stfc.pro \`consecutive_days_active\` (0 = no streak)._\n` +
					truncateLines(players.map(formatPlayerLine)),
				true,
			);
		}
		case 'activity': {
			const userId = resolveTargetUserId(interaction as any, opts);
			if (!userId) {
				return interactionResponse('❌ Provide `user:` (or run without user to see yourself).', true);
			}
			const player = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
			if (!player) {
				return interactionResponse(`❌ <@${userId}> is not on the verified roster.`, true);
			}
			const bits = formatActivityBits({
				activityStreak: player.activity_streak,
				daysInactive: player.days_inactive,
			});
			const updated = player.activity_updated_at
				? ` · updated <t:${Math.floor(Date.parse(player.activity_updated_at) / 1000)}:R>`
				: '';
			return interactionResponse(
				`📈 **Activity** — <@${userId}> **${player.player_name ?? '—'}**` +
					(player.alliance_tag ? ` [${player.alliance_tag}]` : '') +
					`\n• Streak: **${player.activity_streak ?? '—'}** (stfc.pro consecutive days active)` +
					`\n• Days inactive: **${player.days_inactive}**` +
					(bits ? `\n• Summary: ${bits}` : '') +
					updated +
					`\n\nAdjust: \`/roster set-streak\` · \`/roster set-inactive\``,
				true,
			);
		}
		case 'set-streak': {
			if (!isGuildAdministrator(interaction.member?.permissions)) {
				return interactionResponse('❌ `/roster set-streak` requires Administrator.', true);
			}
			const userId = resolveTargetUserId(interaction as any, opts);
			if (!userId) {
				return interactionResponse('❌ Provide `user:`.', true);
			}
			const valueRaw = getOptionValue(opts, 'value');
			const value = Number(valueRaw);
			if (!Number.isFinite(value) || value < 0) {
				return interactionResponse('❌ Provide `value:` ≥ 0 (stfc.pro consecutive days active).', true);
			}
			const player = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
			if (!player) {
				return interactionResponse(`❌ <@${userId}> is not on the verified roster.`, true);
			}
			const streak = Math.floor(value);
			const daysInactive = streak > 0 ? 0 : player.days_inactive;
			await setVerifiedPlayerActivity(env.STFC_DB, guildId, userId, {
				activity_streak: streak,
				days_inactive: daysInactive,
			});
			await postAuditLog(env, config, {
				title: 'Activity streak adjusted',
				description:
					`<@${userId}> **${player.player_name ?? '—'}** streak **${player.activity_streak ?? '—'}** → **${streak}**` +
					(streak > 0 ? ' (days inactive cleared)' : ''),
				actorId,
				source: 'admin',
				color: AuditColor.info,
			});
			return interactionResponse(
				`✅ <@${userId}> streak set to **${streak}**` +
					(streak > 0 ? ' · days inactive reset to **0**' : ` · days inactive left at **${daysInactive}**`),
				true,
			);
		}
		case 'set-inactive': {
			if (!isGuildAdministrator(interaction.member?.permissions)) {
				return interactionResponse('❌ `/roster set-inactive` requires Administrator.', true);
			}
			const userId = resolveTargetUserId(interaction as any, opts);
			if (!userId) {
				return interactionResponse('❌ Provide `user:`.', true);
			}
			const valueRaw = getOptionValue(opts, 'value');
			const value = Number(valueRaw);
			if (!Number.isFinite(value) || value < 0) {
				return interactionResponse('❌ Provide `value:` ≥ 0 (days inactive).', true);
			}
			const player = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
			if (!player) {
				return interactionResponse(`❌ <@${userId}> is not on the verified roster.`, true);
			}
			const days = Math.floor(value);
			await setVerifiedPlayerActivity(env.STFC_DB, guildId, userId, {
				days_inactive: days,
				activity_streak: days > 0 ? 0 : player.activity_streak,
			});
			await postAuditLog(env, config, {
				title: 'Days inactive adjusted',
				description:
					`<@${userId}> **${player.player_name ?? '—'}** days inactive **${player.days_inactive}** → **${days}**` +
					(days > 0 ? ' (streak set to 0)' : ''),
				actorId,
				source: 'admin',
				color: AuditColor.info,
			});
			return interactionResponse(
				`✅ <@${userId}> days inactive set to **${days}**` +
					(days > 0 ? ' · streak set to **0**' : ''),
				true,
			);
		}
		case 'set-guest': {
			if (!isGuildAdministrator(interaction.member?.permissions)) {
				return interactionResponse('❌ `/roster set-guest` requires Administrator.', true);
			}
			const userId = getOptionValue(opts, 'user');
			if (userId == null || !/^\d{15,20}$/.test(String(userId))) {
				return interactionResponse('❌ Provide `user:` (a Discord member).', true);
			}
			const reasonNote = (getOptionValue(opts, 'reason') as string | undefined)?.trim();
			const result = await demotePlayerToGuest(env, config, guildId, String(userId), {
				reason: 'admin',
				actorId,
				source: 'admin',
				requireGuestRole: true,
			});
			if (!result.ok) {
				return interactionResponse(`❌ Set guest failed: ${result.error}`, true);
			}
			return interactionResponse(
				`✅ Set <@${userId}> to guest.` +
					(result.hadVerifiedRow ? ' Linked player status set to **guest**.' : ' (roles only — not in verified roster).') +
					(result.channelArchived ? ' Personal channel moved to archive.' : '') +
					(reasonNote ? `\nNote: ${reasonNote}` : '') +
					`\n${result.notes.join('\n')}`,
				true,
			);
		}
		case 'unverified': {
			if (!env.DISCORD_BOT_TOKEN) {
				return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
			}
			const setGuestRaw = getOptionValue(opts, 'set_guest') ?? getOptionValue(opts, 'demote');
			const setGuest = setGuestRaw === true || setGuestRaw === 'true';

			const [members, verifiedIds, excludedIds] = await Promise.all([
				listAllGuildMembers(env.DISCORD_BOT_TOKEN, guildId),
				getVerifiedDiscordUserIds(env.STFC_DB, guildId),
				getExcludedUserIds(env.STFC_DB, guildId),
			]);

			const unverified = members.filter((m) => {
				if (m.user.bot) return false;
				if (verifiedIds.has(m.user.id)) return false;
				if (excludedIds.has(m.user.id)) return false;
				return true;
			});

			const botCount = members.filter((m) => m.user.bot).length;
			const header =
				`👤 **Unverified Discord members** (${unverified.length})\n` +
				`_Excluded from this list: verified players, \`/server exclude\` list (${excludedIds.size}), Discord bots (${botCount})._\n\n`;

			if (!setGuest) {
				if (unverified.length === 0) {
					return interactionResponse(`${header}Everyone else is verified or excluded.`, true);
				}
				const lines = unverified.map((m) => {
					const nick = m.nick ? ` (${m.nick})` : '';
					return `• <@${m.user.id}> \`${m.user.username}\`${nick}`;
				});
				return interactionResponse(
					header +
						truncateLines(lines, 50) +
						`\n\nTo assign **guest** and remove member/rank roles: \`/roster unverified set_guest:true\` (Administrator).`,
					true,
				);
			}

			if (!isGuildAdministrator(interaction.member?.permissions)) {
				return interactionResponse('❌ Setting unverified members to guest requires Administrator.', true);
			}
			if (!config.guest_role_id || !/^\d{15,20}$/.test(config.guest_role_id)) {
				return interactionResponse(
					'❌ `guest_role` is not configured. Set it with `/server setup guest_role:…` before continuing.',
					true,
				);
			}
			if (unverified.length === 0) {
				return interactionResponse(`${header}Nothing to update.`, true);
			}

			const appId = interaction.application_id ?? env.DISCORD_APPLICATION_ID;
			if (!appId || !interaction.token) {
				return interactionResponse('❌ Missing application id / interaction token for deferred update.', true);
			}

			const deferred = deferredResponse();
			ctx.waitUntil(
				(async () => {
					let ok = 0;
					let failed = 0;
					const errors: string[] = [];
					try {
						for (let i = 0; i < unverified.length; i++) {
							const m = unverified[i];
							if (i === 0 || (i + 1) % 10 === 0 || i + 1 === unverified.length) {
								await editInteractionResponse(
									appId,
									interaction.token!,
									`⏳ Setting guest ${i + 1}/${unverified.length} (ok ${ok}, failed ${failed})…`,
									true,
								);
							}
							try {
								const result = await demotePlayerToGuest(env, config, guildId, m.user.id, {
									reason: 'unverified_bulk',
									actorId,
									source: 'admin',
									requireGuestRole: true,
									skipAudit: true,
								});
								if (result.ok) ok++;
								else {
									failed++;
									if (errors.length < 8) {
										errors.push(`<@${m.user.id}>: ${result.error ?? 'unknown'}`);
									}
								}
							} catch (err) {
								failed++;
								console.error(`Bulk set-guest failed for ${m.user.id}:`, err);
								if (errors.length < 8) {
									const msg = err instanceof Error ? err.message : 'unknown error';
									errors.push(`<@${m.user.id}>: ${msg.slice(0, 180)}`);
								}
							}
							await sleep(350);
						}

						const { postAuditLog, AuditColor } = await import('./audit-log');
						await postAuditLog(env, config, {
							title: 'Bulk set guest (unverified)',
							description:
								`Set **${ok}** unverified member(s) to guest` +
								(failed ? ` · **${failed}** failed` : ''),
							actorId,
							source: 'admin',
							color: failed ? AuditColor.warn : AuditColor.success,
						});

						await editInteractionResponse(
							appId,
							interaction.token!,
							`✅ **Bulk set guest (unverified) complete**\n` +
								`• Updated: ${ok}\n` +
								`• Failed: ${failed}\n` +
								`• Guest role: <@&${config.guest_role_id}>` +
								(errors.length ? `\n\n⚠ Errors:\n${errors.join('\n')}` : ''),
							true,
						);
					} catch (err) {
						console.error('Bulk set-guest unverified aborted:', err);
						const msg = err instanceof Error ? err.message : 'unknown error';
						await editInteractionResponse(
							appId,
							interaction.token!,
							`❌ **Bulk set guest aborted** after ok ${ok}, failed ${failed}.\n${msg.slice(0, 400)}` +
								(errors.length ? `\n\n⚠ Earlier errors:\n${errors.join('\n')}` : ''),
							true,
						);
					}
				})(),
			);
			return deferred;
		}
		default:
			return interactionResponse('❌ Unknown `/roster` subcommand.', true);
	}
}
