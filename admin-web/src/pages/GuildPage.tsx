import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type GradePlayersResponse, type GuildStatus, type RosterPlayerRow } from '../api';
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
	const stored = c.nickname_template != null ? String(c.nickname_template).trim() : '';
	const effective =
		stored ||
		(c.nickname_template_effective != null
			? String(c.nickname_template_effective)
			: c.nickname_template_default != null
				? String(c.nickname_template_default)
				: '');
	return {
		alliance_tag: String(c.alliance_tag ?? ''),
		// Show effective pattern when DB is unset so the field matches /server status behaviour.
		nickname_template: effective,
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

function fmtNum(n: number | null | undefined): string {
	if (n == null || !Number.isFinite(n)) return '—';
	return n.toLocaleString();
}

export function GuildPage() {
	const { guildId } = useParams();
	const navigate = useNavigate();
	const [status, setStatus] = useState<GuildStatus | null>(null);
	const [form, setForm] = useState<ConfigForm | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [selectedGrade, setSelectedGrade] = useState<number | null>(null);
	const [gradePlayers, setGradePlayers] = useState<RosterPlayerRow[] | null>(null);
	const [gradeLoading, setGradeLoading] = useState(false);
	const [gradeError, setGradeError] = useState<string | null>(null);

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

	useEffect(() => {
		if (!guildId || selectedGrade == null) {
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

	async function save(e: React.FormEvent) {
		e.preventDefault();
		if (!guildId || !form || !status) return;
		setSaving(true);
		setSaved(null);
		setError(null);
		const nickTrim = form.nickname_template.trim();
		const modeDefault = String(
			status.config.nickname_template_default ??
				status.config.nickname_template_effective ??
				'',
		).trim();
		// Persist null when the field matches the mode default (same as leaving unset).
		const nickname_template =
			!nickTrim || nickTrim === modeDefault ? null : nickTrim;
		const body = {
			alliance_tag: form.alliance_tag.trim() || null,
			nickname_template,
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
		setStatus((prev) => (prev ? { ...prev, config: res.data!.config } : prev));
		setForm(formFromConfig(res.data.config));
		setSaved('Saved');
	}

	function toggleGrade(grade: number) {
		setSelectedGrade((prev) => (prev === grade ? null : grade));
	}

	if (!status || !form) {
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
	const nickIsDefault = !String(cfg.nickname_template ?? '').trim();

	return (
		<LcarsFrame
			title={`${tag}Guild dashboard`}
			eyebrow={`${String(cfg.mode)} · server ${String(cfg.stfc_server)} ${String(cfg.stfc_region)}`}
			navTop={[
				{ label: 'Guilds', short: '01', to: '/app', color: 5 },
				{ label: 'Home', short: '22', to: '/', color: 6 },
			]}
			navBottom={[
				{ label: gatewayOk ? 'Gateway OK' : 'Gateway —', short: 'GW', color: gatewayOk ? 5 : 3 },
				{ label: `v${status.bot_version}`, short: 'V', color: 8 },
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
					<ul className="plain grade-list">
						{status.stats.by_grade.length === 0 ? (
							<li className="muted">No grade data</li>
						) : (
							status.stats.by_grade.map((r) => (
								<li key={r.grade}>
									<button
										type="button"
										className={`grade-link${selectedGrade === r.grade ? ' grade-link--active' : ''}`}
										onClick={() => toggleGrade(r.grade)}
										aria-pressed={selectedGrade === r.grade}
									>
										<span>G{r.grade}</span>
										<strong>{r.count}</strong>
									</button>
								</li>
							))
						)}
					</ul>
					{selectedGrade != null ? (
						<p className="muted tiny" style={{ marginTop: '0.65rem' }}>
							Showing G{selectedGrade} below — click again to close
						</p>
					) : (
						<p className="muted tiny" style={{ marginTop: '0.65rem' }}>
							Click a grade for the player list
						</p>
					)}
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
											<tr key={p.discord_user_id}>
												<td>{p.player_name ?? '—'}</td>
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
							placeholder="{rank_prefix}{player_name}"
							spellCheck={false}
						/>
						<span className="field-hint">
							{nickIsDefault
								? 'Using mode default (DB unset). Placeholders: {player_name} {alliance_tag} {rank} {rank_prefix} {rank_paren}'
								: 'Custom template stored in DB. Clear or match default to revert. Placeholders: {player_name} {alliance_tag} {rank} {rank_prefix} {rank_paren}'}
						</span>
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
