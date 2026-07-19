/**
 * Refresh Discord roles/nicks for verified players after an alliance tag rename
 * (or when an admin forces a track/resync with apply_discord).
 */
import { listActiveVerifiedPlayers, listAllianceRosterMembers } from './guild-db';
import { createProgressReporter } from './progress-reporter';
import {
	loadRosterPlayerMap,
	rosterMemberToPlayerData,
} from './alliance-roster-sync';
import { syncVerifiedPlayer } from './verification';
import { isDeployTesting } from './deploy-mode';
import type { GuildConfig } from './types';

/** Cap per interaction — Discord API + waitUntil ~30s. Re-run to continue. */
export const PLAYER_TAG_RESYNC_CHUNK = 12;

export type PlayerTagResyncResult = {
	attempted: number;
	synced: number;
	failed: number;
	remaining: number;
	skippedTesting: boolean;
	errors: string[];
};

/**
 * Sync verified Discord members for an alliance tag using the current roster cache.
 * Updates nicknames/roles via syncVerifiedPlayer (same as morning sync).
 */
export async function syncVerifiedPlayersForAllianceTag(
	env: Env,
	config: GuildConfig,
	allianceTag: string,
	opts?: {
		allianceId?: string | null;
		forceDiscord?: boolean;
		onProgress?: (message: string) => Promise<void>;
		/** Max players this call (default PLAYER_TAG_RESYNC_CHUNK). */
		limit?: number;
	},
): Promise<PlayerTagResyncResult> {
	const tag = allianceTag.trim().toUpperCase();
	const errors: string[] = [];
	if (!tag) {
		return {
			attempted: 0,
			synced: 0,
			failed: 0,
			remaining: 0,
			skippedTesting: false,
			errors: ['Missing alliance tag'],
		};
	}

	if (isDeployTesting(config) && !opts?.forceDiscord) {
		return {
			attempted: 0,
			synced: 0,
			failed: 0,
			remaining: 0,
			skippedTesting: true,
			errors: [],
		};
	}

	if (!env.DISCORD_BOT_TOKEN) {
		return {
			attempted: 0,
			synced: 0,
			failed: 0,
			remaining: 0,
			skippedTesting: false,
			errors: ['DISCORD_BOT_TOKEN missing'],
		};
	}

	const progress = createProgressReporter(opts?.onProgress);
	const report = (message: string) => progress.report(message);
	const limit = Math.max(1, opts?.limit ?? PLAYER_TAG_RESYNC_CHUNK);

	const verified = await listActiveVerifiedPlayers(env.STFC_DB, config.guild_id);
	const byPlayerId = new Map(
		verified.filter((p) => p.player_id != null).map((p) => [p.player_id!, p]),
	);

	let candidates = verified.filter(
		(p) => (p.alliance_tag ?? '').trim().toUpperCase() === tag && p.player_id != null,
	);

	// Prefer roster membership for this alliance id when available (covers remap timing).
	const allianceId = opts?.allianceId?.trim();
	if (allianceId) {
		const members = await listAllianceRosterMembers(env.STFC_DB, config.guild_id);
		const onRoster = new Set(
			members.filter((m) => (m.alliance_id ?? '').trim() === allianceId).map((m) => m.player_id),
		);
		const fromRoster = [...onRoster]
			.map((id) => byPlayerId.get(id))
			.filter((p): p is NonNullable<typeof p> => Boolean(p));
		if (fromRoster.length) candidates = fromRoster;
	}

	candidates.sort((a, b) =>
		(a.player_name ?? '').localeCompare(b.player_name ?? '', undefined, { sensitivity: 'base' }),
	);

	const remaining = Math.max(0, candidates.length - limit);
	const batch = candidates.slice(0, limit);
	let rosterMap = await loadRosterPlayerMap(env, config);
	if (!rosterMap || rosterMap.size === 0) {
		// Fall back to raw members for this guild (may be stale freshness).
		const members = await listAllianceRosterMembers(env.STFC_DB, config.guild_id);
		rosterMap = new Map();
		for (const m of members) {
			rosterMap.set(m.player_id, rosterMemberToPlayerData(m, config));
		}
	}

	let synced = 0;
	let failed = 0;
	for (let i = 0; i < batch.length; i++) {
		const record = batch[i]!;
		const playerId = record.player_id!;
		report(
			`⏳ Player nick/role sync \`[${tag}]\` **${i + 1}/${batch.length}**` +
				(candidates.length > batch.length ? ` (of ${candidates.length})` : '') +
				` — **${record.player_name ?? playerId}**…`,
		);
		const fromRoster = rosterMap.get(playerId);
		const player = fromRoster
			? { ...fromRoster, allianceTag: tag }
			: {
					playerId,
					name: record.player_name ?? '',
					rank: record.alliance_rank ?? '',
					level: record.ops_level ?? 0,
					helps: '',
					rss: String(record.power ?? 0),
					power: record.power ?? 0,
					iso: '',
					joinDate: '',
					allianceId: allianceId || '',
					allianceTag: tag,
					server: config.stfc_server,
					region: config.stfc_region,
				};
		try {
			await syncVerifiedPlayer(env, config, config.guild_id, record.discord_user_id, player, {
				autoDemoteOnMismatch: false,
				deferSyncAudit: true,
			});
			synced++;
		} catch (err) {
			failed++;
			const msg = err instanceof Error ? err.message : String(err);
			errors.push(`${record.player_name ?? playerId}: ${msg}`);
			console.warn(
				`Player tag resync failed guild=${config.guild_id} user=${record.discord_user_id}:`,
				err,
			);
		}
	}

	await progress.flush();
	return {
		attempted: batch.length,
		synced,
		failed,
		remaining,
		skippedTesting: false,
		errors: errors.slice(0, 5),
	};
}
