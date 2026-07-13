export type SurveyStatus = 'draft' | 'sent' | 'closed';
export type SurveyDelivery = 'dm' | 'personal_channel';
export type SurveyTargetType = 'all' | 'role' | 'rank' | 'level' | 'grade' | 'users';

export interface SurveyRecord {
	id: number;
	guild_id: string;
	created_by: string;
	/** Optional player-facing title; null → localized "Survey #{id}". */
	title: string | null;
	question: string;
	button_type: string;
	options: string[];
	status: SurveyStatus;
	delivery: SurveyDelivery;
	target_type: SurveyTargetType;
	target_grades: number[];
	target_alliance_tags: string[];
	target_role_ids: string[];
	target_ranks: string[];
	target_ops_min: number | null;
	target_ops_max: number | null;
	target_user_ids: string[];
	viewer_role_ids: string[];
	log_channel_id: string | null;
	/** Per-survey category override; null → guild survey_log_category_id. */
	log_category_id: string | null;
	target_count: number;
	sent_at: string | null;
	closed_at: string | null;
	created_at: string;
}

export interface SurveyResponseRecord {
	id: number;
	survey_id: number;
	discord_user_id: string;
	response: string;
	responded_at: string;
}
