import { describe, expect, it } from 'vitest';
import {
	coerceNumericPlayerId,
	extractInitialPlayerFromHtml,
	extractInitialPlayerObject,
	extractPlayerArray,
	mapRawPlayer,
	unwrapPlayerRow,
} from '../src/stfc-utils';

/** Escaped Next.js flight-style snippet (matches production stfc.pro HTML). */
const ESCAPED_INITIAL_PLAYER_HTML = `
self.__next_f.push([1,"...initialPlayer\\":{\\"playerid\\":3563194597,\\"owner\\":\\"Knightstalker001\\",\\"level\\":60,\\"rankdesc\\":\\"Operative\\",\\"allianceid\\":2990767785,\\"tag\\":\\"KWSN\\",\\"server\\":108,\\"region\\":\\"EU\\",\\"power\\":454183755,\\"max_power\\":476045465,\\"ahelps\\":141132,\\"ajoined\\":\\"2025-02-25T22:37:19\\"}..."])
`;

describe('stfc-utils player response parsing', () => {
	it('unwraps nested { data: player } rows from the new API', () => {
		const row = unwrapPlayerRow({
			data: { playerid: 42, owner: 'Ada', tag: 'TEST', level: 50, power: 1000 },
		});
		expect(row?.playerid).toBe(42);
		expect(mapRawPlayer(row, 1, 'US').name).toBe('Ada');
		expect(mapRawPlayer(row, 1, 'US').allianceTag).toBe('TEST');
	});

	it('extracts players from new uncompressed response shape', () => {
		const players = extractPlayerArray({
			count: 2,
			players: [
				{ data: { playerid: 1, owner: 'A', tag: 'AA', level: 10, power: 1 } },
				{ data: { playerid: 2, owner: 'B', tag: 'BB', level: 20, power: 2 } },
			],
			lastcached: '2026-01-01',
		});
		expect(players).toHaveLength(2);
		expect(players[0].playerid).toBe(1);
		expect(players[1].owner).toBe('B');
	});

	it('extracts flat arrays (legacy)', () => {
		const players = extractPlayerArray([
			{ playerid: 9, owner: 'Legacy', tag: 'LG', level: 1, power: 1 },
		]);
		expect(players).toHaveLength(1);
		expect(players[0].playerid).toBe(9);
	});
});

describe('stfc-utils HTML profile scrape', () => {
	it('coerces numeric string IDs', () => {
		expect(coerceNumericPlayerId(3563194597)).toBe(3563194597);
		expect(coerceNumericPlayerId('3563194597')).toBe(3563194597);
		expect(coerceNumericPlayerId('Knightstalker001')).toBeNull();
	});

	it('parses escaped initialPlayer JSON from HTML', () => {
		const obj = extractInitialPlayerObject(ESCAPED_INITIAL_PLAYER_HTML);
		expect(obj?.playerid).toBe(3563194597);
		expect(obj?.owner).toBe('Knightstalker001');
		expect(obj?.tag).toBe('KWSN');
	});

	it('maps HTML initialPlayer into PlayerData', () => {
		const player = extractInitialPlayerFromHtml(ESCAPED_INITIAL_PLAYER_HTML, 1, 'US');
		expect(player).not.toBeNull();
		expect(player?.playerId).toBe(3563194597);
		expect(player?.name).toBe('Knightstalker001');
		expect(player?.allianceTag).toBe('KWSN');
		expect(player?.rank).toBe('Operative');
		expect(player?.level).toBe(60);
		expect(player?.power).toBe(454183755);
		expect(player?.server).toBe(108);
		expect(player?.region).toBe('EU');
	});
});
