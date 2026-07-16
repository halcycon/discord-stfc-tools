import { describe, expect, it } from 'vitest';
import {
	buildLinkSuggestComponents,
	discordDisplayNick,
	formatLinkSuggestions,
	parseDiscordNick,
	suggestRosterDiscordLinks,
} from '../src/link-suggest';

describe('parseDiscordNick', () => {
	it('parses [TAG] (Adm) Name', () => {
		expect(parseDiscordNick('[KWSN] (Adm) Hal')).toEqual({
			tag: 'KWSN',
			name: 'Hal',
			rankToken: 'Adm',
		});
	});

	it('parses [TAG] Name', () => {
		expect(parseDiscordNick('[horus] Ada')).toEqual({
			tag: 'HORUS',
			name: 'Ada',
			rankToken: null,
		});
	});

	it('parses plain name', () => {
		expect(parseDiscordNick('PlainName')).toEqual({
			tag: null,
			name: 'PlainName',
			rankToken: null,
		});
	});
});

describe('suggestRosterDiscordLinks', () => {
	const roster = [
		{ playerId: 1, playerName: 'Ada', allianceTag: 'KWSN', opsLevel: 50 },
		{ playerId: 2, playerName: 'Bob', allianceTag: 'KWSN', opsLevel: 40 },
		{ playerId: 3, playerName: 'Cara', allianceTag: 'HORUS', opsLevel: 60 },
	];

	it('matches exact name with tag boost', () => {
		const suggestions = suggestRosterDiscordLinks(
			[
				{
					discordUserId: 'u1',
					username: 'x',
					serverNick: '[KWSN] Ada',
					globalName: null,
				},
			],
			roster,
		);
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]!.playerId).toBe(1);
		expect(suggestions[0]!.confidence).toBe('high');
		expect(suggestions[0]!.reason).toContain('TAG');
		expect(suggestions[0]!.serverNick).toBe('[KWSN] Ada');
	});

	it('shows global display name in Nick when server nick is unset', () => {
		expect(
			discordDisplayNick({ serverNick: null, globalName: 'AbInitio' }),
		).toBe('AbInitio');
		expect(
			discordDisplayNick({ serverNick: '[KOBY] Ada', globalName: 'AbInitio' }),
		).toBe('[KOBY] Ada');
		const text = formatLinkSuggestions([
			{
				discordUserId: '9',
				discordLabel: 'AbInitio',
				serverNick: null,
				globalName: 'AbInitio',
				username: 'optimusslim3',
				playerId: 1,
				playerName: 'AbInitio',
				allianceTag: 'KOBY',
				confidence: 'high',
				reason: 'exact name',
			},
		]);
		expect(text).toContain('AbInitio');
		expect(text).toContain('optimusslim3');
	});

	it('does not double-assign the same player', () => {
		const suggestions = suggestRosterDiscordLinks(
			[
				{ discordUserId: 'u1', username: 'a', serverNick: 'Ada', globalName: null },
				{ discordUserId: 'u2', username: 'b', serverNick: 'Ada', globalName: null },
			],
			roster,
		);
		expect(suggestions).toHaveLength(1);
	});

	it('formats empty and non-empty lists as table with Nick column', () => {
		expect(formatLinkSuggestions([], { rosterCount: 3, discordCount: 10 })).toContain(
			'No confident matches',
		);
		expect(formatLinkSuggestions([], { tag: 'KWSN', rosterCount: 0 })).toContain(
			'No unlinked roster players',
		);
		const text = formatLinkSuggestions([
			{
				discordUserId: '9',
				discordLabel: '[KWSN] Ada',
				serverNick: '[KWSN] Ada',
				globalName: null,
				username: 'ada_user',
				playerId: 1,
				playerName: 'Ada',
				allianceTag: 'KWSN',
				confidence: 'high',
				reason: 'exact name + [TAG]',
			},
		]);
		expect(text).toContain('```');
		expect(text).toContain('Nick');
		expect(text).toContain('[KWSN] Ada');
		expect(text).toContain('ada_user');
		expect(text).toContain('Buttons:');
		expect(text).toContain('🟢 **1**');
	});

	it('builds group Approve buttons for each confidence present', () => {
		const rows = buildLinkSuggestComponents(
			'123456789012345678',
			[
				{
					discordUserId: '111111111111111111',
					discordLabel: '[KWSN] Ada',
					serverNick: '[KWSN] Ada',
					globalName: null,
					username: 'ada',
					playerId: 42,
					playerName: 'Ada',
					allianceTag: 'KWSN',
					confidence: 'high',
					reason: 'exact',
				},
				{
					discordUserId: '222222222222222222',
					discordLabel: 'BobX',
					serverNick: null,
					globalName: 'BobX',
					username: 'bobx',
					playerId: 43,
					playerName: 'Bob',
					allianceTag: 'KWSN',
					confidence: 'medium',
					reason: 'fuzzy Δ1',
				},
				{
					discordUserId: '333333333333333333',
					discordLabel: 'Car',
					serverNick: 'Car',
					globalName: null,
					username: 'cara',
					playerId: 44,
					playerName: 'Cara',
					allianceTag: 'HORUS',
					confidence: 'low',
					reason: 'fuzzy Δ2',
				},
			],
			'KWSN',
		);
		expect(rows[0]!.components.map((c) => c.custom_id)).toEqual([
			'alink:grp:h:123456789012345678:KWSN',
			'alink:grp:m:123456789012345678:KWSN',
			'alink:grp:l:123456789012345678:KWSN',
		]);
		expect(rows[1]!.components[0]!.custom_id).toBe(
			'alink:1:123456789012345678:111111111111111111:42:KWSN',
		);
	});

	it('labels group Approve with per-click chunk when many matches', () => {
		const many = Array.from({ length: 5 }, (_, i) => ({
			discordUserId: String(111111111111111111n + BigInt(i)),
			discordLabel: `P${i}`,
			serverNick: `P${i}`,
			globalName: null as string | null,
			username: `u${i}`,
			playerId: i + 1,
			playerName: `P${i}`,
			allianceTag: 'KWSN',
			confidence: 'high' as const,
			reason: 'exact',
		}));
		const rows = buildLinkSuggestComponents('123456789012345678', many, 'KWSN', {
			approveChunkSize: 2,
		});
		expect(rows[0]!.components[0]!.label).toContain('2/click');
		expect(rows[0]!.components[0]!.custom_id).toContain('alink:grp:h:');
	});
});
