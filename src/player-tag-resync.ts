/**
 * Refresh Discord nicks (and optionally roles) for verified players after an alliance
 * tag rename — or when an admin forces track/resync with apply_discord.
 *
 * Re-runs skip members whose Discord nick already matches the desired template so
 * each click advances through the roster (does not re-process the same first N).
 */
import { getGuildMember, setGuildMemberNickname } from './discord-api';
import { listActiveVerifiedPlayers, listAllianceRosterMembers } from './guild-db';
import { createProgressReporter } from './progress-reporter';
import {
	loadRosterPlayerMap,
	rosterMemberToPlayerData,
} from './alliance-roster-sync';
import { nicknameForPlayer } from './verification-access';
import { isDeployTesting } from './deploy-mode';
import type { GuildConfig, PlayerData, VerifiedPlayer } from './types';

/** Cap per interaction — Discord API + waitUntil ~30s. Re-run to continue. */
export const PLAYER_TAG_RESYNC_CHUNK = 12;

export type PlayerTagResyncResult = {
	attempted: number;
	synced: number;
	skippedAlreadyOk: number;
	failed: number;
	remaining: number;
	skippedTesting: boolean;
	errors: string[];
};

function buildPlayerData(
	record: VerifiedPlayer,
	tag: string,
	allianceId: string,
	config: GuildConfig,
	rosterMap: Map<number, PlayerData>,
): PlayerData {
	const playerId = record.player_id!;
	const fromRoster = rosterMap.get(playerId);
	if (fromRoster) return { ...fromRoster, allianceTag: tag };
	return {
		playerId,
		name: record.player_name ?? '',
		rank: record.alliance_rank ?? '',
		level: record.ops_level ?? 0,
		helps: '',
		rss: String(record.power ?? 0),
		power: record.power ?? 0,
		iso: '',
		joinDate: '',
		allianceId,
		allianceTag: tag,
		server: config.stfc_server,
		region: config.stfc_region,
	};
}

/**
 * Sync verified Discord members for an alliance tag using the current roster cache.
 * Prefer nick-only updates (fast); skip nicks that already match.
 */
export async function syncVerifiedPlayersForAllianceTag(
	env: Env,
	config: GuildConfig,
	allianceTag: string,
	opts?: {
		allianceId?: string | null;
		forceDiscord?: boolean;
		onProgress?: (message: string) => Promise<void>;
		/** Max nick *updates* this call (default PLAYER_TAG_RESYNC_CHUNK). Skips don't count. */
		limit?: number;
	},
): Promise<PlayerTagResyncResult> {
	const tag = allianceTag.trim().toUpperCase();
	const errors: string[] = [];
	const empty = (
		partial: Partial<PlayerTagResyncResult> & { skippedTesting: boolean },
	): PlayerTagResyncResult => ({
		attempted: 0,
		synced: 0,
		skippedAlreadyOk: 0,
		failed: 0,
		remaining: 0,
		errors: [],
		...partial,
	});

	if (!tag) return empty({ skippedTesting: false, errors: ['Missing alliance tag'] });
	if (isDeployTesting(config) && !opts?.forceDiscord) {
		return empty({ skippedTesting: true });
	}
	const token = env.DISCORD_BOT_TOKEN;
	if (!token) {
		return empty({ skippedTesting: false, errors: ['DISCORD_BOT_TOKEN missing'] });
	}

	const progress = createProgressReporter(opts?.onProgress, { minIntervalMs: 1_500 });
	const report = (message: string) => progress.report(message);
	const limit = Math.max(1, opts?.limit ?? PLAYER_TAG_RESYNC_CHUNK);

	const verified = await listActiveVerifiedPlayers(env.STFC_DB, config.guild_id);
	const byPlayerId = new Map(
		verified.filter((p) => p.player_id != null).map((p) => [p.player_id!, p]),
	);

	let candidates = verified.filter(
		(p) => (p.alliance_tag ?? '').trim().toUpperCase() === tag && p.player_id != null,
	);

	const allianceId = opts?.allianceId?.trim() || '';
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

	let rosterMap = await loadRosterPlayerMap(env, config);
	if (!rosterMap || rosterMap.size === 0) {
		const members = await listAllianceRosterMembers(env.STFC_DB, config.guild_id);
		rosterMap = new Map();
		for (const m of members) {
			rosterMap.set(m.player_id, rosterMemberToPlayerData(m, config));
		}
	}

	let synced = 0;
	let skippedAlreadyOk = 0;
	let failed = 0;
	let scanned = 0;
	let stillNeed = 0;

	for (const record of candidates) {
		const playerId = record.player_id!;
		const player = buildPlayerData(record, tag, allianceId, config, rosterMap);
		const desired = nicknameForPlayer(config, player);

		scanned++;
		report(
			`⏳ Player nick sync \`[${tag}]\` scanned **${scanned}/${candidates.length}**` +
				` · updated **${synced}/${limit}**` +
				` — **${record.player_name ?? playerId}**…`,
		);

		try {
			const member = await getGuildMember(token, config.guild_id, record.discord_user_id);
			const currentNick = (member?.nick ?? '').trim();
			if (member && currentNick === desired) {
				skippedAlreadyOk++;
				continue;
			}

			if (synced >= limit) {
				stillNeed++;
				continue;
			}

			await setGuildMemberNickname(token, config.guild_id, record.discord_user_id, desired);
			synced++;
		} catch (err) {
			failed++;
			stillNeed++;
			const msg = err instanceof Error ? err.message : String(err);
			errors.push(`${record.player_name ?? playerId}: ${msg}`);
			console.warn(
				`Player nick resync failed guild=${config.guild_id} user=${record.discord_user_id}:`,
				err,
			);
		}
	}

	// Anyone after the limit who wasn't already-ok, plus failures counted above.
	const remaining = stillNeed;

	await progress.flush();
	return {
		attempted: scanned,
		synced,
		skippedAlreadyOk,
		failed,
		remaining,
		skippedTesting: false,
		errors: errors.slice(0, 5),
	};
}
