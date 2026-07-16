import { describe, expect, it } from 'vitest';
import { formatGoLiveDmPreview, type GoLiveDmPreview } from '../src/go-live-dm-preview';

function emptyPreview(over: Partial<GoLiveDmPreview> = {}): GoLiveDmPreview {
	return {
		inviteCount: 0,
		welcomeCount: 0,
		invites: [],
		welcomes: [],
		welcomeConfigured: true,
		verificationEnabled: true,
		...over,
	};
}

describe('formatGoLiveDmPreview', () => {
	it('reports empty backlog clearly', () => {
		const text = formatGoLiveDmPreview(emptyPreview());
		expect(text).toContain('no** automated DMs');
		expect(text).toContain('Verification invites** (0)');
		expect(text).toContain('Welcome DMs** (0)');
	});

	it('lists invite and welcome recipients with counts', () => {
		const text = formatGoLiveDmPreview(
			emptyPreview({
				inviteCount: 1,
				welcomeCount: 1,
				invites: [
					{
						guild_id: 'g',
						discord_user_id: '111',
						username: 'newbie',
						first_seen_at: '2026-01-01',
						verification_invited_at: null,
					},
				],
				welcomes: [
					{
						id: 1,
						guild_id: 'g',
						discord_user_id: '222',
						player_id: 9,
						player_name: 'Ada',
						alliance_tag: 'TAG',
						alliance_rank: null,
						ops_level: 50,
						power: 1,
						grade: 4,
						stfc_pro_url: null,
						verification_status: 'active',
						personal_channel_id: null,
						preferred_locale: null,
						data_consent_at: null,
						data_consent_version: null,
						agreement_accepted_at: null,
						agreement_version: null,
						agreement_method: null,
						activity_streak: 0,
						days_inactive: 0,
						welcome_dm_sent_at: null,
						welcome_dm_attempts: 0,
						verified_at: null,
						last_synced_at: null,
						created_at: '',
						updated_at: '',
					} as GoLiveDmPreview['welcomes'][number],
				],
			}),
		);
		expect(text).toContain('**2** user(s)');
		expect(text).toContain('<@111>');
		expect(text).toContain('newbie');
		expect(text).toContain('<@222>');
		expect(text).toContain('Ada');
		expect(text).toContain('≤5 min');
		expect(text).toContain('batches of 40');
	});

	it('notes when verification or welcome is off', () => {
		expect(
			formatGoLiveDmPreview(emptyPreview({ verificationEnabled: false })),
		).toContain('Verification disabled');
		expect(
			formatGoLiveDmPreview(emptyPreview({ welcomeConfigured: false })),
		).toContain('Welcome DM not configured');
	});
});
