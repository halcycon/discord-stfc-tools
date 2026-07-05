import { describe, it, expect } from 'vitest';
import { parseStfcProUrl, resolveSearchTerm } from '../src/stfc-url';

describe('stfc-url', () => {
	it('parses player ID from URL', () => {
		const parsed = parseStfcProUrl('https://stfc.pro/player/12345?region=US&server=42');
		expect(parsed).not.toBeNull();
		expect(parsed!.playerId).toBe(12345);
		expect(parsed!.server).toBe(42);
		expect(parsed!.region).toBe('US');
	});

	it('rejects non-stfc.pro URLs', () => {
		expect(parseStfcProUrl('https://example.com/player/1')).toBeNull();
	});

	it('resolves search term from parsed URL', () => {
		const parsed = parseStfcProUrl('https://stfc.pro/player/999')!;
		expect(resolveSearchTerm(parsed)).toBe(999);
	});
});
