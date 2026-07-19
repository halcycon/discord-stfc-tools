/**
 * Manual / shared multi-alliance roster resync (scrape + tag-rename remap + diplomacy rebalance).
 */
import {
	syncGuildAllianceRoster,
	syncMultiAllianceTrackedRosters,
	type AllianceTagRename,
	type MultiAllianceRosterSyncResult,
} from './alliance-roster-sync';
import {
	allianceRosterDiffHasChanges,
	formatAllianceRosterChangeReport,
} from './alliance-roster-diff';
import {
	applyAllianceTagRename,
	runDiplomacyAutoRebalance,
} from './diplomacy-maintenance';
import { diplomacyChannelsEnabled } from './diplomacy-channels';
import { getGuildConfig } from './guild-db';
import { AuditColor, postAuditLog } from './audit-log';
import { isDeployTesting } from './deploy-mode';
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
			tagRenames: AllianceTagRename[];
			remapped: number;
			remapErrors: string[];
			rebalanced: boolean;
			diffHasChanges: boolean;
			summary: string;
	  }
	| {
			ok: true;
			mode: 'single_alliance';
			playerCount: number;
			summary: string;
	  }
	| { ok: false; error: string };

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
	},
): Promise<{
	config: GuildConfig;
	remapped: number;
	errors: string[];
	rebalanced: boolean;
}> {
	let current = config;
	const errors: string[] = [];
	let remapped = 0;
	const token = env.DISCORD_BOT_TOKEN;
	if (!token || isDeployTesting(config) || tagRenames.length === 0) {
		return { config: current, remapped: 0, errors, rebalanced: false };
	}

	for (const ren of tagRenames) {
		const latest = (await getGuildConfig(env.STFC_DB, current.guild_id)) ?? current;
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
			},
		);
		if (result.ok) {
			remapped++;
			current = (await getGuildConfig(env.STFC_DB, current.guild_id)) ?? latest;
		} else if (result.error) {
			errors.push(`[${ren.fromTag}→${ren.toTag}] ${result.error}`);
		}
	}

	let rebalanced = false;
	if (opts?.rebalance !== false && diplomacyChannelsEnabled(current) && remapped > 0) {
		const rb = await runDiplomacyAutoRebalance(env, token, current, current.guild_id, {
			force: Object.keys(current.diplomacy_channel_map ?? {}).length > 0,
			reason: `tag rename remap (${remapped})`,
			source: opts?.source ?? 'system',
			actorId: opts?.actorId,
		});
		rebalanced = rb.ran;
		if (rb.config) current = rb.config;
	}

	return { config: current, remapped, errors, rebalanced };
}

/**
 * Scrape tracked alliance rosters now (same as morning), remap tag renames, rebalance diplomacy.
 * Does not run the full verified-player daily sync loop.
 */
export async function runAllianceResync(
	env: Env,
	config: GuildConfig,
	opts?: {
		actorId?: string;
		source?: 'cron' | 'admin' | 'system';
		/** Post the day-over-day roster audit embed (default true for admin). */
		postAudit?: boolean;
	},
): Promise<AllianceResyncResult> {
	const source = opts?.source ?? 'admin';
	const postAudit = opts?.postAudit ?? source === 'admin';

	if (config.mode === 'single_alliance' && config.alliance_tag?.trim()) {
		const result = await syncGuildAllianceRoster(env, config);
		if (!result.ok) {
			return { ok: false, error: `Roster sync failed: ${result.reason}` };
		}
		const report = formatAllianceRosterChangeReport(result.diff, {
			allianceTag: result.scrape.allianceTag || config.alliance_tag || 'alliance',
			allianceId: config.stfc_alliance_id ?? result.scrape.allianceId,
			mode: 'single',
		});
		if (postAudit) {
			await postAuditLog(env, config, {
				title: report.title,
				description: report.description + '\n_Manual `/alliance resync`_',
				actorId: opts?.actorId,
				source,
				color: allianceRosterDiffHasChanges(result.diff) ? AuditColor.warn : AuditColor.info,
			});
		}
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

	const multi = await syncMultiAllianceTrackedRosters(env, config);
	if (!multi.ok) {
		return { ok: false, error: `Multi roster sync failed: ${multi.reason}` };
	}

	let current = (await getGuildConfig(env.STFC_DB, config.guild_id)) ?? config;
	const renameResult = await applyTagRenamesFromSync(env, current, multi.tagRenames, {
		actorId: opts?.actorId,
		source,
		rebalance: true,
	});
	current = renameResult.config;

	// If no renames but buckets overflowed (e.g. new diplomacy channels), still rebalance.
	if (
		!renameResult.rebalanced &&
		diplomacyChannelsEnabled(current) &&
		env.DISCORD_BOT_TOKEN &&
		!isDeployTesting(current)
	) {
		const rb = await runDiplomacyAutoRebalance(
			env,
			env.DISCORD_BOT_TOKEN,
			current,
			current.guild_id,
			{
				reason: 'manual resync',
				source,
				actorId: opts?.actorId,
			},
		);
		if (rb.config) current = rb.config;
		renameResult.rebalanced = rb.ran;
	}

	const report = formatAllianceRosterChangeReport(multi.diff, {
		allianceTag: 'multi',
		mode: 'multi',
		alliancesScraped: multi.scrapedAlliances,
	});
	let extra = '';
	if (multi.failedTags.length) {
		extra += `\n⚠ Failed: ${multi.failedTags.slice(0, 15).join(', ')}`;
	}
	if (multi.skippedTags.length) {
		extra += `\n⏭ Skipped: ${multi.skippedTags.slice(0, 15).join(', ')}`;
	}
	if (multi.tagRenames.length) {
		extra += `\n🏷 Tag renames: ${multi.tagRenames
			.map((r) => `\`${r.fromTag}\`→\`${r.toTag}\``)
			.join(', ')}`;
		extra += `\n· Remapped diplomacy/DB: **${renameResult.remapped}**`;
		if (renameResult.errors.length) {
			extra += `\n· Remap errors: ${renameResult.errors.slice(0, 5).join('; ')}`;
		}
	}
	if (renameResult.rebalanced) {
		extra += `\n· Diplomacy auto-rebalance ran`;
	}

	if (postAudit) {
		await postAuditLog(env, current, {
			title: report.title,
			description:
				report.description +
				`\n_Directory **${multi.directoryCount}** · tracked **${multi.trackedTags}** · manual resync_` +
				extra,
			actorId: opts?.actorId,
			source,
			color: allianceRosterDiffHasChanges(multi.diff) || multi.tagRenames.length
				? AuditColor.warn
				: AuditColor.info,
		});
	}

	const summaryLines = [
		`✅ **Alliance resync** complete`,
		`• Scraped: **${multi.scrapedAlliances}** alliance page(s)`,
		`• Directory: ${multi.directoryCount} · tracked tags: ${multi.trackedTags}`,
	];
	if (multi.failedTags.length) {
		summaryLines.push(`• Failed: ${multi.failedTags.slice(0, 10).join(', ')}`);
	}
	if (multi.skippedTags.length) {
		summaryLines.push(`• Skipped: ${multi.skippedTags.slice(0, 10).join(', ')}`);
	}
	if (multi.tagRenames.length) {
		summaryLines.push(
			`• Tag renames: ${multi.tagRenames.map((r) => `\`${r.fromTag}\`→\`${r.toTag}\``).join(', ')}`,
		);
		summaryLines.push(`• Remapped: **${renameResult.remapped}**`);
	} else {
		summaryLines.push(`• Tag renames: none detected`);
	}
	if (renameResult.errors.length) {
		summaryLines.push(`• Remap issues: ${renameResult.errors.slice(0, 3).join('; ')}`);
	}
	if (renameResult.rebalanced) {
		summaryLines.push(`• Diplomacy rebalanced`);
	}
	summaryLines.push(
		`\n_Verified player roles/nicks update on the next morning sync or when members re-verify._`,
	);

	return {
		ok: true,
		mode: 'multi_alliance',
		directoryCount: multi.directoryCount,
		trackedTags: multi.trackedTags,
		scrapedAlliances: multi.scrapedAlliances,
		skippedTags: multi.skippedTags,
		failedTags: multi.failedTags,
		tagRenames: multi.tagRenames,
		remapped: renameResult.remapped,
		remapErrors: renameResult.errors,
		rebalanced: renameResult.rebalanced,
		diffHasChanges: allianceRosterDiffHasChanges(multi.diff),
		summary: summaryLines.join('\n'),
	};
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
