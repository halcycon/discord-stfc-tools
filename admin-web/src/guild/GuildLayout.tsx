import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, type GuildStatus } from '../api';
import { LcarsFrame, type LcarsNavItem } from '../lcars/LcarsFrame';
import { GuildContext } from './GuildContext';

export function GuildLayout() {
	const { guildId } = useParams();
	const navigate = useNavigate();
	const location = useLocation();
	const [status, setStatus] = useState<GuildStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const path = location.pathname;

	const reload = useCallback(async () => {
		if (!guildId) return;
		const res = await api<GuildStatus>(`/api/admin/guilds/${guildId}/status`);
		if (res.status === 401) {
			navigate('/login');
			return;
		}
		if (res.error || !res.data) {
			setError(res.error || 'Failed to load guild');
			return;
		}
		setStatus(res.data);
		setError(null);
	}, [guildId, navigate]);

	useEffect(() => {
		void reload();
	}, [reload]);

	const nav = useMemo((): LcarsNavItem[] => {
		if (!guildId || !status) return [];
		const base = `/guilds/${guildId}`;
		const canConfig = status.can_configure;
		const multi = String(status.config.mode) === 'multi_alliance';
		const items: LcarsNavItem[] = [
			{ label: 'Guilds', short: '01', to: '/app', color: 5 },
			{
				label: 'Dashboard',
				short: 'D',
				to: base,
				color: 5,
				active: path === base || path === `${base}/`,
			},
			{
				label: 'Reports',
				short: 'R',
				to: `${base}/reports`,
				color: 2,
				active: path.includes('/reports'),
			},
			{
				label: 'Surveys',
				short: 'S',
				to: `${base}/surveys`,
				color: 8,
				active: path.includes('/surveys'),
			},
		];
		if (canConfig) {
			items.push(
				{
					label: 'Server Config',
					short: 'C',
					to: `${base}/config`,
					color: 1,
					active: path.endsWith('/config'),
				},
				{
					label: 'Permissions',
					short: 'P',
					to: `${base}/permissions`,
					color: 6,
					active: path.includes('/permissions'),
				},
			);
			if (multi) {
				items.push({
					label: 'Exchange',
					short: 'X',
					to: `${base}/exchange`,
					color: 7,
					active: path.includes('/exchange'),
				});
			}
		}
		return items;
	}, [guildId, status, path]);

	if (!guildId) return <Navigate to="/app" replace />;

	if (!status) {
		return (
			<LcarsFrame
				title="Guild"
				eyebrow="STFC Tools"
				navTop={[{ label: 'Guilds', short: '01', to: '/app', color: 5 }]}
				navBottom={[{ label: error ? 'Fault' : 'Loading', short: '…', color: error ? 'alert' : 3 }]}
			>
				{error ? <p className="error">{error}</p> : <p className="lcars-status">Loading guild…</p>}
			</LcarsFrame>
		);
	}

	const cfg = status.config;
	const tag = cfg.alliance_tag ? `[${String(cfg.alliance_tag)}] ` : '';
	const gatewayOk = Boolean(status.gateway?.ready);

	return (
		<GuildContext.Provider value={{ guildId, status, reload, setStatus }}>
			<LcarsFrame
				title={`${tag}Guild dashboard`}
				eyebrow={`${String(cfg.mode)} · server ${String(cfg.stfc_server)} ${String(cfg.stfc_region)}`}
				navTop={nav}
				navBottom={[
					{ label: gatewayOk ? 'Gateway OK' : 'Gateway —', short: 'GW', color: gatewayOk ? 5 : 3 },
					{ label: `v${status.bot_version}`, short: 'V', color: 8 },
					{
						label: status.can_configure ? 'Admin' : 'Staff',
						short: 'A',
						color: status.can_configure ? 1 : 2,
					},
				]}
				actions={
					<span className={`lcars-status${gatewayOk ? ' lcars-status--ok' : ' lcars-status--warn'}`}>
						{gatewayOk ? 'Gateway linked' : 'Gateway unknown'}
					</span>
				}
			>
				{error ? <p className="error">{error}</p> : null}
				<Outlet />
			</LcarsFrame>
		</GuildContext.Provider>
	);
}
