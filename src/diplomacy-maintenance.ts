/**
 * Diplomacy auto-rebalance + alliance tag remap orchestration (cron / track / verify).
 */
import { postAuditLog, AuditColor } from './audit-log';
import {
	diplomacyChannelsEnabled,
	diplomacyNeedsRebalance,
	rebalanceDiplomacyChannels,
	remapDiplomacyAllianceTag,
	resolveDiplomacySoftLimit,
} from './diplomacy-channels';
import { getGuildConfig, upsertGuildConfig } from './guild-db';
import type { GuildConfig } from './types';

export async function persistDiplomacySoftLimit(
	env: Env,
	guildId: string,
	softLimit: number,
): Promise<number> {
	const n = resolveDiplomacySoftLimit({ diplomacy_soft_limit: softLimit }, softLimit);
	await upsertGuildConfig(env.STFC_DB, {
		guild_id: guildId,
		diplomacy_soft_limit: n,
	});
	return n;
}

/**
 * Remap diplomacy channel + tracked tag when an alliance renames (same stfc alliance id).
 * Persists D1 maps and optionally rebalances letter buckets.
 */
export async function applyAllianceTagRename(
	env: Env,
	token: string,
	config: GuildConfig,
	guildId: string,
	fromTag: string,
	toTag: string,
	opts?: { rebalance?: boolean; actorId?: string; source?: 'cron' | 'admin' | 'system' },
): Promise<{ ok: boolean; error?: string; rebalanced?: boolean }> {
	if (!diplomacyChannelsEnabled(config) && !(config.tracked_alliance_tags ?? []).length) {
		// Still allow tracked-tag rename even if diplomacy off.
	}

	const result = await remapDiplomacyAllianceTag(token, config, guildId, fromTag, toTag);
	if (!result.ok) {
		// If no diplomacy channel, still rename tracked tag list.
		const from = fromTag.trim().toUpperCase();
		const to = toTag.trim().toUpperCase();
		if (!from || !to || from === to) return { ok: false, error: result.error };
		const tracked = (config.tracked_alliance_tags ?? []).map((t) =>
			t.trim().toUpperCase() === from ? to : t.trim().toUpperCase(),
		);
		const nextTracked = [...new Set(tracked.filter(Boolean))];
		const changed = nextTracked.join(',') !== (config.tracked_alliance_tags ?? []).join(',');
		if (!changed) return { ok: false, error: result.error };
		await upsertGuildConfig(env.STFC_DB, {
			guild_id: guildId,
			tracked_alliance_tags: nextTracked,
		});
		config.tracked_alliance_tags = nextTracked;
		try {
			await env.STFC_DB.prepare(
				`UPDATE verified_players
				 SET alliance_tag = ?, updated_at = datetime('now')
				 WHERE guild_id = ? AND UPPER(TRIM(alliance_tag)) = ?`,
			)
				.bind(to, guildId, from)
				.run();
		} catch (err) {
			console.warn('verified_players tag remap failed:', err);
		}
		await postAuditLog(env, config, {
			title: 'Alliance tag renamed (tracked list)',
			description: `**[${from}]** → **[${to}]** (no diplomacy channel mapped)`,
			actorId: opts?.actorId,
			source: opts?.source ?? 'system',
			color: AuditColor.info,
		});
		return { ok: true, rebalanced: false };
	}

	await upsertGuildConfig(env.STFC_DB, {
		guild_id: guildId,
		diplomacy_channel_map: result.channelMap,
		diplomacy_preferred_locales: result.preferredLocales,
		tracked_alliance_tags: result.trackedTags,
	});
	config.diplomacy_channel_map = result.channelMap;
	config.diplomacy_preferred_locales = result.preferredLocales;
	config.tracked_alliance_tags = result.trackedTags;

	try {
		await env.STFC_DB.prepare(
			`UPDATE verified_players
			 SET alliance_tag = ?, updated_at = datetime('now')
			 WHERE guild_id = ? AND UPPER(TRIM(alliance_tag)) = ?`,
		)
			.bind(result.toTag, guildId, result.fromTag)
			.run();
	} catch (err) {
		console.warn('verified_players tag remap failed:', err);
	}

	await postAuditLog(env, config, {
		title: 'Alliance tag renamed (diplomacy remapped)',
		description:
			`**[${result.fromTag}]** → **[${result.toTag}]** → <#${result.channelId}>` +
			(result.renamed ? ' (renamed)' : '') +
			(result.moved ? ' (moved)' : '') +
			(result.duplicateChannelId
				? `\n⚠ Duplicate map entry <#${result.duplicateChannelId}> unmapped — delete that channel if unwanted.`
				: ''),
		actorId: opts?.actorId,
		source: opts?.source ?? 'system',
		color: AuditColor.warn,
	});

	let rebalanced = false;
	if (opts?.rebalance !== false && diplomacyChannelsEnabled(config)) {
		const rb = await runDiplomacyAutoRebalance(env, token, config, guildId, {
			force: true,
			reason: `tag rename ${result.fromTag}→${result.toTag}`,
			source: opts?.source ?? 'system',
		});
		rebalanced = rb.ran;
		if (rb.config) Object.assign(config, rb.config);
	}

	return { ok: true, rebalanced };
}

/**
 * Run letter-bucket rebalance using persisted soft limit (sticky min bucket count).
 */
export async function runDiplomacyAutoRebalance(
	env: Env,
	token: string,
	config: GuildConfig,
	guildId: string,
	opts?: {
		force?: boolean;
		reason?: string;
		source?: 'cron' | 'admin' | 'system';
		actorId?: string;
	},
): Promise<{ ran: boolean; summary?: string; config?: GuildConfig }> {
	if (!diplomacyChannelsEnabled(config)) return { ran: false };
	if (!opts?.force && !diplomacyNeedsRebalance(config)) return { ran: false };

	const softLimit = resolveDiplomacySoftLimit(config);
	const result = await rebalanceDiplomacyChannels(token, config, guildId, {
		softLimit,
		createMissingTags: Object.keys(config.diplomacy_channel_map),
		archiveUnlinked: false,
		// Bulk path: move/rename only; sort once at end inside rebalance.
		applyPermissions: false,
	});

	await upsertGuildConfig(env.STFC_DB, {
		guild_id: guildId,
		diplomacy_channel_map: result.channelMap,
		diplomacy_category_map: result.categoryMap,
		diplomacy_archive_category_id: result.archiveCategoryId,
		...(result.specialChannelId !== undefined
			? { diplomacy_special_channel_id: result.specialChannelId }
			: {}),
		...(result.specialCategoryId !== undefined
			? { diplomacy_special_category_id: result.specialCategoryId }
			: {}),
	});

	const after = (await getGuildConfig(env.STFC_DB, guildId)) ?? config;
	await postAuditLog(env, after, {
		title: 'Diplomacy auto-rebalance',
		description:
			(opts?.reason ? `_${opts.reason}_\n` : '') + result.summary.slice(0, 1400),
		actorId: opts?.actorId,
		source: opts?.source ?? 'system',
		color: result.ok ? AuditColor.success : AuditColor.warn,
	});

	return { ran: true, summary: result.summary, config: after };
}
