import { describe, expect, it } from 'vitest';
import {
	DAILY_SYNC_INVOCATION_BUDGET_MS,
	DAILY_SYNC_PLAYER_PAGE,
	DAILY_SYNC_SCRAPE_CHUNK,
} from '../src/daily-player-sync';

describe('daily player sync batching constants', () => {
	it('keeps invocation budget under the ~15 min scheduled wall limit', () => {
		expect(DAILY_SYNC_INVOCATION_BUDGET_MS).toBeLessThan(15 * 60 * 1000);
		expect(DAILY_SYNC_INVOCATION_BUDGET_MS).toBeGreaterThanOrEqual(10 * 60 * 1000);
	});

	it('scrapes multi alliances in small chunks', () => {
		expect(DAILY_SYNC_SCRAPE_CHUNK).toBeGreaterThanOrEqual(3);
		expect(DAILY_SYNC_SCRAPE_CHUNK).toBeLessThanOrEqual(15);
	});

	it('pages verified players with a stable cursor-sized batch', () => {
		expect(DAILY_SYNC_PLAYER_PAGE).toBeGreaterThanOrEqual(10);
		expect(DAILY_SYNC_PLAYER_PAGE).toBeLessThanOrEqual(100);
	});
});
