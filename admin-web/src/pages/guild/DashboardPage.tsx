import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type ReportsPlayersResponse, type RosterPlayerRow } from '../../api';
import {
	AlliancePolarChart,
	formatPowerTick,
	GradeByAllianceChart,
	GradePolarChart,
	PowerLineChart,
	ValuePolarChart,
} from '../../components/charts';
import { useGuild } from '../../guild/GuildContext';
import { LcarsPanel } from '../../lcars/LcarsFrame';

type ChartScope = 'alliance' | 'players';

type ChartVisibility = {
	membership: boolean;
	grades: boolean;
	power: boolean;
};

function segmentKey(player: RosterPlayerRow, multi: boolean): string {
	if (multi) {
		const tag = player.alliance_tag?.trim();
		return tag ? `[${tag}]` : '—';
	}
	if (player.on_discord === false) return 'Not on Discord';
	const rank = player.alliance_rank?.trim();
	return rank || '—';
}

function aggregateRoster(
	players: RosterPlayerRow[],
	multi: boolean,
	mode: 'count' | 'power',
): Array<{ label: string; value: number }> {
	const buckets = new Map<string, number>();
	for (const p of players) {
		const key = segmentKey(p, multi);
		const add = mode === 'count' ? 1 : Math.max(0, p.power ?? 0);
		buckets.set(key, (buckets.get(key) ?? 0) + add);
	}
	return Array.from(buckets.entries())
		.map(([label, value]) => ({ label, value }))
		.filter((r) => r.value > 0)
		.sort((a, b) => b.value - a.value);
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
			const qs = new URLSearchParams({
				grade: String(selectedGrade),
				include_unlinked: '1',
				limit: '500',
			});
			const res = await api<ReportsPlayersResponse>(
				`/api/admin/guilds/${guildId}/reports/players?${qs}`,
			);
			if (cancelled) return;
			setGradeLoading(false);
			if (res.status === 401) {
				navigate('/login');
				return;
			}
			if (res.error || !res.data) {
				setGradePlayers(null);
				setGradeError(res.error || 'Failed to load grade breakdown');
				return;
			}
			setGradePlayers(res.data.players);
		})();
		return () => {
			cancelled = true;
		};
	}, [guildId, selectedGrade, navigate]);

	const gradeMakeup = useMemo(() => {
		if (!gradePlayers) return [];
		return aggregateRoster(gradePlayers, multi, 'count');
	}, [gradePlayers, multi]);

	const gradePower = useMemo(() => {
		if (!gradePlayers) return [];
		return aggregateRoster(gradePlayers, multi, 'power');
	}, [gradePlayers, multi]);

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
	const gradeFilterActive = selectedGrade != null;
	const anyChartVisible = showCharts.membership || showCharts.grades || showCharts.power;

	function toggleChart(key: keyof ChartVisibility) {
		setShowCharts((prev) => ({ ...prev, [key]: !prev[key] }));
	}

	const makeupLabel = multi ? 'by alliance' : 'by rank / Discord';
	const gradeSegmentHint = multi
		? 'Includes roster members not on Discord. Segments by alliance tag.'
		: 'Includes roster members not on Discord. Segments by in-game rank; unlinked shown separately.';

	return (
		<>
			<section className="grid">
				<LcarsPanel label="At a glance" cap="a5">
					<p className="stat">{status.stats.verified_total}</p>
					<p className="muted">Verified alliance players on Discord</p>
					<p className="stat stat--sm">{status.stats.guest_total}</p>
					<p className="muted">Guests on Discord</p>
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
						Click a grade to filter charts below (includes unlinked roster). Open Reports for
						sortable tables.
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

			{gradeFilterActive ? (
				<>
					<p className="muted tiny" style={{ marginBottom: '0.75rem' }}>
						<strong>G{selectedGrade}</strong> — {gradeSegmentHint}
					</p>
					{gradeLoading ? <p className="lcars-status">Loading grade breakdown…</p> : null}
					{gradeError ? <p className="error">{gradeError}</p> : null}
					{!gradeLoading && !gradeError && gradePlayers ? (
						gradePlayers.length === 0 ? (
							<p className="muted">No players in this grade.</p>
						) : (
							<section className="grid grid--charts">
								<LcarsPanel label={`G${selectedGrade} players ${makeupLabel}`} cap="a8">
									<ValuePolarChart
										rows={gradeMakeup}
										centerLabel="players"
										formatLegendValue={(v) => String(v)}
									/>
								</LcarsPanel>
								<LcarsPanel label={`G${selectedGrade} power ${makeupLabel}`} cap="a1">
									<ValuePolarChart
										rows={gradePower}
										centerLabel="power"
										formatLegendValue={formatPowerTick}
									/>
								</LcarsPanel>
							</section>
						)
					) : null}
				</>
			) : (
				<>
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
				</>
			)}
		</>
	);
}
