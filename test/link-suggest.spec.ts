import { describe, expect, it } from 'vitest';
import {
	buildLinkSuggestComponents,
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
			[{ discordUserId: 'u1', username: 'x', nick: '[KWSN] Ada' }],
			roster,
		);
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]!.playerId).toBe(1);
		expect(suggestions[0]!.confidence).toBe('high');
		expect(suggestions[0]!.reason).toContain('TAG');
	});

	it('does not double-assign the same player', () => {
		const suggestions = suggestRosterDiscordLinks(
			[
				{ discordUserId: 'u1', username: 'a', nick: 'Ada' },
				{ discordUserId: 'u2', username: 'b', nick: 'Ada' },
			],
			roster,
		);
		expect(suggestions).toHaveLength(1);
	});

	it('formats empty and non-empty lists', () => {
		expect(formatLinkSuggestions([], { rosterCount: 3, discordCount: 10 })).toContain(
			'No confident matches',
		);
		expect(formatLinkSuggestions([], { tag: 'KWSN', rosterCount: 0 })).toContain(
			'No unlinked roster players',
		);
		expect(
			formatLinkSuggestions([
				{
					discordUserId: '9',
					discordLabel: '[KWSN] Ada',
					playerId: 1,
					playerName: 'Ada',
					allianceTag: 'KWSN',
					confidence: 'high',
					reason: 'exact name + [TAG]',
				},
			]),
		).toContain('<@9>');
		expect(formatLinkSuggestions([
			{
				discordUserId: '9',
				discordLabel: '[KWSN] Ada',
				playerId: 1,
				playerName: 'Ada',
				allianceTag: 'KWSN',
				confidence: 'high',
				reason: 'exact name + [TAG]',
			},
		])).toContain('buttons below');
	});

	it('builds Approve buttons including Approve-all-high', () => {
		const rows = buildLinkSuggestComponents(
			'123456789012345678',
			[
				{
					discordUserId: '111111111111111111',
					discordLabel: '[KWSN] Ada',
					playerId: 42,
					playerName: 'Ada',
					allianceTag: 'KWSN',
					confidence: 'high',
					reason: 'exact',
				},
			],
			'KWSN',
		);
		expect(rows[0]!.components[0]!.custom_id).toBe(
			'alink:high:123456789012345678:KWSN',
		);
		expect(rows[1]!.components[0]!.custom_id).toBe(
			'alink:1:123456789012345678:111111111111111111:42:KWSN',
		);
	});

	it('labels Approve-all with per-click chunk when many high matches', () => {
		const many = Array.from({ length: 5 }, (_, i) => ({
			discordUserId: String(111111111111111111n + BigInt(i)),
			discordLabel: `P${i}`,
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
	});
});
