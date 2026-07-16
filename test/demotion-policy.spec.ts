import { describe, expect, it } from 'vitest';
import {
	decideDemotionCandidateAction,
	isAlreadyDemotedGuest,
} from '../src/demotion-policy';
import { playerMatchesGuildAlliance } from '../src/verification-access';

describe('decideDemotionCandidateAction', () => {
	it('approval always enqueues for approval', () => {
		expect(decideDemotionCandidateAction('approval', 'alliance_mismatch')).toEqual({
			action: 'enqueue_approval',
		});
		expect(decideDemotionCandidateAction('approval', 'player_missing')).toEqual({
			action: 'enqueue_approval',
		});
	});

	it('yolo demotes mismatches immediately and rechecks missing', () => {
		expect(decideDemotionCandidateAction('yolo', 'alliance_mismatch')).toEqual({
			action: 'demote_now',
		});
		expect(decideDemotionCandidateAction('yolo', 'player_missing')).toEqual({
			action: 'enqueue_recheck',
		});
	});
});

describe('isAlreadyDemotedGuest', () => {
	it('skips guests so daily sync does not re-queue completed demotions', () => {
		expect(isAlreadyDemotedGuest({ verification_status: 'guest' })).toBe(true);
		expect(isAlreadyDemotedGuest({ verification_status: 'active' })).toBe(false);
		expect(isAlreadyDemotedGuest({ verification_status: 'verified' })).toBe(false);
	});
});

describe('multi-alliance empty tag is not a demotion candidate', () => {
	it('matches empty tag on multi_alliance', () => {
		expect(
			playerMatchesGuildAlliance(
				{ mode: 'multi_alliance', alliance_tag: null },
				'',
			),
		).toBe(true);
		expect(
			playerMatchesGuildAlliance(
				{ mode: 'multi_alliance', alliance_tag: null },
				null,
			),
		).toBe(true);
	});

	it('rejects empty tag on single_alliance', () => {
		expect(
			playerMatchesGuildAlliance(
				{ mode: 'single_alliance', alliance_tag: 'KWSN' },
				'',
			),
		).toBe(false);
	});
});
