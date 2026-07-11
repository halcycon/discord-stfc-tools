import type {
	GuildConfig,
	GuildMemberRecord,
	OverlayBucket,
	StfcRegion,
	VerificationStatus,
	VerifiedPlayer,
} from './types';

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

function parseOverlayBuckets(value: string | null | undefined): Record<string, OverlayBucket> {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

		const result: Record<string, OverlayBucket> = {};
		for (const [bucketName, bucketValue] of Object.entries(parsed as Record<string, any>)) {
			if (!bucketValue || typeof bucketValue !== 'object') continue;
			const ranks = Array.isArray((bucketValue as any).ranks) ? (bucketValue as any).ranks.map(String).filter(Boolean) : [];
			const role_ids = Array.isArray((bucketValue as any).role_ids) ? (bucketValue as any).role_ids.map(String).filter(Boolean) : [];
			const role_names = Array.isArray((bucketValue as any).role_names)
				? (bucketValue as any).role_names.map(String)
				: undefined;
			result[bucketName] = { ranks, role_ids, ...(role_names ? { role_names } : {}) };
		}
		return result;
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
		operative_role_ids: parseJsonArray(row.operative_role_ids),
		agent_role_ids: parseJsonArray(row.agent_role_ids),
		premier_role_ids: parseJsonArray(row.premier_role_ids),
		commodore_role_ids: parseJsonArray(row.commodore_role_ids),
		admiral_role_ids: parseJsonArray(row.admiral_role_ids),
		overlay_buckets: parseOverlayBuckets(row.overlay_buckets),
		alliance_role_prefix: row.alliance_role_prefix ?? null,
		nickname_template: row.nickname_template ?? null,
		verification_log_channel_id: row.verification_log_channel_id ?? null,
		channel_category_map: parseJsonObject(row.channel_category_map),
		personal_channel_extra_roles: parseJsonArray(row.personal_channel_extra_roles),
		diplomacy_enabled: Boolean(row.diplomacy_enabled ?? 0),
		diplomacy_category_id: row.diplomacy_category_id ?? null,
		diplomacy_channel_map: parseJsonObject(row.diplomacy_channel_map),
		diplomacy_everyone_can_view: row.diplomacy_everyone_can_view === undefined || row.diplomacy_everyone_can_view === null
			? true
			: Boolean(row.diplomacy_everyone_can_view),
		diplomacy_view_role_ids: parseJsonArray(row.diplomacy_view_role_ids),
		diplomacy_write_role_ids: parseJsonArray(row.diplomacy_write_role_ids),
		diplomacy_write_ranks: (() => {
			const ranks = parseJsonArray(row.diplomacy_write_ranks);
			return ranks.length > 0 ? ranks : ['Commodore', 'Admiral'];
		})(),
		diplomacy_name_template: row.diplomacy_name_template ?? null,
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

	const nicknameTemplateProvided = Object.prototype.hasOwnProperty.call(config, 'nickname_template');
	const nicknameTemplateValue = nicknameTemplateProvided
		? (config.nickname_template?.trim() || null)
		: null;
	const logChannelProvided = Object.prototype.hasOwnProperty.call(config, 'verification_log_channel_id');
	const logChannelValue = logChannelProvided
		? (config.verification_log_channel_id?.trim() || null)
		: null;

	if (!existing) {
		await db
			.prepare(
				`INSERT INTO guild_configs
				(guild_id, mode, stfc_server, stfc_region, alliance_tag, guest_role_id,
				 member_role_ids, operative_role_ids, agent_role_ids, premier_role_ids, commodore_role_ids, admiral_role_ids,
				 overlay_buckets, nickname_template, verification_log_channel_id,
				 channel_category_map, personal_channel_extra_roles, verification_enabled, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				config.guild_id,
				config.mode ?? 'single_alliance',
				config.stfc_server ?? 0,
				config.stfc_region ?? 'US',
				config.alliance_tag ?? null,
				config.guest_role_id ?? null,
				JSON.stringify(config.member_role_ids ?? []),
				JSON.stringify(config.operative_role_ids ?? []),
				JSON.stringify(config.agent_role_ids ?? []),
				JSON.stringify(config.premier_role_ids ?? []),
				JSON.stringify(config.commodore_role_ids ?? []),
				JSON.stringify(config.admiral_role_ids ?? []),
				JSON.stringify(config.overlay_buckets ?? {}),
				nicknameTemplateProvided ? nicknameTemplateValue : null,
				logChannelProvided ? logChannelValue : null,
				JSON.stringify(config.channel_category_map ?? {}),
				JSON.stringify(config.personal_channel_extra_roles ?? []),
				config.verification_enabled !== false ? 1 : 0,
				now,
			)
			.run();
		await upsertDiplomacyConfigFields(db, config);
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
			 operative_role_ids = COALESCE(?, operative_role_ids),
			 agent_role_ids = COALESCE(?, agent_role_ids),
			 premier_role_ids = COALESCE(?, premier_role_ids),
			 commodore_role_ids = COALESCE(?, commodore_role_ids),
			 admiral_role_ids = COALESCE(?, admiral_role_ids),
			 overlay_buckets = COALESCE(?, overlay_buckets),
			 nickname_template = CASE WHEN ? = 1 THEN ? ELSE nickname_template END,
			 verification_log_channel_id = CASE WHEN ? = 1 THEN ? ELSE verification_log_channel_id END,
			 channel_category_map = COALESCE(?, channel_category_map),
			 personal_channel_extra_roles = COALESCE(?, personal_channel_extra_roles),
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
			config.operative_role_ids ? JSON.stringify(config.operative_role_ids) : null,
			config.agent_role_ids ? JSON.stringify(config.agent_role_ids) : null,
			config.premier_role_ids ? JSON.stringify(config.premier_role_ids) : null,
			config.commodore_role_ids ? JSON.stringify(config.commodore_role_ids) : null,
			config.admiral_role_ids ? JSON.stringify(config.admiral_role_ids) : null,
			config.overlay_buckets ? JSON.stringify(config.overlay_buckets) : null,
			nicknameTemplateProvided ? 1 : 0,
			nicknameTemplateValue,
			logChannelProvided ? 1 : 0,
			logChannelValue,
			config.channel_category_map ? JSON.stringify(config.channel_category_map) : null,
			config.personal_channel_extra_roles ? JSON.stringify(config.personal_channel_extra_roles) : null,
			config.verification_enabled !== undefined ? (config.verification_enabled ? 1 : 0) : null,
			now,
			config.guild_id,
		)
		.run();

	await upsertDiplomacyConfigFields(db, config);
}

async function upsertDiplomacyConfigFields(
	db: D1Database,
	config: Partial<GuildConfig> & { guild_id: string },
): Promise<void> {
	const has =
		Object.prototype.hasOwnProperty.call(config, 'diplomacy_enabled') ||
		Object.prototype.hasOwnProperty.call(config, 'diplomacy_category_id') ||
		Object.prototype.hasOwnProperty.call(config, 'diplomacy_channel_map') ||
		Object.prototype.hasOwnProperty.call(config, 'diplomacy_everyone_can_view') ||
		Object.prototype.hasOwnProperty.call(config, 'diplomacy_view_role_ids') ||
		Object.prototype.hasOwnProperty.call(config, 'diplomacy_write_role_ids') ||
		Object.prototype.hasOwnProperty.call(config, 'diplomacy_write_ranks') ||
		Object.prototype.hasOwnProperty.call(config, 'diplomacy_name_template');
	if (!has) return;

	const categoryProvided = Object.prototype.hasOwnProperty.call(config, 'diplomacy_category_id');
	const nameProvided = Object.prototype.hasOwnProperty.call(config, 'diplomacy_name_template');

	await db
		.prepare(
			`UPDATE guild_configs SET
			 diplomacy_enabled = COALESCE(?, diplomacy_enabled),
			 diplomacy_category_id = CASE WHEN ? = 1 THEN ? ELSE diplomacy_category_id END,
			 diplomacy_channel_map = COALESCE(?, diplomacy_channel_map),
			 diplomacy_everyone_can_view = COALESCE(?, diplomacy_everyone_can_view),
			 diplomacy_view_role_ids = COALESCE(?, diplomacy_view_role_ids),
			 diplomacy_write_role_ids = COALESCE(?, diplomacy_write_role_ids),
			 diplomacy_write_ranks = COALESCE(?, diplomacy_write_ranks),
			 diplomacy_name_template = CASE WHEN ? = 1 THEN ? ELSE diplomacy_name_template END,
			 updated_at = datetime('now')
			 WHERE guild_id = ?`,
		)
		.bind(
			config.diplomacy_enabled !== undefined ? (config.diplomacy_enabled ? 1 : 0) : null,
			categoryProvided ? 1 : 0,
			categoryProvided ? (config.diplomacy_category_id?.trim() || null) : null,
			config.diplomacy_channel_map ? JSON.stringify(config.diplomacy_channel_map) : null,
			config.diplomacy_everyone_can_view !== undefined
				? (config.diplomacy_everyone_can_view ? 1 : 0)
				: null,
			config.diplomacy_view_role_ids ? JSON.stringify(config.diplomacy_view_role_ids) : null,
			config.diplomacy_write_role_ids ? JSON.stringify(config.diplomacy_write_role_ids) : null,
			config.diplomacy_write_ranks ? JSON.stringify(config.diplomacy_write_ranks) : null,
			nameProvided ? 1 : 0,
			nameProvided ? (config.diplomacy_name_template?.trim() || null) : null,
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
		personal_channel_id?: string | null;
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
				 ops_level, power, grade, stfc_pro_url, verification_status, personal_channel_id, verified_at, last_synced_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
				data.personal_channel_id ?? null,
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
			 personal_channel_id = COALESCE(?, personal_channel_id),
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
			data.personal_channel_id ?? null,
			data.verified_at ?? null,
			data.last_synced_at ?? null,
			now,
			data.guild_id,
			data.discord_user_id,
		)
		.run();
}

export async function resetVerification(
	db: D1Database,
	guildId: string,
	discordUserId: string,
): Promise<void> {
	await db
		.prepare(`DELETE FROM verified_players WHERE guild_id = ? AND discord_user_id = ?`)
		.bind(guildId, discordUserId)
		.run();

	await upsertVerifiedPlayer(db, {
		guild_id: guildId,
		discord_user_id: discordUserId,
		verification_status: 'pending_screenshot',
	});

	await db
		.prepare(
			`UPDATE guild_members SET verification_invited_at = NULL
			 WHERE guild_id = ? AND discord_user_id = ?`,
		)
		.bind(guildId, discordUserId)
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

/**
 * Resolve a verified player for channel linking by Discord user ID, STFC player ID,
 * or in-game player name (exact, case-insensitive).
 */
export async function findVerifiedPlayersForLink(
	db: D1Database,
	guildId: string,
	query: string,
): Promise<VerifiedPlayer[]> {
	const q = query.trim();
	if (!q) return [];

	if (/^\d{15,20}$/.test(q)) {
		const byDiscord = await getVerifiedPlayer(db, guildId, q);
		return byDiscord ? [byDiscord] : [];
	}

	if (/^\d+$/.test(q)) {
		const { results } = await db
			.prepare(
				`SELECT * FROM verified_players
				 WHERE guild_id = ? AND player_id = ?`,
			)
			.bind(guildId, Number(q))
			.all();
		return (results ?? []).map(mapVerifiedPlayer);
	}

	const { results } = await db
		.prepare(
			`SELECT * FROM verified_players
			 WHERE guild_id = ? AND LOWER(player_name) = LOWER(?)`,
		)
		.bind(guildId, q)
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
