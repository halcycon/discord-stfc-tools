const GRADE_COLORS = [
	'var(--lcars-a5)',
	'var(--lcars-a1)',
	'var(--lcars-a2)',
	'var(--lcars-a6)',
	'var(--lcars-a8)',
];

const ALLIANCE_COLORS = [
	'var(--lcars-a5)',
	'var(--lcars-a6)',
	'var(--lcars-a8)',
	'var(--lcars-a1)',
	'var(--lcars-a2)',
	'var(--lcars-a7)',
];

export function GradePolarChart({
	rows,
	centerLabel = 'players',
}: {
	rows: Array<{ grade: number; count: number }>;
	centerLabel?: string;
}) {
	const total = rows.reduce((n, r) => n + r.count, 0);
	if (total === 0) {
		return <p className="muted tiny">No grade data</p>;
	}
	const size = 180;
	const cx = size / 2;
	const cy = size / 2;
	const rOuter = 78;
	const rInner = 36;
	let angle = -Math.PI / 2;
	const wedges: Array<{ d: string; color: string; label: string }> = [];
	rows.forEach((row, i) => {
		const slice = (row.count / total) * Math.PI * 2;
		const a0 = angle;
		const a1 = angle + slice;
		angle = a1;
		const x0 = cx + rOuter * Math.cos(a0);
		const y0 = cy + rOuter * Math.sin(a0);
		const x1 = cx + rOuter * Math.cos(a1);
		const y1 = cy + rOuter * Math.sin(a1);
		const xi0 = cx + rInner * Math.cos(a0);
		const yi0 = cy + rInner * Math.sin(a0);
		const xi1 = cx + rInner * Math.cos(a1);
		const yi1 = cy + rInner * Math.sin(a1);
		const large = slice > Math.PI ? 1 : 0;
		const d = [
			`M ${x0} ${y0}`,
			`A ${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1}`,
			`L ${xi1} ${yi1}`,
			`A ${rInner} ${rInner} 0 ${large} 0 ${xi0} ${yi0}`,
			'Z',
		].join(' ');
		wedges.push({
			d,
			color: GRADE_COLORS[i % GRADE_COLORS.length],
			label: `G${row.grade}`,
		});
	});

	return (
		<div className="chart-polar">
			<svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Grades">
				{wedges.map((w) => (
					<path key={w.label} d={w.d} fill={w.color} stroke="#000" strokeWidth="2" />
				))}
				<text x={cx} y={cy - 4} textAnchor="middle" className="chart-center-label">
					{total}
				</text>
				<text x={cx} y={cy + 14} textAnchor="middle" className="chart-center-sub">
					{centerLabel}
				</text>
			</svg>
			<ul className="chart-legend">
				{rows.map((r, i) => (
					<li key={r.grade}>
						<span
							className="chart-swatch"
							style={{ background: GRADE_COLORS[i % GRADE_COLORS.length] }}
						/>
						G{r.grade}: <strong>{r.count}</strong>
					</li>
				))}
			</ul>
		</div>
	);
}

/** Alliance membership share (multi-alliance dashboard). */
export function AlliancePolarChart({
	rows,
}: {
	rows: Array<{ alliance_tag: string; count: number }>;
}) {
	const filtered = rows.filter((r) => r.count > 0);
	const total = filtered.reduce((n, r) => n + r.count, 0);
	if (total === 0) {
		return <p className="muted tiny">No alliance data</p>;
	}
	const size = 180;
	const cx = size / 2;
	const cy = size / 2;
	const rOuter = 78;
	const rInner = 36;
	let angle = -Math.PI / 2;
	const wedges: Array<{ d: string; color: string; label: string }> = [];
	filtered.forEach((row, i) => {
		const slice = (row.count / total) * Math.PI * 2;
		const a0 = angle;
		const a1 = angle + slice;
		angle = a1;
		const x0 = cx + rOuter * Math.cos(a0);
		const y0 = cy + rOuter * Math.sin(a0);
		const x1 = cx + rOuter * Math.cos(a1);
		const y1 = cy + rOuter * Math.sin(a1);
		const xi0 = cx + rInner * Math.cos(a0);
		const yi0 = cy + rInner * Math.sin(a0);
		const xi1 = cx + rInner * Math.cos(a1);
		const yi1 = cy + rInner * Math.sin(a1);
		const large = slice > Math.PI ? 1 : 0;
		const d = [
			`M ${x0} ${y0}`,
			`A ${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1}`,
			`L ${xi1} ${yi1}`,
			`A ${rInner} ${rInner} 0 ${large} 0 ${xi0} ${yi0}`,
			'Z',
		].join(' ');
		wedges.push({
			d,
			color: ALLIANCE_COLORS[i % ALLIANCE_COLORS.length],
			label: row.alliance_tag,
		});
	});

	return (
		<div className="chart-polar">
			<svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Alliances">
				{wedges.map((w) => (
					<path key={w.label} d={w.d} fill={w.color} stroke="#000" strokeWidth="2" />
				))}
				<text x={cx} y={cy - 4} textAnchor="middle" className="chart-center-label">
					{total}
				</text>
				<text x={cx} y={cy + 14} textAnchor="middle" className="chart-center-sub">
					members
				</text>
			</svg>
			<ul className="chart-legend">
				{filtered.map((r, i) => (
					<li key={r.alliance_tag}>
						<span
							className="chart-swatch"
							style={{ background: ALLIANCE_COLORS[i % ALLIANCE_COLORS.length] }}
						/>
						[{r.alliance_tag}]: <strong>{r.count}</strong>
					</li>
				))}
			</ul>
		</div>
	);
}

/** Stacked grade bars per alliance tag. */
export function GradeByAllianceChart({
	rows,
}: {
	rows: Array<{ alliance_tag: string; grade: number; count: number }>;
}) {
	if (rows.length === 0) {
		return <p className="muted tiny">No grade data by alliance</p>;
	}
	const tags = Array.from(new Set(rows.map((r) => r.alliance_tag))).sort((a, b) =>
		a.localeCompare(b, undefined, { sensitivity: 'base' }),
	);
	const grades = Array.from(new Set(rows.map((r) => r.grade))).sort((a, b) => a - b);
	const maxTotal = Math.max(
		...tags.map((tag) =>
			rows.filter((r) => r.alliance_tag === tag).reduce((n, r) => n + r.count, 0),
		),
		1,
	);

	return (
		<div className="chart-stacked">
			<ul className="chart-stacked-list">
				{tags.map((tag) => {
					const segments = grades
						.map((g) => rows.find((r) => r.alliance_tag === tag && r.grade === g))
						.filter(Boolean) as Array<{ grade: number; count: number }>;
					const total = segments.reduce((n, s) => n + s.count, 0);
					return (
						<li key={tag} className="chart-stacked-row">
							<span className="chart-stacked-label">[{tag}]</span>
							<div className="chart-stacked-bar" role="img" aria-label={`${tag} grades`}>
								{segments.map((s) => (
									<span
										key={s.grade}
										className="chart-stacked-seg"
										style={{
											width: `${(s.count / maxTotal) * 100}%`,
											background: GRADE_COLORS[grades.indexOf(s.grade) % GRADE_COLORS.length],
										}}
										title={`G${s.grade}: ${s.count}`}
									/>
								))}
							</div>
							<span className="chart-stacked-total">{total}</span>
						</li>
					);
				})}
			</ul>
			<ul className="chart-legend chart-legend--inline">
				{grades.map((g, i) => (
					<li key={g}>
						<span
							className="chart-swatch"
							style={{ background: GRADE_COLORS[i % GRADE_COLORS.length] }}
						/>
						G{g}
					</li>
				))}
			</ul>
		</div>
	);
}

export function PowerLineChart({
	points,
	series,
}: {
	points?: Array<{ day: string; total_power: number }>;
	/** Multi-alliance: series per tag */
	series?: Array<{ tag: string; points: Array<{ day: string; total_power: number }> }>;
}) {
	const allPoints =
		series && series.length > 0
			? series.flatMap((s) => s.points)
			: points ?? [];
	if (allPoints.length < 2) {
		return (
			<p className="muted tiny">
				Not enough power history yet (needs morning sync snapshots).
			</p>
		);
	}

	const days = Array.from(new Set(allPoints.map((p) => p.day))).sort();
	const values = allPoints.map((p) => p.total_power);
	const min = Math.min(...values);
	const max = Math.max(...values);
	const pad = max === min ? max * 0.05 || 1 : (max - min) * 0.08;
	const yMin = Math.max(0, min - pad);
	const yMax = max + pad;
	const w = 420;
	const h = 160;
	const left = 8;
	const right = 8;
	const top = 12;
	const bottom = 24;

	const xAt = (i: number) => left + (i / Math.max(days.length - 1, 1)) * (w - left - right);
	const yAt = (v: number) =>
		top + (1 - (v - yMin) / (yMax - yMin || 1)) * (h - top - bottom);

	const lines =
		series && series.length > 0
			? series.map((s, si) => {
					const pts = days.map((day, i) => {
						const hit = s.points.find((p) => p.day === day);
						const v = hit?.total_power ?? 0;
						return `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(v)}`;
					});
					return {
						tag: s.tag,
						d: pts.join(' '),
						color: ALLIANCE_COLORS[si % ALLIANCE_COLORS.length],
					};
				})
			: [
					{
						tag: 'Total',
						d: days
							.map((day, i) => {
								const hit = (points ?? []).find((p) => p.day === day);
								return `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(hit?.total_power ?? 0)}`;
							})
							.join(' '),
						color: 'var(--lcars-a5)',
					},
				];

	return (
		<div className="chart-line-wrap">
			<svg viewBox={`0 0 ${w} ${h}`} className="chart-line" role="img" aria-label="Power over time">
				<line
					x1={left}
					y1={h - bottom}
					x2={w - right}
					y2={h - bottom}
					stroke="color-mix(in srgb, var(--lcars-a3) 55%, transparent)"
					strokeWidth="1"
				/>
				{lines.map((l) => (
					<path
						key={l.tag}
						d={l.d}
						fill="none"
						stroke={l.color}
						strokeWidth="2.5"
						strokeLinejoin="round"
						strokeLinecap="round"
					/>
				))}
				<text x={left} y={h - 6} className="chart-axis">
					{days[0]}
				</text>
				<text x={w - right} y={h - 6} textAnchor="end" className="chart-axis">
					{days[days.length - 1]}
				</text>
			</svg>
			{series && series.length > 1 ? (
				<ul className="chart-legend">
					{lines.map((l) => (
						<li key={l.tag}>
							<span className="chart-swatch" style={{ background: l.color }} />
							[{l.tag}]
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
