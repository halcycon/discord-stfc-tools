/**
 * Manual / shared multi-alliance roster resync (scrape + tag-rename remap + diplomacy rebalance).
 *
 * Slash `/alliance resync` is **chunked** (Continue buttons): Cloudflare `waitUntil` after a
 * deferred Discord reply only extends ~30s. Morning cron uses the full scrape in one job (~15 min).
 */
import {
	ALLIANCE_RESYNC_INTERACTION_CHUNK,
	planMultiAllianceScrape,
	scrapeMultiAllianceEntries,
	syncGuildAllianceRoster,
	syncMultiAllianceTrackedRosters,
	type AllianceTagRename,
	type MultiAllianceRosterSyncResult,
	type MultiAllianceScrapeEntry,
} from './alliance-roster-sync';
import {
	allianceRosterDiffHasChanges,
	diffAllianceRosters,
	formatAllianceRosterChangeReport,
} from './alliance-roster-diff';
import {
	applyAllianceTagRename,
	applyVanishedAlliances,
	runDiplomacyAutoRebalance,
} from './diplomacy-maintenance';
import { diplomacyChannelsEnabled } from './diplomacy-channels';
import {
	createAllianceResyncSession,
	deleteAllianceResyncSession,
	getAllianceResyncSession,
	getGuildConfig,
	listAllianceRosterMembers,
	pruneAllianceRostersOutside,
	updateAllianceResyncSessionPayload,
	upsertGuildConfig,
	type AllianceResyncSessionPayload,
} from './guild-db';
import { AuditColor, postAuditLog } from './audit-log';
import { isDeployTesting } from './deploy-mode';
import { createProgressReporter } from './progress-reporter';
import type { DiscordActionRow } from './discord-api';
import type { GuildConfig } from './types';

export type AllianceResyncResult =
	| {
			ok: true;
			mode: 'multi_alliance';
			directoryCount: number;
			trackedTags: number;
			scrapedAlliances: number;
			skippedTags: string[];
			failedTags: string[];
			vanishedTags: string[];
			tagRenames: AllianceTagRename[];
			remapped: number;
			remapErrors: string[];
			rebalanced: boolean;
			archived: number;
			diffHasChanges: boolean;
			summary: string;
	  }
	| {
			ok: true;
			mode: 'single_alliance';
			playerCount: number;
			summary: string;
	  }
	| {
			ok: true;
			mode: 'multi_alliance_continue';
			sessionToken: string;
			summary: string;
			components: DiscordActionRow[];
	  }
	| { ok: false; error: string };

export function buildAllianceResyncContinueComponents(sessionToken: string): DiscordActionRow[] {
	return [
		{
			type: 1,
			components: [
				{
					type: 2,
					style: 1,
					label: 'Continue resync',
					custom_id: `aresync:cont:${sessionToken}`,
				},
			],
		},
	];
}

/**
 * Apply detected alliance tag renames (Discord diplomacy + D1), then optional rebalance.
 */
export async function applyTagRenamesFromSync(
	env: Env,
	config: GuildConfig,
	tagRenames: AllianceTagRename[],
	opts?: {
		actorId?: string;
		source?: 'cron' | 'admin' | 'system';
		rebalance?: boolean;
		onProgress?: (message: string) => Promise<void>;
		forceDiscord?: boolean;
	},
): Promise<{
	config: GuildConfig;
	remapped: number;
	errors: string[];
	rebalanced: boolean;
	skippedTesting: boolean;
	playersSynced: number;
	playersRemaining: number;
}> {
	let current = config;
	const errors: string[] = [];
	let remapped = 0;
	let playersSynced = 0;
	let playersRemaining = 0;
	const token = env.DISCORD_BOT_TOKEN;
	const progress = createProgressReporter(opts?.onProgress);
	const report = (message: string) => progress.report(message);
	if (tagRenames.length === 0) {
		return {
			config: current,
			remapped: 0,
			errors,
			rebalanced: false,
			skippedTesting: false,
			playersSynced: 0,
			playersRemaining: 0,
		};
	}

	const dbOnly = isDeployTesting(config) && !opts?.forceDiscord;
	if (dbOnly) {
		report(
			`⏳ Alliance resync: **${tagRenames.length}** tag rename(s) — updating D1 maps; Discord channel/nicks skipped (testing).\n` +
				`_Override: \`/alliance resync apply_discord:true\` (or \`/alliance track tag:NEW apply_discord:true\`)_`,
		);
	} else if (isDeployTesting(config) && opts?.forceDiscord) {
		report(
			`⏳ Alliance resync: **${tagRenames.length}** tag rename(s) — applying Discord remaps (**testing** override)…`,
		);
	}

	const { syncVerifiedPlayersForAllianceTag } = await import('./player-tag-resync');

	for (let i = 0; i < tagRenames.length; i++) {
		const ren = tagRenames[i]!;
		report(
			`⏳ Alliance resync: remapping tag **${i + 1}/${tagRenames.length}** ` +
				`\`${ren.fromTag}\`→\`${ren.toTag}\`…`,
		);
		const latest = (await getGuildConfig(env.STFC_DB, current.guild_id)) ?? current;
		if (dbOnly || !token) {
			const { remapAllianceTagInDb } = await import('./diplomacy-maintenance');
			const result = await remapAllianceTagInDb(env, latest, ren.fromTag, ren.toTag, {
				source: opts?.source ?? 'system',
				actorId: opts?.actorId,
				allianceId: ren.allianceId,
			});
			if (result.ok) {
				remapped++;
				current = result.config;
			} else if (result.error) {
				errors.push(`[${ren.fromTag}→${ren.toTag}] ${result.error}`);
			}
			continue;
		}
		const result = await applyAllianceTagRename(
			env,
			token,
			latest,
			current.guild_id,
			ren.fromTag,
			ren.toTag,
			{
				source: opts?.source ?? 'system',
				actorId: opts?.actorId,
				rebalance: false,
				allianceId: ren.allianceId,
			},
		);
		if (result.ok) {
			remapped++;
			current = (await getGuildConfig(env.STFC_DB, current.guild_id)) ?? latest;
			const nickSync = await syncVerifiedPlayersForAllianceTag(env, current, ren.toTag, {
				allianceId: ren.allianceId,
				forceDiscord: opts?.forceDiscord,
				onProgress: opts?.onProgress,
			});
			playersSynced += nickSync.synced;
			playersRemaining += nickSync.remaining;
			errors.push(...nickSync.errors.map((e) => `[${ren.toTag} nicks] ${e}`));
		} else if (result.error) {
			errors.push(`[${ren.fromTag}→${ren.toTag}] ${result.error}`);
		}
	}

	if (dbOnly) {
		await progress.flush();
		return {
			config: current,
			remapped,
			errors,
			rebalanced: false,
			skippedTesting: true,
			playersSynced: 0,
			playersRemaining: 0,
		};
	}

	let rebalanced = false;
	if (opts?.rebalance !== false && diplomacyChannelsEnabled(current) && remapped > 0) {
		report('⏳ Alliance resync: diplomacy auto-rebalance…');
		const rb = await runDiplomacyAutoRebalance(env, token!, current, current.guild_id, {
			force: Object.keys(current.diplomacy_channel_map ?? {}).length > 0,
			reason: `tag rename remap (${remapped})`,
			source: opts?.source ?? 'system',
			actorId: opts?.actorId,
		});
		rebalanced = rb.ran;
		if (rb.config) current = rb.config;
	}

	await progress.flush();
	return {
		config: current,
		remapped,
		errors,
		rebalanced,
		skippedTesting: false,
		playersSynced,
		playersRemaining,
	};
}

async function finalizeMultiResync(
	env: Env,
	config: GuildConfig,
	payload: AllianceResyncSessionPayload,
	opts: {
		actorId?: string;
		source?: 'cron' | 'admin' | 'system';
		postAudit?: boolean;
		onProgress?: (message: string) => Promise<void>;
		forceDiscord?: boolean;
	},
): Promise<AllianceResyncResult> {
	const source = opts.source ?? 'admin';
	const progress = createProgressReporter(opts.onProgress);
	progress.report('⏳ Alliance resync: finalizing (prune cache, remaps, audit)…');
	await progress.flush();

	if (payload.scrapedAlliances === 0 && payload.vanished.length === 0) {
		return { ok: false, error: 'All alliance scrapes failed this resync.' };
	}

	const keepAllianceIds = [
		...new Set([...payload.keepAllianceIds, ...payload.preserveAllianceIds]),
	];
	await pruneAllianceRostersOutside(env.STFC_DB, config.guild_id, keepAllianceIds);

	if (payload.tagRenames.length) {
		const renameMap = new Map(payload.tagRenames.map((r) => [r.fromTag, r.toTag]));
		const nextTracked = [
			...new Set(
				(config.tracked_alliance_tags ?? []).map((t) => {
					const upper = t.trim().toUpperCase();
					return renameMap.get(upper) ?? upper;
				}),
			),
		].filter(Boolean);
		await upsertGuildConfig(env.STFC_DB, {
			guild_id: config.guild_id,
			tracked_alliance_tags: nextTracked,
		});
		config.tracked_alliance_tags = nextTracked;
	}

	let current = (await getGuildConfig(env.STFC_DB, config.guild_id)) ?? config;
	const forceDiscord = opts.forceDiscord ?? payload.forceDiscord;
	const renameResult = await applyTagRenamesFromSync(env, current, payload.tagRenames, {
		actorId: opts.actorId,
		source,
		rebalance: true,
		onProgress: opts.onProgress,
		forceDiscord,
	});
	current = renameResult.config;

	const vanishResult = await applyVanishedAlliances(env, current, payload.vanished, {
		actorId: opts.actorId,
		source,
		forceDiscord,
		onProgress: opts.onProgress,
	});
	current = vanishResult.config;

	const allowDiscord = forceDiscord || !isDeployTesting(current);
	if (
		!renameResult.rebalanced &&
		!renameResult.skippedTesting &&
		diplomacyChannelsEnabled(current) &&
		env.DISCORD_BOT_TOKEN &&
		allowDiscord
	) {
		const rb = await runDiplomacyAutoRebalance(
			env,
			env.DISCORD_BOT_TOKEN,
			current,
			current.guild_id,
			{
				reason: 'manual resync',
				source,
				actorId: opts.actorId,
			},
		);
		if (rb.config) current = rb.config;
		renameResult.rebalanced = rb.ran;
	}

	const currentRows = await listAllianceRosterMembers(env.STFC_DB, config.guild_id);
	const currentSnap = currentRows.map((m) => ({
		playerId: m.player_id,
		playerName: m.player_name,
		allianceRank: m.alliance_rank,
		opsLevel: m.ops_level,
		allianceTag: m.alliance_tag,
	}));
	const diff = diffAllianceRosters(payload.previous, currentSnap);
	const changeReport = formatAllianceRosterChangeReport(diff, {
		allianceTag: 'multi',
		mode: 'multi',
		alliancesScraped: payload.scrapedAlliances,
	});

	let extra = '';
	if (payload.failedTags.length) {
		extra += `\n⚠ Failed: ${payload.failedTags.slice(0, 15).join(', ')}`;
	}
	if (payload.skippedTags.length) {
		extra += `\n⏭ Skipped (no alliance id on file): ${payload.skippedTags.slice(0, 15).join(', ')}`;
		extra += `\n_If a skipped tag renamed, run \`/alliance track tag:NEW from_tag:OLD\`_`;
	}
	if (payload.vanished.length) {
		extra += `\n🕊 Vanished (untracked/archived): ${payload.vanished
			.map((v) => v.tag)
			.slice(0, 15)
			.join(', ')}`;
	}
	if (payload.tagRenames.length) {
		extra += `\n🏷 Tag renames: ${payload.tagRenames
			.map((r) => `\`${r.fromTag}\`→\`${r.toTag}\``)
			.join(', ')}`;
		extra += `\n· Remapped diplomacy/DB: **${renameResult.remapped}**`;
		if (renameResult.skippedTesting) extra += ` _(skipped — testing mode)_`;
		if (renameResult.errors.length) {
			extra += `\n· Remap errors: ${renameResult.errors.slice(0, 5).join('; ')}`;
		}
	}
	if (renameResult.rebalanced) extra += `\n· Diplomacy auto-rebalance ran`;

	if (opts.postAudit !== false) {
		await postAuditLog(env, current, {
			title: changeReport.title,
			description:
				changeReport.description +
				`\n_Directory **${payload.directoryCount}** · tracked **${payload.trackedTagCount}** · manual resync_` +
				extra,
			actorId: opts.actorId,
			source,
			color: allianceRosterDiffHasChanges(diff) || payload.tagRenames.length
				? AuditColor.warn
				: AuditColor.info,
		});
	}

	const summaryLines = [
		`✅ **Alliance resync** complete`,
		`• Scraped: **${payload.scrapedAlliances}** alliance page(s)`,
		`• Directory: ${payload.directoryCount} · tracked tags: ${payload.trackedTagCount}`,
	];
	if (payload.failedTags.length) {
		summaryLines.push(`• Failed: ${payload.failedTags.slice(0, 10).join(', ')}`);
	}
	if (payload.skippedTags.length) {
		summaryLines.push(
			`• Skipped (no alliance id on file): ${payload.skippedTags.slice(0, 10).join(', ')}`,
		);
		summaryLines.push(
			`_If renamed: \`/alliance track tag:NEW from_tag:OLD\`_`,
		);
	}
	if (payload.vanished.length) {
		summaryLines.push(
			`• Vanished (untracked` +
				(vanishResult.archived ? ` + archived **${vanishResult.archived}**` : '') +
				`): ${payload.vanished.map((v) => v.tag).slice(0, 10).join(', ')}`,
		);
	}
	if (payload.tagRenames.length) {
		summaryLines.push(
			`• Tag renames: ${payload.tagRenames.map((r) => `\`${r.fromTag}\`→\`${r.toTag}\``).join(', ')}`,
		);
		summaryLines.push(
			`• Remapped: **${renameResult.remapped}**` +
				(renameResult.skippedTesting
					? ' _(testing — Discord remap skipped; use `apply_discord:true`)_'
					: payload.forceDiscord && isDeployTesting(config)
						? ' _(testing override `apply_discord:true`)_'
						: ''),
		);
		if (renameResult.playersSynced > 0 || renameResult.playersRemaining > 0) {
			summaryLines.push(
				`• Player nick/role sync: **${renameResult.playersSynced}**` +
					(renameResult.playersRemaining
						? ` (**${renameResult.playersRemaining}** left — \`/alliance track tag:… apply_discord:true\` again)`
						: ''),
			);
		}
	} else {
		summaryLines.push(`• Tag renames: none detected`);
	}
	if (renameResult.errors.length) {
		summaryLines.push(`• Remap issues: ${renameResult.errors.slice(0, 3).join('; ')}`);
	}
	if (vanishResult.errors.length) {
		summaryLines.push(`• Vanish issues: ${vanishResult.errors.slice(0, 3).join('; ')}`);
	}
	if (renameResult.rebalanced) summaryLines.push(`• Diplomacy rebalanced`);
	if (!renameResult.playersSynced && !payload.forceDiscord && isDeployTesting(config)) {
		summaryLines.push(
			`\n_Discord nicks unchanged in testing — \`/alliance track tag:TAG apply_discord:true\` or morning sync._`,
		);
	} else if (renameResult.playersRemaining > 0) {
		summaryLines.push(
			`\n_Re-run track with \`apply_discord:true\` for remaining nicks, or wait for morning sync._`,
		);
	}

	return {
		ok: true,
		mode: 'multi_alliance',
		directoryCount: payload.directoryCount,
		trackedTags: payload.trackedTagCount,
		scrapedAlliances: payload.scrapedAlliances,
		skippedTags: payload.skippedTags,
		failedTags: payload.failedTags,
		vanishedTags: payload.vanished.map((v) => v.tag),
		tagRenames: payload.tagRenames,
		remapped: renameResult.remapped,
		remapErrors: renameResult.errors,
		rebalanced: renameResult.rebalanced,
		archived: vanishResult.archived,
		diffHasChanges: allianceRosterDiffHasChanges(diff),
		summary: summaryLines.join('\n'),
	};
}

async function runResyncChunk(
	env: Env,
	config: GuildConfig,
	payload: AllianceResyncSessionPayload,
	opts: {
		actorId?: string;
		source?: 'cron' | 'admin' | 'system';
		postAudit?: boolean;
		onProgress?: (message: string) => Promise<void>;
		sessionToken?: string;
	},
): Promise<AllianceResyncResult> {
	const total = payload.entries.length;
	const chunk = payload.entries.slice(
		payload.offset,
		payload.offset + ALLIANCE_RESYNC_INTERACTION_CHUNK,
	);
	if (chunk.length === 0) {
		return finalizeMultiResync(env, config, payload, {
			...opts,
			forceDiscord: payload.forceDiscord,
		});
	}

	const batch = await scrapeMultiAllianceEntries(
		env,
		config,
		chunk as MultiAllianceScrapeEntry[],
		{
			fetchedAt: payload.fetchedAt,
			progressOffset: payload.offset,
			progressTotal: total,
			onProgress: opts.onProgress,
		},
	);

	payload.offset += chunk.length;
	payload.scrapedAlliances += batch.scrapedAlliances;
	payload.failedTags.push(...batch.failedTags);
	payload.vanished.push(...batch.vanished);
	payload.tagRenames.push(...batch.tagRenames);
	payload.keepAllianceIds.push(...batch.keepAllianceIds);
	// Keep overflow ids from plan + not-yet-scraped entries (do not drop overflow).
	payload.preserveAllianceIds = [
		...new Set([
			...payload.preserveAllianceIds,
			...payload.entries.slice(payload.offset).map((e) => e.allianceId),
		]),
	];

	const remaining = total - payload.offset;
	if (remaining > 0) {
		const token =
			opts.sessionToken ??
			(
				await createAllianceResyncSession(env.STFC_DB, {
					guildId: config.guild_id,
					actorId: opts.actorId,
					payload,
				})
			).token;
		if (opts.sessionToken) {
			await updateAllianceResyncSessionPayload(env.STFC_DB, token, payload);
		}
		const nextN = Math.min(remaining, ALLIANCE_RESYNC_INTERACTION_CHUNK);
		return {
			ok: true,
			mode: 'multi_alliance_continue',
			sessionToken: token,
			components: buildAllianceResyncContinueComponents(token),
			summary:
				`⏸ **Alliance resync** progress — Cloudflare stops background work ~**30s** after each reply, so scrapes are chunked.\n\n` +
				`• Done: **${payload.offset}/${total}** alliance pages\n` +
				`• Ok: **${payload.scrapedAlliances}** · fail: **${payload.failedTags.length}**` +
				(payload.tagRenames.length
					? ` · renames so far: **${payload.tagRenames.length}**`
					: '') +
				`\n\nPress **Continue resync** for the next **${nextN}** (then remaps run on the last chunk).`,
		};
	}

	if (opts.sessionToken) {
		await deleteAllianceResyncSession(env.STFC_DB, opts.sessionToken);
	}
	return finalizeMultiResync(env, config, payload, {
		...opts,
		forceDiscord: payload.forceDiscord,
	});
}

/**
 * Interactive `/alliance resync` — chunked for waitUntil limits.
 * Full one-shot scrape remains available via `runAllianceResyncFull` (HTTP/cron helpers).
 */
export async function runAllianceResync(
	env: Env,
	config: GuildConfig,
	opts?: {
		actorId?: string;
		source?: 'cron' | 'admin' | 'system';
		postAudit?: boolean;
		onProgress?: (message: string) => Promise<void>;
		forceDiscord?: boolean;
		/** When true, scrape all alliances in one shot (cron / diagnostic). Default false for slash. */
		fullSync?: boolean;
	},
): Promise<AllianceResyncResult> {
	const source = opts?.source ?? 'admin';
	const postAudit = opts?.postAudit ?? source === 'admin';
	const progress = createProgressReporter(opts?.onProgress);
	const say = (message: string) => progress.report(message);
	const forceDiscord = opts?.forceDiscord === true;

	if (config.mode === 'single_alliance' && config.alliance_tag?.trim()) {
		say('⏳ Alliance resync: scraping home alliance…');
		const result = await syncGuildAllianceRoster(env, config);
		if (!result.ok) {
			await progress.flush();
			return { ok: false, error: `Roster sync failed: ${result.reason}` };
		}
		const changeReport = formatAllianceRosterChangeReport(result.diff, {
			allianceTag: result.scrape.allianceTag || config.alliance_tag || 'alliance',
			allianceId: config.stfc_alliance_id ?? result.scrape.allianceId,
			mode: 'single',
		});
		if (postAudit) {
			await postAuditLog(env, config, {
				title: changeReport.title,
				description: changeReport.description + '\n_Manual `/alliance resync`_',
				actorId: opts?.actorId,
				source,
				color: allianceRosterDiffHasChanges(result.diff) ? AuditColor.warn : AuditColor.info,
			});
		}
		await progress.flush();
		return {
			ok: true,
			mode: 'single_alliance',
			playerCount: result.scrape.players.length,
			summary:
				`✅ Resynced **[${result.scrape.allianceTag || config.alliance_tag}]** — ` +
				`**${result.scrape.players.length}** players on roster.`,
		};
	}

	if (config.mode !== 'multi_alliance') {
		return {
			ok: false,
			error: 'Resync needs **multi_alliance** (or single with an alliance tag).',
		};
	}

	if (opts?.fullSync) {
		const multi = await syncMultiAllianceTrackedRosters(env, config, {
			onProgress: opts?.onProgress,
		});
		if (!multi.ok) {
			return { ok: false, error: `Multi roster sync failed: ${multi.reason}` };
		}
		// Full sync already pruned + updated tracked tags; remaps + vanish cleanup left.
		let current = (await getGuildConfig(env.STFC_DB, config.guild_id)) ?? config;
		const renameResult = await applyTagRenamesFromSync(env, current, multi.tagRenames, {
			actorId: opts?.actorId,
			source,
			rebalance: true,
			onProgress: opts?.onProgress,
			forceDiscord,
		});
		current = renameResult.config;
		const vanishResult = await applyVanishedAlliances(env, current, multi.vanished, {
			actorId: opts?.actorId,
			source,
			forceDiscord,
			onProgress: opts?.onProgress,
		});
		current = vanishResult.config;
		const changeReport = formatAllianceRosterChangeReport(multi.diff, {
			allianceTag: 'multi',
			mode: 'multi',
			alliancesScraped: multi.scrapedAlliances,
		});
		if (postAudit) {
			await postAuditLog(env, current, {
				title: changeReport.title,
				description:
					changeReport.description +
					`\n_Directory **${multi.directoryCount}** · tracked **${multi.trackedTags}** · full resync_` +
					(multi.tagRenames.length
						? `\n🏷 ${multi.tagRenames.map((r) => `\`${r.fromTag}\`→\`${r.toTag}\``).join(', ')}`
						: '') +
					(multi.vanished.length
						? `\n🕊 Vanished: ${multi.vanished.map((v) => v.tag).join(', ')}`
						: '') +
					(multi.skippedTags.length
						? `\n⏭ No id on file: ${multi.skippedTags.slice(0, 15).join(', ')}`
						: ''),
				actorId: opts?.actorId,
				source,
				color:
					allianceRosterDiffHasChanges(multi.diff) ||
					multi.tagRenames.length ||
					multi.vanished.length
						? AuditColor.warn
						: AuditColor.info,
			});
		}
		return {
			ok: true,
			mode: 'multi_alliance',
			directoryCount: multi.directoryCount,
			trackedTags: multi.trackedTags,
			scrapedAlliances: multi.scrapedAlliances,
			skippedTags: multi.skippedTags,
			failedTags: multi.failedTags,
			vanishedTags: multi.vanished.map((v) => v.tag),
			tagRenames: multi.tagRenames,
			remapped: renameResult.remapped,
			remapErrors: renameResult.errors,
			rebalanced: renameResult.rebalanced,
			archived: vanishResult.archived,
			diffHasChanges: allianceRosterDiffHasChanges(multi.diff),
			summary:
				`✅ **Alliance resync** complete (full)\n` +
				`• Scraped: **${multi.scrapedAlliances}**\n` +
				`• Tag renames: ${multi.tagRenames.length ? multi.tagRenames.map((r) => `\`${r.fromTag}\`→\`${r.toTag}\``).join(', ') : 'none'}\n` +
				`• Remapped: **${renameResult.remapped}**` +
				(renameResult.playersSynced
					? `\n• Player nick/role sync: **${renameResult.playersSynced}**` +
						(renameResult.playersRemaining
							? ` (${renameResult.playersRemaining} left)`
							: '')
					: '') +
				(multi.vanished.length
					? `\n• Vanished: ${multi.vanished.map((v) => v.tag).join(', ')}`
					: '') +
				(multi.skippedTags.length
					? `\n• Skipped (no id): ${multi.skippedTags.join(', ')} — use \`from_tag\` if renamed`
					: ''),
		};
	}

	const planned = await planMultiAllianceScrape(env, config, { onProgress: opts?.onProgress });
	if (!planned.ok) {
		return { ok: false, error: `Multi roster plan failed: ${planned.reason}` };
	}

	const payload: AllianceResyncSessionPayload = {
		forceDiscord,
		fetchedAt: planned.plan.fetchedAt,
		directoryCount: planned.plan.directoryCount,
		trackedTagCount: planned.plan.trackedTagCount,
		skippedTags: planned.plan.skippedTags,
		entries: planned.plan.entries,
		offset: 0,
		scrapedAlliances: 0,
		failedTags: [],
		vanished: [],
		tagRenames: [...planned.plan.plannedRenames],
		keepAllianceIds: [],
		preserveAllianceIds: planned.plan.preserveAllianceIds,
		previous: planned.plan.previous,
	};

	say(
		`⏳ Alliance resync: directory **${payload.directoryCount}** · **${payload.entries.length}** page(s) to scrape ` +
			`in chunks of **${ALLIANCE_RESYNC_INTERACTION_CHUNK}** (CF ~30s waitUntil)…`,
	);
	await progress.flush();

	return runResyncChunk(env, config, payload, {
		actorId: opts?.actorId,
		source,
		postAudit,
		onProgress: opts?.onProgress,
	});
}

/** Continue button handler for chunked resync. */
export async function continueAllianceResync(
	env: Env,
	config: GuildConfig,
	sessionToken: string,
	opts?: {
		actorId?: string;
		onProgress?: (message: string) => Promise<void>;
	},
): Promise<AllianceResyncResult> {
	const session = await getAllianceResyncSession(env.STFC_DB, sessionToken);
	if (!session || session.guild_id !== config.guild_id) {
		return { ok: false, error: 'Resync session expired — run `/alliance resync` again.' };
	}
	return runResyncChunk(env, config, session.payload, {
		actorId: opts?.actorId ?? session.actor_id ?? undefined,
		source: 'admin',
		postAudit: true,
		onProgress: opts?.onProgress,
		sessionToken,
	});
}

/** Narrow helper for cron: apply renames already detected by syncMultiAllianceTrackedRosters. */
export async function applyMultiAllianceTagRenamesForCron(
	env: Env,
	config: GuildConfig,
	multiResult: Extract<MultiAllianceRosterSyncResult, { ok: true }>,
): Promise<GuildConfig> {
	if (!multiResult.tagRenames.length) return config;
	const { config: next } = await applyTagRenamesFromSync(env, config, multiResult.tagRenames, {
		source: 'cron',
		rebalance: false,
	});
	return next;
}
