import type { PersonalChannelPermTemplate } from './personal-channel-perm-template';

export type GuildMode = 'single_alliance' | 'multi_alliance';
export type StfcRegion = 'US' | 'EU';
/** When agreement must be accepted relative to stfc.pro verification. */
export type AgreementTiming = 'before_verify' | 'after_verify';
/** How the member accepts. `channel_react` reserved for a follow-up. */
export type AgreementMode = 'dm_button' | 'channel_react';

export type { PersonalChannelPermTemplate };
export type VerificationStatus =
	| 'pending_invite'
	| 'pending_screenshot'
	| 'pending_link'
	| 'verified'
	| 'guest'
	| 'active'
	| 'failed';

export interface PlayerData {
	playerId: number;
	name: string;
	rank: string;
	level: number;
	helps: string;
	rss: string;
	power: number;
	max_power?: number;
	iso: string;
	joinDate: string;
	allianceId: string;
	allianceTag: string;
	server: number;
	region: string;
}

export interface OverlayBucket {
	ranks: string[];
	role_ids: string[];
	/** Configured role names (parallel to role_ids) for rename detection. */
	role_names?: string[];
}

export interface GuildConfig {
	guild_id: string;
	mode: GuildMode;
	stfc_server: number;
	stfc_region: StfcRegion;
	alliance_tag: string | null;
	guest_role_id: string | null;
	member_role_ids: string[];
	operative_role_ids: string[];
	agent_role_ids: string[];
	premier_role_ids: string[];
	commodore_role_ids: string[];
	admiral_role_ids: string[];
	// Named buckets (e.g. "leadership") that add additional Discord roles
	// for a configurable set of in-game ranks.
	overlay_buckets: Record<string, OverlayBucket>;
	alliance_role_prefix: string | null;
	/** Discord nick pattern; null = mode default. See nickname-utils.ts placeholders. */
	nickname_template: string | null;
	/** Channel for admin verification audit posts (summary + screenshot). */
	verification_log_channel_id: string | null;
	/** Channel for general bot audit (admin commands + automated actions). */
	audit_log_channel_id: string | null;
	/** High-signal staff alerts (e.g. verification DM blocked) — optional, separate from audit. */
	urgent_notify_channel_id: string | null;
	channel_category_map: Record<string, string>;
	personal_channel_extra_roles: string[];
	/**
	 * Locked-in overwrite pattern for new/linked personal channels.
	 * Null = built-in default (bot + deny @everyone + member + extra-roles).
	 */
	personal_channel_perm_template: PersonalChannelPermTemplate | null;
	/** Category for member channels no longer linked to a verified player. */
	personal_channel_archive_category_id: string | null;
	/** Multi-alliance: create/link one diplomacy channel per alliance tag. */
	diplomacy_enabled: boolean;
	diplomacy_category_id: string | null;
	/** allianceTag (upper) → Discord channel ID */
	diplomacy_channel_map: Record<string, string>;
	/** If true, @everyone can view diplomacy channels (send still restricted). */
	diplomacy_everyone_can_view: boolean;
	/** Extra roles that can view (used when everyone_can_view is false, or as additive). */
	diplomacy_view_role_ids: string[];
	/** Roles that can write (e.g. Diplomat). */
	diplomacy_write_role_ids: string[];
	/** In-game ranks whose Discord rank roles may write (e.g. Commodore, Admiral). */
	diplomacy_write_ranks: string[];
	/** Channel name pattern; `{tag}` → alliance tag. Default diplomacy-{tag}. */
	diplomacy_name_template: string | null;
	/** Roles allowed to create/send surveys (empty = Administrator only). */
	survey_creator_role_ids: string[];
	/** Roles allowed to view survey results + private survey log channels (in addition to the creator). */
	survey_results_role_ids: string[];
	/** Discord channel name pattern for survey logs; `{id}` → survey id. Default survey-{id}. */
	survey_log_name_template: string | null;
	/** Category for newly created survey log channels. */
	survey_log_category_id: string | null;
	/** Resource exchange layout: hub (one channel) | category (channel per resource) | null = off. */
	exchange_layout: 'hub' | 'category' | null;
	exchange_hub_channel_id: string | null;
	exchange_category_id: string | null;
	/** Roles allowed to manage exchange resources (empty = Administrator only). */
	exchange_admin_role_ids: string[];
	/** Roles allowed to ask roster/analytics questions in DMs (empty = Administrators only). */
	dm_query_role_ids: string[];
	/** When true and Workers AI is bound, allow optional NLP intent classification for DMs. */
	dm_ai_enabled: boolean;
	/** Require Discord agreement / CoC acceptance before or after verify. */
	agreement_enabled: boolean;
	/** before_verify = block screenshot/link until agree; after_verify = lounge/guest until agree (default). */
	agreement_timing: AgreementTiming;
	/** dm_button (v1) | channel_react (planned). */
	agreement_mode: AgreementMode;
	/** Optional channel to link in the agreement DM (existing CoC / Discord Agreement). */
	agreement_channel_id: string | null;
	/** Optional message ID for future channel-reaction mode. */
	agreement_message_id: string | null;
	/** Bump to force re-accept after CoC changes. */
	agreement_version: string | null;
	poll_interval_hours: number;
	verification_enabled: boolean;
	created_at: string;
	updated_at: string;
}

/** Active DM assistant conversation (wizard / guild pick). */
export interface DmSession {
	discord_user_id: string;
	guild_id: string | null;
	flow: string;
	step: string;
	payload: Record<string, unknown>;
	updated_at: string;
}

export interface VerifiedPlayer {
	id: number;
	guild_id: string;
	discord_user_id: string;
	player_id: number | null;
	player_name: string | null;
	alliance_tag: string | null;
	alliance_rank: string | null;
	ops_level: number | null;
	power: number | null;
	grade: number | null;
	stfc_pro_url: string | null;
	verification_status: VerificationStatus;
	personal_channel_id: string | null;
	/** Player-facing bot language (en, de, …). Null until chosen. */
	preferred_locale: string | null;
	/** When the member accepted the Discord agreement / CoC (if required). */
	agreement_accepted_at: string | null;
	/** Version string they accepted (should match guild_configs.agreement_version). */
	agreement_version: string | null;
	/** dm_button | reaction */
	agreement_method: string | null;
	verified_at: string | null;
	last_synced_at: string | null;
}

export interface GuildMemberRecord {
	guild_id: string;
	discord_user_id: string;
	username: string | null;
	first_seen_at: string;
	verification_invited_at: string | null;
}

/** Discord users skipped for invites / unverified stats (bots, never-verify accounts). */
export interface GuildExcludedUser {
	guild_id: string;
	discord_user_id: string;
	reason: string | null;
	excluded_by: string | null;
	excluded_at: string;
}

export interface ParsedStfcProUrl {
	playerId?: number;
	playerName?: string;
	server?: number;
	region?: StfcRegion;
	rawUrl: string;
}
