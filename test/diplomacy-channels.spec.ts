import { describe, expect, it } from 'vitest';
import {
	diplomacyChannelsEnabled,
	diplomacyWriteRoleIds,
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
		alliance_role_prefix: null,
		nickname_template: null,
		verification_log_channel_id: null,
		diplomacy_enabled: true,
		diplomacy_category_id: null,
		diplomacy_channel_map: {},
		diplomacy_everyone_can_view: true,
		diplomacy_view_role_ids: [],
		diplomacy_write_role_ids: ['999999999999999999'],
		diplomacy_write_ranks: ['Commodore', 'Admiral'],
		diplomacy_name_template: null,
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
});
