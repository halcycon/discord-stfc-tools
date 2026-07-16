/**
 * Demotion resilience: approval vs YOLO policies for single-alliance leave detection.
 */
import {
	editChannelMessage,
	interactionResponse,
	sendMessageWithComponents,
	updateMessageResponse,
	type DiscordActionRow,
} from './discord-api';
import {
	cancelDemotionQueueEntry,
	getGuildConfig,
	listDueDemotionRechecks,
	listPendingApprovalDemotions,
	listPendingDemotions,
	resolveDemotionQueueEntries,
	setDemotionQueueUrgentMessage,
	upsertDemotionQueueEntry,
	upsertVerifiedPlayer,
} from './guild-db';
import { opsLevelToGrade } from './grade-utils';
import { AuditColor, postAuditLog } from './audit-log';
import { lookupPlayerByIdOrName } from './stfc-utils';
import { demotePlayerToGuest, playerMatchesGuildAlliance } from './verification-access';
import { isGuildAdministrator } from './discord-admin';
import type {
	DemotionPolicy,
	DemotionQueueReason,
	GuildConfig,
	PlayerData,
	VerifiedPlayer,
} from './types';
import { syncVerifiedPlayer } from './verification';
import { isDeployTesting } from './deploy-mode';

export const DEMOTION_RECHECK_HOURS = 1;

export type DemotionCandidateAction =
	| { action: 'demote_now' }
	| { action: 'enqueue_approval' }
	| { action: 'enqueue_recheck' }
	| { action: 'skip' };

/** Pure policy router for automated demotion candidates (single_alliance only). */
export function decideDemotionCandidateAction(
	policy: DemotionPolicy,
	kind: 'alliance_mismatch' | 'player_missing',
): DemotionCandidateAction {
	if (policy === 'yolo') {
		if (kind === 'alliance_mismatch') return { action: 'demote_now' };
		return { action: 'enqueue_recheck' };
	}
	return { action: 'enqueue_approval' };
}

/**
 * Guests are already demoted; leave them to the guest re-promote poll.
 * Without this, daily sync re-queues / dry-runs them every morning while off-alliance.
 */
export function isAlreadyDemotedGuest(
	record: Pick<VerifiedPlayer, 'verification_status'>,
): boolean {
	return record.verification_status === 'guest';
}

function hoursFromNow(hours: number): string {
	return new Date(Date.now() + hours * 3600_000).toISOString();
}

async function refreshPlayerFieldsWithoutDemotion(
	db: D1Database,
	guildId: string,
	discordUserId: string,
	player: PlayerData,
): Promise<void> {
	await upsertVerifiedPlayer(db, {
		guild_id: guildId,
		discord_user_id: discordUserId,
		player_name: player.name,
		alliance_tag: player.allianceTag || null,
		alliance_rank: player.rank || null,
		ops_level: player.level,
		power: player.power,
		grade: opsLevelToGrade(player.level),
		last_synced_at: new Date().toISOString(),
	});
}

export async function enqueueDemotionCandidate(
	env: Env,
	config: GuildConfig,
	record: VerifiedPlayer,
	reason: DemotionQueueReason,
	opts: {
		status: 'pending_approval' | 'pending_recheck';
		player?: PlayerData | null;
		nextRecheckHours?: number;
	},
): Promise<void> {
	if (opts.player) {
		await refreshPlayerFieldsWithoutDemotion(
			env.STFC_DB,
			config.guild_id,
			record.discord_user_id,
			opts.player,
		);
	}

	await upsertDemotionQueueEntry(env.STFC_DB, {
		guild_id: config.guild_id,
		discord_user_id: record.discord_user_id,
		player_id: opts.player?.playerId ?? record.player_id,
		player_name: opts.player?.name ?? record.player_name,
		reason,
		status: opts.status,
		next_recheck_at:
			opts.status === 'pending_recheck'
				? hoursFromNow(opts.nextRecheckHours ?? DEMOTION_RECHECK_HOURS)
				: null,
		observed_alliance_tag: opts.player?.allianceTag ?? record.alliance_tag,
	});
}

export async function handleAutomatedDemotionCandidate(
	env: Env,
	config: GuildConfig,
	record: VerifiedPlayer,
	kind: 'alliance_mismatch' | 'player_missing',
	player: PlayerData | null,
): Promise<'demoted' | 'queued' | 'skipped' | 'would_demote' | 'would_queue'> {
	if (config.mode !== 'single_alliance') return 'skipped';
	if (isAlreadyDemotedGuest(record)) return 'skipped';

	const decision = decideDemotionCandidateAction(config.demotion_policy, kind);
	if (decision.action === 'skip') return 'skipped';

	if (isDeployTesting(config)) {
		return decision.action === 'demote_now' ? 'would_demote' : 'would_queue';
	}

	if (decision.action === 'demote_now') {
		await demotePlayerToGuest(env, config, config.guild_id, record.discord_user_id, {
			reason: kind,
			player,
			source: 'cron',
		});
		await cancelDemotionQueueEntry(env.STFC_DB, config.guild_id, record.discord_user_id);
		return 'demoted';
	}

	await enqueueDemotionCandidate(env, config, record, kind, {
		status: decision.action === 'enqueue_recheck' ? 'pending_recheck' : 'pending_approval',
		player,
	});
	return 'queued';
}

function demotionDigestComponents(guildId: string): DiscordActionRow[] {
	return [
		{
			type: 1,
			components: [
				{
					type: 2,
					style: 4,
					label: 'Approve all demotions',
					custom_id: `demote:approve:${guildId}`,
				},
				{
					type: 2,
					style: 2,
					label: 'Reject all',
					custom_id: `demote:reject:${guildId}`,
				},
			],
		},
	];
}

/** Post/update urgent digest for pending_approval rows in a guild. */
export async function postDemotionApprovalDigest(
	env: Env,
	config: GuildConfig,
): Promise<void> {
	if (isDeployTesting(config)) return;

	const pending = await listPendingApprovalDemotions(env.STFC_DB, config.guild_id);
	if (pending.length === 0) return;

	const lines = pending.slice(0, 25).map((p) => {
		const tag = p.observed_alliance_tag ? `[${p.observed_alliance_tag}]` : '(no tag)';
		const name = p.player_name ?? '—';
		const why = p.reason === 'player_missing' ? 'missing on stfc.pro' : 'alliance mismatch';
		return `• <@${p.discord_user_id}> **${name}** ${tag} — ${why}`;
	});
	const extra =
		pending.length > 25 ? `\n…and **${pending.length - 25}** more (see \`/server demotion list\`)` : '';

	const content =
		`🚨 **Pending demotions** (${pending.length}) — policy **approval**\n` +
		`Confirm before removing member roles. Or set individuals to guest with \`/roster set-guest\`.\n\n` +
		lines.join('\n') +
		extra;

	const channelId = config.urgent_notify_channel_id;
	const token = env.DISCORD_BOT_TOKEN;
	if (!channelId || !token) {
		await postAuditLog(env, config, {
			title: 'Pending demotions (no urgent channel)',
			description: content.slice(0, 1500),
			source: 'cron',
			color: AuditColor.warn,
		});
		return;
	}

	try {
		const existingMsgId = pending.find((p) => p.urgent_message_id)?.urgent_message_id;
		if (existingMsgId) {
			await editChannelMessage(token, channelId, existingMsgId, {
				content: content.slice(0, 2000),
				components: demotionDigestComponents(config.guild_id),
			});
		} else {
			const msg = await sendMessageWithComponents(token, channelId, {
				content: content.slice(0, 2000),
				components: demotionDigestComponents(config.guild_id),
			});
			await setDemotionQueueUrgentMessage(env.STFC_DB, config.guild_id, msg.id);
		}
	} catch (err) {
		console.error('Demotion digest post failed:', err);
		await postAuditLog(env, config, {
			title: 'Pending demotions (urgent post failed)',
			description: content.slice(0, 1500),
			source: 'cron',
			color: AuditColor.warn,
		});
	}
}

export async function runDemotionRecheck(env: Env): Promise<void> {
	const due = await listDueDemotionRechecks(env.STFC_DB);
	if (due.length === 0) return;

	const byGuild = new Map<string, typeof due>();
	for (const row of due) {
		const list = byGuild.get(row.guild_id) ?? [];
		list.push(row);
		byGuild.set(row.guild_id, list);
	}

	for (const [guildId, rows] of byGuild) {
		const config = await getGuildConfig(env.STFC_DB, guildId);
		if (!config || config.mode !== 'single_alliance') {
			for (const row of rows) {
				await cancelDemotionQueueEntry(env.STFC_DB, guildId, row.discord_user_id);
			}
			continue;
		}

		if (isDeployTesting(config)) {
			console.log(
				`Demotion recheck skipped for guild ${guildId} (deploy_mode=testing, ${rows.length} due)`,
			);
			continue;
		}

		let demoted = 0;
		let cancelled = 0;
		let deferred = 0;

		for (const row of rows) {
			if (!row.player_id) {
				await upsertDemotionQueueEntry(env.STFC_DB, {
					guild_id: guildId,
					discord_user_id: row.discord_user_id,
					reason: row.reason,
					status: 'pending_approval',
					player_id: row.player_id,
					player_name: row.player_name,
				});
				continue;
			}

			const lookup = await lookupPlayerByIdOrName(
				env,
				row.player_id,
				config.stfc_server,
				config.stfc_region,
			);

			if (lookup.status === 'error') {
				await upsertDemotionQueueEntry(env.STFC_DB, {
					guild_id: guildId,
					discord_user_id: row.discord_user_id,
					reason: row.reason,
					status: 'pending_recheck',
					next_recheck_at: hoursFromNow(DEMOTION_RECHECK_HOURS),
					player_id: row.player_id,
					player_name: row.player_name,
				});
				deferred++;
				continue;
			}

			if (lookup.status === 'ok') {
				if (playerMatchesGuildAlliance(config, lookup.player.allianceTag)) {
					await syncVerifiedPlayer(
						env,
						config,
						guildId,
						row.discord_user_id,
						lookup.player,
						{ autoDemoteOnMismatch: false },
					);
					await cancelDemotionQueueEntry(env.STFC_DB, guildId, row.discord_user_id);
					cancelled++;
					continue;
				}
				// Confirmed mismatch after recheck
				if (config.demotion_policy === 'yolo') {
					await demotePlayerToGuest(env, config, guildId, row.discord_user_id, {
						reason: 'alliance_mismatch',
						player: lookup.player,
						source: 'cron',
					});
					await resolveDemotionQueueEntries(env.STFC_DB, guildId, 'completed', [
						row.discord_user_id,
					]);
					demoted++;
				} else {
					await upsertDemotionQueueEntry(env.STFC_DB, {
						guild_id: guildId,
						discord_user_id: row.discord_user_id,
						reason: 'alliance_mismatch',
						status: 'pending_approval',
						player_id: lookup.player.playerId,
						player_name: lookup.player.name,
						observed_alliance_tag: lookup.player.allianceTag,
					});
				}
				continue;
			}

			// still not_found
			if (config.demotion_policy === 'yolo') {
				await demotePlayerToGuest(env, config, guildId, row.discord_user_id, {
					reason: 'player_missing',
					source: 'cron',
				});
				await resolveDemotionQueueEntries(env.STFC_DB, guildId, 'completed', [
					row.discord_user_id,
				]);
				demoted++;
			} else {
				await upsertDemotionQueueEntry(env.STFC_DB, {
					guild_id: guildId,
					discord_user_id: row.discord_user_id,
					reason: 'player_missing',
					status: 'pending_approval',
					player_id: row.player_id,
					player_name: row.player_name,
				});
			}
		}

		await postDemotionApprovalDigest(env, config);

		if (demoted || cancelled || deferred) {
			await postAuditLog(env, config, {
				title: 'Demotion recheck complete',
				description:
					`Demoted **${demoted}** · cleared **${cancelled}** · deferred **${deferred}** (API error)`,
				source: 'cron',
				color: demoted ? AuditColor.warn : AuditColor.info,
			});
		}
	}
}

export async function handleDemoteComponent(
	env: Env,
	interaction: {
		guild_id?: string;
		member?: { permissions?: string; user?: { id: string } };
		message?: { id?: string; channel_id?: string };
		data?: { custom_id?: string };
	},
): Promise<Response> {
	const customId = interaction.data?.custom_id ?? '';
	const match = customId.match(/^demote:(approve|reject):(\d{15,20})$/);
	if (!match) {
		return interactionResponse('❌ Unknown demotion button.', true);
	}

	if (!isGuildAdministrator(interaction.member?.permissions)) {
		return interactionResponse('❌ Administrator required to approve/reject demotions.', true);
	}

	const [, action, guildId] = match;
	if (interaction.guild_id && interaction.guild_id !== guildId) {
		return interactionResponse('❌ Guild mismatch.', true);
	}

	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return interactionResponse('❌ Server not configured.', true);
	}

	if (isDeployTesting(config)) {
		return updateMessageResponse(
			'[TESTING] Demotion approve/reject is disabled while deploy mode is **testing**. ' +
				'Use `/server deploy mode:live` when ready.',
			{ components: [] },
		);
	}

	const pending = await listPendingApprovalDemotions(env.STFC_DB, guildId);
	const actorId = interaction.member?.user?.id;

	if (action === 'reject') {
		await resolveDemotionQueueEntries(env.STFC_DB, guildId, 'rejected');
		await postAuditLog(env, config, {
			title: 'Demotions rejected',
			description: `Rejected **${pending.length}** pending demotion(s).`,
			actorId,
			source: 'admin',
			color: AuditColor.info,
		});
		return updateMessageResponse(
			`✅ Rejected **${pending.length}** pending demotion(s). No roles changed.`,
			{ components: [] },
		);
	}

	let ok = 0;
	let failed = 0;
	for (const row of pending) {
		const result = await demotePlayerToGuest(env, config, guildId, row.discord_user_id, {
			reason: row.reason,
			actorId,
			source: 'admin',
			requireGuestRole: true,
			skipAudit: true,
		});
		if (result.ok) ok++;
		else failed++;
	}
	await resolveDemotionQueueEntries(env.STFC_DB, guildId, 'completed');
	await postAuditLog(env, config, {
		title: 'Demotions approved',
		description: `Demoted **${ok}**` + (failed ? ` · **${failed}** failed` : ''),
		actorId,
		source: 'admin',
		color: failed ? AuditColor.warn : AuditColor.success,
	});

	return updateMessageResponse(
		`✅ Approved demotions: **${ok}** completed` +
			(failed ? `, **${failed}** failed` : '') +
			`.`,
		{ components: [] },
	);
}

export async function formatDemotionQueueList(env: Env, guildId: string): Promise<string> {
	const pending = await listPendingDemotions(env.STFC_DB, guildId);
	if (pending.length === 0) return 'No pending demotions in the queue.';
	const lines = pending.slice(0, 40).map((p) => {
		const st = p.status === 'pending_recheck' ? 'recheck' : 'approval';
		const when =
			p.status === 'pending_recheck' && p.next_recheck_at
				? ` · next ${p.next_recheck_at}`
				: '';
		return `• <@${p.discord_user_id}> **${p.player_name ?? '—'}** · ${p.reason} · ${st}${when}`;
	});
	const extra = pending.length > 40 ? `\n…and ${pending.length - 40} more` : '';
	return `📋 **Pending demotions** (${pending.length})\n${lines.join('\n')}${extra}`;
}
