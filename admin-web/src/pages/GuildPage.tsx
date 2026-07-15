import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type GuildStatus } from '../api';
import { LcarsFrame, LcarsPanel } from '../lcars/LcarsFrame';

type ConfigForm = {
	alliance_tag: string;
	nickname_template: string;
	verification_enabled: boolean;
	poll_interval_hours: number;
	deploy_mode: string;
	demotion_policy: string;
	data_consent_enabled: boolean;
	data_consent_version: string;
	agreement_enabled: boolean;
	welcome_dm_enabled: boolean;
	web_admin_role_ids: string;
};

function formFromConfig(c: Record<string, unknown>): ConfigForm {
	return {
		alliance_tag: String(c.alliance_tag ?? ''),
		nickname_template: String(c.nickname_template ?? ''),
		verification_enabled: Boolean(c.verification_enabled),
		poll_interval_hours: Number(c.poll_interval_hours ?? 6),
		deploy_mode: String(c.deploy_mode ?? 'testing'),
		demotion_policy: String(c.demotion_policy ?? 'approval'),
		data_consent_enabled: Boolean(c.data_consent_enabled),
		data_consent_version: String(c.data_consent_version ?? '1'),
		agreement_enabled: Boolean(c.agreement_enabled),
		welcome_dm_enabled: Boolean(c.welcome_dm_enabled),
		web_admin_role_ids: Array.isArray(c.web_admin_role_ids)
			? (c.web_admin_role_ids as string[]).join(', ')
			: '',
	};
}

export function GuildPage() {
	const { guildId } = useParams();
	const navigate = useNavigate();
	const [status, setStatus] = useState<GuildStatus | null>(null);
	const [form, setForm] = useState<ConfigForm | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!guildId) return;
		void (async () => {
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
			setForm(formFromConfig(res.data.config));
		})();
	}, [guildId, navigate]);

	async function save(e: React.FormEvent) {
		e.preventDefault();
		if (!guildId || !form) return;
		setSaving(true);
		setSaved(null);
		setError(null);
		const body = {
			alliance_tag: form.alliance_tag.trim() || null,
			nickname_template: form.nickname_template.trim() || null,
			verification_enabled: form.verification_enabled,
			poll_interval_hours: form.poll_interval_hours,
			deploy_mode: form.deploy_mode,
			demotion_policy: form.demotion_policy,
			data_consent_enabled: form.data_consent_enabled,
			data_consent_version: form.data_consent_version.trim() || '1',
			agreement_enabled: form.agreement_enabled,
			welcome_dm_enabled: form.welcome_dm_enabled,
			web_admin_role_ids: form.web_admin_role_ids
				.split(/[,\s]+/)
				.map((s) => s.trim())
				.filter((id) => /^\d{15,20}$/.test(id)),
		};
		const res = await api<{ config: Record<string, unknown> }>(
			`/api/admin/guilds/${guildId}/config`,
			{ method: 'PATCH', body: JSON.stringify(body) },
		);
		setSaving(false);
		if (res.error || !res.data) {
			setError(res.error || 'Save failed');
			return;
		}
		setForm(formFromConfig(res.data.config));
		setSaved('Saved');
	}

	if (!status || !form) {
		return (
			<LcarsFrame
				title="Guild"
				eyebrow="STFC Tools"
				navTop={[{ label: 'Guilds', to: '/app', color: 5 }]}
				navBottom={[{ label: error ? 'Fault' : 'Loading', color: error ? 'alert' : 3 }]}
			>
				{error ? <p className="error">{error}</p> : <p className="lcars-status">Loading guild…</p>}
			</LcarsFrame>
		);
	}

	const cfg = status.config;
	const tag = cfg.alliance_tag ? `[${String(cfg.alliance_tag)}] ` : '';
	const gatewayOk = Boolean(status.gateway?.ready);

	return (
		<LcarsFrame
			title={`${tag}Guild dashboard`}
			eyebrow={`${String(cfg.mode)} · server ${String(cfg.stfc_server)} ${String(cfg.stfc_region)}`}
			navTop={[
				{ label: 'Guilds', to: '/app', color: 5 },
				{ label: 'Home', to: '/', color: 6 },
			]}
			navBottom={[
				{ label: gatewayOk ? 'Gateway OK' : 'Gateway —', color: gatewayOk ? 5 : 3 },
				{ label: `v${status.bot_version}`, color: 8 },
			]}
			actions={
				<span className={`lcars-status${gatewayOk ? ' lcars-status--ok' : ' lcars-status--warn'}`}>
					{gatewayOk ? 'Gateway linked' : 'Gateway unknown'}
				</span>
			}
		>
			{error ? <p className="error">{error}</p> : null}
			{saved ? <p className="ok">{saved}</p> : null}

			<section className="grid">
				<LcarsPanel label="At a glance" cap="a5">
					<p className="stat">{status.stats.verified_total}</p>
					<p className="muted">Verified / guest players</p>
					<ul className="plain">
						{status.stats.by_status.map((r) => (
							<li key={r.verification_status}>
								{r.verification_status}: <strong>{r.count}</strong>
							</li>
						))}
					</ul>
				</LcarsPanel>
				<LcarsPanel label="By grade" cap="a2">
					<ul className="plain">
						{status.stats.by_grade.length === 0 ? (
							<li className="muted">No grade data</li>
						) : (
							status.stats.by_grade.map((r) => (
								<li key={r.grade}>
									G{r.grade}: <strong>{r.count}</strong>
								</li>
							))
						)}
					</ul>
				</LcarsPanel>
				<LcarsPanel label="Gateway" cap="a6">
					<p className={gatewayOk ? 'lcars-status lcars-status--ok' : 'lcars-status lcars-status--warn'}>
						{gatewayOk ? 'Connected' : 'Not ready / unknown'}
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

			<LcarsPanel label="Config" cap="a1">
				<p className="muted tiny">
					Subset of <code>/server</code> settings. Slash commands remain available in Discord.
				</p>
				<form className="form" onSubmit={(e) => void save(e)}>
					<label>
						Alliance tag
						<input
							value={form.alliance_tag}
							onChange={(e) => setForm({ ...form, alliance_tag: e.target.value })}
						/>
					</label>
					<label>
						Nickname template
						<input
							value={form.nickname_template}
							onChange={(e) => setForm({ ...form, nickname_template: e.target.value })}
							placeholder="{name}"
						/>
					</label>
					<label>
						Poll interval (hours)
						<input
							type="number"
							min={1}
							max={168}
							value={form.poll_interval_hours}
							onChange={(e) =>
								setForm({ ...form, poll_interval_hours: Number(e.target.value) })
							}
						/>
					</label>
					<label>
						Deploy mode
						<select
							value={form.deploy_mode}
							onChange={(e) => setForm({ ...form, deploy_mode: e.target.value })}
						>
							<option value="testing">testing</option>
							<option value="live">live</option>
						</select>
					</label>
					<label>
						Demotion policy
						<select
							value={form.demotion_policy}
							onChange={(e) => setForm({ ...form, demotion_policy: e.target.value })}
						>
							<option value="approval">approval</option>
							<option value="yolo">yolo</option>
						</select>
					</label>
					<label>
						Data consent version
						<input
							value={form.data_consent_version}
							onChange={(e) => setForm({ ...form, data_consent_version: e.target.value })}
						/>
					</label>
					<label>
						Web admin role IDs (comma-separated)
						<input
							value={form.web_admin_role_ids}
							onChange={(e) => setForm({ ...form, web_admin_role_ids: e.target.value })}
							placeholder="role ids for leadership access"
						/>
					</label>
					<div className="checks">
						<label className="check">
							<input
								type="checkbox"
								checked={form.verification_enabled}
								onChange={(e) =>
									setForm({ ...form, verification_enabled: e.target.checked })
								}
							/>
							Verification enabled
						</label>
						<label className="check">
							<input
								type="checkbox"
								checked={form.data_consent_enabled}
								onChange={(e) =>
									setForm({ ...form, data_consent_enabled: e.target.checked })
								}
							/>
							Data consent gate
						</label>
						<label className="check">
							<input
								type="checkbox"
								checked={form.agreement_enabled}
								onChange={(e) =>
									setForm({ ...form, agreement_enabled: e.target.checked })
								}
							/>
							CoC agreement
						</label>
						<label className="check">
							<input
								type="checkbox"
								checked={form.welcome_dm_enabled}
								onChange={(e) =>
									setForm({ ...form, welcome_dm_enabled: e.target.checked })
								}
							/>
							Welcome DM
						</label>
					</div>
					<button type="submit" className="lcars-pill" disabled={saving}>
						{saving ? 'Saving…' : 'Save config'}
					</button>
				</form>
			</LcarsPanel>
		</LcarsFrame>
	);
}
