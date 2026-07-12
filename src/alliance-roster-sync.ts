import {
	clearAllianceRoster,
	getAllianceRosterMember,
	getAllianceRosterMemberByName,
	getAllianceRosterMeta,
	listActiveVerifiedPlayers,
	listAllianceRosterMembers,
	replaceAllianceRoster,
	setGuildStfcAllianceId,
	type AllianceRosterMemberRow,
} from './guild-db';
import { opsLevelToGrade } from './grade-utils';
import {
	lookupPlayerByIdOrName,
	scrapeAllianceById,
	type AllianceRosterScrape,
} from './stfc-utils';
import type { GuildConfig, PlayerData } from './types';

/** Prefer morning scrape through the next daily run (with slack). */
export const ALLIANCE_ROSTER_MAX_AGE_MS = 36 * 60 * 60 * 1000;

/** Roster cache is single-alliance only — multi never scrapes or reads it. */
export function shouldUseAllianceRoster(
	config: Pick<GuildConfig, 'mode' | 'alliance_tag'>,
): boolean {
	return config.mode === 'single_alliance' && Boolean(config.alliance_tag?.trim());
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
	};
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

export async function syncGuildAllianceRoster(
	env: Env,
	config: GuildConfig,
): Promise<{ ok: true; scrape: AllianceRosterScrape } | { ok: false; reason: string }> {
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

	const fetchedAt = new Date().toISOString();
	const tag = scrape.allianceTag || config.alliance_tag!;

	await replaceAllianceRoster(env.STFC_DB, {
		guildId: config.guild_id,
		allianceId: scrape.allianceId || allianceId,
		allianceTag: tag,
		allianceName: scrape.allianceName || null,
		fetchedAt,
		members: scrape.players.map((p) => ({
			playerId: p.playerId,
			playerName: p.name,
			allianceTag: p.allianceTag || tag,
			allianceId: p.allianceId || scrape.allianceId || allianceId,
			allianceRank: p.rank || '',
			opsLevel: p.level,
			power: p.power,
			grade: opsLevelToGrade(p.level),
			joinDate: p.joinDate || '',
		})),
	});

	if (!config.stfc_alliance_id || config.stfc_alliance_id !== (scrape.allianceId || allianceId)) {
		const id = scrape.allianceId || allianceId;
		await setGuildStfcAllianceId(env.STFC_DB, config.guild_id, id);
		config.stfc_alliance_id = id;
	}

	console.log(
		`Alliance roster synced for guild ${config.guild_id}: ${scrape.players.length} members (${tag})`,
	);
	return { ok: true, scrape };
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
	if (!shouldUseAllianceRoster(config)) return null;
	const meta = await getAllianceRosterMeta(env.STFC_DB, config.guild_id);
	if (!meta || !isAllianceRosterFresh(meta.fetched_at)) return null;
	const members = await listAllianceRosterMembers(env.STFC_DB, config.guild_id);
	const map = new Map<number, PlayerData>();
	for (const m of members) {
		map.set(m.player_id, rosterMemberToPlayerData(m, config));
	}
	return map;
}

/**
 * Prefer a fresh alliance roster hit for verify / guest checks.
 * Returns null when roster is stale/missing, mode is multi, or the player is not on it.
 */
export async function lookupPlayerFromAllianceRoster(
	env: Env,
	config: GuildConfig,
	playerIdOrName: string | number,
): Promise<PlayerData | null> {
	if (!shouldUseAllianceRoster(config)) return null;

	const meta = await getAllianceRosterMeta(env.STFC_DB, config.guild_id);
	if (!meta || !isAllianceRosterFresh(meta.fetched_at)) return null;

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
