export type GuildMode = 'single_alliance' | 'multi_alliance';
export type StfcRegion = 'US' | 'EU';

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
	channel_category_map: Record<string, string>;
	personal_channel_extra_roles: string[];
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
	poll_interval_hours: number;
	verification_enabled: boolean;
	created_at: string;
	updated_at: string;
}

export interface VerifiedPlayer {
	id: number;
	guild_id: string;
	discord_user_id: string;
	player_id: number | null;
	player_name: string | null;
	alliance_tag: string | null;
	ops_level: number | null;
	power: number | null;
	grade: number | null;
	stfc_pro_url: string | null;
	verification_status: VerificationStatus;
	personal_channel_id: string | null;
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

export interface ParsedStfcProUrl {
	playerId?: number;
	playerName?: string;
	server?: number;
	region?: StfcRegion;
	rawUrl: string;
}
