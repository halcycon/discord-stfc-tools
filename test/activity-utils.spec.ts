import { describe, expect, it } from 'vitest';
import { applyActivityObservation, formatActivityBits } from '../src/activity-utils';

describe('applyActivityObservation', () => {
	it('clears inactive when streak is positive', () => {
		const snap = applyActivityObservation(0, 5, 12);
		expect(snap.activityStreak).toBe(12);
		expect(snap.daysInactive).toBe(0);
		expect(snap.returnedActive).toBe(true);
		expect(snap.becameInactive).toBe(false);
	});

	it('starts inactive counter on first zero streak', () => {
		const snap = applyActivityObservation(40, 0, 0);
		expect(snap.activityStreak).toBe(0);
		expect(snap.daysInactive).toBe(1);
		expect(snap.becameInactive).toBe(true);
		expect(snap.inactiveDayAdded).toBe(false);
	});

	it('increments days inactive while streak stays zero', () => {
		const snap = applyActivityObservation(0, 3, 0);
		expect(snap.daysInactive).toBe(4);
		expect(snap.becameInactive).toBe(false);
		expect(snap.inactiveDayAdded).toBe(true);
	});

	it('formats activity bits', () => {
		expect(formatActivityBits({ activityStreak: 10, daysInactive: 0 })).toBe('streak 10');
		expect(formatActivityBits({ activityStreak: 0, daysInactive: 4 })).toBe(
			'streak 0 · inactive 4d',
		);
	});
});
