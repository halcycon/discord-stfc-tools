import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type GuildListItem, type MeResponse } from '../api';
import { LcarsFrame, LcarsPanel } from '../lcars/LcarsFrame';

export function HomePage() {
	const navigate = useNavigate();
	const [me, setMe] = useState<MeResponse | null>(null);
	const [guilds, setGuilds] = useState<GuildListItem[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		void (async () => {
			const meRes = await api<MeResponse>('/api/admin/me');
			if (meRes.status === 401) {
				navigate('/login');
				return;
			}
			if (meRes.error || !meRes.data) {
				setError(meRes.error || 'Failed to load profile');
				setLoading(false);
				return;
			}
			setMe(meRes.data);
			const gRes = await api<{ guilds: GuildListItem[] }>('/api/admin/guilds');
			if (gRes.error || !gRes.data) {
				setError(gRes.error || 'Failed to load guilds');
			} else {
				setGuilds(gRes.data.guilds);
			}
			setLoading(false);
		})();
	}, [navigate]);

	async function logout() {
		await api('/api/admin/auth/logout', { method: 'POST' });
		navigate('/login');
	}

	if (loading) {
		return (
			<LcarsFrame title="Systems" eyebrow="STFC Tools" navBottom={[{ label: 'Loading', color: 3 }]}>
				<p className="lcars-status">Loading guild directory…</p>
			</LcarsFrame>
		);
	}

	return (
		<LcarsFrame
			title="Your guilds"
			eyebrow={`STFC Tools · v${me?.bot_version ?? '—'}`}
			navTop={[
				{ label: 'Guilds', to: '/app', color: 5, active: true },
				{ label: 'Home', to: '/', color: 6 },
			]}
			navBottom={[
				{ label: me?.user.global_name || me?.user.username || 'Operator', color: 2 },
				{ label: 'Log out', onClick: () => void logout(), color: 'alert' },
			]}
			actions={
				<button type="button" className="lcars-pill lcars-pill--ghost lcars-pill--sm" onClick={() => void logout()}>
					Log out
				</button>
			}
		>
			{error ? <p className="error">{error}</p> : null}
			{guilds.length === 0 ? (
				<LcarsPanel label="Directory" cap="a6">
					<p>
						No accessible guilds. Invite the bot and run <code>/server setup</code>, or ensure
						you have Administrator / a web-admin role.
					</p>
				</LcarsPanel>
			) : (
				<LcarsPanel label={`Accessible · ${guilds.length}`} cap="a5">
					<ul className="guild-list">
						{guilds.map((g) => (
							<li key={g.id}>
								<Link className="guild-link" to={`/guilds/${g.id}`}>
									<span className="guild-link-body">
										<strong>{g.name}</strong>
										<span className="muted">
											{g.alliance_tag ? `[${g.alliance_tag}] · ` : ''}
											{g.mode} · via {g.via}
										</span>
									</span>
								</Link>
							</li>
						))}
					</ul>
				</LcarsPanel>
			)}
		</LcarsFrame>
	);
}
