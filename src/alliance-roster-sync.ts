import {
	clearAllianceRoster,
	getAllianceRosterLatestFetchedAt,
	getAllianceRosterMember,
	getAllianceRosterMemberByName,
	getAllianceRosterMeta,
	listActiveVerifiedPlayers,
	listAllianceRosterMembers,
	listAllianceRosterMeta,
	pruneAllianceRostersOutside,
	replaceAllianceRoster,
	replaceServerAllianceDirectory,
	setGuildStfcAllianceId,
	upsertGuildConfig,
	type AllianceRosterMemberRow,
} from './guild-db';
import { opsLevelToGrade } from './grade-utils';
import {
	lookupPlayerByIdOrName,
	scrapeAllianceById,
	scrapeServerAlliances,
	type AllianceRosterScrape,
	type ServerAllianceDirectoryEntry,
} from './stfc-utils';
import type { GuildConfig, PlayerData, VerifiedPlayer } from './types';
import {
	diffAllianceRosters,
	type AllianceRosterDiff,
} from './alliance-roster-diff';
import { applyActivityObservation } from './activity-utils';

/** Prefer morning scrape through the next daily run (with slack). */
export const ALLIANCE_ROSTER_MAX_AGE_MS = 36 * 60 * 60 * 1000;

/** Max alliance HTML pages per morning multi sync (batch). */
export const MULTI_ALLIANCE_SCRAPE_MAX = 40;

/** Delay between alliance page fetches (ms). */
export const MULTI_ALLIANCE_SCRAPE_DELAY_MS = 1200;

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/** Single-alliance guilds use one configured tag roster. */
export function shouldUseAllianceRoster(
	config: Pick<GuildConfig, 'mode' | 'alliance_tag'>,
): boolean {
	return config.mode === 'single_alliance' && Boolean(config.alliance_tag?.trim());
}

export function isMultiAllianceGuild(config: Pick<GuildConfig, 'mode'>): boolean {
	return config.mode === 'multi_alliance';
}

/** Verify/sync may read roster cache in single or multi when fresh. */
export function canReadAllianceRosterCache(
	config: Pick<GuildConfig, 'mode' | 'alliance_tag'>,
): boolean {
	return shouldUseAllianceRoster(config) || isMultiAllianceGuild(config);
}

export function isAllianceRosterFresh(fetchedAt: string, nowMs = Date.now()): boolean {
	const t = Date.parse(fetchedAt);
	if (!Number.isFinite(t)) return false;
	return nowMs - t <= ALLIANCE_ROSTER_MAX_AGE_MS;
}

export function rosterMemberToPlayerData(
	member: AllianceRosterMemberRow,
	config: GuildConfig,
): PlayerData {
	const ops = member.ops_level ?? 0;
	const power = member.power ?? 0;
	return {
		playerId: member.player_id,
		name: member.player_name ?? '',
		rank: member.alliance_rank ?? '',
		level: ops,
		helps: '',
		rss: String(power),
		power,
		max_power: power,
		iso: '',
		joinDate: member.join_date ?? '',
		allianceId: member.alliance_id ?? config.stfc_alliance_id ?? '',
		allianceTag: member.alliance_tag ?? config.alliance_tag ?? '',
		server: config.stfc_server,
		region: config.stfc_region,
		consecutiveDaysActive: member.activity_streak,
	};
}

export function collectTrackedAllianceTags(
	config: GuildConfig,
	verified: VerifiedPlayer[],
): Set<string> {
	const tags = new Set<string>();
	for (const p of verified) {
		const t = p.alliance_tag?.trim();
		if (t) tags.add(t.toUpperCase());
	}
	for (const tag of Object.keys(config.diplomacy_channel_map ?? {})) {
		const t = tag.trim();
		if (t) tags.add(t.toUpperCase());
	}
	for (const tag of config.tracked_alliance_tags ?? []) {
		const t = tag.trim();
		if (t) tags.add(t.toUpperCase());
	}
	return tags;
}

export async function resolveGuildAllianceId(
	env: Env,
	config: GuildConfig,
): Promise<string | null> {
	if (config.stfc_alliance_id?.trim()) return config.stfc_alliance_id.trim();

	const verified = await listActiveVerifiedPlayers(env.STFC_DB, config.guild_id);
	for (const record of verified) {
		if (!record.player_id) continue;
		const lookup = await lookupPlayerByIdOrName(
			env,
			record.player_id,
			config.stfc_server,
			config.stfc_region,
		);
		if (lookup.status !== 'ok') continue;
		const allianceId = lookup.player.allianceId?.trim();
		if (!allianceId) continue;
		await setGuildStfcAllianceId(env.STFC_DB, config.guild_id, allianceId);
		config.stfc_alliance_id = allianceId;
		console.log(
			`Discovered stfc_alliance_id=${allianceId} for guild ${config.guild_id} via player ${record.player_id}`,
		);
		return allianceId;
	}
	return null;
}

function membersFromScrape(
	scrape: AllianceRosterScrape,
	allianceId: string,
	tag: string,
	previousByPlayerId?: Map<number, AllianceRosterMemberRow>,
): Array<{
	playerId: number;
	playerName: string;
	allianceTag: string;
	allianceId: string;
	allianceRank: string;
	opsLevel: number;
	power: number;
	grade: number | null;
	joinDate: string;
	activityStreak: number | null;
	daysInactive: number;
}> {
	return scrape.players.map((p) => {
		const prev = previousByPlayerId?.get(p.playerId);
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
			allianceId: p.allianceId || scrape.allianceId || allianceId,
			allianceRank: p.rank || '',
			opsLevel: p.level,
			power: p.power,
			grade: opsLevelToGrade(p.level),
			joinDate: p.joinDate || '',
			activityStreak,
			daysInactive,
		};
	});
}

export async function syncGuildAllianceRoster(
	env: Env,
	config: GuildConfig,
): Promise<
	| { ok: true; scrape: AllianceRosterScrape; diff: AllianceRosterDiff }
	| { ok: false; reason: string }
> {
	if (!shouldUseAllianceRoster(config)) {
		return { ok: false, reason: 'not_single_alliance' };
	}

	const allianceId = await resolveGuildAllianceId(env, config);
	if (!allianceId) {
		return { ok: false, reason: 'missing_alliance_id' };
	}

	const scrape = await scrapeAllianceById(allianceId, config.stfc_server, config.stfc_region);
	if (!scrape || scrape.players.length === 0) {
		return { ok: false, reason: 'scrape_failed' };
	}

	const previousRows = await listAllianceRosterMembers(env.STFC_DB, config.guild_id);
	const previousById = new Map(previousRows.map((m) => [m.player_id, m]));
	const previous = previousRows.map((m) => ({
		playerId: m.player_id,
		playerName: m.player_name,
		allianceRank: m.alliance_rank,
		opsLevel: m.ops_level,
		allianceTag: m.alliance_tag,
	}));

	const fetchedAt = new Date().toISOString();
	const tag = scrape.allianceTag || config.alliance_tag!;
	const members = membersFromScrape(scrape, allianceId, tag, previousById);

	const diff = diffAllianceRosters(previous, members);

	await replaceAllianceRoster(env.STFC_DB, {
		guildId: config.guild_id,
		allianceId: scrape.allianceId || allianceId,
		allianceTag: tag,
		allianceName: scrape.allianceName || null,
		fetchedAt,
		scope: 'guild',
		members,
	});

	if (!config.stfc_alliance_id || config.stfc_alliance_id !== (scrape.allianceId || allianceId)) {
		const id = scrape.allianceId || allianceId;
		await setGuildStfcAllianceId(env.STFC_DB, config.guild_id, id);
		config.stfc_alliance_id = id;
	}

	console.log(
		`Alliance roster synced for guild ${config.guild_id}: ${scrape.players.length} members (${tag})` +
			(diff.isInitial
				? ' [initial]'
				: ` [+${diff.joined.length}/-${diff.left.length} moves${diff.tagMoved.length} ops↑${diff.opsUp.length}]`),
	);
	return { ok: true, scrape, diff };
}

export type AllianceTagRename = {
	allianceId: string;
	fromTag: string;
	toTag: string;
};

export type MultiAllianceRosterSyncResult =
	| {
			ok: true;
			diff: AllianceRosterDiff;
			directoryCount: number;
			trackedTags: number;
			scrapedAlliances: number;
			skippedTags: string[];
			failedTags: string[];
			/** Same alliance id, tag string changed (diplomacy remap candidates). */
			tagRenames: AllianceTagRename[];
	  }
	| { ok: false; reason: string };

/**
 * Multi-alliance morning job:
 * 1) Fetch /servers/{n} directory
 * 2) Track tags = verified player tags ∪ diplomacy map tags
 * 3) Scrape those alliance pages (batched)
 * 4) Diff vs previous combined roster
 */
export async function syncMultiAllianceTrackedRosters(
	env: Env,
	config: GuildConfig,
): Promise<MultiAllianceRosterSyncResult> {
	if (!isMultiAllianceGuild(config)) {
		return { ok: false, reason: 'not_multi_alliance' };
	}

	const verified = await listActiveVerifiedPlayers(env.STFC_DB, config.guild_id);
	const trackedTags = collectTrackedAllianceTags(config, verified);
	if (trackedTags.size === 0) {
		return { ok: false, reason: 'no_tracked_tags' };
	}

	const previousRows = await listAllianceRosterMembers(env.STFC_DB, config.guild_id);
	const previous = previousRows.map((m) => ({
		playerId: m.player_id,
		playerName: m.player_name,
		allianceRank: m.alliance_rank,
		opsLevel: m.ops_level,
		allianceTag: m.alliance_tag,
	}));

	const directory = await scrapeServerAlliances(config.stfc_server, config.stfc_region);
	if (directory.length === 0) {
		return { ok: false, reason: 'server_directory_failed' };
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

	const byTag = new Map<string, ServerAllianceDirectoryEntry>();
	const byId = new Map<string, ServerAllianceDirectoryEntry>();
	for (const e of directory) {
		byTag.set(e.allianceTag.toUpperCase(), e);
		byId.set(e.allianceId, e);
	}

	const priorMeta = await listAllianceRosterMeta(env.STFC_DB, config.guild_id);
	const metaByTag = new Map<string, (typeof priorMeta)[0]>();
	const metaById = new Map<string, (typeof priorMeta)[0]>();
	for (const m of priorMeta) {
		metaById.set(m.alliance_id, m);
		if (m.alliance_tag?.trim()) metaByTag.set(m.alliance_tag.trim().toUpperCase(), m);
	}

	const toScrape: ServerAllianceDirectoryEntry[] = [];
	const skippedTags: string[] = [];
	const seenAllianceIds = new Set<string>();
	for (const tag of trackedTags) {
		let entry = byTag.get(tag);
		if (!entry) {
			// Tag may have renamed: resolve prior alliance id → current directory row.
			const meta = metaByTag.get(tag);
			if (meta) entry = byId.get(meta.alliance_id);
		}
		if (entry) {
			if (!seenAllianceIds.has(entry.allianceId)) {
				seenAllianceIds.add(entry.allianceId);
				toScrape.push(entry);
			}
		} else {
			skippedTags.push(tag);
		}
	}

	const batch = toScrape.slice(0, MULTI_ALLIANCE_SCRAPE_MAX);
	const overflow = toScrape.slice(MULTI_ALLIANCE_SCRAPE_MAX).map((e) => e.allianceTag);
	skippedTags.push(...overflow);

	const failedTags: string[] = [];
	const keepAllianceIds: string[] = [];
	const tagRenames: AllianceTagRename[] = [];
	let scrapedAlliances = 0;

	for (let i = 0; i < batch.length; i++) {
		const entry = batch[i]!;
		if (i > 0) await sleep(MULTI_ALLIANCE_SCRAPE_DELAY_MS);
		const scrape = await scrapeAllianceById(
			entry.allianceId,
			config.stfc_server,
			config.stfc_region,
		);
		if (!scrape || scrape.players.length === 0) {
			failedTags.push(entry.allianceTag);
			// Keep prior cache for this alliance so we don't wipe day-over-day history on a blip.
			keepAllianceIds.push(entry.allianceId);
			continue;
		}
		const tag = (scrape.allianceTag || entry.allianceTag).trim().toUpperCase();
		const allianceId = scrape.allianceId || entry.allianceId;
		const prior = metaById.get(allianceId);
		const priorTag = prior?.alliance_tag?.trim().toUpperCase();
		if (priorTag && tag && priorTag !== tag) {
			tagRenames.push({ allianceId, fromTag: priorTag, toTag: tag });
		}
		const previousForAlliance = await listAllianceRosterMembers(env.STFC_DB, config.guild_id);
		const previousById = new Map(previousForAlliance.map((m) => [m.player_id, m]));
		const members = membersFromScrape(scrape, allianceId, tag, previousById);
		await replaceAllianceRoster(env.STFC_DB, {
			guildId: config.guild_id,
			allianceId,
			allianceTag: tag,
			allianceName: scrape.allianceName || entry.allianceName || null,
			fetchedAt,
			scope: 'alliance',
			members,
		});
		keepAllianceIds.push(allianceId);
		scrapedAlliances++;
	}

	if (scrapedAlliances === 0) {
		return { ok: false, reason: 'all_alliance_scrapes_failed' };
	}

	// Drop caches for alliances we no longer track (or didn't attempt this run).
	await pruneAllianceRostersOutside(env.STFC_DB, config.guild_id, keepAllianceIds);

	// Persist tracked-tag remaps even if Discord diplomacy remap runs later / fails.
	if (tagRenames.length) {
		const renameMap = new Map(tagRenames.map((r) => [r.fromTag, r.toTag]));
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

	const currentRows = await listAllianceRosterMembers(env.STFC_DB, config.guild_id);
	const current = currentRows.map((m) => ({
		playerId: m.player_id,
		playerName: m.player_name,
		allianceRank: m.alliance_rank,
		opsLevel: m.ops_level,
		allianceTag: m.alliance_tag,
	}));
	const diff = diffAllianceRosters(previous, current);

	console.log(
		`Multi alliance roster sync guild ${config.guild_id}: dir=${directory.length} tracked=${trackedTags.size} scraped=${scrapedAlliances} failed=${failedTags.length} skipped=${skippedTags.length}`,
	);

	return {
		ok: true,
		diff,
		directoryCount: directory.length,
		trackedTags: trackedTags.size,
		scrapedAlliances,
		skippedTags,
		failedTags,
		tagRenames,
	};
}

/** Clear roster cache + alliance id when leaving single-alliance mode. */
export async function clearGuildAllianceRosterCache(env: Env, guildId: string): Promise<void> {
	await clearAllianceRoster(env.STFC_DB, guildId);
	await setGuildStfcAllianceId(env.STFC_DB, guildId, null);
}

/** Build playerId → PlayerData map from the latest D1 roster (no network). */
export async function loadRosterPlayerMap(
	env: Env,
	config: GuildConfig,
): Promise<Map<number, PlayerData> | null> {
	if (!canReadAllianceRosterCache(config)) return null;
	const fetchedAt = await getAllianceRosterLatestFetchedAt(env.STFC_DB, config.guild_id);
	if (!fetchedAt || !isAllianceRosterFresh(fetchedAt)) return null;
	const members = await listAllianceRosterMembers(env.STFC_DB, config.guild_id);
	if (members.length === 0) return null;
	const map = new Map<number, PlayerData>();
	for (const m of members) {
		if (!isAllianceRosterFresh(m.fetched_at)) continue;
		// Multi: only this morning's successful scrapes (failed alliances keep older fetched_at).
		if (isMultiAllianceGuild(config) && m.fetched_at !== fetchedAt) continue;
		map.set(m.player_id, rosterMemberToPlayerData(m, config));
	}
	return map.size > 0 ? map : null;
}

/**
 * Prefer a fresh alliance roster hit for verify / guest checks.
 * Works for single- and multi-alliance when cache is fresh.
 */
export async function lookupPlayerFromAllianceRoster(
	env: Env,
	config: GuildConfig,
	playerIdOrName: string | number,
): Promise<PlayerData | null> {
	if (!canReadAllianceRosterCache(config)) return null;

	const fetchedAt = await getAllianceRosterLatestFetchedAt(env.STFC_DB, config.guild_id);
	if (!fetchedAt || !isAllianceRosterFresh(fetchedAt)) return null;

	const numericId =
		typeof playerIdOrName === 'number'
			? playerIdOrName
			: /^\d+$/.test(String(playerIdOrName).trim())
				? Number(String(playerIdOrName).trim())
				: null;

	let member: AllianceRosterMemberRow | null = null;
	if (numericId && Number.isFinite(numericId)) {
		member = await getAllianceRosterMember(env.STFC_DB, config.guild_id, numericId);
	} else {
		member = await getAllianceRosterMemberByName(
			env.STFC_DB,
			config.guild_id,
			String(playerIdOrName),
		);
	}
	if (!member) return null;
	return rosterMemberToPlayerData(member, config);
}
