import type { SurveyDelivery, SurveyRecord, SurveyResponseRecord, SurveyStatus, SurveyTargetType } from './survey-types';

function parseJsonArray(value: string | null | undefined): string[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

function parseJsonNumberArray(value: string | null | undefined): number[] {
	return parseJsonArray(value)
		.map((v) => Number(v))
		.filter((n) => Number.isFinite(n));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSurvey(row: any): SurveyRecord {
	return {
		id: row.id,
		guild_id: row.guild_id,
		created_by: row.created_by,
		question: row.question,
		button_type: row.button_type ?? 'multi_choice',
		options: parseJsonArray(row.options),
		status: (row.status ?? 'draft') as SurveyStatus,
		delivery: (row.delivery ?? 'dm') as SurveyDelivery,
		target_type: (row.target_type ?? 'all') as SurveyTargetType,
		target_grades: parseJsonNumberArray(row.target_grades),
		target_alliance_tags: parseJsonArray(row.target_alliance_tags),
		target_role_ids: parseJsonArray(row.target_role_ids),
		target_ranks: parseJsonArray(row.target_ranks),
		target_ops_min: row.target_ops_min ?? null,
		target_ops_max: row.target_ops_max ?? null,
		target_user_ids: parseJsonArray(row.target_user_ids),
		viewer_role_ids: parseJsonArray(row.viewer_role_ids),
		log_channel_id: row.log_channel_id ?? null,
		target_count: row.target_count ?? 0,
		sent_at: row.sent_at ?? null,
		closed_at: row.closed_at ?? null,
		created_at: row.created_at,
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapResponse(row: any): SurveyResponseRecord {
	return {
		id: row.id,
		survey_id: row.survey_id,
		discord_user_id: row.discord_user_id,
		response: row.response,
		responded_at: row.responded_at,
	};
}

export async function createSurvey(
	db: D1Database,
	data: {
		guild_id: string;
		created_by: string;
		question: string;
		options: string[];
		delivery: SurveyDelivery;
		target_type: SurveyTargetType;
		target_grades?: number[];
		target_alliance_tags?: string[];
		target_role_ids?: string[];
		target_ranks?: string[];
		target_ops_min?: number | null;
		target_ops_max?: number | null;
		target_user_ids?: string[];
		viewer_role_ids?: string[];
	},
): Promise<SurveyRecord> {
	const result = await db
		.prepare(
			`INSERT INTO surveys
			 (guild_id, created_by, question, button_type, options, status, delivery, target_type,
			  target_grades, target_alliance_tags, target_role_ids, target_ranks,
			  target_ops_min, target_ops_max, target_user_ids, viewer_role_ids)
			 VALUES (?, ?, ?, 'multi_choice', ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 RETURNING *`,
		)
		.bind(
			data.guild_id,
			data.created_by,
			data.question,
			JSON.stringify(data.options),
			data.delivery,
			data.target_type,
			JSON.stringify(data.target_grades ?? []),
			JSON.stringify(data.target_alliance_tags ?? []),
			JSON.stringify(data.target_role_ids ?? []),
			JSON.stringify(data.target_ranks ?? []),
			data.target_ops_min ?? null,
			data.target_ops_max ?? null,
			JSON.stringify(data.target_user_ids ?? []),
			JSON.stringify(data.viewer_role_ids ?? []),
		)
		.first();
	if (!result) throw new Error('Failed to create survey');
	return mapSurvey(result);
}

export async function getSurvey(db: D1Database, surveyId: number): Promise<SurveyRecord | null> {
	const row = await db.prepare('SELECT * FROM surveys WHERE id = ?').bind(surveyId).first();
	return row ? mapSurvey(row) : null;
}

export async function listSurveys(db: D1Database, guildId: string, limit = 15): Promise<SurveyRecord[]> {
	const { results } = await db
		.prepare(`SELECT * FROM surveys WHERE guild_id = ? ORDER BY id DESC LIMIT ?`)
		.bind(guildId, limit)
		.all();
	return (results ?? []).map(mapSurvey);
}

export async function updateSurvey(
	db: D1Database,
	surveyId: number,
	patch: Partial<{
		status: SurveyStatus;
		log_channel_id: string | null;
		target_count: number;
		sent_at: string | null;
		closed_at: string | null;
	}>,
): Promise<void> {
	await db
		.prepare(
			`UPDATE surveys SET
			 status = COALESCE(?, status),
			 log_channel_id = COALESCE(?, log_channel_id),
			 target_count = COALESCE(?, target_count),
			 sent_at = COALESCE(?, sent_at),
			 closed_at = COALESCE(?, closed_at)
			 WHERE id = ?`,
		)
		.bind(
			patch.status ?? null,
			patch.log_channel_id ?? null,
			patch.target_count ?? null,
			patch.sent_at ?? null,
			patch.closed_at ?? null,
			surveyId,
		)
		.run();
}

export async function deleteSurvey(db: D1Database, surveyId: number): Promise<void> {
	await db.prepare('DELETE FROM survey_responses WHERE survey_id = ?').bind(surveyId).run();
	await db.prepare('DELETE FROM surveys WHERE id = ?').bind(surveyId).run();
}

export async function recordSurveyResponse(
	db: D1Database,
	surveyId: number,
	discordUserId: string,
	response: string,
): Promise<{ ok: true } | { ok: false; reason: 'duplicate' | 'error'; message?: string }> {
	try {
		await db
			.prepare(
				`INSERT INTO survey_responses (survey_id, discord_user_id, response)
				 VALUES (?, ?, ?)`,
			)
			.bind(surveyId, discordUserId, response)
			.run();
		return { ok: true };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes('UNIQUE') || msg.includes('unique')) {
			return { ok: false, reason: 'duplicate' };
		}
		return { ok: false, reason: 'error', message: msg };
	}
}

export async function listSurveyResponses(
	db: D1Database,
	surveyId: number,
): Promise<SurveyResponseRecord[]> {
	const { results } = await db
		.prepare(`SELECT * FROM survey_responses WHERE survey_id = ? ORDER BY responded_at ASC`)
		.bind(surveyId)
		.all();
	return (results ?? []).map(mapResponse);
}

export async function getSurveyResponseForUser(
	db: D1Database,
	surveyId: number,
	discordUserId: string,
): Promise<SurveyResponseRecord | null> {
	const row = await db
		.prepare(
			`SELECT * FROM survey_responses WHERE survey_id = ? AND discord_user_id = ?`,
		)
		.bind(surveyId, discordUserId)
		.first();
	return row ? mapResponse(row) : null;
}
