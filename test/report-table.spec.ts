import { describe, it, expect } from 'vitest';
import { formatReportTable, formatReportSection, omitBlankColumns } from '../src/report-table';
import {
	diffAllianceRosters,
	formatAllianceRosterChangeReport,
} from '../src/alliance-roster-diff';

describe('report-table', () => {
	it('wraps a compact table in a code fence and truncates rows', () => {
		const rows = Array.from({ length: 5 }, (_, i) => ({
			Player: `P${i}`,
			Ops: 40 + i,
		}));
		const out = formatReportTable(
			rows,
			[
				{ header: 'Player', width: 4 },
				{ header: 'Ops', width: 3, align: 'right' },
			],
			{ maxRows: 3, maxChars: 5000 },
		);
		expect(out).toMatch(/^```\n/);
		expect(out).toContain('P0');
		expect(out).toContain('P2');
		expect(out).not.toContain('P3');
		expect(out).toContain('_…and 2 more_');
	});

	it('omitBlankColumns drops all-empty columns', () => {
		const cols = omitBlankColumns(
			[
				{ Player: 'Ada', Tag: '—', Ops: 50 },
				{ Player: 'Bob', Tag: '—', Ops: 51 },
			],
			[
				{ header: 'Player', width: 4 },
				{ header: 'Tag', width: 3 },
				{ header: 'Ops', width: 3 },
			],
		);
		expect(cols.map((c) => c.header)).toEqual(['Player', 'Ops']);
	});

	it('formatReportSection includes heading count', () => {
		const section = formatReportSection(
			'Joined',
			[{ Player: 'Ada', Ops: 40 }],
			[
				{ header: 'Player', width: 4 },
				{ header: 'Ops', width: 3, align: 'right' },
			],
		);
		expect(section).toContain('**Joined (1)**');
		expect(section).toContain('```');
		expect(section).toContain('Ada');
	});
});

describe('formatAllianceRosterChangeReport tables', () => {
	it('renders change sections as fenced ASCII tables', () => {
		const prev = [
			{
				playerId: 1,
				playerName: 'Ada',
				allianceRank: 'Operative',
				opsLevel: 40,
				allianceTag: 'ALPHA',
			},
		];
		const next = [
			{
				playerId: 1,
				playerName: 'Ada',
				allianceRank: 'Operative',
				opsLevel: 41,
				allianceTag: 'ALPHA',
			},
			{
				playerId: 2,
				playerName: 'Bea',
				allianceRank: 'Agent',
				opsLevel: 50,
				allianceTag: 'ALPHA',
			},
		];
		const diff = diffAllianceRosters(prev, next);
		const report = formatAllianceRosterChangeReport(diff, { allianceTag: 'ALPHA' });
		expect(report.description).toContain('**Ops up (1)**');
		expect(report.description).toContain('**Joined tracked roster (1)**');
		expect(report.description).toContain('```');
		expect(report.description).toContain('Ada');
		expect(report.description).toContain('Bea');
	});
});
