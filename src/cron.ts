import {
	listConfiguredGuilds,
	listActiveVerifiedPlayers,
	recordPlayerStats,
	cancelDemotionQueueEntry,
	setVerifiedPlayerActivity,
	getGuildConfig,
} from './guild-db';
import { lookupPlayerByIdOrName } from './stfc-utils';
import { syncVerifiedPlayer } from './verification';
import { playerMatchesGuildAlliance } from './verification-access';
import {
	handleAutomatedDemotionCandidate,
	postDemotionApprovalDigest,
	runDemotionRecheck,
} from './demotion-policy';
import { syncGuildMembers } from './member-sync';
import { wakeDiscordGateway } from './discord-gateway/wake';
import { AuditColor, postAuditLog } from './audit-log';
import { listSurveysDueToClose, updateSurvey } from './survey-db';
import { sendChannelMessage } from './discord-api';
import { formatSurveyDeliveryTitle } from './survey-service';
import {
	isMultiAllianceGuild,
	loadRosterPlayerMap,
	lookupPlayerFromAllianceRoster,
	shouldUseAllianceRoster,
	syncGuildAllianceRoster,
	syncMultiAllianceTrackedRosters,
} from './alliance-roster-sync';
import { applyMultiAllianceTagRenamesForCron } from './alliance-resync';
import { runDiplomacyAutoRebalance } from './diplomacy-maintenance';
import { diplomacyChannelsEnabled } from './diplomacy-channels';
import {
	allianceRosterDiffHasChanges,
	formatAllianceRosterChangeReport,
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
import type { PlayerData } from './types';

type ActivityReportRow = {
	Player: string;
	Tag: string;
	Streak: number;
	Inactive: string;
};

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

export async function runDailyPlayerSync(env: Env): Promise<void> {
	console.log('Cron: daily player sync starting');

	const guilds = await listConfiguredGuilds(env.STFC_DB);

	for (let config of guilds) {
		const players = await listActiveVerifiedPlayers(env.STFC_DB, config.guild_id);
		let synced = 0;
		let failed = 0;
		let demoted = 0;
		let queued = 0;
		let wouldDemote = 0;
		let wouldQueue = 0;
		let unavailable = 0;
		let missing = 0;
		let tagChanges = 0;
		let allianceTagRenames = 0;
		let rosterHits = 0;
		let liveLookups = 0;
		const verifiedAllianceMoves: string[] = [];
		const verifiedRoleNotes: string[] = [];
		const becameInactiveRows: ActivityReportRow[] = [];
		const returnedActiveRows: ActivityReportRow[] = [];
		const stillInactiveRows: ActivityReportRow[] = [];
		const welcomeSentRows: TableData[] = [];
		const welcomeFailedRows: TableData[] = [];
		const syncChangeRows: TableData[] = [];
		const wouldHaveActions: string[] = [];

		const pushActivityRow = (
			act: { activityStreak: number; daysInactive: number; becameInactive: boolean; returnedActive: boolean; inactiveDayAdded: boolean },
			playerName: string | null | undefined,
			allianceTag: string | null | undefined,
		) => {
			const row: ActivityReportRow = {
				Player: playerCell(playerName),
				Tag: tagCell(allianceTag),
				Streak: act.activityStreak,
				Inactive: `${act.daysInactive}d`,
			};
			if (act.becameInactive) becameInactiveRows.push(row);
			else if (act.returnedActive) returnedActiveRows.push(row);
			else if (act.inactiveDayAdded && act.daysInactive >= 3) {
				stillInactiveRows.push(row);
			}
		};
		const testing = isDeployTesting(config);
		const testingTitle = (title: string) => (testing ? `[TESTING] ${title}` : title);

		let rosterMap: Map<number, PlayerData> | null = null;
		let rosterOk = false;

		if (shouldUseAllianceRoster(config)) {
			const rosterResult = await syncGuildAllianceRoster(env, config);
			if (rosterResult.ok) {
				rosterOk = true;
				rosterMap = await loadRosterPlayerMap(env, config);
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
		} else if (isMultiAllianceGuild(config)) {
			const multiResult = await syncMultiAllianceTrackedRosters(env, config);
			if (multiResult.ok) {
				rosterOk = true;
				rosterMap = await loadRosterPlayerMap(env, config);
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
					extra += `\n⏭ Skipped (not on server list / over batch cap): ${multiResult.skippedTags.slice(0, 15).join(', ')}`;
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
					color: allianceRosterDiffHasChanges(multiResult.diff)
						? AuditColor.warn
						: AuditColor.info,
				});

				if (multiResult.tagRenames.length && env.DISCORD_BOT_TOKEN && !isDeployTesting(config)) {
					allianceTagRenames = multiResult.tagRenames.length;
					config = await applyMultiAllianceTagRenamesForCron(env, config, multiResult);
					rosterMap = await loadRosterPlayerMap(env, config);
				}
			} else {
				console.warn(
					`Multi alliance roster sync failed for guild ${config.guild_id}: ${multiResult.reason} — falling back to per-player lookups`,
				);
			}
		}

		for (const record of players) {
			if (!record.player_id) continue;

			try {
				let player: PlayerData | null = null;
				let notFound = false;

				if (rosterMap) {
					player = rosterMap.get(record.player_id) ?? null;
					if (player) {
						rosterHits++;
					} else if (rosterOk && shouldUseAllianceRoster(config)) {
						// Single-alliance: absent from the one alliance page → left / wrong tag.
						notFound = true;
					}
					// Multi: absent from tracked rosters → live player page (new/empty/untracked tag).
				}

				if (!player && !notFound) {
					liveLookups++;
					const lookup = await lookupPlayerByIdOrName(
						env,
						record.player_id,
						config.stfc_server,
						config.stfc_region,
					);
					if (lookup.status === 'error') {
						unavailable++;
						continue;
					}
					if (lookup.status === 'not_found') {
						notFound = true;
					} else {
						player = lookup.player;
					}
				}

				if (notFound || !player) {
					missing++;
					if (config.mode === 'single_alliance') {
						const kind = rosterOk ? 'alliance_mismatch' : 'player_missing';
						const result = await handleAutomatedDemotionCandidate(
							env,
							config,
							record,
							kind,
							null,
						);
						if (result === 'demoted') demoted++;
						else if (result === 'queued') queued++;
						else if (result === 'would_demote' || result === 'would_queue') {
							if (result === 'would_demote') wouldDemote++;
							else wouldQueue++;
							wouldHaveActions.push(
								formatWouldHaveDemotionLine({
									discordUserId: record.discord_user_id,
									playerName: record.player_name,
									kind,
									policy: config.demotion_policy,
								}),
							);
						}
					}
					continue;
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
					if (result === 'demoted') demoted++;
					else if (result === 'queued') queued++;
					else if (result === 'would_demote' || result === 'would_queue') {
						if (result === 'would_demote') wouldDemote++;
						else wouldQueue++;
						wouldHaveActions.push(
							formatWouldHaveDemotionLine({
								discordUserId: record.discord_user_id,
								playerName: player.name || record.player_name,
								kind: 'alliance_mismatch',
								policy: config.demotion_policy,
							}),
						);
					}
					if (tagChanged) tagChanges++;
					continue;
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
				await cancelDemotionQueueEntry(
					env.STFC_DB,
					config.guild_id,
					record.discord_user_id,
				);
				synced++;

				if (tagChanged) {
					tagChanges++;
					console.log(
						`Alliance change: ${record.player_name} ${prevTag} → ${player.allianceTag} (guild ${config.guild_id})`,
					);
					if (isMultiAllianceGuild(config)) {
						verifiedAllianceMoves.push(
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
						(c) => c.startsWith('Roles:') || c.startsWith('rank '),
					);
					if (roleBits.length && !roleBits.every((c) => c === 'Roles: no changes')) {
						verifiedRoleNotes.push(
							`• <@${record.discord_user_id}> **${player.name}** — ${roleBits.filter((c) => c !== 'Roles: no changes').join('; ')}`,
						);
					}
				}

				const act = syncResult.activity;
				if (act) {
					pushActivityRow(act, player.name, player.allianceTag);
				}

				if (syncResult.welcomeNote) {
					const note = syncResult.welcomeNote;
					const short =
						note.length > 40 ? `${note.slice(0, 37)}…` : note;
					const row = {
						Player: playerCell(player.name),
						Tag: tagCell(player.allianceTag),
						Note: short.replace(/^Failed to send Welcome DM/i, 'failed').replace(/^welcome DM /i, ''),
					};
					if (syncResult.welcomeSent) welcomeSentRows.push(row);
					else if (/failed/i.test(note)) welcomeFailedRows.push(row);
					else if (/sent/i.test(note)) welcomeSentRows.push(row);
					// skip silent admin/testing notes from the failed table
					else if (!/skipped/i.test(note)) welcomeFailedRows.push(row);
				}

				const material = (syncResult.changeSummary ?? []).filter((c) => {
					if (!c || c === 'Roles: no changes') return false;
					// Activity is covered by the streak/inactive report.
					if (/^(became inactive|returned active|still inactive)/i.test(c)) return false;
					return true;
				});
				if (material.length) {
					syncChangeRows.push({
						Player: playerCell(player.name),
						Tag: tagCell(player.allianceTag),
						Changes: material.join('; ').slice(0, 48),
					});
				}
			} catch (error) {
				failed++;
				console.error(`Daily sync failed for player ${record.player_id}:`, error);
			}
		}

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
				force: allianceTagRenames > 0 && hasDiplomacyChannels,
				reason:
					allianceTagRenames > 0
						? `morning sync (${allianceTagRenames} alliance tag rename(s))`
						: 'morning sync',
				source: 'cron',
			});
		}

		if (testing && wouldHaveActions.length > 0) {
			let description =
				`Deploy mode is **testing** — no demotions or leave queues were applied.\n\n` +
				`**Would have acted (${wouldHaveActions.length})**\n` +
				wouldHaveActions.slice(0, 30).join('\n') +
				(wouldHaveActions.length > 30
					? `\n_…and ${wouldHaveActions.length - 30} more_`
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

		if (becameInactiveRows.length || returnedActiveRows.length || stillInactiveRows.length) {
			const activityCols = [
				ReportCols.player,
				ReportCols.tag,
				ReportCols.streak,
				ReportCols.inactive,
			];
			const tableOpts = { maxRows: 25, maxChars: 1200 };
			const sections: string[] = [];
			if (becameInactiveRows.length) {
				sections.push(
					formatReportSection(
						'Became inactive',
						becameInactiveRows as TableData[],
						activityCols,
						tableOpts,
					),
				);
			}
			if (returnedActiveRows.length) {
				sections.push(
					formatReportSection(
						'Returned active',
						returnedActiveRows as TableData[],
						activityCols,
						tableOpts,
					),
				);
			}
			if (stillInactiveRows.length) {
				sections.push(
					formatReportSection(
						'Still inactive ≥3d',
						stillInactiveRows as TableData[],
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
					becameInactiveRows.length || stillInactiveRows.length
						? AuditColor.warn
						: AuditColor.info,
			});
		}

		if (welcomeSentRows.length || welcomeFailedRows.length || syncChangeRows.length) {
			const tableOpts = { maxRows: 25, maxChars: 1100 };
			const noteCols = [
				ReportCols.player,
				ReportCols.tag,
				{ header: 'Note', width: 28 },
			];
			const changeCols = [
				ReportCols.player,
				ReportCols.tag,
				{ header: 'Changes', width: 28 },
			];
			const sections: string[] = [];
			if (welcomeSentRows.length) {
				sections.push(
					formatReportSection('Welcome DM sent', welcomeSentRows, noteCols, tableOpts),
				);
			}
			if (welcomeFailedRows.length) {
				sections.push(
					formatReportSection('Welcome DM failed', welcomeFailedRows, noteCols, tableOpts),
				);
			}
			if (syncChangeRows.length) {
				sections.push(
					formatReportSection(
						'Other sync changes',
						syncChangeRows,
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
					welcomeFailedRows.length || syncChangeRows.length
						? AuditColor.warn
						: AuditColor.info,
			});
		}

		if (isMultiAllianceGuild(config) && (verifiedAllianceMoves.length || verifiedRoleNotes.length)) {
			const sections: string[] = [];
			if (verifiedAllianceMoves.length) {
				sections.push(
					`**Alliance moves (${verifiedAllianceMoves.length})**`,
					verifiedAllianceMoves.slice(0, 25).join('\n') +
						(verifiedAllianceMoves.length > 25
							? `\n_…and ${verifiedAllianceMoves.length - 25} more_`
							: ''),
				);
			}
			if (verifiedRoleNotes.length) {
				sections.push(
					`**Role / rank updates (${verifiedRoleNotes.length})**`,
					verifiedRoleNotes.slice(0, 25).join('\n') +
						(verifiedRoleNotes.length > 25
							? `\n_…and ${verifiedRoleNotes.length - 25} more_`
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
			synced > 0 ||
			failed > 0 ||
			demoted > 0 ||
			queued > 0 ||
			wouldDemote > 0 ||
			wouldQueue > 0 ||
			unavailable > 0 ||
			missing > 0 ||
			rosterHits > 0
		) {
			await postAuditLog(env, config, {
				title: testingTitle('Daily player sync complete'),
				description:
					`Synced **${synced}**` +
					(rosterHits ? ` · **${rosterHits}** from alliance roster` : '') +
					(liveLookups ? ` · **${liveLookups}** live stfc.pro` : '') +
					(failed ? ` · **${failed}** failed` : '') +
					(demoted ? ` · **${demoted}** set to guest` : '') +
					(queued ? ` · **${queued}** queued for leave review` : '') +
					(wouldDemote || wouldQueue
						? ` · **${wouldDemote + wouldQueue}** would-have demotion action(s) (testing)`
						: '') +
					(missing ? ` · **${missing}** missing / left alliance` : '') +
					(unavailable ? ` · **${unavailable}** stfc.pro unavailable (skipped)` : '') +
					(tagChanges ? ` · **${tagChanges}** alliance change(s)` : '') +
					` · policy **${config.demotion_policy}**` +
					(testing ? ' · deploy **testing**' : ''),
				source: 'cron',
				color: failed || demoted || unavailable ? AuditColor.warn : AuditColor.info,
			});
		}
	}

	console.log('Cron: daily player sync complete');
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

export async function handleScheduledEvent(env: Env, cron: string): Promise<void> {
	await wakeDiscordGateway(env);

	switch (cron) {
		case '*/5 * * * *':
			await runMemberPoll(env);
			await runCloseExpiredSurveys(env);
			break;
		case '0 */6 * * *':
			await runPendingVerificationPoll(env);
			break;
		case '0 6 * * *':
			await runDailyPlayerSync(env);
			break;
		case '30 * * * *':
			await runDemotionRecheck(env);
			break;
		default:
			console.log(`Unknown cron: ${cron}`);
	}
}
