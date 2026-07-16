import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type GradePlayersResponse, type RosterPlayerRow } from '../../api';
import {
	AlliancePolarChart,
	GradeByAllianceChart,
	GradePolarChart,
	PowerLineChart,
} from '../../components/charts';
import { useGuild } from '../../guild/GuildContext';
import { LcarsPanel } from '../../lcars/LcarsFrame';

type ChartScope = 'alliance' | 'players';

type ChartVisibility = {
	membership: boolean;
	grades: boolean;
	power: boolean;
};

function fmtNum(n: number | null | undefined): string {
	if (n == null || !Number.isFinite(n)) return '—';
	return n.toLocaleString();
}

export function DashboardPage() {
	const { guildId, status } = useGuild();
	const navigate = useNavigate();
	const multi = String(status.config.mode) === 'multi_alliance';

	const [chartScope, setChartScope] = useState<ChartScope>(multi ? 'alliance' : 'players');
	const [showCharts, setShowCharts] = useState<ChartVisibility>({
		membership: true,
		grades: true,
		power: true,
	});

	const [selectedGrade, setSelectedGrade] = useState<number | null>(null);
	const [gradePlayers, setGradePlayers] = useState<RosterPlayerRow[] | null>(null);
	const [gradeLoading, setGradeLoading] = useState(false);
	const [gradeError, setGradeError] = useState<string | null>(null);

	useEffect(() => {
		if (selectedGrade == null) {
			setGradePlayers(null);
			setGradeError(null);
			return;
		}
		let cancelled = false;
		setGradeLoading(true);
		setGradeError(null);
		void (async () => {
			const res = await api<GradePlayersResponse>(
				`/api/admin/guilds/${guildId}/players?grade=${selectedGrade}`,
			);
			if (cancelled) return;
			setGradeLoading(false);
			if (res.status === 401) {
				navigate('/login');
				return;
			}
			if (res.error || !res.data) {
				setGradePlayers(null);
				setGradeError(res.error || 'Failed to load players');
				return;
			}
			setGradePlayers(res.data.players);
		})();
		return () => {
			cancelled = true;
		};
	}, [guildId, selectedGrade, navigate]);

	const powerSeries = useMemo(() => {
		if (!multi || chartScope !== 'alliance') return undefined;
		const tags = Array.from(
			new Set(status.charts.power_by_day_alliance.map((p) => p.alliance_tag)),
		);
		return tags.map((tag) => ({
			tag,
			points: status.charts.power_by_day_alliance
				.filter((p) => p.alliance_tag === tag)
				.map((p) => ({ day: p.day, total_power: p.total_power })),
		}));
	}, [multi, chartScope, status.charts.power_by_day_alliance]);

	const allianceMode = multi && chartScope === 'alliance';
	const anyChartVisible = showCharts.membership || showCharts.grades || showCharts.power;

	function toggleChart(key: keyof ChartVisibility) {
		setShowCharts((prev) => ({ ...prev, [key]: !prev[key] }));
	}

	return (
		<>
			<section className="grid">
				<LcarsPanel label="At a glance" cap="a5">
					<p className="stat">{status.stats.verified_total}</p>
					<p className="muted">Verified / guest on Discord</p>
					<p className="stat stat--sm">{status.stats.unlinked_total}</p>
					<p className="muted">On alliance roster, not Discord</p>
					<ul className="plain">
						{status.stats.by_status.map((r) => (
							<li key={r.verification_status}>
								{r.verification_status}: <strong>{r.count}</strong>
							</li>
						))}
					</ul>
				</LcarsPanel>
				<LcarsPanel label="By grade" cap="a2">
					<ul className="plain grade-list">
						{status.stats.by_grade.length === 0 ? (
							<li className="muted">No grade data</li>
						) : (
							status.stats.by_grade.map((r) => (
								<li key={r.grade}>
									<button
										type="button"
										className={`grade-link${selectedGrade === r.grade ? ' grade-link--active' : ''}`}
										onClick={() =>
											setSelectedGrade((prev) => (prev === r.grade ? null : r.grade))
										}
										aria-pressed={selectedGrade === r.grade}
									>
										<span>G{r.grade}</span>
										<strong>{r.count}</strong>
									</button>
								</li>
							))
						)}
					</ul>
					<p className="muted tiny" style={{ marginTop: '0.65rem' }}>
						Click a grade for a quick list, or open Reports for full tables
					</p>
				</LcarsPanel>
				<LcarsPanel label="Gateway" cap="a6">
					<p
						className={
							status.gateway?.ready
								? 'lcars-status lcars-status--ok'
								: 'lcars-status lcars-status--warn'
						}
					>
						{status.gateway?.ready ? 'Connected' : 'Not ready / unknown'}
					</p>
					<p className="muted tiny" style={{ marginTop: '0.65rem' }}>
						Last event: {status.gateway?.lastEventAt ?? '—'}
					</p>
				</LcarsPanel>
				<LcarsPanel label="Alliances" cap="a8">
					<ul className="plain">
						{status.stats.by_alliance.slice(0, 12).map((r) => (
							<li key={r.alliance_tag}>
								[{r.alliance_tag}]: <strong>{r.count}</strong>
							</li>
						))}
					</ul>
				</LcarsPanel>
			</section>

			<LcarsPanel label="Charts" cap="a1">
				<div className="chart-controls">
					{multi ? (
						<label>
							Breakdown
							<select
								value={chartScope}
								onChange={(e) => setChartScope(e.target.value as ChartScope)}
							>
								<option value="alliance">By alliance</option>
								<option value="players">By players (guild total)</option>
							</select>
						</label>
					) : null}
					<div className="chart-toggles">
						{allianceMode ? (
							<label className="check">
								<input
									type="checkbox"
									checked={showCharts.membership}
									onChange={() => toggleChart('membership')}
								/>
								Alliance membership
							</label>
						) : null}
						<label className="check">
							<input
								type="checkbox"
								checked={showCharts.grades}
								onChange={() => toggleChart('grades')}
							/>
							{allianceMode ? 'Grades by alliance' : 'Grades'}
						</label>
						<label className="check">
							<input
								type="checkbox"
								checked={showCharts.power}
								onChange={() => toggleChart('power')}
							/>
							{allianceMode ? 'Power by alliance' : 'Collective power'}
						</label>
					</div>
				</div>
			</LcarsPanel>

			{anyChartVisible ? (
				<section className="grid grid--charts">
					{showCharts.membership && allianceMode ? (
						<LcarsPanel label="Alliance membership" cap="a8">
							<AlliancePolarChart rows={status.stats.by_alliance} />
						</LcarsPanel>
					) : null}
					{showCharts.grades ? (
						<LcarsPanel
							label={allianceMode ? 'Grades by alliance' : 'Grades'}
							cap="a5"
						>
							{allianceMode ? (
								<GradeByAllianceChart rows={status.charts.by_grade_alliance ?? []} />
							) : (
								<GradePolarChart rows={status.stats.by_grade} />
							)}
						</LcarsPanel>
					) : null}
					{showCharts.power ? (
						<LcarsPanel
							label={allianceMode ? 'Power by alliance' : 'Collective power'}
							cap="a1"
						>
							{allianceMode && powerSeries && powerSeries.length > 0 ? (
								<PowerLineChart series={powerSeries} />
							) : (
								<PowerLineChart points={status.charts.power_by_day} />
							)}
						</LcarsPanel>
					) : null}
				</section>
			) : (
				<p className="muted tiny">No charts selected — use the toggles above.</p>
			)}

			{selectedGrade != null ? (
				<LcarsPanel label={`Grade G${selectedGrade}`} cap="a5">
					{gradeLoading ? <p className="lcars-status">Loading players…</p> : null}
					{gradeError ? <p className="error">{gradeError}</p> : null}
					{!gradeLoading && !gradeError && gradePlayers ? (
						gradePlayers.length === 0 ? (
							<p className="muted">No players in this grade.</p>
						) : (
							<div className="roster-table-wrap">
								<table className="roster-table">
									<thead>
										<tr>
											<th>Nickname</th>
											<th>Alliance</th>
											<th>Rank</th>
											<th>Ops</th>
											<th>Power</th>
											<th>Streak</th>
											<th>Inactive</th>
											<th>Status</th>
										</tr>
									</thead>
									<tbody>
										{gradePlayers.map((p) => (
											<tr key={p.discord_user_id ?? `${p.player_id}`}>
												<td>{p.player_name ?? '—'}</td>
												<td>{p.alliance_tag ? `[${p.alliance_tag}]` : '—'}</td>
												<td>{p.alliance_rank ?? '—'}</td>
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
						)
					) : null}
				</LcarsPanel>
			) : null}
		</>
	);
}
