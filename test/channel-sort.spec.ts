import { describe, expect, it } from 'vitest';
import { compareChannelNamesAlpha } from '../src/channel-sort';

describe('compareChannelNamesAlpha', () => {
	it('orders case-insensitively with numeric awareness', () => {
		const names = ['zeta', 'Adam', 'bob2', 'bob10', 'ålice'];
		const sorted = [...names].sort(compareChannelNamesAlpha);
		expect(sorted).toEqual(['Adam', 'ålice', 'bob2', 'bob10', 'zeta']);
	});
});
