/**
 * Resumable morning daily sync (alliance roster scrape + verified player sync).
 *
 * Cloudflare scheduled invocations have ~15 min wall time. Large multi-alliance
 * guilds continue across chunks via:
 * - D1 `daily_sync_jobs` cursor/state
 * - every-5-minute cron resume
 * - optional HTTP self-continue (`/internal/daily-sync-continue`) for faster finish
 */
import {
	cancelDemotionQueueEntry,
	countActiveVerifiedPlayers,
	deleteDailySyncJob,
	deleteExpiredDailySyncJobs,
	getDailySyncJob,
	getGuildConfig,
	listActiveVerifiedPlayersAfterId,
	listConfiguredGuilds,
	listDailySyncJobs,
	recordPlayerStats,
	setVerifiedPlayerActivity,
	updateDailySyncJob,
	upsertDailySyncJob,
	type DailySyncJobPhase,
} from './guild-db';
import { lookupPlayerByIdOrName } from './stfc-utils';
import { syncVerifiedPlayer } from './verification';
import { playerMatchesGuildAlliance } from './verification-access';
import {
	handleAutomatedDemotionCandidate,
	postDemotionApprovalDigest,
} from './demotion-policy';
import { AuditColor, postAuditLog } from './audit-log';
import {
	finalizePlannedMultiAllianceScrape,
	isMultiAllianceGuild,
	loadRosterPlayerMap,
	planMultiAllianceScrape,
	scrapeMultiAllianceEntries,
	shouldUseAllianceRoster,
	syncGuildAllianceRoster,
	type AllianceTagRename,
	type AllianceVanished,
	type MultiAllianceScrapeEntry,
	type PlannedMultiAllianceScrape,
} from './alliance-roster-sync';
import { applyMultiAllianceTagRenamesForCron } from './alliance-resync';
import { runDiplomacyAutoRebalance } from './diplomacy-maintenance';
import { diplomacyChannelsEnabled } from './diplomacy-channels';
import {
	allianceRosterDiffHasChanges,
	formatAllianceRosterChangeReport,
	type AllianceRosterDiff,
} from './alliance-roster-diff';
import {
	formatWouldHaveDemotionLine,
	isDeployTesting,
} from './deploy-mode';
import { applyActivityObservation } from './activity-utils';
import {
	formatReportSection,
	playerCell,
	ReportCols,
	tagCell,
} from './report-table';
import type { TableData } from './tableUtils';
import type { GuildConfig, PlayerData, VerifiedPlayer } from './types';

/** Leave headroom under CF scheduled ~15 min wall. */
export const DAILY_SYNC_INVOCATION_BUDGET_MS = 12 * 60 * 1000;

/**
 * Fetch/`waitUntil` only lasts ~30s — HTTP continue must finish (and persist) under that.
 */
export const DAILY_SYNC_HTTP_BUDGET_MS = 20_000;

/** Alliance pages scraped per budget check (multi). */
export const DAILY_SYNC_SCRAPE_CHUNK = 8;

/** Verified players loaded per D1 page while processing. */
export const DAILY_SYNC_PLAYER_PAGE = 25;

/** Persist cursor at least this often so a killed waitUntil does not lose progress. */
export const DAILY_SYNC_PERSIST_EVERY = 5;

/** Job TTL — abandoned mid-day jobs expire. */
const DAILY_SYNC_JOB_TTL_MS = 20 * 60 * 60 * 1000;

type ActivityReportRow = {
	Player: string;
	Tag: string;
	Streak: number;
	Inactive: string;
};

type SyncCounters = {
	synced: number;
	failed: number;
	demoted: number;
	queued: number;
	wouldDemote: number;
	wouldQueue: number;
	unavailable: number;
	missing: number;
	tagChanges: number;
	allianceTagRenames: number;
	rosterHits: number;
	liveLookups: number;
};

type SyncReports = {
	verifiedAllianceMoves: string[];
	verifiedRoleNotes: string[];
	becameInactiveRows: ActivityReportRow[];
	returnedActiveRows: ActivityReportRow[];
	stillInactiveRows: ActivityReportRow[];
	welcomeSentRows: TableData[];
	welcomeFailedRows: TableData[];
	syncChangeRows: TableData[];
	wouldHaveActions: string[];
};

type MultiScrapeState = {
	plan: PlannedMultiAllianceScrape;
	offset: number;
	scrapedAlliances: number;
	failedTags: string[];
	vanished: AllianceVanished[];
	tagRenames: AllianceTagRename[];
	keepAllianceIds: string[];
	rosterAuditPosted: boolean;
	lastDiff: AllianceRosterDiff | null;
};

export type DailySyncPayload = {
	rosterOk: boolean;
	playerCursorId: number;
	playersTotal: number;
	playersProcessed: number;
	progressPostedAtProcessed: number;
	counters: SyncCounters;
	reports: SyncReports;
	multi?: MultiScrapeState;
};

function emptyCounters(): SyncCounters {
	return {
		synced: 0,
		failed: 0,
		demoted: 0,
		queued: 0,
		wouldDemote: 0,
		wouldQueue: 0,
		unavailable: 0,
		missing: 0,
		tagChanges: 0,
		allianceTagRenames: 0,
		rosterHits: 0,
		liveLookups: 0,
	};
}

function emptyReports(): SyncReports {
	return {
		verifiedAllianceMoves: [],
		verifiedRoleNotes: [],
		becameInactiveRows: [],
		returnedActiveRows: [],
		stillInactiveRows: [],
		welcomeSentRows: [],
		welcomeFailedRows: [],
		syncChangeRows: [],
		wouldHaveActions: [],
	};
}

function emptyPayload(): DailySyncPayload {
	return {
		rosterOk: false,
		playerCursorId: 0,
		playersTotal: 0,
		playersProcessed: 0,
		progressPostedAtProcessed: 0,
		counters: emptyCounters(),
		reports: emptyReports(),
	};
}

function parsePayload(raw: string): DailySyncPayload {
	try {
		const parsed = JSON.parse(raw) as DailySyncPayload;
		if (!parsed?.counters || !parsed?.reports) return emptyPayload();
		return parsed;
	} catch {
		return emptyPayload();
	}
}

function budgetRemaining(deadlineMs: number): number {
	return deadlineMs - Date.now();
}

function jobExpiresAt(startedAt: string): string {
	const start = Date.parse(startedAt);
	const base = Number.isFinite(start) ? start : Date.now();
	return new Date(base + DAILY_SYNC_JOB_TTL_MS).toISOString();
}

function sameUtcDay(aIso: string, bIso: string): boolean {
	const a = aIso.slice(0, 10);
	const b = bIso.slice(0, 10);
	return Boolean(a && b && a === b);
}

async function persistJob(
	env: Env,
	guildId: string,
	startedAt: string,
	phase: DailySyncJobPhase,
	payload: DailySyncPayload,
): Promise<void> {
	await updateDailySyncJob(env.STFC_DB, guildId, {
		phase,
		payload: JSON.stringify(payload),
		expires_at: jobExpiresAt(startedAt),
	});
}

async function postProgressAudit(
	env: Env,
	config: GuildConfig,
	payload: DailySyncPayload,
	phase: DailySyncJobPhase,
): Promise<void> {
	const testing = isDeployTesting(config);
	const title = testing ? '[TESTING] Daily sync progress' : 'Daily sync progress';
	const c = payload.counters;
	await postAuditLog(env, config, {
		title,
		description:
			`Phase **${phase}**` +
			(phase === 'players'
				? ` · players **${payload.playersProcessed}/${payload.playersTotal}**`
				: '') +
			(c.synced ? ` · synced **${c.synced}**` : '') +
			(c.rosterHits ? ` · roster **${c.rosterHits}**` : '') +
			(c.liveLookups ? ` · live **${c.liveLookups}**` : '') +
			`\n_Continuing automatically (chunked under Worker wall-time limit)._`,
		source: 'cron',
		color: AuditColor.info,
	});
	payload.progressPostedAtProcessed = payload.playersProcessed;
}

async function runScrapePhase(
	env: Env,
	config: GuildConfig,
	startedAt: string,
	payload: DailySyncPayload,
	deadlineMs: number,
): Promise<{ phase: DailySyncJobPhase; payload: DailySyncPayload; paused: boolean }> {
	const testing = isDeployTesting(config);
	const testingTitle = (title: string) => (testing ? `[TESTING] ${title}` : title);

	if (shouldUseAllianceRoster(config)) {
		if (budgetRemaining(deadlineMs) < 5_000) {
			return { phase: 'scrape', payload, paused: true };
		}
		const rosterResult = await syncGuildAllianceRoster(env, config);
		if (rosterResult.ok) {
			payload.rosterOk = true;
			const report = formatAllianceRosterChangeReport(rosterResult.diff, {
				allianceTag: rosterResult.scrape.allianceTag || config.alliance_tag || 'alliance',
				allianceId: config.stfc_alliance_id ?? rosterResult.scrape.allianceId,
				mode: 'single',
			});
			await postAuditLog(env, config, {
				title: testingTitle(report.title),
				description: report.description,
				source: 'cron',
				color: allianceRosterDiffHasChanges(rosterResult.diff)
					? AuditColor.warn
					: AuditColor.info,
			});
		} else {
			console.warn(
				`Alliance roster sync failed for guild ${config.guild_id}: ${rosterResult.reason} — falling back to per-player lookups`,
			);
		}
		payload.playersTotal = await countActiveVerifiedPlayers(env.STFC_DB, config.guild_id);
		return { phase: 'players', payload, paused: false };
	}

	if (!isMultiAllianceGuild(config)) {
		payload.playersTotal = await countActiveVerifiedPlayers(env.STFC_DB, config.guild_id);
		return { phase: 'players', payload, paused: false };
	}

	if (!payload.multi) {
		if (budgetRemaining(deadlineMs) < 8_000) {
			return { phase: 'scrape', payload, paused: true };
		}
		const planned = await planMultiAllianceScrape(env, config);
		if (!planned.ok) {
			console.warn(
				`Multi alliance roster sync failed for guild ${config.guild_id}: ${planned.reason} — falling back to per-player lookups`,
			);
			payload.playersTotal = await countActiveVerifiedPlayers(env.STFC_DB, config.guild_id);
			return { phase: 'players', payload, paused: false };
		}
		payload.multi = {
			plan: planned.plan,
			offset: 0,
			scrapedAlliances: 0,
			failedTags: [],
			vanished: [],
			tagRenames: [],
			keepAllianceIds: [],
			rosterAuditPosted: false,
			lastDiff: null,
		};
	}

	const multi = payload.multi;
	while (multi.offset < multi.plan.entries.length) {
		if (budgetRemaining(deadlineMs) < 20_000) {
			await persistJob(env, config.guild_id, startedAt, 'scrape', payload);
			return { phase: 'scrape', payload, paused: true };
		}
		const slice = multi.plan.entries.slice(
			multi.offset,
			multi.offset + DAILY_SYNC_SCRAPE_CHUNK,
		) as MultiAllianceScrapeEntry[];
		const batch = await scrapeMultiAllianceEntries(env, config, slice, {
			fetchedAt: multi.plan.fetchedAt,
			progressOffset: multi.offset,
			progressTotal: multi.plan.entries.length,
		});
		multi.offset += slice.length;
		multi.scrapedAlliances += batch.scrapedAlliances;
		multi.failedTags.push(...batch.failedTags);
		multi.vanished.push(...batch.vanished);
		multi.tagRenames.push(...batch.tagRenames);
		multi.keepAllianceIds.push(...batch.keepAllianceIds);
		await persistJob(env, config.guild_id, startedAt, 'scrape', payload);
	}

	const multiResult = await finalizePlannedMultiAllianceScrape(env, config, multi.plan, {
		scrapedAlliances: multi.scrapedAlliances,
		failedTags: multi.failedTags,
		vanished: multi.vanished,
		tagRenames: multi.tagRenames,
		keepAllianceIds: multi.keepAllianceIds,
	});

	if (!multiResult.ok) {
		console.warn(
			`Multi alliance roster sync failed for guild ${config.guild_id}: ${multiResult.reason} — falling back to per-player lookups`,
		);
		payload.multi = undefined;
		payload.playersTotal = await countActiveVerifiedPlayers(env.STFC_DB, config.guild_id);
		return { phase: 'players', payload, paused: false };
	}

	payload.rosterOk = true;
	multi.lastDiff = multiResult.diff;

	if (!multi.rosterAuditPosted) {
		const report = formatAllianceRosterChangeReport(multiResult.diff, {
			allianceTag: 'multi',
			mode: 'multi',
			alliancesScraped: multiResult.scrapedAlliances,
		});
		let extra = '';
		if (multiResult.failedTags.length) {
			extra += `\n⚠ Failed alliance pages: ${multiResult.failedTags.slice(0, 15).join(', ')}`;
		}
		if (multiResult.skippedTags.length) {
			extra += `\n⏭ Skipped (no alliance id on file): ${multiResult.skippedTags.slice(0, 15).join(', ')}`;
		}
		if (multiResult.vanished.length) {
			extra += `\n🕊 Vanished: ${multiResult.vanished.map((v) => v.tag).slice(0, 15).join(', ')}`;
		}
		if (multiResult.tagRenames.length) {
			extra += `\n🏷 Alliance tag renames: ${multiResult.tagRenames
				.map((r) => `\`${r.fromTag}\`→\`${r.toTag}\``)
				.join(', ')}`;
		}
		await postAuditLog(env, config, {
			title: testingTitle(report.title),
			description:
				report.description +
				`\n_Directory **${multiResult.directoryCount}** · tracked tags **${multiResult.trackedTags}**_` +
				extra,
			source: 'cron',
			color:
				allianceRosterDiffHasChanges(multiResult.diff) ||
				multiResult.tagRenames.length ||
				multiResult.vanished.length
					? AuditColor.warn
					: AuditColor.info,
		});
		multi.rosterAuditPosted = true;
	}

	let nextConfig = config;
	if (multiResult.tagRenames.length) {
		payload.counters.allianceTagRenames = multiResult.tagRenames.length;
		nextConfig = await applyMultiAllianceTagRenamesForCron(env, nextConfig, multiResult);
	}
	if (multiResult.vanished.length) {
		const { applyVanishedAlliances } = await import('./diplomacy-maintenance');
		const vanished = await applyVanishedAlliances(env, nextConfig, multiResult.vanished, {
			source: 'cron',
		});
		nextConfig = vanished.config;
	}
	// Config mutations persist in D1; reload not required for payload.
	void nextConfig;

	payload.playersTotal = await countActiveVerifiedPlayers(env.STFC_DB, config.guild_id);
	return { phase: 'players', payload, paused: false };
}

async function syncOneVerifiedPlayer(
	env: Env,
	config: GuildConfig,
	record: VerifiedPlayer,
	rosterMap: Map<number, PlayerData> | null,
	rosterOk: boolean,
	payload: DailySyncPayload,
): Promise<void> {
	if (!record.player_id) return;

	const c = payload.counters;
	const reports = payload.reports;
	const testing = isDeployTesting(config);

	const pushActivityRow = (
		act: {
			activityStreak: number;
			daysInactive: number;
			becameInactive: boolean;
			returnedActive: boolean;
			inactiveDayAdded: boolean;
		},
		playerName: string | null | undefined,
		allianceTag: string | null | undefined,
	) => {
		const row: ActivityReportRow = {
			Player: playerCell(playerName),
			Tag: tagCell(allianceTag),
			Streak: act.activityStreak,
			Inactive: `${act.daysInactive}d`,
		};
		if (act.becameInactive) reports.becameInactiveRows.push(row);
		else if (act.returnedActive) reports.returnedActiveRows.push(row);
		else if (act.inactiveDayAdded && act.daysInactive >= 3) {
			reports.stillInactiveRows.push(row);
		}
	};

	try {
		let player: PlayerData | null = null;
		let notFound = false;

		if (rosterMap) {
			player = rosterMap.get(record.player_id) ?? null;
			if (player) {
				c.rosterHits++;
			} else if (rosterOk && shouldUseAllianceRoster(config)) {
				notFound = true;
			}
		}

		if (!player && !notFound) {
			c.liveLookups++;
			const lookup = await lookupPlayerByIdOrName(
				env,
				record.player_id,
				config.stfc_server,
				config.stfc_region,
			);
			if (lookup.status === 'error') {
				c.unavailable++;
				return;
			}
			if (lookup.status === 'not_found') {
				notFound = true;
			} else {
				player = lookup.player;
			}
		}

		if (notFound || !player) {
			c.missing++;
			if (config.mode === 'single_alliance') {
				const kind = rosterOk ? 'alliance_mismatch' : 'player_missing';
				const result = await handleAutomatedDemotionCandidate(
					env,
					config,
					record,
					kind,
					null,
				);
				if (result === 'demoted') c.demoted++;
				else if (result === 'queued') c.queued++;
				else if (result === 'would_demote' || result === 'would_queue') {
					if (result === 'would_demote') c.wouldDemote++;
					else c.wouldQueue++;
					reports.wouldHaveActions.push(
						formatWouldHaveDemotionLine({
							discordUserId: record.discord_user_id,
							playerName: record.player_name,
							kind,
							policy: config.demotion_policy,
						}),
					);
				}
			}
			return;
		}

		const prevTag = record.alliance_tag;
		const tagChanged = prevTag && player.allianceTag && prevTag !== player.allianceTag;
		const matches = playerMatchesGuildAlliance(config, player.allianceTag);

		if (!matches && config.mode === 'single_alliance') {
			if (
				player.consecutiveDaysActive != null &&
				Number.isFinite(player.consecutiveDaysActive)
			) {
				const act = applyActivityObservation(
					record.activity_streak,
					record.days_inactive,
					player.consecutiveDaysActive,
				);
				await setVerifiedPlayerActivity(
					env.STFC_DB,
					config.guild_id,
					record.discord_user_id,
					{
						activity_streak: act.activityStreak,
						days_inactive: act.daysInactive,
					},
				);
				pushActivityRow(act, player.name, player.allianceTag);
			}
			const result = await handleAutomatedDemotionCandidate(
				env,
				config,
				record,
				'alliance_mismatch',
				player,
			);
			if (result === 'demoted') c.demoted++;
			else if (result === 'queued') c.queued++;
			else if (result === 'would_demote' || result === 'would_queue') {
				if (result === 'would_demote') c.wouldDemote++;
				else c.wouldQueue++;
				reports.wouldHaveActions.push(
					formatWouldHaveDemotionLine({
						discordUserId: record.discord_user_id,
						playerName: player.name || record.player_name,
						kind: 'alliance_mismatch',
						policy: config.demotion_policy,
					}),
				);
			}
			if (tagChanged) c.tagChanges++;
			return;
		}

		const syncResult = await syncVerifiedPlayer(
			env,
			config,
			config.guild_id,
			record.discord_user_id,
			player,
			{ autoDemoteOnMismatch: false, deferSyncAudit: true },
		);
		await recordPlayerStats(
			env.STFC_DB,
			record.id,
			player.level,
			player.power,
			player.allianceTag,
		);
		await cancelDemotionQueueEntry(env.STFC_DB, config.guild_id, record.discord_user_id);
		c.synced++;

		if (tagChanged) {
			c.tagChanges++;
			console.log(
				`Alliance change: ${record.player_name} ${prevTag} → ${player.allianceTag} (guild ${config.guild_id})`,
			);
			if (isMultiAllianceGuild(config)) {
				reports.verifiedAllianceMoves.push(
					`• <@${record.discord_user_id}> **${player.name}** — [${prevTag}] → **[${player.allianceTag}]**` +
						(player.rank ? ` · ${player.rank}` : ''),
				);
			}
		}
		if (
			isMultiAllianceGuild(config) &&
			syncResult.outcome === 'synced' &&
			syncResult.changeSummary
		) {
			const roleBits = syncResult.changeSummary.filter(
				(ch) => ch.startsWith('Roles:') || ch.startsWith('rank '),
			);
			if (roleBits.length && !roleBits.every((ch) => ch === 'Roles: no changes')) {
				reports.verifiedRoleNotes.push(
					`• <@${record.discord_user_id}> **${player.name}** — ${roleBits
						.filter((ch) => ch !== 'Roles: no changes')
						.join('; ')}`,
				);
			}
		}

		const act = syncResult.activity;
		if (act) {
			pushActivityRow(act, player.name, player.allianceTag);
		}

		if (syncResult.welcomeNote) {
			const note = syncResult.welcomeNote;
			const short = note.length > 40 ? `${note.slice(0, 37)}…` : note;
			const row = {
				Player: playerCell(player.name),
				Tag: tagCell(player.allianceTag),
				Note: short.replace(/^Failed to send Welcome DM/i, 'failed').replace(/^welcome DM /i, ''),
			};
			if (syncResult.welcomeSent) reports.welcomeSentRows.push(row);
			else if (/failed/i.test(note)) reports.welcomeFailedRows.push(row);
			else if (/sent/i.test(note)) reports.welcomeSentRows.push(row);
			else if (!/skipped/i.test(note)) reports.welcomeFailedRows.push(row);
		}

		const material = (syncResult.changeSummary ?? []).filter((ch) => {
			if (!ch || ch === 'Roles: no changes') return false;
			if (/^(became inactive|returned active|still inactive)/i.test(ch)) return false;
			return true;
		});
		if (material.length) {
			reports.syncChangeRows.push({
				Player: playerCell(player.name),
				Tag: tagCell(player.allianceTag),
				Changes: material.join('; ').slice(0, 48),
			});
		}
	} catch (error) {
		c.failed++;
		console.error(`Daily sync failed for player ${record.player_id}:`, error);
	}

	void testing;
}

async function runPlayersPhase(
	env: Env,
	config: GuildConfig,
	startedAt: string,
	payload: DailySyncPayload,
	deadlineMs: number,
): Promise<{ phase: DailySyncJobPhase; payload: DailySyncPayload; paused: boolean }> {
	let rosterMap: Map<number, PlayerData> | null = null;
	if (payload.rosterOk) {
		rosterMap = await loadRosterPlayerMap(env, config);
	}

	const minRemainingMs = Math.min(12_000, Math.max(3_000, (deadlineMs - Date.now()) / 4));

	while (budgetRemaining(deadlineMs) > minRemainingMs) {
		const page = await listActiveVerifiedPlayersAfterId(
			env.STFC_DB,
			config.guild_id,
			payload.playerCursorId,
			DAILY_SYNC_PLAYER_PAGE,
		);
		if (!page.length) {
			return { phase: 'finalize', payload, paused: false };
		}

		for (const record of page) {
			if (budgetRemaining(deadlineMs) < minRemainingMs) {
				await persistJob(env, config.guild_id, startedAt, 'players', payload);
				if (
					payload.playersProcessed - payload.progressPostedAtProcessed >= 50 ||
					payload.progressPostedAtProcessed === 0
				) {
					await postProgressAudit(env, config, payload, 'players');
				}
				return { phase: 'players', payload, paused: true };
			}
			await syncOneVerifiedPlayer(
				env,
				config,
				record,
				rosterMap,
				payload.rosterOk,
				payload,
			);
			payload.playerCursorId = record.id;
			payload.playersProcessed++;
			if (payload.playersProcessed % DAILY_SYNC_PERSIST_EVERY === 0) {
				await persistJob(env, config.guild_id, startedAt, 'players', payload);
			}
		}
		await persistJob(env, config.guild_id, startedAt, 'players', payload);
	}

	await persistJob(env, config.guild_id, startedAt, 'players', payload);
	if (
		payload.playersProcessed - payload.progressPostedAtProcessed >= 50 ||
		payload.progressPostedAtProcessed === 0
	) {
		await postProgressAudit(env, config, payload, 'players');
	}
	return { phase: 'players', payload, paused: true };
}

async function runFinalizePhase(
	env: Env,
	config: GuildConfig,
	payload: DailySyncPayload,
): Promise<void> {
	const testing = isDeployTesting(config);
	const testingTitle = (title: string) => (testing ? `[TESTING] ${title}` : title);
	const c = payload.counters;
	const reports = payload.reports;

	await postDemotionApprovalDigest(env, config);

	if (
		isMultiAllianceGuild(config) &&
		diplomacyChannelsEnabled(config) &&
		env.DISCORD_BOT_TOKEN &&
		!testing
	) {
		const latest = (await getGuildConfig(env.STFC_DB, config.guild_id)) ?? config;
		const hasDiplomacyChannels = Object.keys(latest.diplomacy_channel_map ?? {}).length > 0;
		await runDiplomacyAutoRebalance(env, env.DISCORD_BOT_TOKEN, latest, config.guild_id, {
			force: c.allianceTagRenames > 0 && hasDiplomacyChannels,
			reason:
				c.allianceTagRenames > 0
					? `morning sync (${c.allianceTagRenames} alliance tag rename(s))`
					: 'morning sync',
			source: 'cron',
		});
	}

	if (testing && reports.wouldHaveActions.length > 0) {
		let description =
			`Deploy mode is **testing** — no demotions or leave queues were applied.\n\n` +
			`**Would have acted (${reports.wouldHaveActions.length})**\n` +
			reports.wouldHaveActions.slice(0, 30).join('\n') +
			(reports.wouldHaveActions.length > 30
				? `\n_…and ${reports.wouldHaveActions.length - 30} more_`
				: '') +
			`\n\n_Policy **${config.demotion_policy}** · go live: \`/server deploy mode:live\`_`;
		if (description.length > 3900) {
			description = description.slice(0, 3890) + '\n_…truncated_';
		}
		await postAuditLog(env, config, {
			title: '[TESTING] Daily sync — dry-run demotion actions',
			description,
			source: 'cron',
			color: AuditColor.warn,
		});
	}

	if (
		reports.becameInactiveRows.length ||
		reports.returnedActiveRows.length ||
		reports.stillInactiveRows.length
	) {
		const activityCols = [
			ReportCols.player,
			ReportCols.tag,
			ReportCols.streak,
			ReportCols.inactive,
		];
		const tableOpts = { maxRows: 25, maxChars: 1200 };
		const sections: string[] = [];
		if (reports.becameInactiveRows.length) {
			sections.push(
				formatReportSection(
					'Became inactive',
					reports.becameInactiveRows as TableData[],
					activityCols,
					tableOpts,
				),
			);
		}
		if (reports.returnedActiveRows.length) {
			sections.push(
				formatReportSection(
					'Returned active',
					reports.returnedActiveRows as TableData[],
					activityCols,
					tableOpts,
				),
			);
		}
		if (reports.stillInactiveRows.length) {
			sections.push(
				formatReportSection(
					'Still inactive ≥3d',
					reports.stillInactiveRows as TableData[],
					activityCols,
					tableOpts,
				),
			);
		}
		let description = sections.filter(Boolean).join('\n\n');
		if (description.length > 3900) {
			description = description.slice(0, 3890) + '\n_…truncated_';
		}
		await postAuditLog(env, config, {
			title: testingTitle('Player activity — streak / inactive'),
			description,
			source: 'cron',
			color:
				reports.becameInactiveRows.length || reports.stillInactiveRows.length
					? AuditColor.warn
					: AuditColor.info,
		});
	}

	if (
		reports.welcomeSentRows.length ||
		reports.welcomeFailedRows.length ||
		reports.syncChangeRows.length
	) {
		const tableOpts = { maxRows: 25, maxChars: 1100 };
		const noteCols = [ReportCols.player, ReportCols.tag, { header: 'Note', width: 28 }];
		const changeCols = [ReportCols.player, ReportCols.tag, { header: 'Changes', width: 28 }];
		const sections: string[] = [];
		if (reports.welcomeSentRows.length) {
			sections.push(
				formatReportSection('Welcome DM sent', reports.welcomeSentRows, noteCols, tableOpts),
			);
		}
		if (reports.welcomeFailedRows.length) {
			sections.push(
				formatReportSection(
					'Welcome DM failed',
					reports.welcomeFailedRows,
					noteCols,
					tableOpts,
				),
			);
		}
		if (reports.syncChangeRows.length) {
			sections.push(
				formatReportSection(
					'Other sync changes',
					reports.syncChangeRows,
					changeCols,
					tableOpts,
				),
			);
		}
		let description = sections.filter(Boolean).join('\n\n');
		if (description.length > 3900) {
			description = description.slice(0, 3890) + '\n_…truncated_';
		}
		await postAuditLog(env, config, {
			title: testingTitle('Player sync — daily updates'),
			description,
			source: 'cron',
			color:
				reports.welcomeFailedRows.length || reports.syncChangeRows.length
					? AuditColor.warn
					: AuditColor.info,
		});
	}

	if (
		isMultiAllianceGuild(config) &&
		(reports.verifiedAllianceMoves.length || reports.verifiedRoleNotes.length)
	) {
		const sections: string[] = [];
		if (reports.verifiedAllianceMoves.length) {
			sections.push(
				`**Alliance moves (${reports.verifiedAllianceMoves.length})**`,
				reports.verifiedAllianceMoves.slice(0, 25).join('\n') +
					(reports.verifiedAllianceMoves.length > 25
						? `\n_…and ${reports.verifiedAllianceMoves.length - 25} more_`
						: ''),
			);
		}
		if (reports.verifiedRoleNotes.length) {
			sections.push(
				`**Role / rank updates (${reports.verifiedRoleNotes.length})**`,
				reports.verifiedRoleNotes.slice(0, 25).join('\n') +
					(reports.verifiedRoleNotes.length > 25
						? `\n_…and ${reports.verifiedRoleNotes.length - 25} more_`
						: ''),
			);
		}
		let description = sections.join('\n\n');
		if (description.length > 3900) {
			description = description.slice(0, 3890) + '\n_…truncated_';
		}
		await postAuditLog(env, config, {
			title: testingTitle('Verified players — daily alliance / role changes'),
			description,
			source: 'cron',
			color: AuditColor.warn,
		});
	}

	if (
		c.synced > 0 ||
		c.failed > 0 ||
		c.demoted > 0 ||
		c.queued > 0 ||
		c.wouldDemote > 0 ||
		c.wouldQueue > 0 ||
		c.unavailable > 0 ||
		c.missing > 0 ||
		c.rosterHits > 0
	) {
		await postAuditLog(env, config, {
			title: testingTitle('Daily player sync complete'),
			description:
				`Synced **${c.synced}**` +
				(c.rosterHits ? ` · **${c.rosterHits}** from alliance roster` : '') +
				(c.liveLookups ? ` · **${c.liveLookups}** live stfc.pro` : '') +
				(c.failed ? ` · **${c.failed}** failed` : '') +
				(c.demoted ? ` · **${c.demoted}** set to guest` : '') +
				(c.queued ? ` · **${c.queued}** queued for leave review` : '') +
				(c.wouldDemote || c.wouldQueue
					? ` · **${c.wouldDemote + c.wouldQueue}** would-have demotion action(s) (testing)`
					: '') +
				(c.missing ? ` · **${c.missing}** missing / left alliance` : '') +
				(c.unavailable ? ` · **${c.unavailable}** stfc.pro unavailable (skipped)` : '') +
				(c.tagChanges ? ` · **${c.tagChanges}** alliance change(s)` : '') +
				` · policy **${config.demotion_policy}**` +
				(testing ? ' · deploy **testing**' : ''),
			source: 'cron',
			color: c.failed || c.demoted || c.unavailable ? AuditColor.warn : AuditColor.info,
		});
	}
}

async function processGuildJob(
	env: Env,
	guildId: string,
	deadlineMs: number,
): Promise<{ done: boolean; paused: boolean }> {
	const row = await getDailySyncJob(env.STFC_DB, guildId);
	if (!row) return { done: true, paused: false };

	let config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		await deleteDailySyncJob(env.STFC_DB, guildId);
		return { done: true, paused: false };
	}

	let phase = row.phase;
	let payload = parsePayload(row.payload);
	const startedAt = row.started_at;

	if (phase === 'scrape') {
		const scrape = await runScrapePhase(env, config, startedAt, payload, deadlineMs);
		phase = scrape.phase;
		payload = scrape.payload;
		config = (await getGuildConfig(env.STFC_DB, guildId)) ?? config;
		await persistJob(env, guildId, startedAt, phase, payload);
		if (scrape.paused) return { done: false, paused: true };
	}

	if (phase === 'players') {
		const players = await runPlayersPhase(env, config, startedAt, payload, deadlineMs);
		phase = players.phase;
		payload = players.payload;
		await persistJob(env, guildId, startedAt, phase, payload);
		if (players.paused) return { done: false, paused: true };
	}

	if (phase === 'finalize') {
		config = (await getGuildConfig(env.STFC_DB, guildId)) ?? config;
		await runFinalizePhase(env, config, payload);
		await deleteDailySyncJob(env.STFC_DB, guildId);
		return { done: true, paused: false };
	}

	return { done: false, paused: false };
}

async function ensureTodaysJobs(env: Env): Promise<void> {
	const nowIso = new Date().toISOString();
	await deleteExpiredDailySyncJobs(env.STFC_DB, nowIso);

	const existing = await listDailySyncJobs(env.STFC_DB);
	for (const job of existing) {
		if (!sameUtcDay(job.started_at, nowIso)) {
			console.warn(
				`Daily sync: abandoning stale job guild=${job.guild_id} started=${job.started_at}`,
			);
			await deleteDailySyncJob(env.STFC_DB, job.guild_id);
		}
	}

	const guilds = await listConfiguredGuilds(env.STFC_DB);
	for (const config of guilds) {
		const job = await getDailySyncJob(env.STFC_DB, config.guild_id);
		if (job && sameUtcDay(job.started_at, nowIso)) continue;
		const startedAt = nowIso;
		await upsertDailySyncJob(env.STFC_DB, {
			guild_id: config.guild_id,
			started_at: startedAt,
			phase: 'scrape',
			payload: JSON.stringify(emptyPayload()),
			expires_at: jobExpiresAt(startedAt),
		});
	}
}

async function scheduleSelfContinue(env: Env, ctx?: ExecutionContext): Promise<void> {
	const base = env.WORKER_URL?.replace(/\/$/, '');
	if (!base || !env.DISCORD_BOT_TOKEN) {
		console.log(
			'Daily sync: more work remains — will resume on the every-5-minute cron',
		);
		return;
	}
	const run = async () => {
		try {
			const res = await fetch(`${base}/internal/daily-sync-continue`, {
				method: 'POST',
				headers: {
					Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
					'Content-Type': 'application/json',
				},
				body: '{}',
			});
			if (!res.ok) {
				const body = await res.text().catch(() => '');
				console.error('Daily sync self-continue failed:', res.status, body);
			}
		} catch (err) {
			console.error('Daily sync self-continue error:', err);
		}
	};
	if (ctx) ctx.waitUntil(run());
	else await run();
}

/**
 * Process incomplete daily sync jobs until wall budget is exhausted.
 * @param startFresh when true (morning cron), create today's jobs for all guilds.
 * @param budgetMs override wall budget (HTTP continue uses a short budget).
 */
export async function runDailyPlayerSync(
	env: Env,
	opts?: { startFresh?: boolean; ctx?: ExecutionContext; budgetMs?: number },
): Promise<void> {
	const startFresh = opts?.startFresh ?? true;
	const budgetMs = opts?.budgetMs ?? DAILY_SYNC_INVOCATION_BUDGET_MS;
	console.log(
		startFresh
			? 'Cron: daily player sync starting (chunked)'
			: `Cron: daily player sync continue (budget ${budgetMs}ms)`,
	);

	if (startFresh) {
		await ensureTodaysJobs(env);
	} else {
		await deleteExpiredDailySyncJobs(env.STFC_DB);
	}

	const deadlineMs = Date.now() + budgetMs;
	const jobs = await listDailySyncJobs(env.STFC_DB);
	if (!jobs.length) {
		console.log('Cron: daily player sync — no jobs');
		return;
	}

	let anyPaused = false;
	for (const job of jobs) {
		if (budgetRemaining(deadlineMs) < Math.min(10_000, budgetMs / 3)) {
			anyPaused = true;
			break;
		}
		const result = await processGuildJob(env, job.guild_id, deadlineMs);
		if (result.paused) anyPaused = true;
	}

	const remaining = await listDailySyncJobs(env.STFC_DB);
	if (remaining.length || anyPaused) {
		console.log(
			`Cron: daily player sync paused with ${remaining.length} guild job(s) remaining`,
		);
		// One optional self-continue after the morning kickoff; further chunks use */5
		// (avoids unbounded HTTP chains and overlaps with the every-5-minute cron).
		if (startFresh && remaining.length) {
			await scheduleSelfContinue(env, opts?.ctx);
		}
	} else {
		console.log('Cron: daily player sync complete');
	}
}

/** Resume incomplete jobs only (every-5-minute cron). */
export async function continueDailyPlayerSync(
	env: Env,
	ctx?: ExecutionContext,
): Promise<void> {
	const jobs = await listDailySyncJobs(env.STFC_DB);
	if (!jobs.length) return;

	// HTTP continue chains its own self-continue; cron path skips if recently touched.
	const recentlyTouched = jobs.some((j) => {
		const t = Date.parse(j.updated_at);
		return Number.isFinite(t) && Date.now() - t < 90_000;
	});
	if (recentlyTouched) {
		console.log('Cron: daily sync continue skipped — job updated within 90s (chunk in flight)');
		return;
	}

	await runDailyPlayerSync(env, { startFresh: false, ctx });
}

/** HTTP handler — continue chunked daily sync in a fresh invocation. */
export async function handleDailySyncContinue(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const auth = request.headers.get('Authorization') ?? '';
	const expected = env.DISCORD_BOT_TOKEN ? `Bot ${env.DISCORD_BOT_TOKEN}` : '';
	if (!expected || auth !== expected) {
		return new Response('Unauthorized', { status: 401 });
	}

	ctx.waitUntil(
		runDailyPlayerSync(env, {
			startFresh: false,
			ctx,
			budgetMs: DAILY_SYNC_HTTP_BUDGET_MS,
		})
			.then(async () => {
				const remaining = await listDailySyncJobs(env.STFC_DB);
				if (remaining.length) {
					// Chain another short HTTP chunk (fetch waitUntil ~30s each).
					await scheduleSelfContinue(env);
				}
			})
			.catch((err) => {
				console.error('Daily sync continue failed:', err);
			}),
	);
	return new Response('accepted', { status: 202 });
}
