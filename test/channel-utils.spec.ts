import { describe, expect, it } from 'vitest';
import {
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
		alliance_role_prefix: null,
		nickname_template: null,
		verification_log_channel_id: null,
		diplomacy_enabled: false,
		diplomacy_category_id: null,
		diplomacy_channel_map: {},
		diplomacy_everyone_can_view: true,
		diplomacy_view_role_ids: [],
		diplomacy_write_role_ids: [],
		diplomacy_write_ranks: ['Commodore', 'Admiral'],
		diplomacy_name_template: null,
		survey_creator_role_ids: [],
		survey_results_role_ids: [],
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
	});

	it('slugPersonalChannelName sanitizes names', () => {
		expect(slugPersonalChannelName('Halcynicon', '123')).toBe('halcynicon');
		expect(slugPersonalChannelName('A. Player', '123')).toBe('a-player');
	});

	it('parseCategoryMapInput parses bulk maps', () => {
		expect(parseCategoryMapInput('A-F=123456789012345678,G-M=987654321098765432')).toEqual({
			'A-F': '123456789012345678',
			'G-M': '987654321098765432',
		});
		expect(parseCategoryMapInput('a-f:123456789012345678')).toEqual({ 'A-F': '123456789012345678' });
	});
});
