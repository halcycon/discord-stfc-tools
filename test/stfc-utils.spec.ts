import { describe, expect, it } from 'vitest';
import {
	coerceNumericPlayerId,
	extractAllianceRosterFromHtml,
	extractInitialPlayerFromHtml,
	extractInitialPlayerObject,
	extractPlayerArray,
	extractServerAlliancesFromHtml,
	mapRawPlayer,
	unwrapPlayerRow,
} from '../src/stfc-utils';

/** Escaped Next.js flight-style snippet (matches production stfc.pro HTML). */
const ESCAPED_INITIAL_PLAYER_HTML = `
self.__next_f.push([1,"...initialPlayer\\":{\\"playerid\\":1000000042,\\"owner\\":\\"TestPlayer\\",\\"level\\":60,\\"rankdesc\\":\\"Operative\\",\\"allianceid\\":1000000002,\\"tag\\":\\"ALPHA\\",\\"server\\":108,\\"region\\":\\"EU\\",\\"power\\":454183755,\\"max_power\\":476045465,\\"ahelps\\":141132,\\"ajoined\\":\\"2025-02-25T22:37:19\\"}..."])
`;

/** Escaped alliance page players blob (subset). Includes `"players":87` count before the array. */
const ESCAPED_ALLIANCE_PLAYERS_HTML = `
self.__next_f.push([1,"...\\"players\\":87,\\"public\\":true,\\"players\\":[{\\"playerid\\":1000000042,\\"owner\\":\\"TestPlayer\\",\\"name\\":\\"Example Alliance\\",\\"level\\":60,\\"rank\\":5,\\"rankdesc\\":\\"Operative\\",\\"allianceid\\":1000000002,\\"tag\\":\\"ALPHA\\",\\"server\\":108,\\"region\\":\\"EU\\",\\"power\\":454183755,\\"ajoined\\":\\"2025-02-25T22:37:19\\"},{\\"playerid\\":111,\\"owner\\":\\"OtherMember\\",\\"name\\":\\"Example Alliance\\",\\"level\\":40,\\"rankdesc\\":\\"Recruit\\",\\"allianceid\\":1000000002,\\"tag\\":\\"ALPHA\\",\\"server\\":108,\\"region\\":\\"EU\\",\\"power\\":1000}]..."])
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
		expect(coerceNumericPlayerId(1000000042)).toBe(1000000042);
		expect(coerceNumericPlayerId('1000000042')).toBe(1000000042);
		expect(coerceNumericPlayerId('TestPlayer')).toBeNull();
	});

	it('parses escaped initialPlayer JSON from HTML', () => {
		const obj = extractInitialPlayerObject(ESCAPED_INITIAL_PLAYER_HTML);
		expect(obj?.playerid).toBe(1000000042);
		expect(obj?.owner).toBe('TestPlayer');
		expect(obj?.tag).toBe('ALPHA');
	});

	it('maps HTML initialPlayer into PlayerData', () => {
		const player = extractInitialPlayerFromHtml(ESCAPED_INITIAL_PLAYER_HTML, 1, 'US');
		expect(player).not.toBeNull();
		expect(player?.playerId).toBe(1000000042);
		expect(player?.name).toBe('TestPlayer');
		expect(player?.allianceTag).toBe('ALPHA');
		expect(player?.rank).toBe('Operative');
		expect(player?.level).toBe(60);
		expect(player?.power).toBe(454183755);
		expect(player?.server).toBe(108);
		expect(player?.region).toBe('EU');
	});
});

describe('stfc-utils alliance roster HTML scrape', () => {
	it('parses embedded players array from alliance page HTML', () => {
		const scraped = extractAllianceRosterFromHtml(ESCAPED_ALLIANCE_PLAYERS_HTML, 108, 'EU');
		expect(scraped).not.toBeNull();
		expect(scraped?.allianceId).toBe('1000000002');
		expect(scraped?.allianceTag).toBe('ALPHA');
		expect(scraped?.allianceName).toBe('Example Alliance');
		expect(scraped?.players).toHaveLength(2);
		expect(scraped?.players[0]?.name).toBe('TestPlayer');
		expect(scraped?.players[0]?.rank).toBe('Operative');
		expect(scraped?.players[0]?.level).toBe(60);
		expect(scraped?.players[1]?.name).toBe('OtherMember');
		expect(scraped?.players[1]?.rank).toBe('Recruit');
	});
});

const ESCAPED_SERVER_ALLIANCES_HTML = `
self.__next_f.push([1,"...\\"alliances\\":188,\\"totalpower\\":1,\\"alliances\\":[{\\"id\\":1000000001,\\"tag\\":\\"BETA\\",\\"name\\":\\"Knights\\",\\"slogan\\":\\"Blue skies\\\\nsmiling at me\\",\\"server_rank\\":1,\\"players\\":105,\\"server\\":108,\\"region\\":\\"EU\\"},{\\"id\\":1000000002,\\"tag\\":\\"ALPHA\\",\\"name\\":\\"Other Alliance\\",\\"server_rank\\":9,\\"players\\":87,\\"server\\":108,\\"region\\":\\"EU\\"}]..."])
`;

describe('stfc-utils server alliance directory HTML scrape', () => {
	it('parses alliances array (skipping numeric count field)', () => {
		const entries = extractServerAlliancesFromHtml(ESCAPED_SERVER_ALLIANCES_HTML, 108, 'EU');
		expect(entries).toHaveLength(2);
		expect(entries[0]?.allianceTag).toBe('BETA');
		expect(entries[0]?.allianceId).toBe('1000000001');
		expect(entries[1]?.allianceTag).toBe('ALPHA');
		expect(entries[1]?.playerCount).toBe(87);
	});
});
