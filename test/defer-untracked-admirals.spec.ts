import { describe, expect, it } from 'vitest';
import {
	isAllianceExplicitlyTracked,
	shouldDeferUntrackedAdmiralRoles,
	shouldDeferUntrackedDiplomacy,
} from '../src/tracked-alliance-tags';
import { getMemberRoleIdsForRank } from '../src/verification-access';
import type { GuildConfig } from '../src/types';

function baseConfig(over: Partial<GuildConfig> = {}): GuildConfig {
	return {
		guild_id: '1',
		mode: 'multi_alliance',
		stfc_server: 1,
		stfc_region: 'US',
		alliance_tag: null,
		stfc_alliance_id: null,
		guest_role_id: null,
		member_role_ids: ['111'],
		operative_role_ids: [],
		agent_role_ids: [],
		premier_role_ids: [],
		commodore_role_ids: [],
		admiral_role_ids: ['222'],
		overlay_buckets: {
			leadership: { ranks: ['Admiral', 'Commodore'], role_ids: ['333'] },
		},
		alliance_role_prefix: null,
		nickname_template: null,
		nickname_display_ranks: [],
		verification_log_channel_id: null,
		audit_log_channel_id: null,
		urgent_notify_channel_id: null,
		channel_category_map: {},
		personal_channel_extra_roles: [],
		personal_channel_perm_template: null,
		personal_channel_archive_category_id: null,
		diplomacy_enabled: true,
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
		defer_untracked_admiral_roles: true,
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
		data_consent_version: null,
		agreement_enabled: false,
		agreement_timing: 'after_verify',
		agreement_mode: 'dm_button',
		agreement_version: null,
		agreement_channel_id: null,
		demotion_policy: 'approval',
		verification_invite_mode: 'dm',
		verify_panel_channel_id: null,
		verify_panel_message_id: null,
		demotion_notify: 'dm',
		deploy_mode: 'live',
		welcome_dm_enabled: false,
		welcome_dm_channel_id: null,
		welcome_dm_message_id: null,
		poll_interval_hours: 6,
		verification_enabled: true,
		created_at: '',
		updated_at: '',
		...over,
	};
}

describe('defer untracked admiral roles', () => {
	it('treats explicit track + diplomacy map as tracked', () => {
		expect(
			isAllianceExplicitlyTracked(
				{ tracked_alliance_tags: ['ALPHA'], diplomacy_channel_map: {} },
				'alpha',
			),
		).toBe(true);
		expect(
			isAllianceExplicitlyTracked(
				{ tracked_alliance_tags: [], diplomacy_channel_map: { ABC: '99' } },
				'abc',
			),
		).toBe(true);
		expect(
			isAllianceExplicitlyTracked(
				{ tracked_alliance_tags: [], diplomacy_channel_map: {} },
				'XYZ',
			),
		).toBe(false);
	});

	it('defers only Admirals of untracked alliances when flag on', () => {
		const cfg = baseConfig();
		expect(shouldDeferUntrackedAdmiralRoles(cfg, 'XYZ', 'Admiral')).toBe(true);
		expect(shouldDeferUntrackedAdmiralRoles(cfg, 'XYZ', 'Commodore')).toBe(false);
		expect(shouldDeferUntrackedAdmiralRoles(cfg, 'ALPHA', 'Admiral')).toBe(true);
		expect(
			shouldDeferUntrackedAdmiralRoles(
				baseConfig({ tracked_alliance_tags: ['ALPHA'] }),
				'ALPHA',
				'Admiral',
			),
		).toBe(false);
		expect(
			shouldDeferUntrackedAdmiralRoles(baseConfig({ defer_untracked_admiral_roles: false }), 'XYZ', 'Admiral'),
		).toBe(false);
	});

	it('defers diplomacy for untracked tags when flag on', () => {
		const cfg = baseConfig();
		expect(shouldDeferUntrackedDiplomacy(cfg, 'XYZ')).toBe(true);
		expect(shouldDeferUntrackedDiplomacy(baseConfig({ tracked_alliance_tags: ['XYZ'] }), 'XYZ')).toBe(
			false,
		);
	});

	it('omits admiral + overlay roles when deferred', () => {
		const cfg = baseConfig();
		expect(getMemberRoleIdsForRank(cfg, 'Admiral', 'XYZ').sort()).toEqual(['111']);
		expect(getMemberRoleIdsForRank(cfg, 'Admiral', 'ALPHA').sort()).toEqual(['111']);
		expect(
			getMemberRoleIdsForRank(baseConfig({ tracked_alliance_tags: ['ALPHA'] }), 'Admiral', 'ALPHA').sort(),
		).toEqual(['111', '222', '333']);
	});
});
