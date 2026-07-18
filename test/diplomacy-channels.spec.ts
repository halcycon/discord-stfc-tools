import { describe, expect, it } from 'vitest';
import {
	diplomacyChannelsEnabled,
	diplomacyWriteRoleIds,
	planDiplomacyChannels,
	slugDiplomacyChannelName,
} from '../src/diplomacy-channels';
import type { GuildConfig } from '../src/types';

function baseConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
	return {
		guild_id: '1',
		mode: 'multi_alliance',
		stfc_server: 108,
		stfc_region: 'EU',
		alliance_tag: null,
		guest_role_id: null,
		member_role_ids: [],
		operative_role_ids: [],
		agent_role_ids: [],
		premier_role_ids: [],
		commodore_role_ids: ['111111111111111111'],
		admiral_role_ids: ['222222222222222222'],
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
		diplomacy_enabled: true,
		diplomacy_category_id: null,
		diplomacy_category_map: {},
		diplomacy_archive_category_id: null,
		diplomacy_channel_map: {},
		tracked_alliance_tags: [],
		defer_untracked_admiral_roles: false,
		diplomacy_everyone_can_view: true,
		diplomacy_view_role_ids: [],
		diplomacy_write_role_ids: ['999999999999999999'],
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

describe('diplomacy-channels', () => {
	it('slugDiplomacyChannelName uses template', () => {
		expect(slugDiplomacyChannelName('KWSN')).toBe('diplomacy-kwsn');
		expect(slugDiplomacyChannelName('KWSN', '{tag}-diplo')).toBe('kwsn-diplo');
	});

	it('slugDiplomacyChannelName latinizes lookalike tags', () => {
		expect(slugDiplomacyChannelName('KWβN')).toBe('diplomacy-kwbn');
		expect(slugDiplomacyChannelName('ŁTAG', '{tag}-diplo')).toBe('ltag-diplo');
	});

	it('diplomacyWriteRoleIds merges write roles and rank roles', () => {
		expect(diplomacyWriteRoleIds(baseConfig()).sort()).toEqual([
			'111111111111111111',
			'222222222222222222',
			'999999999999999999',
		]);
	});

	it('diplomacyChannelsEnabled respects flag', () => {
		expect(diplomacyChannelsEnabled(baseConfig())).toBe(true);
		expect(diplomacyChannelsEnabled(baseConfig({ diplomacy_enabled: false }))).toBe(false);
	});

	it('planDiplomacyChannels splits tags under soft limit', () => {
		const tags = Array.from({ length: 50 }, (_, i) =>
			String.fromCharCode(65 + (i % 26)) + String(i),
		);
		const map = Object.fromEntries(tags.map((t) => [t, `ch-${t}`]));
		const result = planDiplomacyChannels(
			baseConfig({ diplomacy_channel_map: map }),
			{ softLimit: 45 },
		);
		expect(result.plan.total).toBe(50);
		expect(result.plan.categoryCount).toBeGreaterThanOrEqual(2);
		expect(result.summary).toContain('Diplomacy category plan');
	});
});
