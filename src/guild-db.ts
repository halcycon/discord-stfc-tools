import type { GuildConfig, GuildMemberRecord, StfcRegion, VerificationStatus, VerifiedPlayer } from './types';

function parseJsonArray(value: string | null | undefined): string[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

function parseJsonObject(value: string | null | undefined): Record<string, string> {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapGuildConfig(row: any): GuildConfig {
	return {
		guild_id: row.guild_id,
		mode: row.mode,
		stfc_server: row.stfc_server,
		stfc_region: row.stfc_region as StfcRegion,
		alliance_tag: row.alliance_tag ?? null,
		guest_role_id: row.guest_role_id ?? null,
		member_role_ids: parseJsonArray(row.member_role_ids),
		alliance_role_prefix: row.alliance_role_prefix ?? null,
		channel_category_map: parseJsonObject(row.channel_category_map),
		personal_channel_extra_roles: parseJsonArray(row.personal_channel_extra_roles),
		poll_interval_hours: row.poll_interval_hours ?? 6,
		verification_enabled: Boolean(row.verification_enabled ?? 1),
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapVerifiedPlayer(row: any): VerifiedPlayer {
	return {
		id: row.id,
		guild_id: row.guild_id,
		discord_user_id: row.discord_user_id,
		player_id: row.player_id ?? null,
		player_name: row.player_name ?? null,
		alliance_tag: row.alliance_tag ?? null,
		ops_level: row.ops_level ?? null,
		power: row.power ?? null,
		grade: row.grade ?? null,
		stfc_pro_url: row.stfc_pro_url ?? null,
		verification_status: row.verification_status as VerificationStatus,
		personal_channel_id: row.personal_channel_id ?? null,
		verified_at: row.verified_at ?? null,
		last_synced_at: row.last_synced_at ?? null,
	};
}

export async function getGuildConfig(db: D1Database, guildId: string): Promise<GuildConfig | null> {
	const row = await db
		.prepare('SELECT * FROM guild_configs WHERE guild_id = ?')
		.bind(guildId)
		.first();
	return row ? mapGuildConfig(row) : null;
}

export async function listConfiguredGuilds(db: D1Database): Promise<GuildConfig[]> {
	const { results } = await db.prepare('SELECT * FROM guild_configs').all();
	return (results ?? []).map(mapGuildConfig);
}

export async function upsertGuildConfig(
	db: D1Database,
	config: Partial<GuildConfig> & { guild_id: string },
): Promise<void> {
	const existing = await getGuildConfig(db, config.guild_id);
	const now = new Date().toISOString();

	if (!existing) {
		await db
			.prepare(
				`INSERT INTO guild_configs
				(guild_id, mode, stfc_server, stfc_region, alliance_tag, guest_role_id,
				 member_role_ids, verification_enabled, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				config.guild_id,
				config.mode ?? 'single_alliance',
				config.stfc_server ?? 0,
				config.stfc_region ?? 'US',
				config.alliance_tag ?? null,
				config.guest_role_id ?? null,
				JSON.stringify(config.member_role_ids ?? []),
				config.verification_enabled !== false ? 1 : 0,
				now,
			)
			.run();
		return;
	}

	await db
		.prepare(
			`UPDATE guild_configs SET
			 mode = COALESCE(?, mode),
			 stfc_server = COALESCE(?, stfc_server),
			 stfc_region = COALESCE(?, stfc_region),
			 alliance_tag = COALESCE(?, alliance_tag),
			 guest_role_id = COALESCE(?, guest_role_id),
			 member_role_ids = COALESCE(?, member_role_ids),
			 verification_enabled = COALESCE(?, verification_enabled),
			 updated_at = ?
			 WHERE guild_id = ?`,
		)
		.bind(
			config.mode ?? null,
			config.stfc_server ?? null,
			config.stfc_region ?? null,
			config.alliance_tag ?? null,
			config.guest_role_id ?? null,
			config.member_role_ids ? JSON.stringify(config.member_role_ids) : null,
			config.verification_enabled !== undefined ? (config.verification_enabled ? 1 : 0) : null,
			now,
			config.guild_id,
		)
		.run();
}

export async function getKnownMemberIds(db: D1Database, guildId: string): Promise<Set<string>> {
	const { results } = await db
		.prepare('SELECT discord_user_id FROM guild_members WHERE guild_id = ?')
		.bind(guildId)
		.all();
	return new Set((results ?? []).map((r) => String((r as { discord_user_id: string }).discord_user_id)));
}

export async function recordGuildMember(
	db: D1Database,
	guildId: string,
	userId: string,
	username: string | null,
	invitedAt?: string,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO guild_members (guild_id, discord_user_id, username, verification_invited_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
			   username = excluded.username,
			   verification_invited_at = COALESCE(guild_members.verification_invited_at, excluded.verification_invited_at)`,
		)
		.bind(guildId, userId, username, invitedAt ?? null)
		.run();
}

export async function markMemberInvited(db: D1Database, guildId: string, userId: string): Promise<void> {
	await db
		.prepare(
			`UPDATE guild_members SET verification_invited_at = datetime('now')
			 WHERE guild_id = ? AND discord_user_id = ?`,
		)
		.bind(guildId, userId)
		.run();
}

export async function getVerifiedPlayer(
	db: D1Database,
	guildId: string,
	discordUserId: string,
): Promise<VerifiedPlayer | null> {
	const row = await db
		.prepare('SELECT * FROM verified_players WHERE guild_id = ? AND discord_user_id = ?')
		.bind(guildId, discordUserId)
		.first();
	return row ? mapVerifiedPlayer(row) : null;
}

export async function upsertVerifiedPlayer(
	db: D1Database,
	data: {
		guild_id: string;
		discord_user_id: string;
		player_id?: number | null;
		player_name?: string | null;
		alliance_tag?: string | null;
		ops_level?: number | null;
		power?: number | null;
		grade?: number | null;
		stfc_pro_url?: string | null;
		verification_status?: VerificationStatus;
		verified_at?: string | null;
		last_synced_at?: string | null;
	},
): Promise<void> {
	const now = new Date().toISOString();
	const existing = await getVerifiedPlayer(db, data.guild_id, data.discord_user_id);

	if (!existing) {
		await db
			.prepare(
				`INSERT INTO verified_players
				(guild_id, discord_user_id, player_id, player_name, alliance_tag,
				 ops_level, power, grade, stfc_pro_url, verification_status, verified_at, last_synced_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				data.guild_id,
				data.discord_user_id,
				data.player_id ?? null,
				data.player_name ?? null,
				data.alliance_tag ?? null,
				data.ops_level ?? null,
				data.power ?? null,
				data.grade ?? null,
				data.stfc_pro_url ?? null,
				data.verification_status ?? 'pending_invite',
				data.verified_at ?? null,
				data.last_synced_at ?? null,
				now,
			)
			.run();
		return;
	}

	await db
		.prepare(
			`UPDATE verified_players SET
			 player_id = COALESCE(?, player_id),
			 player_name = COALESCE(?, player_name),
			 alliance_tag = COALESCE(?, alliance_tag),
			 ops_level = COALESCE(?, ops_level),
			 power = COALESCE(?, power),
			 grade = COALESCE(?, grade),
			 stfc_pro_url = COALESCE(?, stfc_pro_url),
			 verification_status = COALESCE(?, verification_status),
			 verified_at = COALESCE(?, verified_at),
			 last_synced_at = COALESCE(?, last_synced_at),
			 updated_at = ?
			 WHERE guild_id = ? AND discord_user_id = ?`,
		)
		.bind(
			data.player_id ?? null,
			data.player_name ?? null,
			data.alliance_tag ?? null,
			data.ops_level ?? null,
			data.power ?? null,
			data.grade ?? null,
			data.stfc_pro_url ?? null,
			data.verification_status ?? null,
			data.verified_at ?? null,
			data.last_synced_at ?? null,
			now,
			data.guild_id,
			data.discord_user_id,
		)
		.run();
}

export async function recordScreenshot(
	db: D1Database,
	guildId: string,
	discordUserId: string,
	attachmentUrl: string,
	r2Key?: string,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO verification_screenshots
			 (guild_id, discord_user_id, discord_attachment_url, r2_key)
			 VALUES (?, ?, ?, ?)`,
		)
		.bind(guildId, discordUserId, attachmentUrl, r2Key ?? null)
		.run();
}

export async function listActiveVerifiedPlayers(db: D1Database, guildId: string): Promise<VerifiedPlayer[]> {
	const { results } = await db
		.prepare(
			`SELECT * FROM verified_players
			 WHERE guild_id = ? AND verification_status IN ('verified', 'active', 'guest')`,
		)
		.bind(guildId)
		.all();
	return (results ?? []).map(mapVerifiedPlayer);
}

export async function recordPlayerStats(
	db: D1Database,
	verifiedPlayerId: number,
	opsLevel: number,
	power: number,
	allianceTag: string,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO player_stats_history (verified_player_id, ops_level, power, alliance_tag)
			 VALUES (?, ?, ?, ?)`,
		)
		.bind(verifiedPlayerId, opsLevel, power, allianceTag)
		.run();
}

export async function getPendingVerificationsForUser(
	db: D1Database,
	discordUserId: string,
): Promise<VerifiedPlayer[]> {
	const { results } = await db
		.prepare(
			`SELECT * FROM verified_players
			 WHERE discord_user_id = ?
			 AND verification_status IN ('pending_invite', 'pending_screenshot', 'pending_link')
			 ORDER BY updated_at DESC`,
		)
		.bind(discordUserId)
		.all();
	return (results ?? []).map(mapVerifiedPlayer);
}

export async function getMembersNeedingInvite(db: D1Database, guildId: string): Promise<GuildMemberRecord[]> {
	const { results } = await db
		.prepare(
			`SELECT * FROM guild_members
			 WHERE guild_id = ? AND verification_invited_at IS NULL`,
		)
		.bind(guildId)
		.all();
	return (results ?? []) as GuildMemberRecord[];
}
