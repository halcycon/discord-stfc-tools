import { describe, expect, it } from 'vitest';
import {
	archivePersonalChannelOnDemotion,
	demotePlayerToGuest,
	playerMatchesGuildAlliance,
} from '../src/verification-access';
import type { GuildConfig } from '../src/types';

function baseConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
	return {
		guild_id: '1',
		mode: 'single_alliance',
		stfc_server: 108,
		stfc_region: 'EU',
		alliance_tag: 'KWSN',
		guest_role_id: '999999999999999999',
		member_role_ids: ['111111111111111111'],
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

describe('playerMatchesGuildAlliance', () => {
	it('matches same tag case-insensitively on single_alliance', () => {
		expect(playerMatchesGuildAlliance(baseConfig(), 'kwsn')).toBe(true);
		expect(playerMatchesGuildAlliance(baseConfig(), 'KWSN')).toBe(true);
	});

	it('treats empty / wrong tag as mismatch on single_alliance', () => {
		expect(playerMatchesGuildAlliance(baseConfig(), '')).toBe(false);
		expect(playerMatchesGuildAlliance(baseConfig(), null)).toBe(false);
		expect(playerMatchesGuildAlliance(baseConfig(), 'OTHER')).toBe(false);
	});

	it('always matches on multi_alliance even with empty tag', () => {
		const config = baseConfig({ mode: 'multi_alliance', alliance_tag: null });
		expect(playerMatchesGuildAlliance(config, '')).toBe(true);
		expect(playerMatchesGuildAlliance(config, 'ANY')).toBe(true);
	});
});

describe('demotePlayerToGuest', () => {
	it('requires guest_role for admin demote', async () => {
		const result = await demotePlayerToGuest({} as Env, baseConfig({ guest_role_id: null }), 'g', 'u', {
			reason: 'admin',
			requireGuestRole: true,
		});
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/guest_role/i);
	});

	it('requires bot token after guest role check', async () => {
		const result = await demotePlayerToGuest({} as Env, baseConfig(), 'g', 'u', {
			reason: 'admin',
			requireGuestRole: true,
		});
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/DISCORD_BOT_TOKEN/i);
	});
});

describe('archivePersonalChannelOnDemotion', () => {
	it('returns false when archive category is not configured', async () => {
		const archived = await archivePersonalChannelOnDemotion(
			'token',
			baseConfig({ personal_channel_archive_category_id: null }),
			'123456789012345678',
		);
		expect(archived).toBe(false);
	});

	it('returns false when channel id is missing', async () => {
		const archived = await archivePersonalChannelOnDemotion(
			'token',
			baseConfig({ personal_channel_archive_category_id: '123456789012345678' }),
			null,
		);
		expect(archived).toBe(false);
	});
});
