import { describe, expect, it } from 'vitest';
import {
	applyTestingPrefix,
	formatWouldHaveDemotionLine,
	isDeployTesting,
	parseDeployMode,
	withDeployModeContext,
} from '../src/deploy-mode';
import { decideDemotionCandidateAction } from '../src/demotion-policy';

describe('deploy mode helpers', () => {
	it('parses deploy mode (default live)', () => {
		expect(parseDeployMode('testing')).toBe('testing');
		expect(parseDeployMode('live')).toBe('live');
		expect(parseDeployMode(null)).toBe('live');
		expect(parseDeployMode(undefined)).toBe('live');
	});

	it('detects testing', () => {
		expect(isDeployTesting({ deploy_mode: 'testing' })).toBe(true);
		expect(isDeployTesting({ deploy_mode: 'live' })).toBe(false);
		expect(isDeployTesting(null)).toBe(false);
	});

	it('prefixes content from config or request context', async () => {
		expect(applyTestingPrefix('hello', { deploy_mode: 'testing' })).toBe('[TESTING] hello');
		expect(applyTestingPrefix('[TESTING] hello', { deploy_mode: 'testing' })).toBe(
			'[TESTING] hello',
		);
		expect(applyTestingPrefix('hello', { deploy_mode: 'live' })).toBe('hello');

		await withDeployModeContext({ deploy_mode: 'testing' }, async () => {
			expect(applyTestingPrefix('hi')).toBe('[TESTING] hi');
		});
		expect(applyTestingPrefix('hi')).toBe('hi');
	});

	it('formats would-have demotion lines', () => {
		const line = formatWouldHaveDemotionLine({
			discordUserId: '123',
			playerName: 'Ada',
			kind: 'alliance_mismatch',
			policy: 'approval',
		});
		expect(line).toContain('<@123>');
		expect(line).toContain('Ada');
		expect(line).toContain('urgent-channel approval');
	});
});

describe('outbound DM gating', () => {
	it('blocks production DMs in testing only', async () => {
		const { shouldSkipOutboundDm } = await import('../src/deploy-mode');
		expect(shouldSkipOutboundDm({ deploy_mode: 'testing' })).toBe(true);
		expect(shouldSkipOutboundDm({ deploy_mode: 'live' })).toBe(false);
		expect(shouldSkipOutboundDm(null)).toBe(false);
	});
});
