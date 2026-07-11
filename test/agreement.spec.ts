import { describe, expect, it } from 'vitest';
import {
	needsAgreementBeforeFullAccess,
	needsAgreementBeforeVerify,
	playerHasAcceptedAgreement,
	parseAgreeCustomId,
	agreeCustomId,
} from '../src/agreement';
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
		verification_log_channel_id: null,
		audit_log_channel_id: null,
		channel_category_map: {},
		personal_channel_extra_roles: [],
		personal_channel_archive_category_id: null,
		diplomacy_enabled: false,
		diplomacy_category_id: null,
		diplomacy_channel_map: {},
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
		dm_ai_enabled: false,
		agreement_enabled: true,
		agreement_timing: 'after_verify',
		agreement_mode: 'dm_button',
		agreement_channel_id: null,
		agreement_message_id: null,
		agreement_version: '2026-07',
		poll_interval_hours: 6,
		verification_enabled: true,
		created_at: '',
		updated_at: '',
		...overrides,
	};
}

describe('agreement gates', () => {
	it('disabled = always accepted', () => {
		const c = cfg({ agreement_enabled: false });
		expect(playerHasAcceptedAgreement(c, null)).toBe(true);
		expect(needsAgreementBeforeVerify(c, null)).toBe(false);
		expect(needsAgreementBeforeFullAccess(c, null)).toBe(false);
	});

	it('after_verify gates full access until accept', () => {
		const c = cfg({ agreement_timing: 'after_verify' });
		expect(needsAgreementBeforeVerify(c, null)).toBe(false);
		expect(needsAgreementBeforeFullAccess(c, null)).toBe(true);
		expect(
			needsAgreementBeforeFullAccess(c, {
				agreement_accepted_at: '2026-07-11',
				agreement_version: '2026-07',
			}),
		).toBe(false);
	});

	it('before_verify blocks verify until accept', () => {
		const c = cfg({ agreement_timing: 'before_verify' });
		expect(needsAgreementBeforeVerify(c, null)).toBe(true);
		expect(needsAgreementBeforeFullAccess(c, null)).toBe(false);
	});

	it('version mismatch requires re-accept', () => {
		const c = cfg({ agreement_version: '2026-08' });
		expect(
			playerHasAcceptedAgreement(c, {
				agreement_accepted_at: '2026-07-01',
				agreement_version: '2026-07',
			}),
		).toBe(false);
	});

	it('parses agree custom ids', () => {
		expect(agreeCustomId('123456789012345678')).toBe('agree:123456789012345678');
		expect(parseAgreeCustomId('agree:123456789012345678')).toEqual({
			guildId: '123456789012345678',
		});
		expect(parseAgreeCustomId('agree:nope')).toBeNull();
	});
});
