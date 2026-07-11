import {
	deferredResponse,
	editInteractionResponse,
	interactionResponse,
	listAllGuildMembers,
} from './discord-api';
import {
	countPlayersByAlliance,
	countPlayersByGrade,
	countPlayersByStatus,
	getExcludedUserIds,
	getGuildConfig,
	getVerifiedDiscordUserIds,
	listRosterPlayers,
} from './guild-db';
import { isGuildAdministrator } from './discord-admin';
import { demotePlayerToGuest } from './verification-access';
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
	return `• <@${p.discord_user_id}> **${name}** ${tag} · ${ops} · ${grade} · ${status}`;
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
			'Use `/roster grades`, `/roster grade`, `/roster ops`, `/roster unverified`, `/roster demote`, `/roster status`, or `/roster alliances`.',
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
		case 'demote': {
			if (!isGuildAdministrator(interaction.member?.permissions)) {
				return interactionResponse('❌ `/roster demote` requires Administrator.', true);
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
				return interactionResponse(`❌ Demote failed: ${result.error}`, true);
			}
			return interactionResponse(
				`✅ Demoted <@${userId}> to guest.` +
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
			const demoteRaw = getOptionValue(opts, 'demote');
			const demote = demoteRaw === true || demoteRaw === 'true';

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

			if (!demote) {
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
						`\n\nTo assign **guest** and strip member/rank roles: \`/roster unverified demote:true\` (Administrator).`,
					true,
				);
			}

			if (!isGuildAdministrator(interaction.member?.permissions)) {
				return interactionResponse('❌ Demoting unverified members requires Administrator.', true);
			}
			if (!config.guest_role_id || !/^\d{15,20}$/.test(config.guest_role_id)) {
				return interactionResponse(
					'❌ `guest_role` is not configured. Set it with `/server setup guest_role:…` before demoting.',
					true,
				);
			}
			if (unverified.length === 0) {
				return interactionResponse(`${header}Nothing to demote.`, true);
			}

			const appId = interaction.application_id ?? env.DISCORD_APPLICATION_ID;
			if (!appId || !interaction.token) {
				return interactionResponse('❌ Missing application id / interaction token for deferred demote.', true);
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
									`⏳ Demoting unverified ${i + 1}/${unverified.length} (ok ${ok}, failed ${failed})…`,
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
								console.error(`Bulk demote failed for ${m.user.id}:`, err);
								if (errors.length < 8) {
									const msg = err instanceof Error ? err.message : 'unknown error';
									errors.push(`<@${m.user.id}>: ${msg.slice(0, 180)}`);
								}
							}
							await sleep(350);
						}

						const { postAuditLog, AuditColor } = await import('./audit-log');
						await postAuditLog(env, config, {
							title: 'Bulk demote unverified',
							description:
								`Demoted **${ok}** unverified member(s)` + (failed ? ` · **${failed}** failed` : ''),
							actorId,
							source: 'admin',
							color: failed ? AuditColor.warn : AuditColor.success,
						});

						await editInteractionResponse(
							appId,
							interaction.token!,
							`✅ **Bulk demote unverified complete**\n` +
								`• Demoted: ${ok}\n` +
								`• Failed: ${failed}\n` +
								`• Guest role: <@&${config.guest_role_id}>` +
								(errors.length ? `\n\n⚠ Errors:\n${errors.join('\n')}` : ''),
							true,
						);
					} catch (err) {
						console.error('Bulk demote unverified aborted:', err);
						const msg = err instanceof Error ? err.message : 'unknown error';
						await editInteractionResponse(
							appId,
							interaction.token!,
							`❌ **Bulk demote aborted** after ok ${ok}, failed ${failed}.\n${msg.slice(0, 400)}` +
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
