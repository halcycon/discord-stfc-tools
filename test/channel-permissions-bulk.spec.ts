import { describe, expect, it } from 'vitest';
import {
	resolvePresetBits,
	type BulkPermPreset,
} from '../src/channel-permissions-bulk';
import {
	DEFAULT_PERSONAL_CHANNEL_BOT_ALLOW,
	DEFAULT_PERSONAL_CHANNEL_MEMBER_ALLOW,
} from '../src/personal-channel-perm-template';
import type { GuildConfig } from '../src/types';

function minimalConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
	return {
		guild_id: '1',
		mode: 'single_alliance',
		stfc_server: 1,
		stfc_region: 'EU',
		alliance_tag: 'T',
		guest_role_id: null,
		member_role_ids: [],
		operative_role_ids: [],
		agent_role_ids: [],
		premier_role_ids: [],
		commodore_role_ids: [],
		admiral_role_ids: [],
		overlay_buckets: {},
		channel_category_map: {},
		personal_channel_extra_roles: ['111'],
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
		diplomacy_soft_limit: 45,
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
		verification_invite_mode: 'dm',
		verify_panel_channel_id: null,
		verify_panel_message_id: null,
		demotion_notify: 'dm',
		deploy_mode: 'testing',
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

describe('bulk permissions presets', () => {
	it('resolves bot / member / view_send presets', () => {
		const config = minimalConfig();
		expect(resolvePresetBits('bot', config).allow).toBe(DEFAULT_PERSONAL_CHANNEL_BOT_ALLOW);
		expect(resolvePresetBits('member', config).allow).toBe(DEFAULT_PERSONAL_CHANNEL_MEMBER_ALLOW);
		const vs = resolvePresetBits('view_send' as BulkPermPreset, config);
		expect(BigInt(vs.allow) & 0x400n).toBe(0x400n);
		expect(BigInt(vs.allow) & 0x8n).toBe(0n);
	});
});
