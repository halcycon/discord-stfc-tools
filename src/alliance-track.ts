/**
 * Multi-alliance: track a tag and scrape its roster immediately into D1.
 */
import {
	countAllianceMembersMissingVerify,
	getServerAllianceIdByTag,
	listActiveVerifiedPlayers,
	listAllianceRosterMembers,
	replaceAllianceRoster,
	replaceServerAllianceDirectory,
	upsertGuildConfig,
} from './guild-db';
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
	opts: { tag?: string | null; allianceId?: string | null },
): Promise<TrackAllianceResult> {
	if (!isMultiAllianceGuild(config)) {
		return { ok: false, error: 'Only available in **multi_alliance** mode.' };
	}

	const tagIn = opts.tag?.trim().toUpperCase() || null;
	let allianceId = opts.allianceId?.trim() || null;
	if (!tagIn && !allianceId) {
		return { ok: false, error: 'Provide `tag:` or `alliance_id:`.' };
	}

	const directory = await scrapeServerAlliances(config.stfc_server, config.stfc_region);
	if (directory.length === 0) {
		return { ok: false, error: 'Could not load stfc.pro server alliance directory.' };
	}
	const fetchedAt = new Date().toISOString();
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

	let resolvedTag = tagIn;
	let allianceName: string | null = null;

	if (!allianceId && tagIn) {
		const fromDir = directory.find((e) => e.allianceTag.toUpperCase() === tagIn);
		allianceId =
			fromDir?.allianceId ??
			(await getServerAllianceIdByTag(env.STFC_DB, config.guild_id, tagIn));
		allianceName = fromDir?.allianceName || null;
		if (!allianceId) {
			return {
				ok: false,
				error: `Alliance tag **${tagIn}** not found on server **${config.stfc_server}** (${config.stfc_region}).`,
			};
		}
	} else if (allianceId) {
		const fromDir = directory.find((e) => e.allianceId === allianceId);
		resolvedTag = (fromDir?.allianceTag || tagIn || '').toUpperCase() || null;
		allianceName = fromDir?.allianceName || null;
		if (!resolvedTag) {
			return {
				ok: false,
				error: `Alliance id \`${allianceId}\` not on server directory — pass \`tag:\` as well or check the id.`,
			};
		}
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

	const nextTracked = parseTrackedAllianceTags([
		...(config.tracked_alliance_tags ?? []),
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
	if (token && !isDeployTesting(config)) {
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
		const placeholders = members.map(() => '?').join(',');
		const linkedRow = await env.STFC_DB.prepare(
			`SELECT COUNT(*) AS c FROM verified_players
			 WHERE guild_id = ?
			   AND verification_status IN ('verified','active','guest')
			   AND player_id IN (${placeholders})`,
		)
			.bind(config.guild_id, ...members.map((m) => m.playerId))
			.first();
		alreadyVerifiedOnRoster = Number((linkedRow as { c?: number } | null)?.c ?? 0);
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
