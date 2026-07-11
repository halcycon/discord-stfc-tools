import type {
	AgreementMode,
	AgreementTiming,
	GuildConfig,
	GuildExcludedUser,
	GuildMemberRecord,
	OverlayBucket,
	PersonalChannelPermTemplate,
	StfcRegion,
	VerificationStatus,
	VerifiedPlayer,
} from './types';
import { parsePersonalChannelPermTemplate } from './personal-channel-perm-template';

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
		audit_log_channel_id: row.audit_log_channel_id ?? null,
		urgent_notify_channel_id: row.urgent_notify_channel_id ?? null,
		channel_category_map: parseJsonObject(row.channel_category_map),
		personal_channel_extra_roles: parseJsonArray(row.personal_channel_extra_roles),
		personal_channel_perm_template: parsePersonalChannelPermTemplate(
			row.personal_channel_perm_template,
		),
		personal_channel_archive_category_id: row.personal_channel_archive_category_id ?? null,
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
		survey_creator_role_ids: parseJsonArray(row.survey_creator_role_ids),
		survey_results_role_ids: parseJsonArray(row.survey_results_role_ids),
		survey_log_name_template: row.survey_log_name_template ?? null,
		survey_log_category_id: row.survey_log_category_id ?? null,
		exchange_layout:
			row.exchange_layout === 'hub' || row.exchange_layout === 'category'
				? row.exchange_layout
				: null,
		exchange_hub_channel_id: row.exchange_hub_channel_id ?? null,
		exchange_category_id: row.exchange_category_id ?? null,
		exchange_admin_role_ids: parseJsonArray(row.exchange_admin_role_ids),
		dm_query_role_ids: parseJsonArray(row.dm_query_role_ids),
		dm_ai_enabled: Boolean(row.dm_ai_enabled ?? 0),
		agreement_enabled: Boolean(row.agreement_enabled ?? 0),
		agreement_timing:
			row.agreement_timing === 'before_verify' ? 'before_verify' : 'after_verify',
		agreement_mode: row.agreement_mode === 'channel_react' ? 'channel_react' : 'dm_button',
		agreement_channel_id: row.agreement_channel_id ?? null,
		agreement_message_id: row.agreement_message_id ?? null,
		agreement_version: row.agreement_version ?? null,
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
		alliance_rank: row.alliance_rank ?? null,
		ops_level: row.ops_level ?? null,
		power: row.power ?? null,
		grade: row.grade ?? null,
		stfc_pro_url: row.stfc_pro_url ?? null,
		verification_status: row.verification_status as VerificationStatus,
		personal_channel_id: row.personal_channel_id ?? null,
		preferred_locale: row.preferred_locale ?? null,
		agreement_accepted_at: row.agreement_accepted_at ?? null,
		agreement_version: row.agreement_version ?? null,
		agreement_method: row.agreement_method ?? null,
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
		await upsertPersonalChannelArchiveField(db, config);
		await upsertAuditLogChannelField(db, config);
		await upsertUrgentNotifyChannelField(db, config);
		await upsertPersonalChannelPermTemplateField(db, config);
		await upsertDmAssistantConfigFields(db, config);
		await upsertAgreementConfigFields(db, config);
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
	await upsertPersonalChannelArchiveField(db, config);
	await upsertAuditLogChannelField(db, config);
	await upsertUrgentNotifyChannelField(db, config);
	await upsertPersonalChannelPermTemplateField(db, config);
}

async function upsertPersonalChannelPermTemplateField(
	db: D1Database,
	config: Partial<GuildConfig> & { guild_id: string },
): Promise<void> {
	if (!Object.prototype.hasOwnProperty.call(config, 'personal_channel_perm_template')) return;
	const value = config.personal_channel_perm_template;
	await db
		.prepare(
			`UPDATE guild_configs SET
			 personal_channel_perm_template = ?,
			 updated_at = datetime('now')
			 WHERE guild_id = ?`,
		)
		.bind(value ? JSON.stringify(value) : null, config.guild_id)
		.run();
}

async function upsertAuditLogChannelField(
	db: D1Database,
	config: Partial<GuildConfig> & { guild_id: string },
): Promise<void> {
	if (!Object.prototype.hasOwnProperty.call(config, 'audit_log_channel_id')) return;
	await db
		.prepare(
			`UPDATE guild_configs SET
			 audit_log_channel_id = ?,
			 updated_at = datetime('now')
			 WHERE guild_id = ?`,
		)
		.bind(config.audit_log_channel_id?.trim() || null, config.guild_id)
		.run();
}

async function upsertUrgentNotifyChannelField(
	db: D1Database,
	config: Partial<GuildConfig> & { guild_id: string },
): Promise<void> {
	if (!Object.prototype.hasOwnProperty.call(config, 'urgent_notify_channel_id')) return;
	await db
		.prepare(
			`UPDATE guild_configs SET
			 urgent_notify_channel_id = ?,
			 updated_at = datetime('now')
			 WHERE guild_id = ?`,
		)
		.bind(config.urgent_notify_channel_id?.trim() || null, config.guild_id)
		.run();
}

async function upsertPersonalChannelArchiveField(
	db: D1Database,
	config: Partial<GuildConfig> & { guild_id: string },
): Promise<void> {
	if (!Object.prototype.hasOwnProperty.call(config, 'personal_channel_archive_category_id')) return;
	await db
		.prepare(
			`UPDATE guild_configs SET
			 personal_channel_archive_category_id = ?,
			 updated_at = datetime('now')
			 WHERE guild_id = ?`,
		)
		.bind(config.personal_channel_archive_category_id?.trim() || null, config.guild_id)
		.run();
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
	if (has) {
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

	const surveyRolesTouched =
		Object.prototype.hasOwnProperty.call(config, 'survey_creator_role_ids') ||
		Object.prototype.hasOwnProperty.call(config, 'survey_results_role_ids') ||
		Object.prototype.hasOwnProperty.call(config, 'survey_log_name_template') ||
		Object.prototype.hasOwnProperty.call(config, 'survey_log_category_id');
	if (surveyRolesTouched) {
		const creatorsProvided = Object.prototype.hasOwnProperty.call(config, 'survey_creator_role_ids');
		const resultsProvided = Object.prototype.hasOwnProperty.call(config, 'survey_results_role_ids');
		const logNameProvided = Object.prototype.hasOwnProperty.call(config, 'survey_log_name_template');
		const logCategoryProvided = Object.prototype.hasOwnProperty.call(config, 'survey_log_category_id');
		await db
			.prepare(
				`UPDATE guild_configs SET
				 survey_creator_role_ids = CASE WHEN ? = 1 THEN ? ELSE survey_creator_role_ids END,
				 survey_results_role_ids = CASE WHEN ? = 1 THEN ? ELSE survey_results_role_ids END,
				 survey_log_name_template = CASE WHEN ? = 1 THEN ? ELSE survey_log_name_template END,
				 survey_log_category_id = CASE WHEN ? = 1 THEN ? ELSE survey_log_category_id END,
				 updated_at = datetime('now')
				 WHERE guild_id = ?`,
			)
			.bind(
				creatorsProvided ? 1 : 0,
				creatorsProvided ? JSON.stringify(config.survey_creator_role_ids ?? []) : null,
				resultsProvided ? 1 : 0,
				resultsProvided ? JSON.stringify(config.survey_results_role_ids ?? []) : null,
				logNameProvided ? 1 : 0,
				logNameProvided ? (config.survey_log_name_template?.trim() || null) : null,
				logCategoryProvided ? 1 : 0,
				logCategoryProvided ? (config.survey_log_category_id?.trim() || null) : null,
				config.guild_id,
			)
			.run();
	}

	const exchangeTouched =
		Object.prototype.hasOwnProperty.call(config, 'exchange_layout') ||
		Object.prototype.hasOwnProperty.call(config, 'exchange_hub_channel_id') ||
		Object.prototype.hasOwnProperty.call(config, 'exchange_category_id') ||
		Object.prototype.hasOwnProperty.call(config, 'exchange_admin_role_ids');
	if (exchangeTouched) {
		const layoutProvided = Object.prototype.hasOwnProperty.call(config, 'exchange_layout');
		const hubProvided = Object.prototype.hasOwnProperty.call(config, 'exchange_hub_channel_id');
		const catProvided = Object.prototype.hasOwnProperty.call(config, 'exchange_category_id');
		const adminProvided = Object.prototype.hasOwnProperty.call(config, 'exchange_admin_role_ids');
		await db
			.prepare(
				`UPDATE guild_configs SET
				 exchange_layout = CASE WHEN ? = 1 THEN ? ELSE exchange_layout END,
				 exchange_hub_channel_id = CASE WHEN ? = 1 THEN ? ELSE exchange_hub_channel_id END,
				 exchange_category_id = CASE WHEN ? = 1 THEN ? ELSE exchange_category_id END,
				 exchange_admin_role_ids = CASE WHEN ? = 1 THEN ? ELSE exchange_admin_role_ids END,
				 updated_at = datetime('now')
				 WHERE guild_id = ?`,
			)
			.bind(
				layoutProvided ? 1 : 0,
				layoutProvided ? (config.exchange_layout ?? null) : null,
				hubProvided ? 1 : 0,
				hubProvided ? (config.exchange_hub_channel_id?.trim() || null) : null,
				catProvided ? 1 : 0,
				catProvided ? (config.exchange_category_id?.trim() || null) : null,
				adminProvided ? 1 : 0,
				adminProvided ? JSON.stringify(config.exchange_admin_role_ids ?? []) : null,
				config.guild_id,
			)
			.run();
	}

	await upsertDmAssistantConfigFields(db, config);
	await upsertAgreementConfigFields(db, config);
}

async function upsertAgreementConfigFields(
	db: D1Database,
	config: Partial<GuildConfig> & { guild_id: string },
): Promise<void> {
	const touched =
		Object.prototype.hasOwnProperty.call(config, 'agreement_enabled') ||
		Object.prototype.hasOwnProperty.call(config, 'agreement_timing') ||
		Object.prototype.hasOwnProperty.call(config, 'agreement_mode') ||
		Object.prototype.hasOwnProperty.call(config, 'agreement_channel_id') ||
		Object.prototype.hasOwnProperty.call(config, 'agreement_message_id') ||
		Object.prototype.hasOwnProperty.call(config, 'agreement_version');
	if (!touched) return;

	const enabledProvided = Object.prototype.hasOwnProperty.call(config, 'agreement_enabled');
	const timingProvided = Object.prototype.hasOwnProperty.call(config, 'agreement_timing');
	const modeProvided = Object.prototype.hasOwnProperty.call(config, 'agreement_mode');
	const channelProvided = Object.prototype.hasOwnProperty.call(config, 'agreement_channel_id');
	const messageProvided = Object.prototype.hasOwnProperty.call(config, 'agreement_message_id');
	const versionProvided = Object.prototype.hasOwnProperty.call(config, 'agreement_version');

	await db
		.prepare(
			`UPDATE guild_configs SET
			 agreement_enabled = CASE WHEN ? = 1 THEN ? ELSE agreement_enabled END,
			 agreement_timing = CASE WHEN ? = 1 THEN ? ELSE agreement_timing END,
			 agreement_mode = CASE WHEN ? = 1 THEN ? ELSE agreement_mode END,
			 agreement_channel_id = CASE WHEN ? = 1 THEN ? ELSE agreement_channel_id END,
			 agreement_message_id = CASE WHEN ? = 1 THEN ? ELSE agreement_message_id END,
			 agreement_version = CASE WHEN ? = 1 THEN ? ELSE agreement_version END,
			 updated_at = datetime('now')
			 WHERE guild_id = ?`,
		)
		.bind(
			enabledProvided ? 1 : 0,
			enabledProvided ? (config.agreement_enabled ? 1 : 0) : null,
			timingProvided ? 1 : 0,
			timingProvided ? (config.agreement_timing ?? 'after_verify') : null,
			modeProvided ? 1 : 0,
			modeProvided ? (config.agreement_mode ?? 'dm_button') : null,
			channelProvided ? 1 : 0,
			channelProvided ? (config.agreement_channel_id?.trim() || null) : null,
			messageProvided ? 1 : 0,
			messageProvided ? (config.agreement_message_id?.trim() || null) : null,
			versionProvided ? 1 : 0,
			versionProvided ? (config.agreement_version?.trim() || null) : null,
			config.guild_id,
		)
		.run();
}

async function upsertDmAssistantConfigFields(
	db: D1Database,
	config: Partial<GuildConfig> & { guild_id: string },
): Promise<void> {
	const rolesProvided = Object.prototype.hasOwnProperty.call(config, 'dm_query_role_ids');
	const aiProvided = Object.prototype.hasOwnProperty.call(config, 'dm_ai_enabled');
	if (!rolesProvided && !aiProvided) return;

	await db
		.prepare(
			`UPDATE guild_configs SET
			 dm_query_role_ids = CASE WHEN ? = 1 THEN ? ELSE dm_query_role_ids END,
			 dm_ai_enabled = CASE WHEN ? = 1 THEN ? ELSE dm_ai_enabled END,
			 updated_at = datetime('now')
			 WHERE guild_id = ?`,
		)
		.bind(
			rolesProvided ? 1 : 0,
			rolesProvided ? JSON.stringify(config.dm_query_role_ids ?? []) : null,
			aiProvided ? 1 : 0,
			aiProvided ? (config.dm_ai_enabled ? 1 : 0) : null,
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
			   username = COALESCE(excluded.username, guild_members.username),
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
		alliance_rank?: string | null;
		ops_level?: number | null;
		power?: number | null;
		grade?: number | null;
		stfc_pro_url?: string | null;
		verification_status?: VerificationStatus;
		personal_channel_id?: string | null;
		preferred_locale?: string | null;
		agreement_accepted_at?: string | null;
		agreement_version?: string | null;
		agreement_method?: string | null;
		verified_at?: string | null;
		last_synced_at?: string | null;
	},
): Promise<void> {
	const now = new Date().toISOString();
	const existing = await getVerifiedPlayer(db, data.guild_id, data.discord_user_id);
	const agreementProvided = Object.prototype.hasOwnProperty.call(data, 'agreement_accepted_at');

	if (!existing) {
		await db
			.prepare(
				`INSERT INTO verified_players
				(guild_id, discord_user_id, player_id, player_name, alliance_tag, alliance_rank,
				 ops_level, power, grade, stfc_pro_url, verification_status, personal_channel_id,
				 preferred_locale, agreement_accepted_at, agreement_version, agreement_method,
				 verified_at, last_synced_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				data.guild_id,
				data.discord_user_id,
				data.player_id ?? null,
				data.player_name ?? null,
				data.alliance_tag ?? null,
				data.alliance_rank ?? null,
				data.ops_level ?? null,
				data.power ?? null,
				data.grade ?? null,
				data.stfc_pro_url ?? null,
				data.verification_status ?? 'pending_invite',
				data.personal_channel_id ?? null,
				data.preferred_locale ?? null,
				data.agreement_accepted_at ?? null,
				data.agreement_version ?? null,
				data.agreement_method ?? null,
				data.verified_at ?? null,
				data.last_synced_at ?? null,
				now,
			)
			.run();
		return;
	}

	const localeProvided = Object.prototype.hasOwnProperty.call(data, 'preferred_locale');

	await db
		.prepare(
			`UPDATE verified_players SET
			 player_id = COALESCE(?, player_id),
			 player_name = COALESCE(?, player_name),
			 alliance_tag = COALESCE(?, alliance_tag),
			 alliance_rank = COALESCE(?, alliance_rank),
			 ops_level = COALESCE(?, ops_level),
			 power = COALESCE(?, power),
			 grade = COALESCE(?, grade),
			 stfc_pro_url = COALESCE(?, stfc_pro_url),
			 verification_status = COALESCE(?, verification_status),
			 personal_channel_id = COALESCE(?, personal_channel_id),
			 preferred_locale = CASE WHEN ? = 1 THEN ? ELSE preferred_locale END,
			 agreement_accepted_at = CASE WHEN ? = 1 THEN ? ELSE agreement_accepted_at END,
			 agreement_version = CASE WHEN ? = 1 THEN ? ELSE agreement_version END,
			 agreement_method = CASE WHEN ? = 1 THEN ? ELSE agreement_method END,
			 verified_at = COALESCE(?, verified_at),
			 last_synced_at = COALESCE(?, last_synced_at),
			 updated_at = ?
			 WHERE guild_id = ? AND discord_user_id = ?`,
		)
		.bind(
			data.player_id ?? null,
			data.player_name ?? null,
			data.alliance_tag ?? null,
			data.alliance_rank ?? null,
			data.ops_level ?? null,
			data.power ?? null,
			data.grade ?? null,
			data.stfc_pro_url ?? null,
			data.verification_status ?? null,
			data.personal_channel_id ?? null,
			localeProvided ? 1 : 0,
			localeProvided ? (data.preferred_locale?.trim() || null) : null,
			agreementProvided ? 1 : 0,
			agreementProvided ? (data.agreement_accepted_at?.trim() || null) : null,
			agreementProvided ? 1 : 0,
			agreementProvided ? (data.agreement_version?.trim() || null) : null,
			agreementProvided ? 1 : 0,
			agreementProvided ? (data.agreement_method?.trim() || null) : null,
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
 * Verified members used for personal-channel planning/rebalance.
 * Includes active/verified (and guests with a linked channel).
 */
export async function listPlayersForPersonalChannels(
	db: D1Database,
	guildId: string,
): Promise<VerifiedPlayer[]> {
	const { results } = await db
		.prepare(
			`SELECT * FROM verified_players
			 WHERE guild_id = ?
			   AND player_name IS NOT NULL
			   AND TRIM(player_name) != ''
			   AND (
			     verification_status IN ('verified', 'active')
			     OR personal_channel_id IS NOT NULL
			   )
			 ORDER BY LOWER(player_name)`,
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
	// Skip verified/active/guest and manually excluded users (bots, never-verify accounts).
	const { results } = await db
		.prepare(
			`SELECT gm.* FROM guild_members gm
			 WHERE gm.guild_id = ?
			   AND gm.verification_invited_at IS NULL
			   AND NOT EXISTS (
			     SELECT 1 FROM verified_players vp
			     WHERE vp.guild_id = gm.guild_id
			       AND vp.discord_user_id = gm.discord_user_id
			       AND vp.verification_status IN ('verified', 'active', 'guest')
			   )
			   AND NOT EXISTS (
			     SELECT 1 FROM guild_excluded_users ex
			     WHERE ex.guild_id = gm.guild_id
			       AND ex.discord_user_id = gm.discord_user_id
			   )`,
		)
		.bind(guildId)
		.all();
	return (results ?? []) as unknown as GuildMemberRecord[];
}

/** Verified / active / guest rows for a Discord user across all guilds. */
export async function listVerifiedGuildsForUser(
	db: D1Database,
	discordUserId: string,
): Promise<VerifiedPlayer[]> {
	const { results } = await db
		.prepare(
			`SELECT * FROM verified_players
			 WHERE discord_user_id = ?
			 AND verification_status IN ('verified', 'active', 'guest')
			 ORDER BY updated_at DESC`,
		)
		.bind(discordUserId)
		.all();
	return (results ?? []).map(mapVerifiedPlayer);
}

/** Any verified_players row for locale / name (prefer active statuses). */
export async function getAnyPlayerRecordForUser(
	db: D1Database,
	discordUserId: string,
): Promise<VerifiedPlayer | null> {
	const verified = await listVerifiedGuildsForUser(db, discordUserId);
	if (verified.length > 0) return verified[0];
	const row = await db
		.prepare(
			`SELECT * FROM verified_players WHERE discord_user_id = ? ORDER BY updated_at DESC LIMIT 1`,
		)
		.bind(discordUserId)
		.first();
	return row ? mapVerifiedPlayer(row) : null;
}

const DM_SESSION_TTL_MINUTES = 60;

function mapDmSession(row: Record<string, unknown>): import('./types').DmSession {
	let payload: Record<string, unknown> = {};
	try {
		const raw = row.payload_json;
		if (typeof raw === 'string' && raw) {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				payload = parsed as Record<string, unknown>;
			}
		}
	} catch {
		payload = {};
	}
	return {
		discord_user_id: String(row.discord_user_id),
		guild_id: row.guild_id != null ? String(row.guild_id) : null,
		flow: String(row.flow),
		step: String(row.step ?? 'start'),
		payload,
		updated_at: String(row.updated_at ?? ''),
	};
}

function isDmSessionStale(updatedAt: string): boolean {
	const t = Date.parse(updatedAt);
	if (!Number.isFinite(t)) return true;
	return Date.now() - t > DM_SESSION_TTL_MINUTES * 60 * 1000;
}

export async function getDmSession(
	db: D1Database,
	discordUserId: string,
): Promise<import('./types').DmSession | null> {
	const row = await db
		.prepare(`SELECT * FROM dm_sessions WHERE discord_user_id = ?`)
		.bind(discordUserId)
		.first();
	if (!row) return null;
	const session = mapDmSession(row as Record<string, unknown>);
	if (isDmSessionStale(session.updated_at)) {
		await clearDmSession(db, discordUserId);
		return null;
	}
	return session;
}

export async function upsertDmSession(
	db: D1Database,
	session: {
		discord_user_id: string;
		guild_id?: string | null;
		flow: string;
		step: string;
		payload?: Record<string, unknown>;
	},
): Promise<void> {
	const now = new Date().toISOString();
	await db
		.prepare(
			`INSERT INTO dm_sessions (discord_user_id, guild_id, flow, step, payload_json, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(discord_user_id) DO UPDATE SET
			  guild_id = excluded.guild_id,
			  flow = excluded.flow,
			  step = excluded.step,
			  payload_json = excluded.payload_json,
			  updated_at = excluded.updated_at`,
		)
		.bind(
			session.discord_user_id,
			session.guild_id ?? null,
			session.flow,
			session.step,
			JSON.stringify(session.payload ?? {}),
			now,
		)
		.run();
}

export async function clearDmSession(db: D1Database, discordUserId: string): Promise<void> {
	await db.prepare(`DELETE FROM dm_sessions WHERE discord_user_id = ?`).bind(discordUserId).run();
}

export async function cleanupStaleDmSessions(db: D1Database): Promise<number> {
	const cutoff = new Date(Date.now() - DM_SESSION_TTL_MINUTES * 60 * 1000).toISOString();
	const result = await db
		.prepare(`DELETE FROM dm_sessions WHERE updated_at < ?`)
		.bind(cutoff)
		.run();
	return result.meta?.changes ?? 0;
}

export async function countPlayersByGrade(
	db: D1Database,
	guildId: string,
): Promise<Array<{ grade: number; count: number }>> {
	const { results } = await db
		.prepare(
			`SELECT grade, COUNT(*) AS count FROM verified_players
			 WHERE guild_id = ?
			 AND verification_status IN ('verified', 'active', 'guest')
			 AND grade IS NOT NULL
			 GROUP BY grade
			 ORDER BY grade`,
		)
		.bind(guildId)
		.all();
	return (results ?? []).map((r) => ({
		grade: Number((r as { grade: number }).grade),
		count: Number((r as { count: number }).count),
	}));
}

export async function countPlayersForGrade(
	db: D1Database,
	guildId: string,
	grade: number,
): Promise<number> {
	const row = await db
		.prepare(
			`SELECT COUNT(*) AS count FROM verified_players
			 WHERE guild_id = ?
			 AND verification_status IN ('verified', 'active', 'guest')
			 AND grade = ?`,
		)
		.bind(guildId, grade)
		.first<{ count: number }>();
	return Number(row?.count ?? 0);
}

export async function countPlayersByAlliance(
	db: D1Database,
	guildId: string,
): Promise<Array<{ alliance_tag: string; count: number }>> {
	const { results } = await db
		.prepare(
			`SELECT COALESCE(alliance_tag, '—') AS alliance_tag, COUNT(*) AS count
			 FROM verified_players
			 WHERE guild_id = ?
			 AND verification_status IN ('verified', 'active', 'guest')
			 GROUP BY alliance_tag
			 ORDER BY count DESC`,
		)
		.bind(guildId)
		.all();
	return (results ?? []).map((r) => ({
		alliance_tag: String((r as { alliance_tag: string }).alliance_tag),
		count: Number((r as { count: number }).count),
	}));
}

export async function countPlayersByStatus(
	db: D1Database,
	guildId: string,
): Promise<Array<{ verification_status: string; count: number }>> {
	const { results } = await db
		.prepare(
			`SELECT verification_status, COUNT(*) AS count FROM verified_players
			 WHERE guild_id = ?
			 AND verification_status IN ('verified', 'active', 'guest')
			 GROUP BY verification_status
			 ORDER BY verification_status`,
		)
		.bind(guildId)
		.all();
	return (results ?? []).map((r) => ({
		verification_status: String((r as { verification_status: string }).verification_status),
		count: Number((r as { count: number }).count),
	}));
}

export async function getDmAiUsage(db: D1Database, day: string): Promise<number> {
	const row = await db
		.prepare(`SELECT request_count FROM dm_ai_usage WHERE day = ?`)
		.bind(day)
		.first<{ request_count: number }>();
	return Number(row?.request_count ?? 0);
}

export async function incrementDmAiUsage(db: D1Database, day: string): Promise<number> {
	await db
		.prepare(
			`INSERT INTO dm_ai_usage (day, request_count) VALUES (?, 1)
			 ON CONFLICT(day) DO UPDATE SET request_count = request_count + 1`,
		)
		.bind(day)
		.run();
	return getDmAiUsage(db, day);
}

function mapExcludedUser(row: Record<string, unknown>): GuildExcludedUser {
	return {
		guild_id: String(row.guild_id),
		discord_user_id: String(row.discord_user_id),
		reason: row.reason != null ? String(row.reason) : null,
		excluded_by: row.excluded_by != null ? String(row.excluded_by) : null,
		excluded_at: String(row.excluded_at ?? ''),
	};
}

export async function isUserExcluded(db: D1Database, guildId: string, userId: string): Promise<boolean> {
	const row = await db
		.prepare(
			`SELECT 1 AS ok FROM guild_excluded_users
			 WHERE guild_id = ? AND discord_user_id = ?`,
		)
		.bind(guildId, userId)
		.first();
	return Boolean(row);
}

export async function getExcludedUserIds(db: D1Database, guildId: string): Promise<Set<string>> {
	const { results } = await db
		.prepare(`SELECT discord_user_id FROM guild_excluded_users WHERE guild_id = ?`)
		.bind(guildId)
		.all();
	return new Set((results ?? []).map((r) => String((r as { discord_user_id: string }).discord_user_id)));
}

export async function listExcludedUsers(db: D1Database, guildId: string): Promise<GuildExcludedUser[]> {
	const { results } = await db
		.prepare(
			`SELECT * FROM guild_excluded_users
			 WHERE guild_id = ?
			 ORDER BY excluded_at DESC`,
		)
		.bind(guildId)
		.all();
	return (results ?? []).map((r) => mapExcludedUser(r as Record<string, unknown>));
}

export async function excludeGuildUser(
	db: D1Database,
	guildId: string,
	userId: string,
	opts?: { reason?: string | null; excludedBy?: string | null },
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO guild_excluded_users (guild_id, discord_user_id, reason, excluded_by, excluded_at)
			 VALUES (?, ?, ?, ?, datetime('now'))
			 ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
			   reason = COALESCE(excluded.reason, guild_excluded_users.reason),
			   excluded_by = COALESCE(excluded.excluded_by, guild_excluded_users.excluded_by),
			   excluded_at = datetime('now')`,
		)
		.bind(guildId, userId, opts?.reason?.trim() || null, opts?.excludedBy ?? null)
		.run();
}

export async function unexcludeGuildUser(db: D1Database, guildId: string, userId: string): Promise<boolean> {
	const result = await db
		.prepare(
			`DELETE FROM guild_excluded_users
			 WHERE guild_id = ? AND discord_user_id = ?`,
		)
		.bind(guildId, userId)
		.run();
	return (result.meta?.changes ?? 0) > 0;
}

/** Verified players with optional grade / ops filters (active roster only). */
export async function listRosterPlayers(
	db: D1Database,
	guildId: string,
	filters?: {
		grade?: number;
		opsMin?: number;
		opsMax?: number;
		status?: VerificationStatus;
		limit?: number;
	},
): Promise<VerifiedPlayer[]> {
	const clauses = [
		`guild_id = ?`,
		`verification_status IN ('verified', 'active', 'guest')`,
	];
	const binds: Array<string | number> = [guildId];

	if (filters?.grade != null) {
		clauses.push(`grade = ?`);
		binds.push(filters.grade);
	}
	if (filters?.opsMin != null) {
		clauses.push(`ops_level >= ?`);
		binds.push(filters.opsMin);
	}
	if (filters?.opsMax != null) {
		clauses.push(`ops_level <= ?`);
		binds.push(filters.opsMax);
	}
	if (filters?.status) {
		clauses.push(`verification_status = ?`);
		binds.push(filters.status);
	}

	const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 100);
	binds.push(limit);

	const { results } = await db
		.prepare(
			`SELECT * FROM verified_players
			 WHERE ${clauses.join(' AND ')}
			 ORDER BY (ops_level IS NULL), ops_level DESC, player_name COLLATE NOCASE
			 LIMIT ?`,
		)
		.bind(...binds)
		.all();
	return (results ?? []).map(mapVerifiedPlayer);
}

/** Discord user IDs with an active/guest/verified link in this guild. */
export async function getVerifiedDiscordUserIds(db: D1Database, guildId: string): Promise<Set<string>> {
	const { results } = await db
		.prepare(
			`SELECT discord_user_id FROM verified_players
			 WHERE guild_id = ?
			 AND verification_status IN ('verified', 'active', 'guest')`,
		)
		.bind(guildId)
		.all();
	return new Set((results ?? []).map((r) => String((r as { discord_user_id: string }).discord_user_id)));
}
