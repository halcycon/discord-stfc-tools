/**
 * Multi-alliance: track a tag and scrape its roster immediately into D1.
 */
import {
	countAllianceMembersMissingVerify,
	getGuildConfig,
	getServerAllianceIdByTag,
	listActiveVerifiedPlayers,
	listAllianceRosterMembers,
	listAllianceRosterMeta,
	rememberAllianceTagAlias,
	replaceAllianceRoster,
	replaceServerAllianceDirectory,
	upsertGuildConfig,
} from './guild-db';
import { applyAllianceTagRename, remapAllianceTagInDb } from './diplomacy-maintenance';
import { opsLevelToGrade } from './grade-utils';
import { scrapeAllianceById, scrapeServerAlliances } from './stfc-utils';
import { applyActivityObservation } from './activity-utils';
import {
	collectTrackedAllianceTags,
	isMultiAllianceGuild,
} from './alliance-roster-sync';
import { parseTrackedAllianceTags } from './tracked-alliance-tags';
import { normalizeAllianceRank } from './nickname-utils';
import {
	applyDiplomacyForAlliance,
	applyMemberRoles,
} from './verification-access';
import { isDeployTesting } from './deploy-mode';
import type { GuildConfig } from './types';

export { parseTrackedAllianceTags } from './tracked-alliance-tags';

export type TrackAllianceResult =
	| {
			ok: true;
			allianceId: string;
			allianceTag: string;
			allianceName: string | null;
			playerCount: number;
			alreadyVerifiedOnRoster: number;
			missingVerify: number;
			trackedTags: string[];
			diplomacyChannelId: string | null;
			admiralsRolesApplied: number;
			admiralsRolesFailed: number;
	  }
	| { ok: false; error: string };

/**
 * Resolve tag → alliance id (refresh server directory if needed), scrape HTML,
 * persist roster, add tag to tracked_alliance_tags.
 * When defer_untracked_admiral_roles is on: create diplomacy + assign Admiral roles
 * for already-verified admirals of this tag.
 */
export async function trackAndScrapeAlliance(
	env: Env,
	config: GuildConfig,
	opts: {
		tag?: string | null;
		allianceId?: string | null;
		fromTag?: string | null;
		/** Rename/move Discord diplomacy channel even when deploy_mode is testing. */
		applyDiscord?: boolean;
	},
): Promise<TrackAllianceResult> {
	if (!isMultiAllianceGuild(config)) {
		return { ok: false, error: 'Only available in **multi_alliance** mode.' };
	}

	const tagIn = opts.tag?.trim().toUpperCase() || null;
	let allianceId = opts.allianceId?.trim() || null;
	if (!tagIn && !allianceId) {
		return { ok: false, error: 'Provide `tag:` or `alliance_id:`.' };
	}

	/**
	 * Prefer cached server directory (from morning/resync) so we only need one stfc.pro
	 * page fetch. A full directory scrape + alliance scrape can exceed CF waitUntil (~30s).
	 */
	let resolvedTag = tagIn;
	let allianceName: string | null = null;
	const fetchedAt = new Date().toISOString();

	if (!allianceId && tagIn) {
		allianceId = await getServerAllianceIdByTag(env.STFC_DB, config.guild_id, tagIn);
	}

	if (!allianceId || !resolvedTag) {
		const directory = await scrapeServerAlliances(config.stfc_server, config.stfc_region);
		if (directory.length === 0) {
			return { ok: false, error: 'Could not load stfc.pro server alliance directory.' };
		}
		await replaceServerAllianceDirectory(
			env.STFC_DB,
			config.guild_id,
			fetchedAt,
			directory.map((e) => ({
				allianceId: e.allianceId,
				allianceTag: e.allianceTag,
				allianceName: e.allianceName || null,
				serverRank: e.serverRank,
				playerCount: e.playerCount,
			})),
		);

		if (!allianceId && tagIn) {
			const fromDir = directory.find((e) => e.allianceTag.toUpperCase() === tagIn);
			allianceId = fromDir?.allianceId ?? null;
			allianceName = fromDir?.allianceName || null;
		} else if (allianceId) {
			const fromDir = directory.find((e) => e.allianceId === allianceId);
			resolvedTag = (fromDir?.allianceTag || tagIn || '').toUpperCase() || null;
			allianceName = fromDir?.allianceName || null;
		}

		if (!allianceId && tagIn) {
			return {
				ok: false,
				error: `Alliance tag **${tagIn}** not found on server **${config.stfc_server}** (${config.stfc_region}).`,
			};
		}
		if (allianceId && !resolvedTag) {
			return {
				ok: false,
				error: `Alliance id \`${allianceId}\` not on server directory — pass \`tag:\` as well or check the id.`,
			};
		}
	} else if (allianceId && tagIn) {
		resolvedTag = tagIn;
	}

	if (!allianceId || !resolvedTag) {
		return { ok: false, error: 'Could not resolve alliance id/tag.' };
	}

	const scrape = await scrapeAllianceById(allianceId, config.stfc_server, config.stfc_region);
	if (!scrape || scrape.players.length === 0) {
		return {
			ok: false,
			error: `Failed to scrape alliance **${resolvedTag}** (\`${allianceId}\`) from stfc.pro.`,
		};
	}

	const tag = (scrape.allianceTag || resolvedTag).toUpperCase();
	const id = scrape.allianceId || allianceId;
	const priorMeta = (await listAllianceRosterMeta(env.STFC_DB, config.guild_id)).find(
		(m) => m.alliance_id === id,
	);
	const priorTag = priorMeta?.alliance_tag?.trim().toUpperCase() || null;
	const previous = await listAllianceRosterMembers(env.STFC_DB, config.guild_id);
	const previousById = new Map(previous.map((m) => [m.player_id, m]));

	const members = scrape.players.map((p) => {
		const prev = previousById.get(p.playerId);
		let activityStreak: number | null =
			p.consecutiveDaysActive == null
				? null
				: Math.max(0, Math.floor(p.consecutiveDaysActive));
		let daysInactive = prev?.days_inactive ?? 0;
		if (activityStreak != null && Number.isFinite(activityStreak)) {
			const snap = applyActivityObservation(
				prev?.activity_streak,
				prev?.days_inactive,
				activityStreak,
			);
			activityStreak = snap.activityStreak;
			daysInactive = snap.daysInactive;
		}
		return {
			playerId: p.playerId,
			playerName: p.name,
			allianceTag: p.allianceTag || tag,
			allianceId: p.allianceId || id,
			allianceRank: p.rank || '',
			opsLevel: p.level,
			power: p.power,
			grade: opsLevelToGrade(p.level),
			joinDate: p.joinDate || '',
			activityStreak,
			daysInactive,
		};
	});

	await replaceAllianceRoster(env.STFC_DB, {
		guildId: config.guild_id,
		allianceId: id,
		allianceTag: tag,
		allianceName: scrape.allianceName || allianceName,
		fetchedAt,
		scope: 'alliance',
		members,
	});

	// Explicit from_tag wins (meta may already say the new tag from an earlier scrape).
	const fromTagOpt = opts.fromTag?.trim().toUpperCase() || null;
	const renameFrom =
		fromTagOpt && fromTagOpt !== tag
			? fromTagOpt
			: priorTag && priorTag !== tag
				? priorTag
				: null;

	const nextTracked = parseTrackedAllianceTags([
		...(config.tracked_alliance_tags ?? []).map((t) => {
			const upper = t.trim().toUpperCase();
			if (renameFrom && upper === renameFrom) return tag;
			if (priorTag && priorTag !== tag && upper === priorTag) return tag;
			return t;
		}),
		tag,
	]);
	await upsertGuildConfig(env.STFC_DB, {
		guild_id: config.guild_id,
		tracked_alliance_tags: nextTracked,
	});
	config.tracked_alliance_tags = nextTracked;

	let diplomacyChannelId: string | null = null;
	let admiralsRolesApplied = 0;
	let admiralsRolesFailed = 0;

	const token = env.DISCORD_BOT_TOKEN;
	const applyDiscord = opts.applyDiscord === true || !isDeployTesting(config);
	if (renameFrom) {
		await rememberAllianceTagAlias(env.STFC_DB, config.guild_id, id, renameFrom);
		await rememberAllianceTagAlias(env.STFC_DB, config.guild_id, id, tag);
		if (token && applyDiscord) {
			await applyAllianceTagRename(env, token, config, config.guild_id, renameFrom, tag, {
				source: 'admin',
				rebalance: true,
				allianceId: id,
			});
			const refreshed = await getGuildConfig(env.STFC_DB, config.guild_id);
			if (refreshed) Object.assign(config, refreshed);
		} else {
			// Testing without apply_discord: remap D1 only (Discord channel name stays until override).
			const dbRemap = await remapAllianceTagInDb(env, config, renameFrom, tag, {
				source: 'admin',
				allianceId: id,
			});
			if (dbRemap.ok) Object.assign(config, dbRemap.config);
		}
	}
	if (token && applyDiscord) {
		// Refresh Discord channel name/placement for the (possibly already remapped) tag.
		diplomacyChannelId = await applyDiplomacyForAlliance(
			env,
			token,
			config,
			config.guild_id,
			tag,
		);

		const verified = await listActiveVerifiedPlayers(env.STFC_DB, config.guild_id);
		const admirals = verified.filter(
			(p) =>
				(p.alliance_tag ?? '').trim().toUpperCase() === tag &&
				normalizeAllianceRank(p.alliance_rank) === 'Admiral' &&
				(p.verification_status === 'active' ||
					p.verification_status === 'verified' ||
					p.verification_status === 'guest'),
		);
		for (const p of admirals) {
			if (p.verification_status === 'guest') continue; // lounge until agreement
			try {
				const changes = await applyMemberRoles(
					token,
					config,
					config.guild_id,
					p.discord_user_id,
					p.alliance_rank ?? 'Admiral',
					tag,
				);
				if (changes.added.length > 0 || changes.unchanged.length > 0) {
					admiralsRolesApplied++;
				}
			} catch (err) {
				console.warn(`Admiral role backfill failed for ${p.discord_user_id}:`, err);
				admiralsRolesFailed++;
			}
		}
	}

	let alreadyVerifiedOnRoster = 0;
	if (members.length > 0) {
		// D1/SQLite caps bound variables (~100); chunk large rosters.
		const ids = members.map((m) => m.playerId);
		const chunkSize = 80;
		for (let i = 0; i < ids.length; i += chunkSize) {
			const chunk = ids.slice(i, i + chunkSize);
			const placeholders = chunk.map(() => '?').join(',');
			const linkedRow = await env.STFC_DB.prepare(
				`SELECT COUNT(*) AS c FROM verified_players
				 WHERE guild_id = ?
				   AND verification_status IN ('verified','active','guest')
				   AND player_id IN (${placeholders})`,
			)
				.bind(config.guild_id, ...chunk)
				.first();
			alreadyVerifiedOnRoster += Number((linkedRow as { c?: number } | null)?.c ?? 0);
		}
	}

	const missingVerify = await countAllianceMembersMissingVerify(env.STFC_DB, config.guild_id);
	const verified = await listActiveVerifiedPlayers(env.STFC_DB, config.guild_id);
	const allTracked = [...collectTrackedAllianceTags(config, verified)].sort();

	return {
		ok: true,
		allianceId: id,
		allianceTag: tag,
		allianceName: scrape.allianceName || allianceName,
		playerCount: members.length,
		alreadyVerifiedOnRoster,
		missingVerify,
		trackedTags: allTracked,
		diplomacyChannelId,
		admiralsRolesApplied,
		admiralsRolesFailed,
	};
}

export async function untrackAllianceTag(
	env: Env,
	config: GuildConfig,
	tagRaw: string,
): Promise<{ ok: true; trackedTags: string[] } | { ok: false; error: string }> {
	if (!isMultiAllianceGuild(config)) {
		return { ok: false, error: 'Only available in **multi_alliance** mode.' };
	}
	const tag = tagRaw.trim().toUpperCase();
	if (!tag) return { ok: false, error: 'Provide `tag:`.' };
	const next = (config.tracked_alliance_tags ?? []).filter((t) => t.toUpperCase() !== tag);
	await upsertGuildConfig(env.STFC_DB, {
		guild_id: config.guild_id,
		tracked_alliance_tags: next,
	});
	return { ok: true, trackedTags: next };
}
