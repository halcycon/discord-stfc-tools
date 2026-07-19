import {
	clearAllianceRoster,
	getAllianceRosterLatestFetchedAt,
	getAllianceRosterMember,
	getAllianceRosterMemberByName,
	getAllianceRosterMeta,
	listActiveVerifiedPlayers,
	getAllianceIdByTagAlias,
	getServerAllianceIdByTag,
	listAllianceRosterMembers,
	listAllianceRosterMeta,
	pruneAllianceRostersOutside,
	rememberAllianceTagAlias,
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
import { createProgressReporter } from './progress-reporter';

/** Prefer morning scrape through the next daily run (with slack). */
export const ALLIANCE_ROSTER_MAX_AGE_MS = 36 * 60 * 60 * 1000;

/** Max alliance HTML pages per morning multi sync (batch). */
export const MULTI_ALLIANCE_SCRAPE_MAX = 40;

/** Delay between alliance page fetches (ms). */
export const MULTI_ALLIANCE_SCRAPE_DELAY_MS = 1200;

/**
 * Max alliances scraped per `/alliance resync` click.
 * After Discord’s deferred reply, Cloudflare `waitUntil` only extends ~30s wall time —
 * a full 40-alliance scrape cannot finish in one interaction.
 */
export const ALLIANCE_RESYNC_INTERACTION_CHUNK = 5;

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
			/** Tracked tags whose alliance page is gone (not on directory + scrape-by-id failed). */
			vanished: AllianceVanished[];
	  }
	| { ok: false; reason: string };

export type AllianceVanished = {
	tag: string;
	allianceId: string;
};

export type MultiAllianceRosterSyncOptions = {
	onProgress?: (message: string) => Promise<void>;
};

export type RosterDiffSnapshot = {
	playerId: number;
	playerName: string;
	allianceRank: string;
	opsLevel: number;
	allianceTag: string;
};

/** One alliance HTML page to fetch — always by `allianceId`, never by tag string. */
export type MultiAllianceScrapeEntry = ServerAllianceDirectoryEntry & {
	/** Tracked/diplomacy tag that resolved to this id (may differ after a rename). */
	requestedTag: string;
	/** True when this id appeared on the current `/servers/{n}` directory. */
	onDirectory: boolean;
};

export type PlannedMultiAllianceScrape = {
	fetchedAt: string;
	directoryCount: number;
	trackedTagCount: number;
	/** No stored alliance id (never scraped / meta pruned) — cannot follow renames or confirm disband. */
	skippedTags: string[];
	entries: MultiAllianceScrapeEntry[];
	/** Renames known at plan time (requested tag ≠ directory tag for same id). */
	plannedRenames: AllianceTagRename[];
	/** Alliance ids not scraped this invocation (overflow / later chunks) — do not prune. */
	preserveAllianceIds: string[];
	previous: RosterDiffSnapshot[];
};

function pushUniqueRename(into: AllianceTagRename[], rename: AllianceTagRename): void {
	if (!rename.fromTag || !rename.toTag || rename.fromTag === rename.toTag) return;
	if (into.some((r) => r.allianceId === rename.allianceId && r.fromTag === rename.fromTag)) return;
	into.push(rename);
}

/**
 * Resolve directory + which alliance **ids** to scrape (HTML pages are always by id).
 * Tag strings are only used to find a stored id (directory / roster meta / members).
 */
export async function planMultiAllianceScrape(
	env: Env,
	config: GuildConfig,
	opts?: { onProgress?: (message: string) => Promise<void> },
): Promise<
	| { ok: true; plan: PlannedMultiAllianceScrape }
	| { ok: false; reason: string }
> {
	if (!isMultiAllianceGuild(config)) {
		return { ok: false, reason: 'not_multi_alliance' };
	}

	const progress = createProgressReporter(opts?.onProgress);
	const report = (message: string) => progress.report(message);

	const verified = await listActiveVerifiedPlayers(env.STFC_DB, config.guild_id);
	const trackedTags = collectTrackedAllianceTags(config, verified);
	if (trackedTags.size === 0) {
		await progress.flush();
		return { ok: false, reason: 'no_tracked_tags' };
	}

	const previousRows = await listAllianceRosterMembers(env.STFC_DB, config.guild_id);
	const previous: RosterDiffSnapshot[] = previousRows.map((m) => ({
		playerId: m.player_id,
		playerName: m.player_name ?? '',
		allianceRank: m.alliance_rank ?? '',
		opsLevel: m.ops_level ?? 0,
		allianceTag: m.alliance_tag ?? '',
	}));
	const memberIdByTag = new Map<string, string>();
	for (const m of previousRows) {
		const t = m.alliance_tag?.trim().toUpperCase();
		const id = m.alliance_id?.trim();
		if (t && id && !memberIdByTag.has(t)) memberIdByTag.set(t, id);
	}

	// Resolve ids from *previous* server directory BEFORE we overwrite it (rename window).
	const priorDirIds = new Map<string, string>();
	for (const tag of trackedTags) {
		const id = await getServerAllianceIdByTag(env.STFC_DB, config.guild_id, tag);
		if (id) priorDirIds.set(tag, id.trim());
	}

	report(`⏳ Alliance sync: loading server directory (${trackedTags.size} tracked tag(s))…`);
	const directory = await scrapeServerAlliances(config.stfc_server, config.stfc_region);
	if (directory.length === 0) {
		await progress.flush();
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
		byId.set(e.allianceId.trim(), e);
	}

	const priorMeta = await listAllianceRosterMeta(env.STFC_DB, config.guild_id);
	const metaByTag = new Map<string, (typeof priorMeta)[0]>();
	const metaById = new Map<string, (typeof priorMeta)[0]>();
	for (const m of priorMeta) {
		const id = m.alliance_id?.trim();
		if (id) metaById.set(id, m);
		if (m.alliance_tag?.trim()) metaByTag.set(m.alliance_tag.trim().toUpperCase(), m);
	}

	const toScrape: MultiAllianceScrapeEntry[] = [];
	const skippedTags: string[] = [];
	const plannedRenames: AllianceTagRename[] = [];
	const seenAllianceIds = new Set<string>();

	for (const tag of trackedTags) {
		let dirEntry = byTag.get(tag);
		let allianceId: string | null = dirEntry?.allianceId?.trim() ?? null;
		let onDirectory = Boolean(dirEntry);

		if (!allianceId) {
			const meta = metaByTag.get(tag);
			if (meta?.alliance_id?.trim()) {
				allianceId = meta.alliance_id.trim();
				dirEntry = byId.get(allianceId);
				onDirectory = Boolean(dirEntry);
			}
		}
		if (!allianceId) {
			const fromAlias = await getAllianceIdByTagAlias(env.STFC_DB, config.guild_id, tag);
			if (fromAlias) {
				allianceId = fromAlias;
				dirEntry = byId.get(allianceId);
				onDirectory = Boolean(dirEntry);
			}
		}
		if (!allianceId) {
			const fromPriorDir = priorDirIds.get(tag);
			if (fromPriorDir) {
				allianceId = fromPriorDir;
				dirEntry = byId.get(allianceId);
				onDirectory = Boolean(dirEntry);
			}
		}
		if (!allianceId) {
			const fromMembers = memberIdByTag.get(tag);
			if (fromMembers) {
				allianceId = fromMembers;
				dirEntry = byId.get(allianceId);
				onDirectory = Boolean(dirEntry);
			}
		}

		if (!allianceId) {
			// No id on file — cannot scrape, follow a rename, or confirm disband.
			skippedTags.push(tag);
			continue;
		}

		const meta = metaById.get(allianceId);
		const entry: MultiAllianceScrapeEntry = dirEntry
			? {
					...dirEntry,
					allianceId,
					requestedTag: tag,
					onDirectory: true,
				}
			: {
					allianceId,
					allianceTag: (meta?.alliance_tag || tag).toUpperCase(),
					allianceName: meta?.alliance_name || '',
					serverRank: null,
					playerCount: meta?.player_count ?? null,
					server: config.stfc_server,
					region: config.stfc_region,
					requestedTag: tag,
					onDirectory: false,
				};

		const liveTag = entry.allianceTag.toUpperCase();
		if (tag !== liveTag && onDirectory) {
			pushUniqueRename(plannedRenames, {
				allianceId,
				fromTag: tag,
				toTag: liveTag,
			});
		}

		if (!seenAllianceIds.has(allianceId)) {
			seenAllianceIds.add(allianceId);
			toScrape.push(entry);
		}
	}

	const entries = toScrape.slice(0, MULTI_ALLIANCE_SCRAPE_MAX);
	const overflow = toScrape.slice(MULTI_ALLIANCE_SCRAPE_MAX);
	const preserveAllianceIds = overflow.map((e) => e.allianceId);

	await progress.flush();
	return {
		ok: true,
		plan: {
			fetchedAt,
			directoryCount: directory.length,
			trackedTagCount: trackedTags.size,
			skippedTags,
			entries,
			plannedRenames,
			preserveAllianceIds,
			previous,
		},
	};
}

/**
 * Scrape a slice of alliance pages into D1 (used by morning cron + chunked resync).
 * Fetches are always `scrapeAllianceById` — tag is only for progress / rename labels.
 */
export async function scrapeMultiAllianceEntries(
	env: Env,
	config: GuildConfig,
	entries: MultiAllianceScrapeEntry[],
	opts: {
		fetchedAt: string;
		/** Absolute index offset for progress labels (0-based into full plan). */
		progressOffset?: number;
		progressTotal?: number;
		onProgress?: (message: string) => Promise<void>;
	},
): Promise<{
	scrapedAlliances: number;
	failedTags: string[];
	vanished: AllianceVanished[];
	tagRenames: AllianceTagRename[];
	keepAllianceIds: string[];
}> {
	const progress = createProgressReporter(opts.onProgress);
	const report = (message: string) => progress.report(message);
	const progressOffset = opts.progressOffset ?? 0;
	const progressTotal = opts.progressTotal ?? entries.length;

	const priorMeta = await listAllianceRosterMeta(env.STFC_DB, config.guild_id);
	const metaById = new Map(priorMeta.map((m) => [m.alliance_id, m]));

	const failedTags: string[] = [];
	const vanished: AllianceVanished[] = [];
	const keepAllianceIds: string[] = [];
	const tagRenames: AllianceTagRename[] = [];
	let scrapedAlliances = 0;

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i]!;
		const labelTag = (entry.requestedTag || entry.allianceTag).toUpperCase();
		const abs = progressOffset + i + 1;
		report(
			`⏳ Alliance sync: scrape **${abs}/${progressTotal}** \`[${labelTag}]\` id \`${entry.allianceId}\`` +
				` (ok ${scrapedAlliances}, fail ${failedTags.length})…` +
				`\n_Fetching stfc.pro by alliance id (≤25s timeout)…_`,
		);
		if (i > 0) await sleep(MULTI_ALLIANCE_SCRAPE_DELAY_MS);
		const started = Date.now();
		let scrape = await scrapeAllianceById(
			entry.allianceId,
			config.stfc_server,
			config.stfc_region,
		);
		const ms = Date.now() - started;
		if (!scrape || scrape.players.length === 0) {
			// Always keep cache on failure (timeout ≠ disbanded). Off-directory: one retry, then vanish.
			keepAllianceIds.push(entry.allianceId.trim());
			let giveUp = !entry.onDirectory;
			if (!entry.onDirectory) {
				await sleep(2000);
				const retry = await scrapeAllianceById(
					entry.allianceId,
					config.stfc_server,
					config.stfc_region,
				);
				if (retry && retry.players.length > 0) {
					scrape = retry;
					giveUp = false;
				}
			}
			if (!scrape || scrape.players.length === 0) {
				failedTags.push(labelTag);
				if (giveUp) {
					vanished.push({ tag: labelTag, allianceId: entry.allianceId.trim() });
					console.warn(
						`Alliance vanished guild=${config.guild_id} tag=${labelTag} id=${entry.allianceId} (${ms}ms)`,
					);
				} else {
					console.warn(
						`Alliance scrape failed guild=${config.guild_id} tag=${labelTag} id=${entry.allianceId} (${ms}ms)`,
					);
				}
				report(
					`⏳ Alliance sync: scrape **${abs}/${progressTotal}** \`[${labelTag}]\` ❌` +
						` (${ms}ms; ok ${scrapedAlliances}, fail ${failedTags.length}` +
						(giveUp ? ', vanished' : '') +
						`)…`,
				);
				continue;
			}
		}
		const tag = (scrape.allianceTag || entry.allianceTag).trim().toUpperCase();
		const allianceId = (scrape.allianceId || entry.allianceId).trim();
		const prior = metaById.get(allianceId);
		const priorTag = prior?.alliance_tag?.trim().toUpperCase();
		if (priorTag && tag && priorTag !== tag) {
			pushUniqueRename(tagRenames, { allianceId, fromTag: priorTag, toTag: tag });
			await rememberAllianceTagAlias(env.STFC_DB, config.guild_id, allianceId, priorTag);
		}
		const requested = entry.requestedTag?.trim().toUpperCase();
		if (requested && tag && requested !== tag) {
			pushUniqueRename(tagRenames, { allianceId, fromTag: requested, toTag: tag });
			await rememberAllianceTagAlias(env.STFC_DB, config.guild_id, allianceId, requested);
		}
		await rememberAllianceTagAlias(env.STFC_DB, config.guild_id, allianceId, tag);
		const previousForAlliance = await listAllianceRosterMembers(env.STFC_DB, config.guild_id);
		const previousById = new Map(previousForAlliance.map((m) => [m.player_id, m]));
		const members = membersFromScrape(scrape, allianceId, tag, previousById);
		await replaceAllianceRoster(env.STFC_DB, {
			guildId: config.guild_id,
			allianceId,
			allianceTag: tag,
			allianceName: scrape.allianceName || entry.allianceName || null,
			fetchedAt: opts.fetchedAt,
			scope: 'alliance',
			members,
		});
		keepAllianceIds.push(allianceId);
		scrapedAlliances++;
		report(
			`⏳ Alliance sync: scrape **${abs}/${progressTotal}** \`[${tag}]\` ✅` +
				` ${scrape.players.length} players (${ms}ms; ok ${scrapedAlliances}, fail ${failedTags.length})…`,
		);
	}

	await progress.flush();
	return { scrapedAlliances, failedTags, vanished, tagRenames, keepAllianceIds };
}

/**
 * Multi-alliance morning job:
 * 1) Fetch /servers/{n} directory
 * 2) Track tags = verified player tags ∪ diplomacy map tags
 * 3) Scrape those alliance pages (batched)
 * 4) Diff vs previous combined roster
 *
 * Cron has ~15 min wall time — runs the full scrape in one invocation.
 * Slash `/alliance resync` must chunk (see ALLIANCE_RESYNC_INTERACTION_CHUNK).
 */
export async function syncMultiAllianceTrackedRosters(
	env: Env,
	config: GuildConfig,
	opts?: MultiAllianceRosterSyncOptions,
): Promise<MultiAllianceRosterSyncResult> {
	const planned = await planMultiAllianceScrape(env, config, opts);
	if (!planned.ok) {
		return { ok: false, reason: planned.reason };
	}
	const { plan } = planned;

	const progress = createProgressReporter(opts?.onProgress);
	progress.report(
		`⏳ Alliance sync: directory **${plan.directoryCount}** · scraping **${plan.entries.length}** alliance page(s)` +
			(plan.skippedTags.length ? ` (${plan.skippedTags.length} skipped)` : '') +
			`…`,
	);
	await progress.flush();

	const batch = await scrapeMultiAllianceEntries(env, config, plan.entries, {
		fetchedAt: plan.fetchedAt,
		progressOffset: 0,
		progressTotal: plan.entries.length,
		onProgress: opts?.onProgress,
	});

	const tagRenames: AllianceTagRename[] = [];
	for (const r of plan.plannedRenames) pushUniqueRename(tagRenames, r);
	for (const r of batch.tagRenames) pushUniqueRename(tagRenames, r);

	if (batch.scrapedAlliances === 0 && batch.vanished.length === 0) {
		return { ok: false, reason: 'all_alliance_scrapes_failed' };
	}

	const keepAllianceIds = [
		...new Set([...batch.keepAllianceIds, ...plan.preserveAllianceIds]),
	];
	await pruneAllianceRostersOutside(env.STFC_DB, config.guild_id, keepAllianceIds);

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
	const diff = diffAllianceRosters(plan.previous, current);

	console.log(
		`Multi alliance roster sync guild ${config.guild_id}: dir=${plan.directoryCount} tracked=${plan.trackedTagCount} scraped=${batch.scrapedAlliances} failed=${batch.failedTags.length} skipped=${plan.skippedTags.length} vanished=${batch.vanished.length}`,
	);

	return {
		ok: true,
		diff,
		directoryCount: plan.directoryCount,
		trackedTags: plan.trackedTagCount,
		scrapedAlliances: batch.scrapedAlliances,
		skippedTags: plan.skippedTags,
		failedTags: batch.failedTags,
		tagRenames,
		vanished: batch.vanished,
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
