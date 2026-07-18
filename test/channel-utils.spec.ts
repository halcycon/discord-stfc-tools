import { describe, expect, it } from 'vitest';
import {
	categoryForAllianceTag,
	categoryForPlayerName,
	parseCategoryMapInput,
	personalChannelsEnabled,
	slugPersonalChannelName,
} from '../src/channel-utils';
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
		channel_category_map: { 'A-F': 'cat-af', 'G-M': 'cat-gm' },
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
		diplomacy_archive_category_map: {},
		diplomacy_channel_map: {},
		diplomacy_preferred_locales: {},
		diplomacy_special_channel_id: null,
		diplomacy_special_name: null,
		diplomacy_special_placement: 'special_category',
		diplomacy_special_category_id: null,
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

describe('channel-utils', () => {
	it('personalChannelsEnabled when category map is non-empty', () => {
		expect(personalChannelsEnabled(baseConfig())).toBe(true);
		expect(personalChannelsEnabled(baseConfig({ channel_category_map: {} }))).toBe(false);
	});

	it('categoryForPlayerName picks bucket by first letter', () => {
		const config = baseConfig();
		expect(categoryForPlayerName(config, 'Adam')).toBe('cat-af');
		expect(categoryForPlayerName(config, 'Hannah')).toBe('cat-gm');
		expect(categoryForPlayerName(config, 'Zoe')).toBeUndefined();
		expect(categoryForPlayerName(config, '9lives')).toBeUndefined();
	});

	it('categoryForPlayerName treats # as after Z', () => {
		const config = baseConfig({
			channel_category_map: { 'A-Z': 'cat-az', '#': 'cat-hash' },
		});
		expect(categoryForPlayerName(config, 'Adam')).toBe('cat-az');
		expect(categoryForPlayerName(config, '1abc')).toBe('cat-hash');
	});

	it('slugPersonalChannelName sanitizes names', () => {
		expect(slugPersonalChannelName('Halcynicon', '123')).toBe('halcynicon');
		expect(slugPersonalChannelName('A. Player', '123')).toBe('a-player');
	});

	it('slugPersonalChannelName folds lookalike Unicode', () => {
		expect(slugPersonalChannelName('KOŁES', '123')).toBe('koles');
		expect(slugPersonalChannelName('RAMβX', '123')).toBe('rambx');
		expect(slugPersonalChannelName('ンAlpha', '123')).toBe('nalpha');
		expect(slugPersonalChannelName('José', '123')).toBe('jose');
		expect(slugPersonalChannelName('Сool', '123')).toBe('cool'); // Cyrillic С
	});

	it('categoryForPlayerName uses latinized first letter', () => {
		const config = baseConfig({
			channel_category_map: { 'A-L': 'cat-al', 'M-Z': 'cat-mz', '#': 'cat-hash' },
		});
		expect(categoryForPlayerName(config, 'Łukasz')).toBe('cat-al');
		expect(categoryForPlayerName(config, 'ンZed')).toBe('cat-mz');
	});

	it('categoryForAllianceTag uses diplomacy letter buckets', () => {
		const config = baseConfig({
			diplomacy_category_map: { 'A-M': 'dip-am', 'N-#': 'dip-nz' },
			diplomacy_category_id: 'legacy-cat',
		});
		expect(categoryForAllianceTag(config, 'KWSN')).toBe('dip-am');
		expect(categoryForAllianceTag(config, 'ROME')).toBe('dip-nz');
		expect(categoryForAllianceTag(config, 'ŁTAG')).toBe('dip-am');
	});

	it('categoryForAllianceTag falls back to legacy single category', () => {
		const config = baseConfig({
			diplomacy_category_map: {},
			diplomacy_category_id: 'legacy-cat',
		});
		expect(categoryForAllianceTag(config, 'KWSN')).toBe('legacy-cat');
	});

	it('parseCategoryMapInput parses bulk maps', () => {
		expect(parseCategoryMapInput('A-F=123456789012345678,G-M=987654321098765432')).toEqual({
			'A-F': '123456789012345678',
			'G-M': '987654321098765432',
		});
		expect(parseCategoryMapInput('a-f:123456789012345678')).toEqual({ 'A-F': '123456789012345678' });
	});
});
