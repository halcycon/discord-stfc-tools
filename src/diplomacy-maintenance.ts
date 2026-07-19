/**
 * Diplomacy auto-rebalance + alliance tag remap orchestration (cron / track / verify).
 */
import { postAuditLog, AuditColor } from './audit-log';
import { categoryForLetterName } from './channel-utils';
import {
	diplomacyChannelsEnabled,
	diplomacyNeedsRebalance,
	rebalanceDiplomacyChannels,
	remapDiplomacyAllianceTag,
	resolveDiplomacySoftLimit,
} from './diplomacy-channels';
import { listGuildChannels, patchGuildChannel } from './discord-api';
import {
	deleteAllianceRosterForId,
	getGuildConfig,
	upsertGuildConfig,
} from './guild-db';
import { resolveArchiveCategory } from './personal-channels';
import { isDeployTesting } from './deploy-mode';
import type { AllianceVanished } from './alliance-roster-sync';
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
 * Untrack + unmap diplomacy + archive Discord room when an alliance is gone from stfc.pro
 * (not on server directory and `/alliances/{id}` scrape failed).
 */
export async function applyVanishedAlliances(
	env: Env,
	config: GuildConfig,
	vanished: AllianceVanished[],
	opts?: {
		actorId?: string;
		source?: 'cron' | 'admin' | 'system';
		forceDiscord?: boolean;
		onProgress?: (message: string) => Promise<void>;
	},
): Promise<{ config: GuildConfig; archived: number; untracked: string[]; errors: string[] }> {
	if (!vanished.length) {
		return { config, archived: 0, untracked: [], errors: [] };
	}

	let current = config;
	const errors: string[] = [];
	const untracked: string[] = [];
	let archived = 0;
	const token = env.DISCORD_BOT_TOKEN;
	const allowDiscord =
		Boolean(token) && ((opts?.forceDiscord === true) || !isDeployTesting(current));

	const report = opts?.onProgress;
	const tags = [...new Set(vanished.map((v) => v.tag.trim().toUpperCase()).filter(Boolean))];

	for (const v of vanished) {
		const tag = v.tag.trim().toUpperCase();
		if (!tag) continue;
		await report?.(`⏳ Alliance gone: untracking \`[${tag}]\`…`);

		const channelMap = { ...(current.diplomacy_channel_map ?? {}) };
		const preferred = { ...(current.diplomacy_preferred_locales ?? {}) };
		const channelId = channelMap[tag] ?? null;
		delete channelMap[tag];
		delete preferred[tag];

		const nextTracked = (current.tracked_alliance_tags ?? [])
			.map((t) => t.trim().toUpperCase())
			.filter((t) => t && t !== tag);

		await upsertGuildConfig(env.STFC_DB, {
			guild_id: current.guild_id,
			diplomacy_channel_map: channelMap,
			diplomacy_preferred_locales: preferred,
			tracked_alliance_tags: nextTracked,
		});
		current = {
			...current,
			diplomacy_channel_map: channelMap,
			diplomacy_preferred_locales: preferred,
			tracked_alliance_tags: nextTracked,
		};
		untracked.push(tag);

		try {
			await deleteAllianceRosterForId(env.STFC_DB, current.guild_id, v.allianceId);
		} catch (err) {
			errors.push(
				`[${tag}] roster delete: ${err instanceof Error ? err.message : String(err)}`,
			);
		}

		if (allowDiscord && channelId && /^\d{15,20}$/.test(channelId)) {
			try {
				const archiveMap = current.diplomacy_archive_category_map ?? {};
				let parentId =
					categoryForLetterName(archiveMap, tag) ||
					current.diplomacy_archive_category_id ||
					null;
				if (!parentId) {
					const resolved = await resolveArchiveCategory(token!, current.guild_id, {
						archiveName: 'Diplomacy Channels Archive',
						configArchiveCategoryId: current.diplomacy_archive_category_id,
						createIfMissing: true,
					});
					parentId = resolved.categoryId;
					if (parentId && resolved.created) {
						await upsertGuildConfig(env.STFC_DB, {
							guild_id: current.guild_id,
							diplomacy_archive_category_id: parentId,
						});
						current = { ...current, diplomacy_archive_category_id: parentId };
					}
				}
				if (parentId) {
					const channels = await listGuildChannels(token!, current.guild_id);
					const ch = channels.find((c) => c.id === channelId);
					if (ch && ch.parent_id !== parentId) {
						await patchGuildChannel(token!, channelId, { parent_id: parentId });
					}
					archived++;
				} else {
					errors.push(`[${tag}] no archive category available`);
				}
			} catch (err) {
				errors.push(
					`[${tag}] archive: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}

		await postAuditLog(env, current, {
			title: 'Alliance vanished (untracked)',
			description:
				`**[${tag}]** id \`${v.allianceId}\` — not on server directory and alliance page scrape failed.` +
				(channelId ? `\nDiplomacy <#${channelId}> unmapped` + (archived ? ' + archived' : '') : '') +
				(isDeployTesting(config) && !opts?.forceDiscord
					? '\n_Discord archive skipped (testing) — D1 untracked/unmapped_'
					: ''),
			actorId: opts?.actorId,
			source: opts?.source ?? 'system',
			color: AuditColor.warn,
		});
	}

	const refreshed = (await getGuildConfig(env.STFC_DB, current.guild_id)) ?? current;
	return { config: refreshed, archived, untracked: tags, errors };
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
