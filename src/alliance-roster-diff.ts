import {
	formatReportSection,
	playerCell,
	ReportCols,
	tagCell,
} from './report-table';
import type { TableData } from './tableUtils';

/** Slim roster row used for day-over-day diffs (ids are stable; names/ranks/ops/tags change). */
export type RosterDiffMember = {
	playerId: number;
	playerName: string;
	allianceRank: string;
	opsLevel: number;
	allianceTag: string;
};

export type RosterJoined = RosterDiffMember;
export type RosterLeft = RosterDiffMember;

export type RosterOpsChange = RosterDiffMember & {
	previousOps: number;
	delta: number;
};

export type RosterRankChange = RosterDiffMember & {
	previousRank: string;
};

export type RosterRename = RosterDiffMember & {
	previousName: string;
};

export type RosterTagMove = RosterDiffMember & {
	previousTag: string;
};

export type AllianceRosterDiff = {
	/** True when there was no previous snapshot to compare. */
	isInitial: boolean;
	previousCount: number;
	currentCount: number;
	joined: RosterJoined[];
	left: RosterLeft[];
	opsUp: RosterOpsChange[];
	opsDown: RosterOpsChange[];
	rankChanged: RosterRankChange[];
	renamed: RosterRename[];
	/** Same player_id, different alliance tag (multi-alliance movement). */
	tagMoved: RosterTagMove[];
};

function normName(s: string | null | undefined): string {
	return (s ?? '').trim();
}

function normRank(s: string | null | undefined): string {
	return (s ?? '').trim();
}

function normTag(s: string | null | undefined): string {
	return (s ?? '').trim();
}

function toDiffMember(m: {
	playerId: number;
	playerName?: string | null;
	allianceRank?: string | null;
	opsLevel?: number | null;
	allianceTag?: string | null;
}): RosterDiffMember {
	return {
		playerId: m.playerId,
		playerName: normName(m.playerName),
		allianceRank: normRank(m.allianceRank),
		opsLevel: Number(m.opsLevel ?? 0) || 0,
		allianceTag: normTag(m.allianceTag),
	};
}

export function diffAllianceRosters(
	previous: Array<{
		playerId: number;
		playerName?: string | null;
		allianceRank?: string | null;
		opsLevel?: number | null;
		allianceTag?: string | null;
	}>,
	current: Array<{
		playerId: number;
		playerName?: string | null;
		allianceRank?: string | null;
		opsLevel?: number | null;
		allianceTag?: string | null;
	}>,
): AllianceRosterDiff {
	const prevMap = new Map(previous.map((m) => [m.playerId, toDiffMember(m)]));
	const currMap = new Map(current.map((m) => [m.playerId, toDiffMember(m)]));

	if (previous.length === 0) {
		return {
			isInitial: true,
			previousCount: 0,
			currentCount: current.length,
			joined: [],
			left: [],
			opsUp: [],
			opsDown: [],
			rankChanged: [],
			renamed: [],
			tagMoved: [],
		};
	}

	const joined: RosterJoined[] = [];
	const left: RosterLeft[] = [];
	const opsUp: RosterOpsChange[] = [];
	const opsDown: RosterOpsChange[] = [];
	const rankChanged: RosterRankChange[] = [];
	const renamed: RosterRename[] = [];
	const tagMoved: RosterTagMove[] = [];

	for (const [id, curr] of currMap) {
		const prev = prevMap.get(id);
		if (!prev) {
			joined.push(curr);
			continue;
		}
		if (curr.opsLevel > prev.opsLevel) {
			opsUp.push({
				...curr,
				previousOps: prev.opsLevel,
				delta: curr.opsLevel - prev.opsLevel,
			});
		} else if (curr.opsLevel < prev.opsLevel) {
			opsDown.push({
				...curr,
				previousOps: prev.opsLevel,
				delta: curr.opsLevel - prev.opsLevel,
			});
		}
		if (curr.allianceRank !== prev.allianceRank) {
			rankChanged.push({ ...curr, previousRank: prev.allianceRank });
		}
		if (curr.playerName && prev.playerName && curr.playerName !== prev.playerName) {
			renamed.push({ ...curr, previousName: prev.playerName });
		}
		if (
			curr.allianceTag &&
			prev.allianceTag &&
			curr.allianceTag.toUpperCase() !== prev.allianceTag.toUpperCase()
		) {
			tagMoved.push({ ...curr, previousTag: prev.allianceTag });
		}
	}

	for (const [id, prev] of prevMap) {
		if (!currMap.has(id)) left.push(prev);
	}

	const byName = (a: RosterDiffMember, b: RosterDiffMember) =>
		a.playerName.localeCompare(b.playerName, undefined, { sensitivity: 'base' });
	joined.sort(byName);
	left.sort(byName);
	opsUp.sort((a, b) => b.delta - a.delta || byName(a, b));
	opsDown.sort((a, b) => a.delta - b.delta || byName(a, b));
	rankChanged.sort(byName);
	renamed.sort(byName);
	tagMoved.sort(byName);

	return {
		isInitial: false,
		previousCount: previous.length,
		currentCount: current.length,
		joined,
		left,
		opsUp,
		opsDown,
		rankChanged,
		renamed,
		tagMoved,
	};
}

export function allianceRosterDiffHasChanges(diff: AllianceRosterDiff): boolean {
	if (diff.isInitial) return false;
	return (
		diff.joined.length > 0 ||
		diff.left.length > 0 ||
		diff.opsUp.length > 0 ||
		diff.opsDown.length > 0 ||
		diff.rankChanged.length > 0 ||
		diff.renamed.length > 0 ||
		diff.tagMoved.length > 0
	);
}

const SECTION_MAX_ROWS = 18;

/** Discord-friendly markdown body for the morning roster report. */
export function formatAllianceRosterChangeReport(
	diff: AllianceRosterDiff,
	opts: {
		allianceTag: string;
		allianceId?: string | null;
		/** multi = emphasize tag moves; single = classic join/leave framing */
		mode?: 'single' | 'multi';
		alliancesScraped?: number;
	},
): { title: string; description: string } {
	const mode = opts.mode ?? 'single';
	const tag = opts.allianceTag || 'alliance';
	const idBit = opts.allianceId ? ` (id \`${opts.allianceId}\`)` : '';
	const multiBit =
		mode === 'multi' && opts.alliancesScraped != null
			? ` · **${opts.alliancesScraped}** alliance page(s)`
			: '';

	if (diff.isInitial) {
		return {
			title:
				mode === 'multi'
					? 'Alliance rosters — initial snapshot'
					: 'Alliance roster — initial snapshot',
			description:
				(mode === 'multi'
					? `Cached **${diff.currentCount}** players across tracked alliances${multiBit}.\n`
					: `Cached **${diff.currentCount}** members for **${tag}**${idBit}.\n`) +
				`Day-over-day joins/leaves/moves/ops/rank will appear on the next morning sync.`,
		};
	}

	const title = allianceRosterDiffHasChanges(diff)
		? mode === 'multi'
			? 'Alliance rosters — daily changes'
			: 'Alliance roster — daily changes'
		: mode === 'multi'
			? 'Alliance rosters — no changes'
			: 'Alliance roster — no changes';

	const summary =
		(mode === 'multi'
			? `Tracked rosters${multiBit}: **${diff.previousCount}** → **${diff.currentCount}** players\n`
			: `**${tag}**${idBit}: **${diff.previousCount}** → **${diff.currentCount}** members\n`) +
		`Joined **${diff.joined.length}** · Left **${diff.left.length}** · ` +
		`Moved **${diff.tagMoved.length}** · ` +
		`Ops↑ **${diff.opsUp.length}** · Ops↓ **${diff.opsDown.length}** · ` +
		`Rank **${diff.rankChanged.length}** · Rename **${diff.renamed.length}**`;

	if (!allianceRosterDiffHasChanges(diff)) {
		return { title, description: summary };
	}

	const sections: string[] = [summary];
	const tableOpts = { maxRows: SECTION_MAX_ROWS, maxChars: 1200 };

	if (diff.tagMoved.length) {
		const rows: TableData[] = diff.tagMoved.map((m) => ({
			Player: playerCell(m.playerName, m.playerId),
			From: tagCell(m.previousTag),
			To: tagCell(m.allianceTag),
			Rank: m.allianceRank || '—',
		}));
		sections.push(
			formatReportSection('Alliance moves', rows, [
				ReportCols.player,
				ReportCols.from,
				ReportCols.to,
				ReportCols.rank,
			], tableOpts),
		);
	}
	if (diff.joined.length) {
		const rows: TableData[] = diff.joined.map((m) => ({
			Player: playerCell(m.playerName, m.playerId),
			Tag: tagCell(m.allianceTag),
			Ops: m.opsLevel,
			Rank: m.allianceRank || '—',
		}));
		sections.push(
			formatReportSection('Joined tracked roster', rows, [
				ReportCols.player,
				ReportCols.tag,
				ReportCols.ops,
				ReportCols.rank,
			], tableOpts),
		);
	}
	if (diff.left.length) {
		const rows: TableData[] = diff.left.map((m) => ({
			Player: playerCell(m.playerName, m.playerId),
			Tag: tagCell(m.allianceTag),
			Ops: m.opsLevel,
			Rank: m.allianceRank || '—',
		}));
		sections.push(
			formatReportSection(mode === 'multi' ? 'Left tracked roster' : 'Left', rows, [
				ReportCols.player,
				ReportCols.tag,
				ReportCols.ops,
				ReportCols.rank,
			], tableOpts),
		);
	}
	if (diff.opsUp.length) {
		const rows: TableData[] = diff.opsUp.map((m) => ({
			Player: playerCell(m.playerName, m.playerId),
			Tag: tagCell(m.allianceTag),
			Was: m.previousOps,
			Ops: m.opsLevel,
			Δ: `+${m.delta}`,
		}));
		sections.push(
			formatReportSection('Ops up', rows, [
				ReportCols.player,
				ReportCols.tag,
				ReportCols.prevOps,
				ReportCols.ops,
				ReportCols.delta,
			], tableOpts),
		);
	}
	if (diff.opsDown.length) {
		const rows: TableData[] = diff.opsDown.map((m) => ({
			Player: playerCell(m.playerName, m.playerId),
			Tag: tagCell(m.allianceTag),
			Was: m.previousOps,
			Ops: m.opsLevel,
			Δ: String(m.delta),
		}));
		sections.push(
			formatReportSection('Ops down', rows, [
				ReportCols.player,
				ReportCols.tag,
				ReportCols.prevOps,
				ReportCols.ops,
				ReportCols.delta,
			], tableOpts),
		);
	}
	if (diff.rankChanged.length) {
		const rows: TableData[] = diff.rankChanged.map((m) => ({
			Player: playerCell(m.playerName, m.playerId),
			Tag: tagCell(m.allianceTag),
			From: m.previousRank || '—',
			To: m.allianceRank || '—',
		}));
		sections.push(
			formatReportSection('Rank changes', rows, [
				ReportCols.player,
				ReportCols.tag,
				{ header: 'From', width: 6 },
				{ header: 'To', width: 6 },
			], tableOpts),
		);
	}
	if (diff.renamed.length) {
		const rows: TableData[] = diff.renamed.map((m) => ({
			Was: m.previousName,
			Player: playerCell(m.playerName, m.playerId),
			Tag: tagCell(m.allianceTag),
		}));
		sections.push(
			formatReportSection(
				'Renames',
				rows,
				[ReportCols.prevName, ReportCols.player, ReportCols.tag],
				tableOpts,
			),
		);
	}

	let description = sections.filter(Boolean).join('\n\n').trim();
	if (description.length > 3900) {
		description = description.slice(0, 3890) + '\n_…truncated_';
	}
	return { title, description };
}
