import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../api';
import { useGuild } from '../../guild/GuildContext';
import { LcarsPanel } from '../../lcars/LcarsFrame';

type ConfigForm = {
	alliance_tag: string;
	nickname_template: string;
	nickname_display_ranks: string;
	verification_enabled: boolean;
	poll_interval_hours: number;
	deploy_mode: string;
	demotion_policy: string;
	data_consent_enabled: boolean;
	data_consent_version: string;
	agreement_enabled: boolean;
	welcome_dm_enabled: boolean;
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
	const ranks = Array.isArray(c.nickname_display_ranks)
		? c.nickname_display_ranks.map(String).join(',')
		: String(c.nickname_display_ranks ?? '');
	return {
		alliance_tag: String(c.alliance_tag ?? ''),
		nickname_template: effective,
		nickname_display_ranks: ranks,
		verification_enabled: Boolean(c.verification_enabled),
		poll_interval_hours: Number(c.poll_interval_hours ?? 6),
		deploy_mode: String(c.deploy_mode ?? 'testing'),
		demotion_policy: String(c.demotion_policy ?? 'approval'),
		data_consent_enabled: Boolean(c.data_consent_enabled),
		data_consent_version: String(c.data_consent_version ?? '1'),
		agreement_enabled: Boolean(c.agreement_enabled),
		welcome_dm_enabled: Boolean(c.welcome_dm_enabled),
	};
}

export function ConfigPage() {
	const { guildId, status, setStatus } = useGuild();
	const [form, setForm] = useState(() => formFromConfig(status.config));
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	if (!status.can_configure) {
		return <Navigate to={`/guilds/${guildId}`} replace />;
	}

	const nickIsDefault = !String(status.config.nickname_template ?? '').trim();

	async function save(e: React.FormEvent) {
		e.preventDefault();
		setSaving(true);
		setSaved(null);
		setError(null);
		const nickTrim = form.nickname_template.trim();
		const modeDefault = String(
			status.config.nickname_template_default ??
				status.config.nickname_template_effective ??
				'',
		).trim();
		const nickname_template =
			!nickTrim || nickTrim === modeDefault ? null : nickTrim;
		const body = {
			alliance_tag: form.alliance_tag.trim() || null,
			nickname_template,
			nickname_display_ranks: form.nickname_display_ranks.trim() || null,
			verification_enabled: form.verification_enabled,
			poll_interval_hours: form.poll_interval_hours,
			deploy_mode: form.deploy_mode,
			demotion_policy: form.demotion_policy,
			data_consent_enabled: form.data_consent_enabled,
			data_consent_version: form.data_consent_version.trim() || '1',
			agreement_enabled: form.agreement_enabled,
			welcome_dm_enabled: form.welcome_dm_enabled,
		};
		const res = await api<{ config: Record<string, unknown>; can_configure: boolean }>(
			`/api/admin/guilds/${guildId}/config`,
			{ method: 'PATCH', body: JSON.stringify(body) },
		);
		setSaving(false);
		if (res.error || !res.data) {
			setError(res.error || 'Save failed');
			return;
		}
		setStatus({ ...status, config: res.data.config });
		setForm(formFromConfig(res.data.config));
		setSaved('Saved');
	}

	return (
		<LcarsPanel label="Server Config" cap="a1">
			<p className="muted tiny">
				Discord Administrator only. Slash commands remain available in Discord. Role lists are under
				Permissions.
			</p>
			{error ? <p className="error">{error}</p> : null}
			{saved ? <p className="ok">{saved}</p> : null}
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
							: 'Custom template stored in DB. Clear or match default to revert.'}
					</span>
				</label>
				<label>
					Nickname ranks
					<input
						value={form.nickname_display_ranks}
						onChange={(e) =>
							setForm({ ...form, nickname_display_ranks: e.target.value })
						}
						placeholder="Commodore,Admiral"
						spellCheck={false}
					/>
					<span className="field-hint">
						Which in-game ranks appear in nick placeholders (comma-separated). Empty =
						all. Abbrevs OK: Adm, Com, Pr, Op, Ag.
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
	);
}
