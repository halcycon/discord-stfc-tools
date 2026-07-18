import { describe, expect, it } from 'vitest';
import { canCreateSurvey, canViewSurveyResults } from '../src/survey-handlers';
import {
	buildSurveyVoteComponents,
	formatSurveyCloseAfter,
	formatSurveyDeliveryTitle,
	formatSurveyResultsTable,
	parseSurveyClosesIn,
	parseSurveyOptions,
	resolveSurveyLogChannelName,
} from '../src/survey-service';
import { describeSurveyTarget } from '../src/survey-targeting';
import type { SurveyRecord } from '../src/survey-types';
import type { GuildConfig } from '../src/types';

function baseConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
	return {
		guild_id: '1',
		mode: 'single_alliance',
		stfc_server: 108,
		stfc_region: 'EU',
		alliance_tag: 'TEST',
		guest_role_id: null,
		member_role_ids: [],
		operative_role_ids: [],
		agent_role_ids: [],
		premier_role_ids: [],
		commodore_role_ids: [],
		admiral_role_ids: [],
		overlay_buckets: {},
		channel_category_map: {},
		personal_channel_extra_roles: [],
		personal_channel_perm_template: null,
		personal_channel_archive_category_id: null,
		alliance_role_prefix: null,
		nickname_template: null,
		nickname_display_ranks: ["Operative","Agent","Premier","Commodore","Admiral"],
		verification_log_channel_id: null,
		audit_log_channel_id: null,
		urgent_notify_channel_id: null,
		diplomacy_enabled: false,
		diplomacy_category_id: null,
		diplomacy_category_map: {},
		diplomacy_archive_category_id: null,
		diplomacy_channel_map: {},
		diplomacy_preferred_locales: {},
		tracked_alliance_tags: [],
		defer_untracked_admiral_roles: false,
		diplomacy_everyone_can_view: true,
		diplomacy_view_role_ids: [],
		diplomacy_write_role_ids: [],
		diplomacy_write_ranks: [],
		diplomacy_name_template: null,
		survey_creator_role_ids: [],
		survey_results_role_ids: [],
		survey_log_name_template: null,
		survey_log_category_id: null,
		exchange_layout: null,
		exchange_hub_channel_id: null,
		exchange_category_id: null,
		exchange_admin_role_ids: [],
		dm_query_role_ids: [],
		web_admin_role_ids: [],
		dm_ai_enabled: false,
		data_consent_enabled: false,
		data_consent_version: '1',
		agreement_enabled: false,
		agreement_timing: 'after_verify',
		agreement_mode: 'dm_button',
		agreement_channel_id: null,
		agreement_message_id: null,
		agreement_version: null,
		demotion_policy: 'approval',
		deploy_mode: 'live',
		verification_invite_mode: 'dm',
		verify_panel_channel_id: null,
		verify_panel_message_id: null,
		demotion_notify: 'dm',
		welcome_dm_enabled: false,
		welcome_dm_channel_id: null,
		welcome_dm_message_id: null,
		poll_interval_hours: 6,
		verification_enabled: true,
		created_at: '',
		updated_at: '',
		...overrides,
	};
}

function sampleSurvey(overrides: Partial<SurveyRecord> = {}): SurveyRecord {
	return {
		id: 7,
		guild_id: '1',
		created_by: 'creator1',
		title: null,
		question: 'Ready for G5?',
		button_type: 'multi_choice',
		options: ['Yes', 'No', 'Maybe'],
		status: 'sent',
		delivery: 'dm',
		target_type: 'grade',
		target_grades: [5],
		target_alliance_tags: [],
		target_role_ids: [],
		target_ranks: [],
		target_ops_min: null,
		target_ops_max: null,
		target_user_ids: [],
		viewer_role_ids: [],
		log_channel_id: null,
		log_category_id: null,
		target_count: 3,
		close_after_seconds: null,
		closes_at: null,
		sent_at: null,
		closed_at: null,
		created_at: '',
		...overrides,
	};
}

describe('survey helpers', () => {
	it('parseSurveyOptions splits and caps at 5', () => {
		expect(parseSurveyOptions(' Yes | No | Maybe ')).toEqual(['Yes', 'No', 'Maybe']);
		expect(parseSurveyOptions('A|B|C|D|E|F')).toEqual(['A', 'B', 'C', 'D', 'E']);
	});

	it('resolveSurveyLogChannelName applies template and slugs', () => {
		expect(resolveSurveyLogChannelName(null, 1)).toBe('1-survey');
		expect(resolveSurveyLogChannelName(null, 3, 'Ops readiness')).toBe('3-ops-readiness');
		expect(resolveSurveyLogChannelName('poll-{id}', 12)).toBe('poll-12');
		expect(resolveSurveyLogChannelName('{id}-{title}', 3, 'Ops readiness')).toBe(
			'3-ops-readiness',
		);
		expect(resolveSurveyLogChannelName('Event Feedback', 3)).toBe('3-event-feedback');
		expect(resolveSurveyLogChannelName('  ', 7)).toBe('7-survey');
	});

	it('parseSurveyClosesIn accepts m/h/d and rejects bad input', () => {
		expect(parseSurveyClosesIn('48h')).toEqual({ ok: true, seconds: 48 * 3600 });
		expect(parseSurveyClosesIn('7d')).toEqual({ ok: true, seconds: 7 * 86400 });
		expect(parseSurveyClosesIn('30m')).toEqual({ ok: true, seconds: 1800 });
		expect(parseSurveyClosesIn('2 hours')).toEqual({ ok: true, seconds: 7200 });
		expect(parseSurveyClosesIn('0h').ok).toBe(false);
		expect(parseSurveyClosesIn('tomorrow').ok).toBe(false);
		expect(parseSurveyClosesIn('100d').ok).toBe(false);
	});

	it('formatSurveyCloseAfter formats whole units', () => {
		expect(formatSurveyCloseAfter(3600)).toBe('1 hour');
		expect(formatSurveyCloseAfter(12 * 3600)).toBe('12 hours');
		expect(formatSurveyCloseAfter(86400)).toBe('1 day');
	});

	it('formatSurveyDeliveryTitle uses custom title or default', () => {
		expect(formatSurveyDeliveryTitle(sampleSurvey({ title: null }), 'en')).toBe('Survey #7');
		expect(formatSurveyDeliveryTitle(sampleSurvey({ title: 'Ops readiness' }), 'en')).toBe(
			'Ops readiness',
		);
	});

	it('buildSurveyVoteComponents uses one row of buttons (not table cells)', () => {
		const rows = buildSurveyVoteComponents(9, ['Yes', 'No']);
		expect(rows).toHaveLength(1);
		expect(rows[0].components).toHaveLength(2);
		expect(rows[0].components[0].custom_id).toBe('survey:vote:9:0');
		expect(rows[0].components[0].label).toBe('Yes');
	});

	it('formatSurveyResultsTable uses ASCII tables for summary and who-voted', () => {
		const text = formatSurveyResultsTable(sampleSurvey(), [
			{ discord_user_id: 'u1', response: 'Yes', player_name: 'Alice' },
			{ discord_user_id: 'u2', response: 'No', player_name: 'Bob' },
			{ discord_user_id: 'u3', response: 'Yes', player_name: null },
		]);
		expect(text).toContain('Summary');
		expect(text).toContain('Who voted');
		expect(text).toContain('Alice');
		expect(text).toContain('```');
		expect(text).not.toContain('components');
	});

	it('describeSurveyTarget summarises filters', () => {
		expect(describeSurveyTarget(sampleSurvey())).toContain('grades G5');
		expect(
			describeSurveyTarget(
				sampleSurvey({
					target_type: 'level',
					target_grades: [],
					target_ops_min: 40,
					target_ops_max: 50,
				}),
			),
		).toContain('ops 40–50');
	});

	it('canCreateSurvey allows admins or configured roles', () => {
		const adminPerms = String(0x8); // ADMINISTRATOR
		expect(canCreateSurvey(baseConfig(), { member: { permissions: adminPerms } })).toBe(true);
		expect(canCreateSurvey(baseConfig(), { member: { roles: ['r1'], permissions: '0' } })).toBe(
			false,
		);
		expect(
			canCreateSurvey(baseConfig({ survey_creator_role_ids: ['r1'] }), {
				member: { roles: ['r1'], permissions: '0' },
			}),
		).toBe(true);
	});

	it('canViewSurveyResults allows creator, admins, and results roles', () => {
		const survey = { created_by: 'creator1', viewer_role_ids: ['view1'] };
		expect(
			canViewSurveyResults(survey, baseConfig(), {
				user: { id: 'creator1' },
				member: { roles: [], permissions: '0' },
			}),
		).toBe(true);
		expect(
			canViewSurveyResults(survey, baseConfig({ survey_results_role_ids: ['res1'] }), {
				user: { id: 'other' },
				member: { roles: ['res1'], permissions: '0' },
			}),
		).toBe(true);
		expect(
			canViewSurveyResults(survey, baseConfig(), {
				user: { id: 'other' },
				member: { roles: ['view1'], permissions: '0' },
			}),
		).toBe(true);
		expect(
			canViewSurveyResults(survey, baseConfig(), {
				user: { id: 'other' },
				member: { roles: [], permissions: '0' },
			}),
		).toBe(false);
	});
});
