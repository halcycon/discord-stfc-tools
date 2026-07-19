import { describe, expect, it } from 'vitest';
import { gateWelcomeDmAttempt, WELCOME_DM_MAX_AUTO_ATTEMPTS } from '../src/welcome-dm-gate';
import { formatOnboardingPath } from '../src/onboarding-path';
import type { GuildConfig } from '../src/types';

describe('gateWelcomeDmAttempt', () => {
	it('allows first and second attempt', () => {
		expect(gateWelcomeDmAttempt({ sentAt: null, attempts: 0 }).allow).toBe(true);
		expect(gateWelcomeDmAttempt({ sentAt: null, attempts: 1 }).allow).toBe(true);
	});

	it('blocks after max auto attempts unless force', () => {
		const blocked = gateWelcomeDmAttempt({
			sentAt: null,
			attempts: WELCOME_DM_MAX_AUTO_ATTEMPTS,
		});
		expect(blocked).toEqual({ allow: false, reason: 'max_attempts' });
		expect(
			gateWelcomeDmAttempt({
				sentAt: null,
				attempts: WELCOME_DM_MAX_AUTO_ATTEMPTS,
				force: true,
			}).allow,
		).toBe(true);
	});

	it('skips when already sent or skip flag', () => {
		expect(gateWelcomeDmAttempt({ sentAt: '2026-01-01', attempts: 0 })).toEqual({
			allow: false,
			reason: 'already_sent',
		});
		expect(gateWelcomeDmAttempt({ sentAt: null, attempts: 0, skip: true })).toEqual({
			allow: false,
			reason: 'skip',
		});
	});
});

describe('formatOnboardingPath', () => {
	it('marks consent and welcome when enabled', () => {
		const text = formatOnboardingPath({
			mode: 'single_alliance',
			alliance_tag: 'ALPHA',
			deploy_mode: 'live',
			verification_enabled: true,
			data_consent_enabled: true,
			data_consent_version: '2026-07',
			agreement_enabled: true,
			agreement_timing: 'after_verify',
			agreement_mode: 'dm_button',
			agreement_version: '1',
			agreement_channel_id: '111',
			welcome_dm_enabled: true,
			welcome_dm_channel_id: '222222222222222222',
			welcome_dm_message_id: '333333333333333333',
		} as GuildConfig);
		expect(text).toContain('Onboarding path');
		expect(text).toContain('Data consent');
		expect(text).toContain('Code of Conduct');
		expect(text).toContain('Welcome DM');
		expect(text).toContain('send_welcome');
	});
});
