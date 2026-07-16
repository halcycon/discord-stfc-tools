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
	listAllianceRosterMeta,
} from './guild-db';
import { shouldUseAllianceRoster, isMultiAllianceGuild } from './alliance-roster-sync';
import {
	formatActivityTargetSummary,
	handleSetActivityCommand,
	resolveActivityTarget,
} from './activity-adjust';
import { formatReportTable, ReportCols } from './report-table';
import {
	parseRosterFormat,
	parseRosterIncludeUnlinked,
	parseRosterSort,
	parseRosterVisibility,
	startRosterListReply,
} from './roster-list-view';
import {
	isGuildAdministrator,
	resolveRequiredUserOption,
	resolveTargetUserId,
} from './discord-admin';
import { demotePlayerToGuest } from './verification-access';
import { AuditColor, postAuditLog } from './audit-log';
import type { GuildConfig } from './types';

const LIST_CAP = 40;

function canUseRoster(
	interaction: { member?: { permissions?: string; roles?: string[] } },
	config: GuildConfig,
): boolean {
	if (isGuildAdministrator(interaction.member?.permissions)) return true;
	const roles = new Set(interaction.member?.roles ?? []);
	const allowed = [
		...(config.dm_query_role_ids ?? []),
		...(config.web_admin_role_ids ?? []),
	];
	if (!allowed.length) return false;
	return allowed.some((id) => roles.has(id));
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
			const total = rows.reduce((n, r) => n + r.count, 0);
			const table = formatReportTable(
				rows.map((r) => ({ Grade: `G${r.grade}`, Count: r.count })),
				[
					{ header: 'Grade', width: 5 },
					{ header: 'Count', width: 5, align: 'right' },
				],
				{ maxRows: 20, maxChars: 1500 },
			);
			return interactionResponse(
				`📊 **Grade breakdown** (${total} verified)\n${table}`,
				true,
			);
		}
		case 'grade': {
			const gradeRaw = getOptionValue(opts, 'grade');
			const grade = Number(gradeRaw);
			if (!Number.isFinite(grade) || grade < 3 || grade > 7) {
				return interactionResponse('❌ Provide `grade:` 3–7 (e.g. `6` for G6).', true);
			}
			if (!actorId) {
				return interactionResponse('❌ Could not resolve your Discord user id.', true);
			}
			const sort = parseRosterSort(getOptionValue(opts, 'sort'), 'ops', [
				'ops',
				'name',
				'streak',
				'inactive',
				'grade',
			]);
			const format = parseRosterFormat(getOptionValue(opts, 'format'));
			const visibility = parseRosterVisibility(getOptionValue(opts, 'visibility'));
			const includeUnlinked = parseRosterIncludeUnlinked(getOptionValue(opts, 'include_unlinked'));
			const pageRaw = Number(getOptionValue(opts, 'page'));
			const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
			return startRosterListReply(env, {
				guildId,
				userId: actorId,
				payload: {
					kind: 'grade',
					title: `📋 **G${grade}**`,
					filters: { grade },
					sort,
					format,
					visibility,
					includeUnlinked,
					page,
				},
			});
		}
		case 'ranks': {
			const rows = await countPlayersByAllianceRank(env.STFC_DB, guildId);
			if (rows.length === 0) {
				return interactionResponse('No verified players yet.', true);
			}
			const total = rows.reduce((n, r) => n + r.count, 0);
			const table = formatReportTable(
				rows.map((r) => ({ Rank: r.alliance_rank, Count: r.count })),
				[
					{ header: 'Rank', width: 10 },
					{ header: 'Count', width: 5, align: 'right' },
				],
				{ maxRows: 30, maxChars: 1500 },
			);
			return interactionResponse(
				`📊 **In-game rank breakdown** (${total} verified)\n${table}`,
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
			if (!actorId) {
				return interactionResponse('❌ Could not resolve your Discord user id.', true);
			}
			const sort = parseRosterSort(getOptionValue(opts, 'sort'), 'ops', [
				'ops',
				'name',
				'streak',
				'inactive',
				'grade',
			]);
			const format = parseRosterFormat(getOptionValue(opts, 'format'));
			const visibility = parseRosterVisibility(getOptionValue(opts, 'visibility'));
			const includeUnlinked = parseRosterIncludeUnlinked(getOptionValue(opts, 'include_unlinked'));
			const pageRaw = Number(getOptionValue(opts, 'page'));
			const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
			return startRosterListReply(env, {
				guildId,
				userId: actorId,
				payload: {
					kind: 'rank',
					title: `📋 **Rank ${rankRaw}**`,
					filters: { allianceRank: rankRaw },
					sort,
					format,
					visibility,
					includeUnlinked,
					page,
				},
			});
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
			const [totalMissing] = await Promise.all([
				countAllianceMembersMissingVerify(env.STFC_DB, guildId),
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
				`_In-game players on the alliance roster with no active/guest Discord link. Guests count as linked._`;
			if (totalMissing === 0) {
				return interactionResponse(`${header}\n\nEveryone on the alliance roster is linked.`, true);
			}
			if (!actorId) {
				return interactionResponse('❌ Could not resolve your Discord user id.', true);
			}
			const sort = parseRosterSort(getOptionValue(opts, 'sort'), 'ops', [
				'ops',
				'name',
				'rank',
			]);
			const format = parseRosterFormat(getOptionValue(opts, 'format'));
			const visibility = parseRosterVisibility(getOptionValue(opts, 'visibility'));
			const includeUnlinked = parseRosterIncludeUnlinked(getOptionValue(opts, 'include_unlinked'));
			const pageRaw = Number(getOptionValue(opts, 'page'));
			const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
			return startRosterListReply(env, {
				guildId,
				userId: actorId,
				payload: {
					kind: 'missing-verify',
					title: header,
					filters: {},
					sort,
					format,
					visibility,
					includeUnlinked,
					page,
				},
			});
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
			if (!actorId) {
				return interactionResponse('❌ Could not resolve your Discord user id.', true);
			}
			const range =
				opsMin != null && opsMax != null
					? `${opsMin}–${opsMax}`
					: opsMin != null
						? `≥ ${opsMin}`
						: `≤ ${opsMax}`;
			const sort = parseRosterSort(getOptionValue(opts, 'sort'), 'ops', [
				'ops',
				'name',
				'streak',
				'inactive',
				'grade',
			]);
			const format = parseRosterFormat(getOptionValue(opts, 'format'));
			const visibility = parseRosterVisibility(getOptionValue(opts, 'visibility'));
			const includeUnlinked = parseRosterIncludeUnlinked(getOptionValue(opts, 'include_unlinked'));
			const pageRaw = Number(getOptionValue(opts, 'page'));
			const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
			return startRosterListReply(env, {
				guildId,
				userId: actorId,
				payload: {
					kind: 'ops',
					title: `📋 **Ops ${range}**`,
					filters: { opsMin, opsMax },
					sort,
					format,
					visibility,
					includeUnlinked,
					page,
				},
			});
		}
		case 'status': {
			const rows = await countPlayersByStatus(env.STFC_DB, guildId);
			if (rows.length === 0) {
				return interactionResponse('No verified players yet.', true);
			}
			const table = formatReportTable(
				rows.map((r) => ({ Status: r.verification_status, Count: r.count })),
				[
					{ header: 'Status', width: 10 },
					{ header: 'Count', width: 5, align: 'right' },
				],
				{ maxRows: 20, maxChars: 1500 },
			);
			return interactionResponse(`📊 **Verification status**\n${table}`, true);
		}
		case 'alliances': {
			const rows = await countPlayersByAlliance(env.STFC_DB, guildId);
			if (rows.length === 0) {
				return interactionResponse('No verified players yet.', true);
			}
			const table = formatReportTable(
				rows.map((r) => ({ Tag: r.alliance_tag, Count: r.count })),
				[
					ReportCols.tag,
					{ header: 'Count', width: 5, align: 'right' },
				],
				{ maxRows: 40, maxChars: 1700 },
			);
			return interactionResponse(`📊 **Alliance breakdown**\n${table}`, true);
		}
		case 'inactive': {
			const minRaw = getOptionValue(opts, 'min_days');
			const minDays = minRaw != null && minRaw !== '' ? Number(minRaw) : 1;
			if (!Number.isFinite(minDays) || minDays < 0) {
				return interactionResponse('❌ `min_days` must be a non-negative number.', true);
			}
			if (!actorId) {
				return interactionResponse('❌ Could not resolve your Discord user id.', true);
			}
			const sort = parseRosterSort(getOptionValue(opts, 'sort'), 'inactive', [
				'ops',
				'name',
				'streak',
				'inactive',
				'grade',
			]);
			const format = parseRosterFormat(getOptionValue(opts, 'format'));
			const visibility = parseRosterVisibility(getOptionValue(opts, 'visibility'));
			const includeUnlinked = parseRosterIncludeUnlinked(getOptionValue(opts, 'include_unlinked'));
			const pageRaw = Number(getOptionValue(opts, 'page'));
			const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
			return startRosterListReply(env, {
				guildId,
				userId: actorId,
				payload: {
					kind: 'inactive',
					title:
						`😴 **Inactive ≥ ${minDays}d**\n` +
						`_From morning sync of stfc.pro \`consecutive_days_active\` (alliance page)._`,
					filters: { daysInactiveMin: minDays },
					sort,
					format,
					visibility,
					includeUnlinked,
					page,
				},
			});
		}
		case 'activity': {
			const userIdOpt = resolveRequiredUserOption(opts);
			const playerQuery = (getOptionValue(opts, 'player') as string | undefined)?.trim();
			if (userIdOpt && playerQuery) {
				return interactionResponse('❌ Provide either `user:` or `player:`, not both.', true);
			}
			const discordUserId = userIdOpt ?? (playerQuery ? undefined : resolveTargetUserId(interaction as any, opts));
			if (!discordUserId && !playerQuery) {
				return interactionResponse('❌ Provide `user:` or `player:` (or run without either to see yourself).', true);
			}
			const resolved = await resolveActivityTarget(env.STFC_DB, guildId, {
				discordUserId,
				playerQuery,
			});
			if (resolved.status === 'none') {
				return interactionResponse(
					`❌ No match for ${playerQuery ? `\`${playerQuery}\`` : `<@${discordUserId}>`}.`,
					true,
				);
			}
			if (resolved.status === 'suggest') {
				return interactionResponse(
					`❓ No exact match for \`${resolved.query}\`.\n` +
						`Did you mean **${resolved.target.playerName ?? '—'}**` +
						(resolved.target.playerId != null ? ` (id ${resolved.target.playerId})` : '') +
						`?\nRe-run with the exact name or id, or use \`/roster set-streak\` / \`set-inactive\` to confirm via buttons.`,
					true,
				);
			}
			return interactionResponse(
				`📈 **Activity** — ${formatActivityTargetSummary(resolved.target)}` +
					`\n\nAdjust: \`/roster set-streak\` · \`/roster set-inactive\``,
				true,
			);
		}
		case 'set-streak':
		case 'set-inactive': {
			if (!isGuildAdministrator(interaction.member?.permissions)) {
				return interactionResponse(
					`❌ \`/roster ${sub.name}\` requires Administrator.`,
					true,
				);
			}
			const userIdOpt = resolveRequiredUserOption(opts);
			const playerQuery = (getOptionValue(opts, 'player') as string | undefined)?.trim();
			if (userIdOpt && playerQuery) {
				return interactionResponse('❌ Provide either `user:` or `player:`, not both.', true);
			}
			if (!userIdOpt && !playerQuery) {
				return interactionResponse('❌ Provide `user:` (Discord) or `player:` (name or STFC id).', true);
			}
			const valueRaw = getOptionValue(opts, 'value');
			const value = Number(valueRaw);
			if (!Number.isFinite(value) || value < 0) {
				return interactionResponse(
					sub.name === 'set-streak'
						? '❌ Provide `value:` ≥ 0 (stfc.pro consecutive days active).'
						: '❌ Provide `value:` ≥ 0 (days inactive).',
					true,
				);
			}
			return handleSetActivityCommand({
				env,
				guildId,
				actorId,
				field: sub.name === 'set-streak' ? 'streak' : 'inactive',
				value: Math.floor(value),
				discordUserId: userIdOpt,
				playerQuery,
			});
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
