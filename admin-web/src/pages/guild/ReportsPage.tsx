import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type ReportsPlayersResponse, type RosterPlayerRow } from '../../api';
import { useGuild } from '../../guild/GuildContext';
import { LcarsPanel } from '../../lcars/LcarsFrame';

type SortKey =
	| 'player_name'
	| 'alliance_rank'
	| 'ops_level'
	| 'power'
	| 'activity_streak'
	| 'days_inactive'
	| 'verification_status'
	| 'alliance_tag'
	| 'grade';

function fmtNum(n: number | null | undefined): string {
	if (n == null || !Number.isFinite(n)) return '—';
	return n.toLocaleString();
}

function cmp(a: RosterPlayerRow, b: RosterPlayerRow, key: SortKey, dir: 1 | -1): number {
	const av = a[key];
	const bv = b[key];
	if (av == null && bv == null) return 0;
	if (av == null) return 1;
	if (bv == null) return -1;
	if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
	return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' }) * dir;
}

export function ReportsPage() {
	const { guildId } = useGuild();
	const navigate = useNavigate();
	const [players, setPlayers] = useState<RosterPlayerRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [includeUnlinked, setIncludeUnlinked] = useState(true);
	const [gradeFilter, setGradeFilter] = useState<string>('');
	const [sortKey, setSortKey] = useState<SortKey>('ops_level');
	const [sortDir, setSortDir] = useState<1 | -1>(-1);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		void (async () => {
			const qs = new URLSearchParams();
			if (includeUnlinked) qs.set('include_unlinked', '1');
			if (gradeFilter) qs.set('grade', gradeFilter);
			qs.set('limit', '500');
			const res = await api<ReportsPlayersResponse>(
				`/api/admin/guilds/${guildId}/reports/players?${qs}`,
			);
			if (cancelled) return;
			setLoading(false);
			if (res.status === 401) {
				navigate('/login');
				return;
			}
			if (res.error || !res.data) {
				setError(res.error || 'Failed to load report');
				return;
			}
			setPlayers(res.data.players);
		})();
		return () => {
			cancelled = true;
		};
	}, [guildId, includeUnlinked, gradeFilter, navigate]);

	const sorted = useMemo(
		() => [...players].sort((a, b) => cmp(a, b, sortKey, sortDir)),
		[players, sortKey, sortDir],
	);

	function toggleSort(key: SortKey) {
		if (sortKey === key) {
			setSortDir((d) => (d === 1 ? -1 : 1));
		} else {
			setSortKey(key);
			setSortDir(key === 'player_name' || key === 'alliance_tag' ? 1 : -1);
		}
	}

	function th(key: SortKey, label: string) {
		const active = sortKey === key;
		return (
			<th>
				<button type="button" className={`sort-th${active ? ' sort-th--active' : ''}`} onClick={() => toggleSort(key)}>
					{label}
					{active ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
				</button>
			</th>
		);
	}

	return (
		<LcarsPanel label="Reports" cap="a2">
			<div className="report-toolbar">
				<label className="check">
					<input
						type="checkbox"
						checked={includeUnlinked}
						onChange={(e) => setIncludeUnlinked(e.target.checked)}
					/>
					Include unlinked alliance members
				</label>
				<label>
					Grade
					<select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)}>
						<option value="">All</option>
						{[3, 4, 5, 6, 7].map((g) => (
							<option key={g} value={String(g)}>
								G{g}
							</option>
						))}
					</select>
				</label>
			</div>
			{loading ? <p className="lcars-status">Loading report…</p> : null}
			{error ? <p className="error">{error}</p> : null}
			{!loading && !error ? (
				<>
					<p className="muted tiny">{sorted.length} players — click a column header to sort</p>
					<div className="roster-table-wrap">
						<table className="roster-table">
							<thead>
								<tr>
									{th('player_name', 'Nickname')}
									{th('alliance_tag', 'Alliance')}
									{th('alliance_rank', 'Rank')}
									{th('grade', 'Grade')}
									{th('ops_level', 'Ops')}
									{th('power', 'Power')}
									{th('activity_streak', 'Streak')}
									{th('days_inactive', 'Inactive')}
									{th('verification_status', 'Status')}
								</tr>
							</thead>
							<tbody>
								{sorted.map((p, i) => (
									<tr key={p.discord_user_id ?? `u-${p.player_id}-${i}`}>
										<td>{p.player_name ?? '—'}</td>
										<td>{p.alliance_tag ? `[${p.alliance_tag}]` : '—'}</td>
										<td>{p.alliance_rank ?? '—'}</td>
										<td>{p.grade != null ? `G${p.grade}` : '—'}</td>
										<td>{fmtNum(p.ops_level)}</td>
										<td>{fmtNum(p.power)}</td>
										<td>{fmtNum(p.activity_streak)}</td>
										<td>{fmtNum(p.days_inactive)}</td>
										<td>{p.verification_status}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</>
			) : null}
		</LcarsPanel>
	);
}
