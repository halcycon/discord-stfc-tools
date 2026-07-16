import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type SurveySummary, type SurveysResponse } from '../../api';
import { useGuild } from '../../guild/GuildContext';
import { LcarsPanel } from '../../lcars/LcarsFrame';

export function SurveysPage() {
	const { guildId } = useGuild();
	const navigate = useNavigate();
	const [surveys, setSurveys] = useState<SurveySummary[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [openId, setOpenId] = useState<number | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		void (async () => {
			const res = await api<SurveysResponse>(`/api/admin/guilds/${guildId}/surveys`);
			if (cancelled) return;
			setLoading(false);
			if (res.status === 401) {
				navigate('/login');
				return;
			}
			if (res.error || !res.data) {
				setError(res.error || 'Failed to load surveys');
				return;
			}
			setSurveys(res.data.surveys);
		})();
		return () => {
			cancelled = true;
		};
	}, [guildId, navigate]);

	return (
		<LcarsPanel label="Surveys" cap="a8">
			<p className="muted tiny">Read-only summary. Create and send surveys via Discord `/survey`.</p>
			{loading ? <p className="lcars-status">Loading surveys…</p> : null}
			{error ? <p className="error">{error}</p> : null}
			{!loading && !error && surveys.length === 0 ? (
				<p className="muted">No surveys yet.</p>
			) : null}
			<ul className="survey-list">
				{surveys.map((s) => {
					const open = openId === s.id;
					return (
						<li key={s.id} className="survey-card">
							<button
								type="button"
								className="survey-card-head"
								onClick={() => setOpenId(open ? null : s.id)}
								aria-expanded={open}
							>
								<span>
									<strong>{s.title || s.question.slice(0, 80)}</strong>
									<span className="muted tiny">
										{' '}
										· {s.status} · {s.response_count}/{s.target_count || '?'} responses
									</span>
								</span>
								<span className="muted tiny">{open ? 'Hide' : 'Results'}</span>
							</button>
							{open ? (
								<div className="survey-card-body">
									{s.title ? <p className="muted">{s.question}</p> : null}
									{s.by_option.length === 0 ? (
										<p className="muted tiny">No responses yet.</p>
									) : (
										<ul className="plain">
											{s.by_option.map((o) => (
												<li key={o.response}>
													{o.response}: <strong>{o.count}</strong>
												</li>
											))}
										</ul>
									)}
								</div>
							) : null}
						</li>
					);
				})}
			</ul>
		</LcarsPanel>
	);
}
