/**
 * stfc.pro exposes `consecutive_days_active` (0 = no current login streak).
 * We store that as activity_streak and derive days_inactive day-over-day.
 */

export type ActivitySnapshot = {
	/** stfc.pro consecutive_days_active (≥0). */
	activityStreak: number;
	daysInactive: number;
	/** Became inactive this sync (streak went to 0 from >0, or first observed 0). */
	becameInactive: boolean;
	/** Returned from inactivity (streak >0 after days_inactive >0). */
	returnedActive: boolean;
	/** days_inactive incremented (still inactive). */
	inactiveDayAdded: boolean;
};

/**
 * Apply one successful sync observation of consecutive_days_active.
 * - streak > 0 → record streak, clear days_inactive
 * - streak === 0 → clear streak, increment days_inactive (or set to 1)
 * Does not run when the scrape omitted the field (pass null / undefined → no-op caller-side).
 */
export function applyActivityObservation(
	previousStreak: number | null | undefined,
	previousDaysInactive: number | null | undefined,
	observedStreak: number,
): ActivitySnapshot {
	const prevDays = Math.max(0, Number(previousDaysInactive ?? 0) || 0);
	const prevStreak =
		previousStreak == null || !Number.isFinite(Number(previousStreak))
			? null
			: Math.max(0, Math.floor(Number(previousStreak)));
	const streak = Math.max(0, Math.floor(Number(observedStreak) || 0));

	if (streak > 0) {
		return {
			activityStreak: streak,
			daysInactive: 0,
			becameInactive: false,
			returnedActive: prevDays > 0,
			inactiveDayAdded: false,
		};
	}

	// streak === 0
	const daysInactive = prevDays > 0 ? prevDays + 1 : 1;
	return {
		activityStreak: 0,
		daysInactive,
		becameInactive: prevDays === 0,
		returnedActive: false,
		inactiveDayAdded: prevDays > 0,
	};
}

export function formatActivityBits(opts: {
	activityStreak?: number | null;
	daysInactive?: number | null;
}): string {
	const streak = opts.activityStreak;
	const days = opts.daysInactive;
	const parts: string[] = [];
	if (streak != null && Number.isFinite(streak)) {
		parts.push(streak > 0 ? `streak ${streak}` : 'streak 0');
	}
	if (days != null && Number.isFinite(days) && days > 0) {
		parts.push(`inactive ${days}d`);
	}
	return parts.length ? parts.join(' · ') : '';
}
