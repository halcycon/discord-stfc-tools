import type {
	AgreementMode,
	AgreementTiming,
	DemotionPolicy,
	DemotionQueueReason,
	DemotionQueueRow,
	DemotionQueueStatus,
	GuildConfig,
	GuildExcludedUser,
	GuildMemberRecord,
	OverlayBucket,
	PersonalChannelPermTemplate,
	StfcRegion,
	VerificationStatus,
	VerifiedPlayer,
} from './types';
import { parseDeployMode } from './deploy-mode';
import { parsePersonalChannelPermTemplate } from './personal-channel-perm-template';

function parseDemotionPolicy(value: string | null | undefined): DemotionPolicy {
	return value === 'yolo' ? 'yolo' : 'approval';
}
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
		stfc_alliance_id: row.stfc_alliance_id != null ? String(row.stfc_alliance_id) : null,
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
		diplomacy_category_map: parseJsonObject(row.diplomacy_category_map),
		diplomacy_archive_category_id: row.diplomacy_archive_category_id ?? null,
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
		web_admin_role_ids: parseJsonArray(row.web_admin_role_ids),
		dm_ai_enabled: Boolean(row.dm_ai_enabled ?? 0),
		data_consent_enabled: Boolean(row.data_consent_enabled ?? 0),
		data_consent_version: row.data_consent_version?.trim() || '1',
		agreement_enabled: Boolean(row.agreement_enabled ?? 0),
		agreement_timing:
			row.agreement_timing === 'before_verify' ? 'before_verify' : 'after_verify',
		agreement_mode: row.agreement_mode === 'channel_react' ? 'channel_react' : 'dm_button',
		agreement_channel_id: row.agreement_channel_id ?? null,
		agreement_message_id: row.agreement_message_id ?? null,
		agreement_version: row.agreement_version ?? null,
		demotion_policy: parseDemotionPolicy(row.demotion_policy),
		deploy_mode: parseDeployMode(row.deploy_mode),
		welcome_dm_enabled: Boolean(row.welcome_dm_enabled ?? 0),
		welcome_dm_channel_id: row.welcome_dm_channel_id ?? null,
		welcome_dm_message_id: row.welcome_dm_message_id ?? null,
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
		data_consent_at: row.data_consent_at ?? null,
		data_consent_version: row.data_consent_version ?? null,
		data_consent_choice: row.data_consent_choice ?? null,
		data_consent_method: row.data_consent_method ?? null,
		agreement_accepted_at: row.agreement_accepted_at ?? null,
		agreement_version: row.agreement_version ?? null,
		agreement_method: row.agreement_method ?? null,
		welcome_dm_sent_at: row.welcome_dm_sent_at ?? null,
		welcome_dm_attempts: Number(row.welcome_dm_attempts ?? 0) || 0,
		activity_streak: row.activity_streak != null ? Number(row.activity_streak) : null,
		days_inactive: Number(row.days_inactive ?? 0) || 0,
		activity_updated_at: row.activity_updated_at ?? null,
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
		await upsertDemotionPolicyField(db, config);
		// Brand-new guilds start in testing unless explicitly set.
		await upsertDeployModeField(db, {
			guild_id: config.guild_id,
			deploy_mode: config.deploy_mode ?? 'testing',
		});
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
		Object.prototype.hasOwnProperty.call(config, 'diplomacy_category_map') ||
		Object.prototype.hasOwnProperty.call(config, 'diplomacy_archive_category_id') ||
		Object.prototype.hasOwnProperty.call(config, 'diplomacy_channel_map') ||
		Object.prototype.hasOwnProperty.call(config, 'diplomacy_everyone_can_view') ||
		Object.prototype.hasOwnProperty.call(config, 'diplomacy_view_role_ids') ||
		Object.prototype.hasOwnProperty.call(config, 'diplomacy_write_role_ids') ||
		Object.prototype.hasOwnProperty.call(config, 'diplomacy_write_ranks') ||
		Object.prototype.hasOwnProperty.call(config, 'diplomacy_name_template');
	if (has) {
		const categoryProvided = Object.prototype.hasOwnProperty.call(config, 'diplomacy_category_id');
		const archiveProvided = Object.prototype.hasOwnProperty.call(
			config,
			'diplomacy_archive_category_id',
		);
		const nameProvided = Object.prototype.hasOwnProperty.call(config, 'diplomacy_name_template');

		await db
			.prepare(
				`UPDATE guild_configs SET
				 diplomacy_enabled = COALESCE(?, diplomacy_enabled),
				 diplomacy_category_id = CASE WHEN ? = 1 THEN ? ELSE diplomacy_category_id END,
				 diplomacy_category_map = COALESCE(?, diplomacy_category_map),
				 diplomacy_archive_category_id = CASE WHEN ? = 1 THEN ? ELSE diplomacy_archive_category_id END,
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
				config.diplomacy_category_map ? JSON.stringify(config.diplomacy_category_map) : null,
				archiveProvided ? 1 : 0,
				archiveProvided ? (config.diplomacy_archive_category_id?.trim() || null) : null,
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
	await upsertDataConsentConfigFields(db, config);
	await upsertAgreementConfigFields(db, config);
	await upsertDemotionPolicyField(db, config);
	await upsertDeployModeField(db, config);
	await upsertWelcomeDmConfigFields(db, config);
	await upsertWebAdminRoleIdsField(db, config);
}

async function upsertWebAdminRoleIdsField(
	db: D1Database,
	config: Partial<GuildConfig> & { guild_id: string },
): Promise<void> {
	if (!Object.prototype.hasOwnProperty.call(config, 'web_admin_role_ids')) return;
	await db
		.prepare(
			`UPDATE guild_configs SET
			 web_admin_role_ids = ?,
			 updated_at = datetime('now')
			 WHERE guild_id = ?`,
		)
		.bind(JSON.stringify(config.web_admin_role_ids ?? []), config.guild_id)
		.run();
}

async function upsertDataConsentConfigFields(
	db: D1Database,
	config: Partial<GuildConfig> & { guild_id: string },
): Promise<void> {
	const touched =
		Object.prototype.hasOwnProperty.call(config, 'data_consent_enabled') ||
		Object.prototype.hasOwnProperty.call(config, 'data_consent_version');
	if (!touched) return;

	const enabledProvided = Object.prototype.hasOwnProperty.call(config, 'data_consent_enabled');
	const versionProvided = Object.prototype.hasOwnProperty.call(config, 'data_consent_version');

	await db
		.prepare(
			`UPDATE guild_configs SET
			 data_consent_enabled = CASE WHEN ? = 1 THEN ? ELSE data_consent_enabled END,
			 data_consent_version = CASE WHEN ? = 1 THEN ? ELSE data_consent_version END,
			 updated_at = datetime('now')
			 WHERE guild_id = ?`,
		)
		.bind(
			enabledProvided ? 1 : 0,
			enabledProvided ? (config.data_consent_enabled ? 1 : 0) : null,
			versionProvided ? 1 : 0,
			versionProvided ? (config.data_consent_version?.trim() || '1') : null,
			config.guild_id,
		)
		.run();
}

async function upsertWelcomeDmConfigFields(
	db: D1Database,
	config: Partial<GuildConfig> & { guild_id: string },
): Promise<void> {
	const touched =
		Object.prototype.hasOwnProperty.call(config, 'welcome_dm_enabled') ||
		Object.prototype.hasOwnProperty.call(config, 'welcome_dm_channel_id') ||
		Object.prototype.hasOwnProperty.call(config, 'welcome_dm_message_id');
	if (!touched) return;

	const enabledProvided = Object.prototype.hasOwnProperty.call(config, 'welcome_dm_enabled');
	const channelProvided = Object.prototype.hasOwnProperty.call(config, 'welcome_dm_channel_id');
	const messageProvided = Object.prototype.hasOwnProperty.call(config, 'welcome_dm_message_id');

	await db
		.prepare(
			`UPDATE guild_configs SET
			 welcome_dm_enabled = CASE WHEN ? = 1 THEN ? ELSE welcome_dm_enabled END,
			 welcome_dm_channel_id = CASE WHEN ? = 1 THEN ? ELSE welcome_dm_channel_id END,
			 welcome_dm_message_id = CASE WHEN ? = 1 THEN ? ELSE welcome_dm_message_id END,
			 updated_at = datetime('now')
			 WHERE guild_id = ?`,
		)
		.bind(
			enabledProvided ? 1 : 0,
			enabledProvided ? (config.welcome_dm_enabled ? 1 : 0) : null,
			channelProvided ? 1 : 0,
			channelProvided ? (config.welcome_dm_channel_id?.trim() || null) : null,
			messageProvided ? 1 : 0,
			messageProvided ? (config.welcome_dm_message_id?.trim() || null) : null,
			config.guild_id,
		)
		.run();
}

async function upsertDemotionPolicyField(
	db: D1Database,
	config: Partial<GuildConfig> & { guild_id: string },
): Promise<void> {
	if (!Object.prototype.hasOwnProperty.call(config, 'demotion_policy')) return;
	const policy = config.demotion_policy === 'yolo' ? 'yolo' : 'approval';
	await db
		.prepare(
			`UPDATE guild_configs SET
			 demotion_policy = ?,
			 updated_at = datetime('now')
			 WHERE guild_id = ?`,
		)
		.bind(policy, config.guild_id)
		.run();
}

async function upsertDeployModeField(
	db: D1Database,
	config: Partial<GuildConfig> & { guild_id: string },
): Promise<void> {
	if (!Object.prototype.hasOwnProperty.call(config, 'deploy_mode')) return;
	const mode = config.deploy_mode === 'testing' ? 'testing' : 'live';
	await db
		.prepare(
			`UPDATE guild_configs SET
			 deploy_mode = ?,
			 updated_at = datetime('now')
			 WHERE guild_id = ?`,
		)
		.bind(mode, config.guild_id)
		.run();
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
			timingProvided ? (config.agreement_timing ?? 'before_verify') : null,
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
		data_consent_at?: string | null;
		data_consent_version?: string | null;
		data_consent_choice?: string | null;
		data_consent_method?: string | null;
		agreement_accepted_at?: string | null;
		agreement_version?: string | null;
		agreement_method?: string | null;
		welcome_dm_sent_at?: string | null;
		welcome_dm_attempts?: number;
		verified_at?: string | null;
		last_synced_at?: string | null;
	},
): Promise<void> {
	const now = new Date().toISOString();
	const existing = await getVerifiedPlayer(db, data.guild_id, data.discord_user_id);
	const agreementProvided = Object.prototype.hasOwnProperty.call(data, 'agreement_accepted_at');
	const consentProvided = Object.prototype.hasOwnProperty.call(data, 'data_consent_at');
	const welcomeSentProvided = Object.prototype.hasOwnProperty.call(data, 'welcome_dm_sent_at');
	const welcomeAttemptsProvided = Object.prototype.hasOwnProperty.call(data, 'welcome_dm_attempts');

	if (!existing) {
		await db
			.prepare(
				`INSERT INTO verified_players
				(guild_id, discord_user_id, player_id, player_name, alliance_tag, alliance_rank,
				 ops_level, power, grade, stfc_pro_url, verification_status, personal_channel_id,
				 preferred_locale, data_consent_at, data_consent_version, data_consent_choice, data_consent_method,
				 agreement_accepted_at, agreement_version, agreement_method,
				 welcome_dm_sent_at, welcome_dm_attempts, verified_at, last_synced_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
				data.data_consent_at ?? null,
				data.data_consent_version ?? null,
				data.data_consent_choice ?? null,
				data.data_consent_method ?? null,
				data.agreement_accepted_at ?? null,
				data.agreement_version ?? null,
				data.agreement_method ?? null,
				data.welcome_dm_sent_at ?? null,
				Math.max(0, Math.floor(Number(data.welcome_dm_attempts) || 0)),
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
			 data_consent_at = CASE WHEN ? = 1 THEN ? ELSE data_consent_at END,
			 data_consent_version = CASE WHEN ? = 1 THEN ? ELSE data_consent_version END,
			 data_consent_choice = CASE WHEN ? = 1 THEN ? ELSE data_consent_choice END,
			 data_consent_method = CASE WHEN ? = 1 THEN ? ELSE data_consent_method END,
			 agreement_accepted_at = CASE WHEN ? = 1 THEN ? ELSE agreement_accepted_at END,
			 agreement_version = CASE WHEN ? = 1 THEN ? ELSE agreement_version END,
			 agreement_method = CASE WHEN ? = 1 THEN ? ELSE agreement_method END,
			 welcome_dm_sent_at = CASE WHEN ? = 1 THEN ? ELSE welcome_dm_sent_at END,
			 welcome_dm_attempts = CASE WHEN ? = 1 THEN ? ELSE welcome_dm_attempts END,
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
			consentProvided ? 1 : 0,
			consentProvided ? (data.data_consent_at?.trim() || null) : null,
			consentProvided ? 1 : 0,
			consentProvided ? (data.data_consent_version?.trim() || null) : null,
			consentProvided ? 1 : 0,
			consentProvided ? (data.data_consent_choice?.trim() || null) : null,
			consentProvided ? 1 : 0,
			consentProvided ? (data.data_consent_method?.trim() || null) : null,
			agreementProvided ? 1 : 0,
			agreementProvided ? (data.agreement_accepted_at?.trim() || null) : null,
			agreementProvided ? 1 : 0,
			agreementProvided ? (data.agreement_version?.trim() || null) : null,
			agreementProvided ? 1 : 0,
			agreementProvided ? (data.agreement_method?.trim() || null) : null,
			welcomeSentProvided ? 1 : 0,
			welcomeSentProvided ? (data.welcome_dm_sent_at?.trim() || null) : null,
			welcomeAttemptsProvided ? 1 : 0,
			welcomeAttemptsProvided
				? Math.max(0, Math.floor(Number(data.welcome_dm_attempts) || 0))
				: null,
			data.verified_at ?? null,
			data.last_synced_at ?? null,
			now,
			data.guild_id,
			data.discord_user_id,
		)
		.run();
}

/** Set activity streak / days inactive (sync or admin adjust). */
export async function setVerifiedPlayerActivity(
	db: D1Database,
	guildId: string,
	discordUserId: string,
	opts: {
		activity_streak?: number | null;
		days_inactive?: number;
		activity_updated_at?: string | null;
	},
): Promise<void> {
	const streakProvided = Object.prototype.hasOwnProperty.call(opts, 'activity_streak');
	const inactiveProvided = Object.prototype.hasOwnProperty.call(opts, 'days_inactive');
	if (!streakProvided && !inactiveProvided) return;

	const now = opts.activity_updated_at ?? new Date().toISOString();
	await db
		.prepare(
			`UPDATE verified_players SET
			 activity_streak = CASE WHEN ? = 1 THEN ? ELSE activity_streak END,
			 days_inactive = CASE WHEN ? = 1 THEN ? ELSE days_inactive END,
			 activity_updated_at = ?,
			 updated_at = datetime('now')
			 WHERE guild_id = ? AND discord_user_id = ?`,
		)
		.bind(
			streakProvided ? 1 : 0,
			streakProvided
				? opts.activity_streak == null
					? null
					: Math.max(0, Math.floor(Number(opts.activity_streak) || 0))
				: null,
			inactiveProvided ? 1 : 0,
			inactiveProvided ? Math.max(0, Math.floor(Number(opts.days_inactive) || 0)) : null,
			now,
			guildId,
			discordUserId,
		)
		.run();
}

/** Set activity on alliance roster cache (unlinked + linked morning scrape rows). */
export async function setAllianceRosterMemberActivity(
	db: D1Database,
	guildId: string,
	playerId: number,
	opts: {
		activity_streak?: number | null;
		days_inactive?: number;
	},
): Promise<void> {
	const streakProvided = Object.prototype.hasOwnProperty.call(opts, 'activity_streak');
	const inactiveProvided = Object.prototype.hasOwnProperty.call(opts, 'days_inactive');
	if (!streakProvided && !inactiveProvided) return;

	await db
		.prepare(
			`UPDATE alliance_roster_members SET
			 activity_streak = CASE WHEN ? = 1 THEN ? ELSE activity_streak END,
			 days_inactive = CASE WHEN ? = 1 THEN ? ELSE days_inactive END
			 WHERE guild_id = ? AND player_id = ?`,
		)
		.bind(
			streakProvided ? 1 : 0,
			streakProvided
				? opts.activity_streak == null
					? null
					: Math.max(0, Math.floor(Number(opts.activity_streak) || 0))
				: null,
			inactiveProvided ? 1 : 0,
			inactiveProvided ? Math.max(0, Math.floor(Number(opts.days_inactive) || 0)) : null,
			guildId,
			playerId,
		)
		.run();
}

/** Union of verified + alliance-cache players for name/id activity lookups. */
export type PlayerActivityCandidate = {
	player_id: number | null;
	discord_user_id: string | null;
	player_name: string | null;
	alliance_tag: string | null;
	activity_streak: number | null;
	days_inactive: number;
};

export async function listPlayerActivityCandidates(
	db: D1Database,
	guildId: string,
): Promise<PlayerActivityCandidate[]> {
	const { results } = await db
		.prepare(
			`SELECT
				player_id,
				discord_user_id,
				player_name,
				alliance_tag,
				activity_streak,
				days_inactive
			 FROM (
				SELECT
					vp.player_id AS player_id,
					vp.discord_user_id AS discord_user_id,
					vp.player_name AS player_name,
					vp.alliance_tag AS alliance_tag,
					vp.activity_streak AS activity_streak,
					vp.days_inactive AS days_inactive
				FROM verified_players vp
				WHERE vp.guild_id = ?
				  AND vp.verification_status IN ('verified', 'active', 'guest')
				  AND (vp.player_name IS NOT NULL OR vp.player_id IS NOT NULL)
				UNION ALL
				SELECT
					arm.player_id AS player_id,
					NULL AS discord_user_id,
					arm.player_name AS player_name,
					arm.alliance_tag AS alliance_tag,
					arm.activity_streak AS activity_streak,
					arm.days_inactive AS days_inactive
				FROM alliance_roster_members arm
				WHERE arm.guild_id = ?
				  AND NOT EXISTS (
				    SELECT 1 FROM verified_players vp2
				    WHERE vp2.guild_id = arm.guild_id
				      AND vp2.player_id = arm.player_id
				      AND vp2.verification_status IN ('verified', 'active', 'guest')
				  )
			 )`,
		)
		.bind(guildId, guildId)
		.all();

	return (results ?? []).map((row) => {
		const r = row as Record<string, unknown>;
		return {
			player_id: r.player_id != null ? Number(r.player_id) : null,
			discord_user_id: r.discord_user_id != null ? String(r.discord_user_id) : null,
			player_name: r.player_name != null ? String(r.player_name) : null,
			alliance_tag: r.alliance_tag != null ? String(r.alliance_tag) : null,
			activity_streak: r.activity_streak != null ? Number(r.activity_streak) : null,
			days_inactive: Number(r.days_inactive ?? 0) || 0,
		};
	});
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
 * Verified players who still need CoC acceptance for the current agreement_version
 * (or any version if guild has no version set — only those with null agreement_accepted_at).
 */
export async function listPlayersMissingAgreement(
	db: D1Database,
	guildId: string,
	requiredVersion: string | null | undefined,
): Promise<VerifiedPlayer[]> {
	const required = requiredVersion?.trim() || null;
	const { results } = await db
		.prepare(
			required
				? `SELECT * FROM verified_players
				   WHERE guild_id = ?
				     AND verification_status IN ('verified', 'active', 'guest')
				     AND player_id IS NOT NULL
				     AND (
				       agreement_accepted_at IS NULL
				       OR agreement_version IS NULL
				       OR TRIM(agreement_version) = ''
				       OR agreement_version != ?
				     )
				   ORDER BY LOWER(COALESCE(player_name, ''))`
				: `SELECT * FROM verified_players
				   WHERE guild_id = ?
				     AND verification_status IN ('verified', 'active', 'guest')
				     AND player_id IS NOT NULL
				     AND agreement_accepted_at IS NULL
				   ORDER BY LOWER(COALESCE(player_name, ''))`,
		)
		.bind(...(required ? [guildId, required] : [guildId]))
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

/**
 * Active/verified players who still qualify for the hybrid welcome DM auto-send
 * (no success stamp yet; under the attempt cap). Caller should also filter CoC hold.
 */
export async function listPlayersNeedingWelcomeDm(
	db: D1Database,
	guildId: string,
	maxAttempts = 2,
): Promise<VerifiedPlayer[]> {
	const cap = Math.max(0, Math.floor(Number(maxAttempts) || 0));
	const { results } = await db
		.prepare(
			`SELECT * FROM verified_players
			 WHERE guild_id = ?
			   AND verification_status IN ('verified', 'active')
			   AND player_id IS NOT NULL
			   AND welcome_dm_sent_at IS NULL
			   AND COALESCE(welcome_dm_attempts, 0) < ?
			 ORDER BY LOWER(COALESCE(player_name, discord_user_id))`,
		)
		.bind(guildId, cap)
		.all();
	return (results ?? []).map(mapVerifiedPlayer);
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
	opts?: { includeGuests?: boolean },
): Promise<Array<{ grade: number; count: number }>> {
	const includeGuests = opts?.includeGuests !== false;
	const statuses = includeGuests ? `('verified', 'active', 'guest')` : `('verified', 'active')`;
	const { results } = await db
		.prepare(
			`SELECT grade, COUNT(*) AS count FROM verified_players
			 WHERE guild_id = ?
			 AND verification_status IN ${statuses}
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

/** Grade counts including alliance-roster members not on Discord; excludes guests. */
export async function countMergedPlayersByGrade(
	db: D1Database,
	guildId: string,
): Promise<Array<{ grade: number; count: number }>> {
	const { results } = await db
		.prepare(
			`SELECT grade, COUNT(*) AS count FROM (
				SELECT vp.grade
				FROM verified_players vp
				WHERE vp.guild_id = ?
				  AND vp.verification_status IN ('verified', 'active')
				  AND vp.grade IS NOT NULL
				UNION ALL
				SELECT arm.grade
				FROM alliance_roster_members arm
				WHERE arm.guild_id = ?
				  AND arm.grade IS NOT NULL
				  AND NOT EXISTS (
				    SELECT 1 FROM verified_players vp2
				    WHERE vp2.guild_id = arm.guild_id
				      AND vp2.player_id = arm.player_id
				      AND vp2.verification_status IN ('verified', 'active', 'guest')
				  )
			)
			GROUP BY grade
			ORDER BY grade`,
		)
		.bind(guildId, guildId)
		.all();
	return (results ?? []).map((r) => ({
		grade: Number((r as { grade: number }).grade),
		count: Number((r as { count: number }).count),
	}));
}

/** Alliance tag counts including roster members not on Discord; excludes guests. */
export async function countMergedPlayersByAlliance(
	db: D1Database,
	guildId: string,
): Promise<Array<{ alliance_tag: string; count: number }>> {
	const { results } = await db
		.prepare(
			`SELECT alliance_tag, COUNT(*) AS count FROM (
				SELECT COALESCE(NULLIF(TRIM(vp.alliance_tag), ''), '—') AS alliance_tag
				FROM verified_players vp
				WHERE vp.guild_id = ?
				  AND vp.verification_status IN ('verified', 'active')
				UNION ALL
				SELECT COALESCE(NULLIF(TRIM(arm.alliance_tag), ''), '—') AS alliance_tag
				FROM alliance_roster_members arm
				WHERE arm.guild_id = ?
				  AND NOT EXISTS (
				    SELECT 1 FROM verified_players vp2
				    WHERE vp2.guild_id = arm.guild_id
				      AND vp2.player_id = arm.player_id
				      AND vp2.verification_status IN ('verified', 'active', 'guest')
				  )
			)
			GROUP BY alliance_tag
			ORDER BY count DESC`,
		)
		.bind(guildId, guildId)
		.all();
	return (results ?? []).map((r) => ({
		alliance_tag: String((r as { alliance_tag: string }).alliance_tag),
		count: Number((r as { count: number }).count),
	}));
}

export async function countPlayersByGradeAndAlliance(
	db: D1Database,
	guildId: string,
	opts?: { includeGuests?: boolean },
): Promise<Array<{ alliance_tag: string; grade: number; count: number }>> {
	const includeGuests = opts?.includeGuests !== false;
	const statuses = includeGuests ? `('verified', 'active', 'guest')` : `('verified', 'active')`;
	const { results } = await db
		.prepare(
			`SELECT COALESCE(NULLIF(TRIM(alliance_tag), ''), '—') AS alliance_tag,
			        grade,
			        COUNT(*) AS count
			 FROM verified_players
			 WHERE guild_id = ?
			 AND verification_status IN ${statuses}
			 AND grade IS NOT NULL
			 GROUP BY COALESCE(NULLIF(TRIM(alliance_tag), ''), '—'), grade
			 ORDER BY alliance_tag COLLATE NOCASE, grade`,
		)
		.bind(guildId)
		.all();
	return (results ?? []).map((r) => ({
		alliance_tag: String((r as { alliance_tag: string }).alliance_tag),
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
	opts?: { includeGuests?: boolean },
): Promise<Array<{ alliance_tag: string; count: number }>> {
	const includeGuests = opts?.includeGuests !== false;
	const statuses = includeGuests ? `('verified', 'active', 'guest')` : `('verified', 'active')`;
	const { results } = await db
		.prepare(
			`SELECT COALESCE(alliance_tag, '—') AS alliance_tag, COUNT(*) AS count
			 FROM verified_players
			 WHERE guild_id = ?
			 AND verification_status IN ${statuses}
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

/** Verified players with optional grade / ops / alliance-rank filters (active roster only). */
export type RosterPlayerSort = 'ops' | 'name' | 'streak' | 'inactive' | 'grade';

export type RosterPlayerFilters = {
	grade?: number;
	opsMin?: number;
	opsMax?: number;
	allianceRank?: string;
	status?: VerificationStatus;
	includeGuests?: boolean;
	daysInactiveMin?: number;
	limit?: number;
	offset?: number;
	sort?: RosterPlayerSort;
};

function rosterPlayerWhere(
	guildId: string,
	filters?: Omit<RosterPlayerFilters, 'limit' | 'offset' | 'sort'>,
): { clauses: string[]; binds: Array<string | number> } {
	const includeGuests = filters?.includeGuests !== false;
	const clauses = [
		`guild_id = ?`,
		includeGuests
			? `verification_status IN ('verified', 'active', 'guest')`
			: `verification_status IN ('verified', 'active')`,
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
	if (filters?.allianceRank?.trim()) {
		clauses.push(`LOWER(TRIM(alliance_rank)) = LOWER(?)`);
		binds.push(filters.allianceRank.trim());
	}
	if (filters?.status) {
		clauses.push(`verification_status = ?`);
		binds.push(filters.status);
	}
	if (filters?.daysInactiveMin != null) {
		clauses.push(`days_inactive >= ?`);
		binds.push(filters.daysInactiveMin);
	}
	return { clauses, binds };
}

function rosterPlayerOrderBy(sort?: RosterPlayerSort, daysInactiveMin?: number): string {
	const resolved =
		sort ??
		(daysInactiveMin != null ? 'inactive' : 'ops');
	switch (resolved) {
		case 'name':
			return `player_name COLLATE NOCASE ASC, (ops_level IS NULL), ops_level DESC`;
		case 'streak':
			return `(activity_streak IS NULL), activity_streak DESC, player_name COLLATE NOCASE`;
		case 'inactive':
			return `days_inactive DESC, (ops_level IS NULL), ops_level DESC, player_name COLLATE NOCASE`;
		case 'grade':
			return `(grade IS NULL), grade DESC, (ops_level IS NULL), ops_level DESC, player_name COLLATE NOCASE`;
		case 'ops':
		default:
			return `(ops_level IS NULL), ops_level DESC, player_name COLLATE NOCASE`;
	}
}

export async function countRosterPlayers(
	db: D1Database,
	guildId: string,
	filters?: Omit<RosterPlayerFilters, 'limit' | 'offset' | 'sort'>,
): Promise<number> {
	const { clauses, binds } = rosterPlayerWhere(guildId, filters);
	const row = await db
		.prepare(`SELECT COUNT(*) AS c FROM verified_players WHERE ${clauses.join(' AND ')}`)
		.bind(...binds)
		.first();
	return Number((row as { c?: number } | null)?.c ?? 0);
}

export async function listRosterPlayers(
	db: D1Database,
	guildId: string,
	filters?: RosterPlayerFilters,
): Promise<VerifiedPlayer[]> {
	const { clauses, binds } = rosterPlayerWhere(guildId, filters);
	const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 500);
	const offset = Math.max(0, Math.floor(filters?.offset ?? 0));
	const orderBy = rosterPlayerOrderBy(filters?.sort, filters?.daysInactiveMin);

	const { results } = await db
		.prepare(
			`SELECT * FROM verified_players
			 WHERE ${clauses.join(' AND ')}
			 ORDER BY ${orderBy}
			 LIMIT ? OFFSET ?`,
		)
		.bind(...binds, limit, offset)
		.all();
	return (results ?? []).map(mapVerifiedPlayer);
}

/** Unified row for Discord-linked players and alliance-cache members not on Discord. */
export type MergedRosterRow = {
	player_name: string | null;
	alliance_tag: string | null;
	alliance_rank: string | null;
	ops_level: number | null;
	power: number | null;
	grade: number | null;
	activity_streak: number | null;
	days_inactive: number;
	status: string;
	on_discord: boolean;
	discord_user_id: string | null;
	player_id: number | null;
};

export type MergedRosterFilters = Omit<RosterPlayerFilters, 'status'> & {
	/** When true, include alliance_roster_members with no Discord link. Default false in callers. */
	includeUnlinked?: boolean;
};

function mergedRosterOrderBy(sort?: RosterPlayerSort, daysInactiveMin?: number): string {
	const resolved = sort ?? (daysInactiveMin != null ? 'inactive' : 'ops');
	switch (resolved) {
		case 'name':
			return `player_name COLLATE NOCASE ASC, (ops_level IS NULL), ops_level DESC`;
		case 'streak':
			return `(activity_streak IS NULL), activity_streak DESC, player_name COLLATE NOCASE`;
		case 'inactive':
			return `days_inactive DESC, (ops_level IS NULL), ops_level DESC, player_name COLLATE NOCASE`;
		case 'grade':
			return `(grade IS NULL), grade DESC, (ops_level IS NULL), ops_level DESC, player_name COLLATE NOCASE`;
		case 'ops':
		default:
			return `(ops_level IS NULL), ops_level DESC, player_name COLLATE NOCASE`;
	}
}

function mapMergedRosterRow(row: Record<string, unknown>): MergedRosterRow {
	return {
		player_name: row.player_name != null ? String(row.player_name) : null,
		alliance_tag: row.alliance_tag != null ? String(row.alliance_tag) : null,
		alliance_rank: row.alliance_rank != null ? String(row.alliance_rank) : null,
		ops_level: row.ops_level != null ? Number(row.ops_level) : null,
		power: row.power != null ? Number(row.power) : null,
		grade: row.grade != null ? Number(row.grade) : null,
		activity_streak: row.activity_streak != null ? Number(row.activity_streak) : null,
		days_inactive: Number(row.days_inactive ?? 0) || 0,
		status: String(row.status ?? '—'),
		on_discord: Number(row.on_discord ?? 0) === 1,
		discord_user_id: row.discord_user_id != null ? String(row.discord_user_id) : null,
		player_id: row.player_id != null ? Number(row.player_id) : null,
	};
}

/**
 * List verified Discord players, optionally UNION alliance-cache members with no Discord link.
 * Unlinked rows use status `unlinked`, on_discord=0; inactive days for them are 1 when streak is 0 else 0.
 */
export async function countMergedRosterPlayers(
	db: D1Database,
	guildId: string,
	filters?: MergedRosterFilters,
): Promise<number> {
	const includeUnlinked = filters?.includeUnlinked === true;
	if (!includeUnlinked) {
		return countRosterPlayers(db, guildId, filters);
	}

	const vp = rosterPlayerWhere(guildId, filters);
	const armClauses = [`arm.guild_id = ?`];
	const armBinds: Array<string | number> = [guildId];
	if (filters?.grade != null) {
		armClauses.push(`arm.grade = ?`);
		armBinds.push(filters.grade);
	}
	if (filters?.opsMin != null) {
		armClauses.push(`arm.ops_level >= ?`);
		armBinds.push(filters.opsMin);
	}
	if (filters?.opsMax != null) {
		armClauses.push(`arm.ops_level <= ?`);
		armBinds.push(filters.opsMax);
	}
	if (filters?.allianceRank?.trim()) {
		armClauses.push(`LOWER(TRIM(arm.alliance_rank)) = LOWER(?)`);
		armBinds.push(filters.allianceRank.trim());
	}
	if (filters?.daysInactiveMin != null) {
		armClauses.push(`arm.days_inactive >= ?`);
		armBinds.push(filters.daysInactiveMin);
	}

	const row = await db
		.prepare(
			`SELECT COUNT(*) AS c FROM (
				SELECT vp.discord_user_id AS id
				FROM verified_players vp
				WHERE ${vp.clauses.join(' AND ')}
				UNION ALL
				SELECT CAST(arm.player_id AS TEXT) AS id
				FROM alliance_roster_members arm
				WHERE ${armClauses.join(' AND ')}
				  AND NOT EXISTS (
				    SELECT 1 FROM verified_players vp2
				    WHERE vp2.guild_id = arm.guild_id
				      AND vp2.player_id = arm.player_id
				      AND vp2.verification_status IN ('verified', 'active', 'guest')
				  )
			)`,
		)
		.bind(...vp.binds, ...armBinds)
		.first();
	return Number((row as { c?: number } | null)?.c ?? 0);
}

export async function listMergedRosterPlayers(
	db: D1Database,
	guildId: string,
	filters?: MergedRosterFilters,
): Promise<MergedRosterRow[]> {
	const includeUnlinked = filters?.includeUnlinked === true;
	const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 500);
	const offset = Math.max(0, Math.floor(filters?.offset ?? 0));
	const orderBy = mergedRosterOrderBy(filters?.sort, filters?.daysInactiveMin);

	if (!includeUnlinked) {
		const players = await listRosterPlayers(db, guildId, filters);
		return players.map((p) => ({
			player_name: p.player_name,
			alliance_tag: p.alliance_tag,
			alliance_rank: p.alliance_rank,
			ops_level: p.ops_level,
			power: p.power,
			grade: p.grade,
			activity_streak: p.activity_streak,
			days_inactive: p.days_inactive,
			status: p.verification_status,
			on_discord: true,
			discord_user_id: p.discord_user_id,
			player_id: p.player_id,
		}));
	}

	const vp = rosterPlayerWhere(guildId, filters);
	const armClauses = [`arm.guild_id = ?`];
	const armBinds: Array<string | number> = [guildId];
	if (filters?.grade != null) {
		armClauses.push(`arm.grade = ?`);
		armBinds.push(filters.grade);
	}
	if (filters?.opsMin != null) {
		armClauses.push(`arm.ops_level >= ?`);
		armBinds.push(filters.opsMin);
	}
	if (filters?.opsMax != null) {
		armClauses.push(`arm.ops_level <= ?`);
		armBinds.push(filters.opsMax);
	}
	if (filters?.allianceRank?.trim()) {
		armClauses.push(`LOWER(TRIM(arm.alliance_rank)) = LOWER(?)`);
		armBinds.push(filters.allianceRank.trim());
	}
	if (filters?.daysInactiveMin != null) {
		armClauses.push(`arm.days_inactive >= ?`);
		armBinds.push(filters.daysInactiveMin);
	}

	const { results } = await db
		.prepare(
			`SELECT * FROM (
				SELECT
					vp.player_name AS player_name,
					vp.alliance_tag AS alliance_tag,
					vp.alliance_rank AS alliance_rank,
					vp.ops_level AS ops_level,
					vp.power AS power,
					vp.grade AS grade,
					vp.activity_streak AS activity_streak,
					vp.days_inactive AS days_inactive,
					vp.verification_status AS status,
					1 AS on_discord,
					vp.discord_user_id AS discord_user_id,
					vp.player_id AS player_id
				FROM verified_players vp
				WHERE ${vp.clauses.join(' AND ')}
				UNION ALL
				SELECT
					arm.player_name AS player_name,
					arm.alliance_tag AS alliance_tag,
					arm.alliance_rank AS alliance_rank,
					arm.ops_level AS ops_level,
					arm.power AS power,
					arm.grade AS grade,
					arm.activity_streak AS activity_streak,
					arm.days_inactive AS days_inactive,
					'unlinked' AS status,
					0 AS on_discord,
					NULL AS discord_user_id,
					arm.player_id AS player_id
				FROM alliance_roster_members arm
				WHERE ${armClauses.join(' AND ')}
				  AND NOT EXISTS (
				    SELECT 1 FROM verified_players vp2
				    WHERE vp2.guild_id = arm.guild_id
				      AND vp2.player_id = arm.player_id
				      AND vp2.verification_status IN ('verified', 'active', 'guest')
				  )
			)
			ORDER BY ${orderBy}
			LIMIT ? OFFSET ?`,
		)
		.bind(...vp.binds, ...armBinds, limit, offset)
		.all();

	return (results ?? []).map((r) => mapMergedRosterRow(r as Record<string, unknown>));
}

export async function countPlayersByAllianceRank(
	db: D1Database,
	guildId: string,
): Promise<Array<{ alliance_rank: string; count: number }>> {
	const { results } = await db
		.prepare(
			`SELECT COALESCE(NULLIF(TRIM(alliance_rank), ''), '—') AS alliance_rank, COUNT(*) AS count
			 FROM verified_players
			 WHERE guild_id = ?
			   AND verification_status IN ('verified', 'active', 'guest')
			 GROUP BY COALESCE(NULLIF(TRIM(alliance_rank), ''), '—')
			 ORDER BY count DESC, alliance_rank COLLATE NOCASE`,
		)
		.bind(guildId)
		.all();
	return (results ?? []).map((row) => {
		const r = row as Record<string, unknown>;
		return {
			alliance_rank: String(r.alliance_rank ?? '—'),
			count: Number(r.count ?? 0),
		};
	});
}

/**
 * Alliance scrape members whose player_id is not linked on this Discord guild
 * (active/guest/verified). Requires a prior alliance roster scrape.
 */
export async function listAllianceMembersMissingVerify(
	db: D1Database,
	guildId: string,
	opts?: {
		limit?: number;
		offset?: number;
		sort?: 'ops' | 'name' | 'rank';
	},
): Promise<AllianceRosterMemberRow[]> {
	const cap = Math.min(Math.max(opts?.limit ?? 100, 1), 200);
	const offset = Math.max(0, Math.floor(opts?.offset ?? 0));
	const sort = opts?.sort ?? 'ops';
	const orderBy =
		sort === 'name'
			? `arm.player_name COLLATE NOCASE ASC, (arm.ops_level IS NULL), arm.ops_level DESC`
			: sort === 'rank'
				? `arm.alliance_rank COLLATE NOCASE ASC, (arm.ops_level IS NULL), arm.ops_level DESC`
				: `(arm.ops_level IS NULL), arm.ops_level DESC, arm.player_name COLLATE NOCASE`;
	const { results } = await db
		.prepare(
			`SELECT arm.*
			 FROM alliance_roster_members arm
			 WHERE arm.guild_id = ?
			   AND NOT EXISTS (
			     SELECT 1 FROM verified_players vp
			     WHERE vp.guild_id = arm.guild_id
			       AND vp.player_id = arm.player_id
			       AND vp.verification_status IN ('verified', 'active', 'guest')
			   )
			 ORDER BY ${orderBy}
			 LIMIT ? OFFSET ?`,
		)
		.bind(guildId, cap, offset)
		.all();
	return (results ?? []).map((row) => mapAllianceRosterMemberRow(row as Record<string, unknown>));
}

export async function countAllianceMembersMissingVerify(
	db: D1Database,
	guildId: string,
): Promise<number> {
	const row = await db
		.prepare(
			`SELECT COUNT(*) AS c
			 FROM alliance_roster_members arm
			 WHERE arm.guild_id = ?
			   AND NOT EXISTS (
			     SELECT 1 FROM verified_players vp
			     WHERE vp.guild_id = arm.guild_id
			       AND vp.player_id = arm.player_id
			       AND vp.verification_status IN ('verified', 'active', 'guest')
			   )`,
		)
		.bind(guildId)
		.first();
	return Number((row as { c?: number } | null)?.c ?? 0);
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

function mapDemotionQueueRow(row: Record<string, unknown>): DemotionQueueRow {
	return {
		id: Number(row.id),
		guild_id: String(row.guild_id),
		discord_user_id: String(row.discord_user_id),
		player_id: row.player_id == null ? null : Number(row.player_id),
		player_name: row.player_name == null ? null : String(row.player_name),
		reason: row.reason as DemotionQueueReason,
		status: row.status as DemotionQueueStatus,
		detect_count: Number(row.detect_count ?? 1),
		first_detected_at: String(row.first_detected_at ?? ''),
		next_recheck_at: row.next_recheck_at == null ? null : String(row.next_recheck_at),
		resolved_at: row.resolved_at == null ? null : String(row.resolved_at),
		urgent_message_id: row.urgent_message_id == null ? null : String(row.urgent_message_id),
		observed_alliance_tag:
			row.observed_alliance_tag == null ? null : String(row.observed_alliance_tag),
	};
}

export async function upsertDemotionQueueEntry(
	db: D1Database,
	entry: {
		guild_id: string;
		discord_user_id: string;
		player_id?: number | null;
		player_name?: string | null;
		reason: DemotionQueueReason;
		status: DemotionQueueStatus;
		next_recheck_at?: string | null;
		observed_alliance_tag?: string | null;
		urgent_message_id?: string | null;
	},
): Promise<DemotionQueueRow> {
	const existing = await db
		.prepare(
			`SELECT * FROM demotion_queue WHERE guild_id = ? AND discord_user_id = ?`,
		)
		.bind(entry.guild_id, entry.discord_user_id)
		.first();

	if (existing) {
		const prev = mapDemotionQueueRow(existing as Record<string, unknown>);
		const bumpDetect =
			prev.status === 'pending_recheck' ||
			prev.status === 'pending_approval' ||
			entry.status === 'pending_recheck' ||
			entry.status === 'pending_approval';
		await db
			.prepare(
				`UPDATE demotion_queue SET
				 player_id = COALESCE(?, player_id),
				 player_name = COALESCE(?, player_name),
				 reason = ?,
				 status = ?,
				 detect_count = CASE WHEN ? = 1 THEN detect_count + 1 ELSE detect_count END,
				 next_recheck_at = CASE WHEN ? = 1 THEN ? ELSE next_recheck_at END,
				 observed_alliance_tag = COALESCE(?, observed_alliance_tag),
				 urgent_message_id = COALESCE(?, urgent_message_id),
				 resolved_at = CASE WHEN ? IN ('completed','rejected','cancelled') THEN datetime('now') ELSE resolved_at END
				 WHERE guild_id = ? AND discord_user_id = ?`,
			)
			.bind(
				entry.player_id ?? null,
				entry.player_name ?? null,
				entry.reason,
				entry.status,
				bumpDetect &&
					(entry.status === 'pending_recheck' || entry.status === 'pending_approval')
					? 1
					: 0,
				entry.next_recheck_at !== undefined ? 1 : 0,
				entry.next_recheck_at ?? null,
				entry.observed_alliance_tag ?? null,
				entry.urgent_message_id ?? null,
				entry.status,
				entry.guild_id,
				entry.discord_user_id,
			)
			.run();
	} else {
		await db
			.prepare(
				`INSERT INTO demotion_queue
				 (guild_id, discord_user_id, player_id, player_name, reason, status,
				  next_recheck_at, observed_alliance_tag, urgent_message_id)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				entry.guild_id,
				entry.discord_user_id,
				entry.player_id ?? null,
				entry.player_name ?? null,
				entry.reason,
				entry.status,
				entry.next_recheck_at ?? null,
				entry.observed_alliance_tag ?? null,
				entry.urgent_message_id ?? null,
			)
			.run();
	}

	const row = await db
		.prepare(
			`SELECT * FROM demotion_queue WHERE guild_id = ? AND discord_user_id = ?`,
		)
		.bind(entry.guild_id, entry.discord_user_id)
		.first();
	return mapDemotionQueueRow(row as Record<string, unknown>);
}

export async function listPendingDemotions(
	db: D1Database,
	guildId: string,
): Promise<DemotionQueueRow[]> {
	const { results } = await db
		.prepare(
			`SELECT * FROM demotion_queue
			 WHERE guild_id = ?
			   AND status IN ('pending_recheck', 'pending_approval')
			 ORDER BY first_detected_at ASC`,
		)
		.bind(guildId)
		.all();
	return (results ?? []).map((r) => mapDemotionQueueRow(r as Record<string, unknown>));
}

export async function listPendingApprovalDemotions(
	db: D1Database,
	guildId: string,
): Promise<DemotionQueueRow[]> {
	const { results } = await db
		.prepare(
			`SELECT * FROM demotion_queue
			 WHERE guild_id = ? AND status = 'pending_approval'
			 ORDER BY first_detected_at ASC`,
		)
		.bind(guildId)
		.all();
	return (results ?? []).map((r) => mapDemotionQueueRow(r as Record<string, unknown>));
}

export async function listDueDemotionRechecks(db: D1Database): Promise<DemotionQueueRow[]> {
	const { results } = await db
		.prepare(
			`SELECT * FROM demotion_queue
			 WHERE status = 'pending_recheck'
			   AND next_recheck_at IS NOT NULL
			   AND next_recheck_at <= datetime('now')
			 ORDER BY next_recheck_at ASC
			 LIMIT 200`,
		)
		.all();
	return (results ?? []).map((r) => mapDemotionQueueRow(r as Record<string, unknown>));
}

export async function cancelDemotionQueueEntry(
	db: D1Database,
	guildId: string,
	discordUserId: string,
): Promise<void> {
	await db
		.prepare(
			`UPDATE demotion_queue SET
			 status = 'cancelled',
			 resolved_at = datetime('now')
			 WHERE guild_id = ? AND discord_user_id = ?
			   AND status IN ('pending_recheck', 'pending_approval')`,
		)
		.bind(guildId, discordUserId)
		.run();
}

export async function resolveDemotionQueueEntries(
	db: D1Database,
	guildId: string,
	status: 'completed' | 'rejected' | 'cancelled',
	discordUserIds?: string[],
): Promise<number> {
	if (discordUserIds && discordUserIds.length > 0) {
		let n = 0;
		for (const userId of discordUserIds) {
			const r = await db
				.prepare(
					`UPDATE demotion_queue SET
					 status = ?,
					 resolved_at = datetime('now')
					 WHERE guild_id = ? AND discord_user_id = ?
					   AND status IN ('pending_recheck', 'pending_approval')`,
				)
				.bind(status, guildId, userId)
				.run();
			n += r.meta?.changes ?? 0;
		}
		return n;
	}
	const r = await db
		.prepare(
			`UPDATE demotion_queue SET
			 status = ?,
			 resolved_at = datetime('now')
			 WHERE guild_id = ?
			   AND status IN ('pending_recheck', 'pending_approval')`,
		)
		.bind(status, guildId)
		.run();
	return r.meta?.changes ?? 0;
}

export async function setDemotionQueueUrgentMessage(
	db: D1Database,
	guildId: string,
	messageId: string,
): Promise<void> {
	await db
		.prepare(
			`UPDATE demotion_queue SET urgent_message_id = ?
			 WHERE guild_id = ? AND status = 'pending_approval'`,
		)
		.bind(messageId, guildId)
		.run();
}

export async function setGuildStfcAllianceId(
	db: D1Database,
	guildId: string,
	allianceId: string | null,
): Promise<void> {
	await db
		.prepare(
			`UPDATE guild_configs SET stfc_alliance_id = ?, updated_at = datetime('now') WHERE guild_id = ?`,
		)
		.bind(allianceId, guildId)
		.run();
}

/** Drop cached alliance roster rows (e.g. when switching to multi_alliance). */
export async function clearAllianceRoster(db: D1Database, guildId: string): Promise<void> {
	await db.batch([
		db.prepare(`DELETE FROM alliance_roster_members WHERE guild_id = ?`).bind(guildId),
		db.prepare(`DELETE FROM alliance_roster_meta WHERE guild_id = ?`).bind(guildId),
		db.prepare(`DELETE FROM server_alliance_directory WHERE guild_id = ?`).bind(guildId),
	]);
}


export interface AllianceRosterMemberRow {
	guild_id: string;
	player_id: number;
	player_name: string | null;
	alliance_tag: string | null;
	alliance_id: string | null;
	alliance_rank: string | null;
	ops_level: number | null;
	power: number | null;
	grade: number | null;
	join_date: string | null;
	activity_streak: number | null;
	/** Days observed with streak 0 on morning alliance scrapes. */
	days_inactive: number;
	fetched_at: string;
}

export interface AllianceRosterMetaRow {
	guild_id: string;
	alliance_id: string;
	alliance_tag: string | null;
	alliance_name: string | null;
	player_count: number;
	fetched_at: string;
}

export async function getAllianceRosterMeta(
	db: D1Database,
	guildId: string,
	allianceId?: string,
): Promise<AllianceRosterMetaRow | null> {
	const row = allianceId
		? await db
				.prepare(`SELECT * FROM alliance_roster_meta WHERE guild_id = ? AND alliance_id = ?`)
				.bind(guildId, allianceId)
				.first()
		: await db
				.prepare(
					`SELECT * FROM alliance_roster_meta WHERE guild_id = ? ORDER BY fetched_at DESC LIMIT 1`,
				)
				.bind(guildId)
				.first();
	if (!row) return null;
	const r = row as Record<string, unknown>;
	return {
		guild_id: String(r.guild_id),
		alliance_id: String(r.alliance_id),
		alliance_tag: r.alliance_tag != null ? String(r.alliance_tag) : null,
		alliance_name: r.alliance_name != null ? String(r.alliance_name) : null,
		player_count: Number(r.player_count ?? 0),
		fetched_at: String(r.fetched_at),
	};
}

export async function listAllianceRosterMeta(
	db: D1Database,
	guildId: string,
): Promise<AllianceRosterMetaRow[]> {
	const { results } = await db
		.prepare(`SELECT * FROM alliance_roster_meta WHERE guild_id = ? ORDER BY alliance_tag COLLATE NOCASE`)
		.bind(guildId)
		.all();
	return (results ?? []).map((row) => {
		const r = row as Record<string, unknown>;
		return {
			guild_id: String(r.guild_id),
			alliance_id: String(r.alliance_id),
			alliance_tag: r.alliance_tag != null ? String(r.alliance_tag) : null,
			alliance_name: r.alliance_name != null ? String(r.alliance_name) : null,
			player_count: Number(r.player_count ?? 0),
			fetched_at: String(r.fetched_at),
		};
	});
}

/** Newest roster fetch time for the guild (any alliance). */
export async function getAllianceRosterLatestFetchedAt(
	db: D1Database,
	guildId: string,
): Promise<string | null> {
	const row = await db
		.prepare(`SELECT MAX(fetched_at) AS fetched_at FROM alliance_roster_meta WHERE guild_id = ?`)
		.bind(guildId)
		.first();
	const v = (row as { fetched_at?: string | null } | null)?.fetched_at;
	return v != null ? String(v) : null;
}

function mapAllianceRosterMemberRow(row: Record<string, unknown>): AllianceRosterMemberRow {
	return {
		guild_id: String(row.guild_id),
		player_id: Number(row.player_id),
		player_name: row.player_name != null ? String(row.player_name) : null,
		alliance_tag: row.alliance_tag != null ? String(row.alliance_tag) : null,
		alliance_id: row.alliance_id != null ? String(row.alliance_id) : null,
		alliance_rank: row.alliance_rank != null ? String(row.alliance_rank) : null,
		ops_level: row.ops_level != null ? Number(row.ops_level) : null,
		power: row.power != null ? Number(row.power) : null,
		grade: row.grade != null ? Number(row.grade) : null,
		join_date: row.join_date != null ? String(row.join_date) : null,
		activity_streak: row.activity_streak != null ? Number(row.activity_streak) : null,
		days_inactive: Number(row.days_inactive ?? 0) || 0,
		fetched_at: String(row.fetched_at),
	};
}

export async function getAllianceRosterMember(
	db: D1Database,
	guildId: string,
	playerId: number,
): Promise<AllianceRosterMemberRow | null> {
	const row = await db
		.prepare(`SELECT * FROM alliance_roster_members WHERE guild_id = ? AND player_id = ?`)
		.bind(guildId, playerId)
		.first();
	if (!row) return null;
	return mapAllianceRosterMemberRow(row as Record<string, unknown>);
}

export async function getAllianceRosterMemberByName(
	db: D1Database,
	guildId: string,
	playerName: string,
): Promise<AllianceRosterMemberRow | null> {
	const row = await db
		.prepare(
			`SELECT * FROM alliance_roster_members
			 WHERE guild_id = ? AND LOWER(player_name) = LOWER(?)
			 LIMIT 1`,
		)
		.bind(guildId, playerName.trim())
		.first();
	if (!row) return null;
	return mapAllianceRosterMemberRow(row as Record<string, unknown>);
}

export async function listAllianceRosterMembers(
	db: D1Database,
	guildId: string,
): Promise<AllianceRosterMemberRow[]> {
	const { results } = await db
		.prepare(`SELECT * FROM alliance_roster_members WHERE guild_id = ?`)
		.bind(guildId)
		.all();
	return (results ?? []).map((row) => mapAllianceRosterMemberRow(row as Record<string, unknown>));
}

/**
 * Replace roster rows for one alliance.
 * - `scope: 'guild'` (single-alliance): wipe all guild members/meta, then write this alliance.
 * - `scope: 'alliance'` (multi): replace only this alliance_id's members + meta row.
 */
export async function replaceAllianceRoster(
	db: D1Database,
	opts: {
		guildId: string;
		allianceId: string;
		allianceTag: string | null;
		allianceName: string | null;
		fetchedAt: string;
		scope?: 'guild' | 'alliance';
		members: Array<{
			playerId: number;
			playerName: string;
			allianceTag: string;
			allianceId: string;
			allianceRank: string;
			opsLevel: number;
			power: number;
			grade: number | null;
			joinDate: string;
			activityStreak?: number | null;
			daysInactive?: number;
		}>;
	},
): Promise<void> {
	const scope = opts.scope ?? 'guild';
	const stmts: D1PreparedStatement[] = [];

	if (scope === 'guild') {
		stmts.push(db.prepare(`DELETE FROM alliance_roster_members WHERE guild_id = ?`).bind(opts.guildId));
		stmts.push(db.prepare(`DELETE FROM alliance_roster_meta WHERE guild_id = ?`).bind(opts.guildId));
	} else {
		stmts.push(
			db
				.prepare(`DELETE FROM alliance_roster_members WHERE guild_id = ? AND alliance_id = ?`)
				.bind(opts.guildId, opts.allianceId),
		);
	}

	stmts.push(
		db
			.prepare(
				`INSERT INTO alliance_roster_meta
				 (guild_id, alliance_id, alliance_tag, alliance_name, player_count, fetched_at)
				 VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT(guild_id, alliance_id) DO UPDATE SET
				   alliance_tag = excluded.alliance_tag,
				   alliance_name = excluded.alliance_name,
				   player_count = excluded.player_count,
				   fetched_at = excluded.fetched_at`,
			)
			.bind(
				opts.guildId,
				opts.allianceId,
				opts.allianceTag,
				opts.allianceName,
				opts.members.length,
				opts.fetchedAt,
			),
	);

	for (const m of opts.members) {
		const daysInactive = Math.max(0, Math.floor(Number(m.daysInactive ?? 0) || 0));
		stmts.push(
			db
				.prepare(
					`INSERT INTO alliance_roster_members
					 (guild_id, player_id, player_name, alliance_tag, alliance_id, alliance_rank,
					  ops_level, power, grade, join_date, activity_streak, days_inactive, fetched_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
					 ON CONFLICT(guild_id, player_id) DO UPDATE SET
					   player_name = excluded.player_name,
					   alliance_tag = excluded.alliance_tag,
					   alliance_id = excluded.alliance_id,
					   alliance_rank = excluded.alliance_rank,
					   ops_level = excluded.ops_level,
					   power = excluded.power,
					   grade = excluded.grade,
					   join_date = excluded.join_date,
					   activity_streak = excluded.activity_streak,
					   days_inactive = excluded.days_inactive,
					   fetched_at = excluded.fetched_at`,
				)
				.bind(
					opts.guildId,
					m.playerId,
					m.playerName,
					m.allianceTag,
					m.allianceId,
					m.allianceRank,
					m.opsLevel,
					m.power,
					m.grade,
					m.joinDate,
					m.activityStreak ?? null,
					daysInactive,
					opts.fetchedAt,
				),
		);
	}

	await db.batch(stmts);
}

/** Drop roster members/meta for alliance ids not in `keepAllianceIds` (multi cleanup). */
export async function pruneAllianceRostersOutside(
	db: D1Database,
	guildId: string,
	keepAllianceIds: string[],
): Promise<void> {
	if (keepAllianceIds.length === 0) {
		await db.batch([
			db.prepare(`DELETE FROM alliance_roster_members WHERE guild_id = ?`).bind(guildId),
			db.prepare(`DELETE FROM alliance_roster_meta WHERE guild_id = ?`).bind(guildId),
		]);
		return;
	}
	const placeholders = keepAllianceIds.map(() => '?').join(',');
	await db.batch([
		db
			.prepare(
				`DELETE FROM alliance_roster_members WHERE guild_id = ? AND alliance_id NOT IN (${placeholders})`,
			)
			.bind(guildId, ...keepAllianceIds),
		db
			.prepare(
				`DELETE FROM alliance_roster_meta WHERE guild_id = ? AND alliance_id NOT IN (${placeholders})`,
			)
			.bind(guildId, ...keepAllianceIds),
	]);
}

export interface ServerAllianceDirectoryRow {
	guild_id: string;
	alliance_id: string;
	alliance_tag: string;
	alliance_name: string | null;
	server_rank: number | null;
	player_count: number | null;
	fetched_at: string;
}

export async function replaceServerAllianceDirectory(
	db: D1Database,
	guildId: string,
	fetchedAt: string,
	entries: Array<{
		allianceId: string;
		allianceTag: string;
		allianceName: string | null;
		serverRank: number | null;
		playerCount: number | null;
	}>,
): Promise<void> {
	const stmts: D1PreparedStatement[] = [
		db.prepare(`DELETE FROM server_alliance_directory WHERE guild_id = ?`).bind(guildId),
	];
	for (const e of entries) {
		stmts.push(
			db
				.prepare(
					`INSERT INTO server_alliance_directory
					 (guild_id, alliance_id, alliance_tag, alliance_name, server_rank, player_count, fetched_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				)
				.bind(
					guildId,
					e.allianceId,
					e.allianceTag,
					e.allianceName,
					e.serverRank,
					e.playerCount,
					fetchedAt,
				),
		);
	}
	await db.batch(stmts);
}

export async function getServerAllianceIdByTag(
	db: D1Database,
	guildId: string,
	allianceTag: string,
): Promise<string | null> {
	const row = await db
		.prepare(
			`SELECT alliance_id FROM server_alliance_directory
			 WHERE guild_id = ? AND UPPER(alliance_tag) = UPPER(?)
			 LIMIT 1`,
		)
		.bind(guildId, allianceTag.trim())
		.first();
	return row ? String((row as { alliance_id: string }).alliance_id) : null;
}

/** Payload for /roster paginated list button sessions. */
export type RosterListSessionPayload = {
	kind: 'grade' | 'rank' | 'ops' | 'inactive' | 'missing-verify';
	/** Header lines without page footer (markdown). */
	title: string;
	filters: {
		grade?: number;
		opsMin?: number;
		opsMax?: number;
		allianceRank?: string;
		daysInactiveMin?: number;
	};
	sort: RosterPlayerSort | 'rank';
	format: 'table' | 'list';
	/** private = ephemeral (default); public = channel-visible, anyone can paginate */
	visibility: 'private' | 'public';
	/** Include alliance-cache members with no Discord link (flagged in the table). */
	includeUnlinked: boolean;
	page: number;
};

export type RosterListSession = {
	token: string;
	guild_id: string;
	user_id: string;
	payload: RosterListSessionPayload;
	expires_at: string;
};

function newRosterListToken(): string {
	const bytes = new Uint8Array(12);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createRosterListSession(
	db: D1Database,
	opts: {
		guildId: string;
		userId: string;
		payload: RosterListSessionPayload;
		ttlSeconds?: number;
	},
): Promise<RosterListSession> {
	const token = newRosterListToken();
	const ttl = opts.ttlSeconds ?? 3600;
	const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
	await db
		.prepare(
			`INSERT INTO roster_list_sessions (token, guild_id, user_id, payload, expires_at)
			 VALUES (?, ?, ?, ?, ?)`,
		)
		.bind(token, opts.guildId, opts.userId, JSON.stringify(opts.payload), expiresAt)
		.run();
	return {
		token,
		guild_id: opts.guildId,
		user_id: opts.userId,
		payload: opts.payload,
		expires_at: expiresAt,
	};
}

export async function getRosterListSession(
	db: D1Database,
	token: string,
): Promise<RosterListSession | null> {
	const row = await db
		.prepare(
			`SELECT token, guild_id, user_id, payload, expires_at
			 FROM roster_list_sessions WHERE token = ?`,
		)
		.bind(token)
		.first();
	if (!row) return null;
	const r = row as Record<string, unknown>;
	const expiresAt = String(r.expires_at ?? '');
	if (expiresAt && Date.parse(expiresAt) < Date.now()) {
		await db.prepare(`DELETE FROM roster_list_sessions WHERE token = ?`).bind(token).run();
		return null;
	}
	let payload: RosterListSessionPayload;
	try {
		payload = JSON.parse(String(r.payload ?? '{}')) as RosterListSessionPayload;
	} catch {
		return null;
	}
	return {
		token: String(r.token),
		guild_id: String(r.guild_id),
		user_id: String(r.user_id),
		payload,
		expires_at: expiresAt,
	};
}

export async function updateRosterListSessionPayload(
	db: D1Database,
	token: string,
	payload: RosterListSessionPayload,
	ttlSeconds = 3600,
): Promise<void> {
	const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
	await db
		.prepare(
			`UPDATE roster_list_sessions
			 SET payload = ?, expires_at = ?
			 WHERE token = ?`,
		)
		.bind(JSON.stringify(payload), expiresAt, token)
		.run();
}

export async function cleanupExpiredRosterListSessions(db: D1Database): Promise<number> {
	const result = await db
		.prepare(`DELETE FROM roster_list_sessions WHERE expires_at < datetime('now')`)
		.run();
	return result.meta?.changes ?? 0;
}

/** Daily sum of recorded power for verified players in a guild (from player_stats_history). */
export async function sumGuildPowerByDay(
	db: D1Database,
	guildId: string,
	days = 90,
	opts?: { includeGuests?: boolean },
): Promise<Array<{ day: string; total_power: number; sample_count: number }>> {
	const includeGuests = opts?.includeGuests !== false;
	const statuses = includeGuests ? `('verified', 'active', 'guest')` : `('verified', 'active')`;
	const limitDays = Math.min(Math.max(Math.floor(days) || 90, 7), 366);
	const { results } = await db
		.prepare(
			`SELECT date(h.recorded_at) AS day,
			        SUM(COALESCE(h.power, 0)) AS total_power,
			        COUNT(*) AS sample_count
			 FROM player_stats_history h
			 INNER JOIN verified_players vp ON vp.id = h.verified_player_id
			 WHERE vp.guild_id = ?
			   AND vp.verification_status IN ${statuses}
			   AND h.recorded_at >= datetime('now', ?)
			 GROUP BY date(h.recorded_at)
			 ORDER BY day ASC`,
		)
		.bind(guildId, `-${limitDays} days`)
		.all();
	return (results ?? []).map((row) => {
		const r = row as Record<string, unknown>;
		return {
			day: String(r.day ?? ''),
			total_power: Number(r.total_power ?? 0) || 0,
			sample_count: Number(r.sample_count ?? 0) || 0,
		};
	});
}

/** Daily sum of power broken down by alliance_tag (multi-alliance dashboards). */
export async function sumGuildPowerByDayAndAlliance(
	db: D1Database,
	guildId: string,
	days = 90,
	opts?: { includeGuests?: boolean },
): Promise<Array<{ day: string; alliance_tag: string; total_power: number; sample_count: number }>> {
	const includeGuests = opts?.includeGuests !== false;
	const statuses = includeGuests ? `('verified', 'active', 'guest')` : `('verified', 'active')`;
	const limitDays = Math.min(Math.max(Math.floor(days) || 90, 7), 366);
	const { results } = await db
		.prepare(
			`SELECT date(h.recorded_at) AS day,
			        COALESCE(NULLIF(TRIM(h.alliance_tag), ''), '—') AS alliance_tag,
			        SUM(COALESCE(h.power, 0)) AS total_power,
			        COUNT(*) AS sample_count
			 FROM player_stats_history h
			 INNER JOIN verified_players vp ON vp.id = h.verified_player_id
			 WHERE vp.guild_id = ?
			   AND vp.verification_status IN ${statuses}
			   AND h.recorded_at >= datetime('now', ?)
			 GROUP BY date(h.recorded_at), COALESCE(NULLIF(TRIM(h.alliance_tag), ''), '—')
			 ORDER BY day ASC, alliance_tag COLLATE NOCASE`,
		)
		.bind(guildId, `-${limitDays} days`)
		.all();
	return (results ?? []).map((row) => {
		const r = row as Record<string, unknown>;
		return {
			day: String(r.day ?? ''),
			alliance_tag: String(r.alliance_tag ?? '—'),
			total_power: Number(r.total_power ?? 0) || 0,
			sample_count: Number(r.sample_count ?? 0) || 0,
		};
	});
}
