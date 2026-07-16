import { describe, it, expect } from 'vitest';
import {
	abbreviateAllianceRank,
	buildMemberNickname,
	defaultNicknameTemplate,
	DISCORD_NICK_MAX,
	normalizeAllianceRank,
} from '../src/nickname-utils';

describe('nickname-utils', () => {
	it('normalizes alliance ranks (full and abbrev)', () => {
		expect(normalizeAllianceRank('admiral')).toBe('Admiral');
		expect(normalizeAllianceRank(' COMMODORE ')).toBe('Commodore');
		expect(normalizeAllianceRank('adm')).toBe('Admiral');
		expect(normalizeAllianceRank('op')).toBe('Operative');
		expect(normalizeAllianceRank('nope')).toBeNull();
	});

	it('abbreviates ranks for nicknames', () => {
		expect(abbreviateAllianceRank('Admiral')).toBe('Adm');
		expect(abbreviateAllianceRank('Commodore')).toBe('Com');
		expect(abbreviateAllianceRank('Premier')).toBe('Pr');
		expect(abbreviateAllianceRank('Operative')).toBe('Op');
		expect(abbreviateAllianceRank('Agent')).toBe('Ag');
	});

	it('uses mode defaults when template is empty', () => {
		expect(defaultNicknameTemplate('single_alliance')).toBe('{rank_prefix}{player_name}');
		expect(defaultNicknameTemplate('multi_alliance')).toBe(
			'[{alliance_tag}]{rank_paren} {player_name}',
		);
	});

	it('single-alliance: leadership prefix only for Premier/Commodore/Admiral', () => {
		expect(
			buildMemberNickname(null, 'single_alliance', {
				name: 'Adam',
				allianceTag: 'HORUS',
				rank: 'Admiral',
			}),
		).toBe('[Adm] Adam');

		expect(
			buildMemberNickname(null, 'single_alliance', {
				name: 'Adam',
				allianceTag: 'HORUS',
				rank: 'Commodore',
			}),
		).toBe('[Com] Adam');

		expect(
			buildMemberNickname(null, 'single_alliance', {
				name: 'Adam',
				allianceTag: 'HORUS',
				rank: 'Premier',
			}),
		).toBe('[Pr] Adam');

		expect(
			buildMemberNickname(null, 'single_alliance', {
				name: 'Adam',
				allianceTag: 'HORUS',
				rank: 'Operative',
			}),
		).toBe('Adam');

		expect(
			buildMemberNickname(null, 'single_alliance', {
				name: 'Adam',
				allianceTag: 'HORUS',
				rank: 'Agent',
			}),
		).toBe('Adam');
	});

	it('multi-alliance: tag plus abbreviated rank paren when rank known', () => {
		expect(
			buildMemberNickname(null, 'multi_alliance', {
				name: 'Adam',
				allianceTag: 'HORUS',
				rank: 'Admiral',
			}),
		).toBe('[HORUS] (Adm) Adam');

		expect(
			buildMemberNickname(null, 'multi_alliance', {
				name: 'Adam',
				allianceTag: 'HORUS',
				rank: 'Operative',
			}),
		).toBe('[HORUS] (Op) Adam');

		expect(
			buildMemberNickname(null, 'multi_alliance', {
				name: 'Adam',
				allianceTag: 'HORUS',
				rank: undefined,
			}),
		).toBe('[HORUS] Adam');
	});

	it('supports custom templates with abbreviated {rank}', () => {
		expect(
			buildMemberNickname('{rank} | {player_name}', 'single_alliance', {
				name: 'Ada',
				rank: 'Premier',
			}),
		).toBe('Pr | Ada');
	});

	it('truncates to Discord nick limit', () => {
		const longName = 'A'.repeat(40);
		const nick = buildMemberNickname(null, 'single_alliance', {
			name: longName,
			rank: 'Admiral',
		});
		expect(nick.length).toBeLessThanOrEqual(DISCORD_NICK_MAX);
		expect(nick.startsWith('[Adm]')).toBe(true);
	});
});
