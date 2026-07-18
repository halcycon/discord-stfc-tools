import { describe, expect, it } from 'vitest';
import {
	needsDataConsent,
	parseConsentCustomId,
	playerHasDataConsent,
	consentYesCustomId,
	consentNoCustomId,
	requiredDataConsentVersion,
} from '../src/data-consent';
import type { GuildConfig } from '../src/types';

function cfg(overrides: Partial<GuildConfig> = {}): GuildConfig {
	return {
		guild_id: '1',
		mode: 'single_alliance',
		stfc_server: 1,
		stfc_region: 'US',
		alliance_tag: 'TAG',
		guest_role_id: null,
		member_role_ids: [],
		operative_role_ids: [],
		agent_role_ids: [],
		premier_role_ids: [],
		commodore_role_ids: [],
		admiral_role_ids: [],
		overlay_buckets: {},
		alliance_role_prefix: null,
		nickname_template: null,
		nickname_display_ranks: ["Operative","Agent","Premier","Commodore","Admiral"],
		verification_log_channel_id: null,
		audit_log_channel_id: null,
		urgent_notify_channel_id: null,
		channel_category_map: {},
		personal_channel_extra_roles: [],
		personal_channel_perm_template: null,
		personal_channel_archive_category_id: null,
		diplomacy_enabled: false,
		diplomacy_category_id: null,
		diplomacy_category_map: {},
		diplomacy_archive_category_id: null,
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
		data_consent_enabled: true,
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

describe('data consent', () => {
	it('disabled = no gate', () => {
		const c = cfg({ data_consent_enabled: false });
		expect(needsDataConsent(c, null)).toBe(false);
		expect(playerHasDataConsent(c, null)).toBe(true);
	});

	it('enabled blocks until accepted at current version', () => {
		const c = cfg();
		expect(needsDataConsent(c, null)).toBe(true);
		expect(
			playerHasDataConsent(c, {
				data_consent_at: '2026-07-11',
				data_consent_version: '1',
				data_consent_choice: 'accepted',
			}),
		).toBe(true);
		expect(
			needsDataConsent(c, {
				data_consent_at: '2026-07-11',
				data_consent_version: '1',
				data_consent_choice: 'declined',
			}),
		).toBe(true);
	});

	it('version bump requires re-consent', () => {
		const c = cfg({ data_consent_version: '2' });
		expect(requiredDataConsentVersion(c)).toBe('2');
		expect(
			playerHasDataConsent(c, {
				data_consent_at: '2026-07-11',
				data_consent_version: '1',
				data_consent_choice: 'accepted',
			}),
		).toBe(false);
	});

	it('parses yes/no custom ids', () => {
		expect(consentYesCustomId('123456789012345678')).toBe('consent:yes:123456789012345678');
		expect(consentNoCustomId('123456789012345678')).toBe('consent:no:123456789012345678');
		expect(parseConsentCustomId('consent:yes:123456789012345678')).toEqual({
			guildId: '123456789012345678',
			choice: 'accepted',
		});
		expect(parseConsentCustomId('consent:no:123456789012345678')).toEqual({
			guildId: '123456789012345678',
			choice: 'declined',
		});
		expect(parseConsentCustomId('consent:maybe:1')).toBeNull();
	});
});
