import { describe, expect, it } from 'vitest';
import {
	buildLetterHistogram,
	formatLetterRange,
	letterKeyForName,
	parseLetterRange,
	planCategoryBuckets,
	applyCategoryNameTemplate,
	categoryNameTemplatePrefix,
	DEFAULT_SOFT_LIMIT,
} from '../src/personal-channel-plan';
import { categoryForPlayerName } from '../src/channel-utils';
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
		tracked_alliance_tags: [],
		defer_untracked_admiral_roles: false,
		diplomacy_everyone_can_view: true,
		diplomacy_view_role_ids: [],
		diplomacy_write_role_ids: [],
		diplomacy_write_ranks: ['Commodore', 'Admiral'],
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

function countsFromLetters(spec: Partial<Record<string, number>>) {
	const names: string[] = [];
	for (const [letter, n] of Object.entries(spec)) {
		for (let i = 0; i < (n ?? 0); i++) {
			names.push(letter === '#' ? `${i}Player` : `${letter}player${i}`);
		}
	}
	return buildLetterHistogram(names);
}

describe('personal-channel-plan', () => {
	it('letterKeyForName maps non-alpha to #', () => {
		expect(letterKeyForName('Adam')).toBe('A');
		expect(letterKeyForName('zoe')).toBe('Z');
		expect(letterKeyForName('007Bond')).toBe('#');
		expect(letterKeyForName('_x')).toBe('#');
	});

	it('letterKeyForName latinizes lookalikes', () => {
		expect(letterKeyForName('Łukasz')).toBe('L');
		expect(letterKeyForName('βeta')).toBe('B');
		expect(letterKeyForName('ンZed')).toBe('N');
	});

	it('categoryNameTemplatePrefix extracts the stem before {range}', () => {
		expect(categoryNameTemplatePrefix('Member Channels {range}')).toBe('Member Channels ');
		expect(categoryNameTemplatePrefix('Players {range} here')).toBe('Players ');
	});

	it('parseLetterRange supports N-#', () => {
		expect(parseLetterRange('N-#')).toEqual({ start: 'N', end: '#' });
		expect(parseLetterRange('A-M')).toEqual({ start: 'A', end: 'M' });
		expect(parseLetterRange('#')).toEqual({ start: '#', end: '#' });
		expect(parseLetterRange('Z-A')).toBeNull();
	});

	it('formatLetterRange', () => {
		expect(formatLetterRange('A', 'M')).toBe('A-M');
		expect(formatLetterRange('N', '#')).toBe('N-#');
		expect(formatLetterRange('#', '#')).toBe('#');
	});

	it('plans a single bucket under soft limit', () => {
		const plan = planCategoryBuckets(countsFromLetters({ A: 10, M: 5, Z: 3 }), DEFAULT_SOFT_LIMIT);
		expect(plan.categoryCount).toBe(1);
		expect(plan.buckets).toHaveLength(1);
		expect(plan.buckets[0].range).toBe('A-#');
		expect(plan.buckets[0].count).toBe(18);
	});

	it('splits 50 players fairly evenly (not 45+5)', () => {
		const plan = planCategoryBuckets(countsFromLetters({ A: 25, N: 25 }), 45);
		expect(plan.categoryCount).toBe(2);
		expect(plan.buckets[0].count).toBe(25);
		expect(plan.buckets[1].count).toBe(25);
		expect(plan.buckets[0].range).toBe('A-M');
		expect(plan.buckets[1].range).toBe('N-#');
	});

	it('creates a third category when nearing two-category capacity', () => {
		// 91 players with soft 45 → 3 categories
		const plan = planCategoryBuckets(
			countsFromLetters({ A: 30, J: 31, T: 30 }),
			45,
		);
		expect(plan.categoryCount).toBe(3);
		expect(plan.total).toBe(91);
		for (const b of plan.buckets) {
			expect(b.count).toBeLessThanOrEqual(45);
		}
		const sizes = plan.buckets.map((b) => b.count).sort((a, b) => a - b);
		expect(sizes[0]).toBeGreaterThanOrEqual(30);
		expect(sizes[2]).toBeLessThanOrEqual(31);
	});

	it('covers full alphabet including #', () => {
		const plan = planCategoryBuckets(countsFromLetters({ A: 20, Z: 20, '#': 10 }), 45);
		expect(plan.categoryCount).toBe(2);
		expect(plan.buckets[0].start).toBe('A');
		expect(plan.buckets[plan.buckets.length - 1].end).toBe('#');
		expect(plan.buckets.reduce((s, b) => s + b.count, 0)).toBe(50);
	});

	it('warns when a single letter exceeds soft limit', () => {
		const plan = planCategoryBuckets(countsFromLetters({ D: 50, A: 1 }), 45);
		expect(plan.warnings.some((w) => w.includes('Letter D'))).toBe(true);
	});

	it('applyCategoryNameTemplate', () => {
		expect(applyCategoryNameTemplate('Member Channels {range}', 'A-M')).toBe('Member Channels A-M');
		expect(applyCategoryNameTemplate('Member Channels {range}', 'N-#')).toBe('Member Channels N-#');
	});
});

describe('findUnlinkedMemberChannels', () => {
	it('finds text channels in member categories that are not linked', async () => {
		const { findUnlinkedMemberChannels } = await import('../src/personal-channels');
		const channels = [
			{ id: 'linked', name: 'adam', type: 0, parent_id: 'cat-am' },
			{ id: 'orphan', name: 'old-player', type: 0, parent_id: 'cat-am' },
			{ id: 'elsewhere', name: 'general', type: 0, parent_id: 'other' },
			{ id: 'cat-am', name: 'Member Channels A-M', type: 4, parent_id: null },
		];
		const unlinked = findUnlinkedMemberChannels(
			channels,
			new Set(['cat-am']),
			new Set(['linked']),
			null,
		);
		expect(unlinked.map((c) => c.id)).toEqual(['orphan']);
	});
});

describe('categoryForPlayerName with #', () => {
	it('routes non-alpha into N-# range', () => {
		const config = baseConfig({
			channel_category_map: { 'A-M': 'cat-am', 'N-#': 'cat-n' },
		});
		expect(categoryForPlayerName(config, 'Adam')).toBe('cat-am');
		expect(categoryForPlayerName(config, 'Nora')).toBe('cat-n');
		expect(categoryForPlayerName(config, 'Zoe')).toBe('cat-n');
		expect(categoryForPlayerName(config, '42Hero')).toBe('cat-n');
	});
});
