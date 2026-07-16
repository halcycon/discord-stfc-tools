import { describe, expect, it } from 'vitest';
import {
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
		expect(formatLinkSuggestions([])).toContain('No confident matches');
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
	});
});
