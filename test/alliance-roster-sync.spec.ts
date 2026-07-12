import { describe, expect, it } from 'vitest';
import { shouldUseAllianceRoster } from '../src/alliance-roster-sync';

describe('alliance roster multi-alliance safety', () => {
	it('enables roster only for single_alliance with a tag', () => {
		expect(
			shouldUseAllianceRoster({ mode: 'single_alliance', alliance_tag: 'KWSN' }),
		).toBe(true);
		expect(
			shouldUseAllianceRoster({ mode: 'single_alliance', alliance_tag: '  ' }),
		).toBe(false);
		expect(
			shouldUseAllianceRoster({ mode: 'single_alliance', alliance_tag: null }),
		).toBe(false);
	});

	it('never enables roster for multi_alliance (even with leftover tag)', () => {
		expect(
			shouldUseAllianceRoster({ mode: 'multi_alliance', alliance_tag: 'KWSN' }),
		).toBe(false);
		expect(
			shouldUseAllianceRoster({ mode: 'multi_alliance', alliance_tag: null }),
		).toBe(false);
	});
});
