import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, type GuildRoleRow, type GuildRolesResponse } from '../../api';
import { RoleChecklist } from '../../components/RoleChecklist';
import { useGuild } from '../../guild/GuildContext';
import { LcarsPanel } from '../../lcars/LcarsFrame';

function idsFromConfig(c: Record<string, unknown>, key: string): string[] {
	const v = c[key];
	return Array.isArray(v) ? v.map(String).filter((id) => /^\d{15,20}$/.test(id)) : [];
}

export function PermissionsPage() {
	const { guildId, status, setStatus } = useGuild();
	const navigate = useNavigate();
	const [webAdmin, setWebAdmin] = useState(() => idsFromConfig(status.config, 'web_admin_role_ids'));
	const [dmQuery, setDmQuery] = useState(() => idsFromConfig(status.config, 'dm_query_role_ids'));
	const [surveyCreators, setSurveyCreators] = useState(() =>
		idsFromConfig(status.config, 'survey_creator_role_ids'),
	);
	const [surveyResults, setSurveyResults] = useState(() =>
		idsFromConfig(status.config, 'survey_results_role_ids'),
	);
	const [exchangeAdmins, setExchangeAdmins] = useState(() =>
		idsFromConfig(status.config, 'exchange_admin_role_ids'),
	);
	const [roles, setRoles] = useState<GuildRoleRow[] | null>(null);
	const [rolesLoading, setRolesLoading] = useState(false);
	const [rolesError, setRolesError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState<string | null>(null);

	if (!status.can_configure) {
		return <Navigate to={`/guilds/${guildId}`} replace />;
	}

	const multi = String(status.config.mode) === 'multi_alliance';
	const suggested = Array.isArray(status.config.suggested_web_admin_role_ids)
		? (status.config.suggested_web_admin_role_ids as string[])
		: [];

	async function loadRoles() {
		setRolesLoading(true);
		setRolesError(null);
		const res = await api<GuildRolesResponse>(`/api/admin/guilds/${guildId}/roles`);
		setRolesLoading(false);
		if (res.status === 401) {
			navigate('/login');
			return;
		}
		if (res.error || !res.data) {
			setRolesError(res.error || 'Failed to list roles');
			return;
		}
		setRoles(res.data.roles);
	}

	async function save(e: React.FormEvent) {
		e.preventDefault();
		setSaving(true);
		setError(null);
		setSaved(null);
		const body: Record<string, unknown> = {
			web_admin_role_ids: webAdmin,
			dm_query_role_ids: dmQuery,
			survey_creator_role_ids: surveyCreators,
			survey_results_role_ids: surveyResults,
		};
		if (multi) body.exchange_admin_role_ids = exchangeAdmins;
		const res = await api<{ config: Record<string, unknown> }>(
			`/api/admin/guilds/${guildId}/config`,
			{ method: 'PATCH', body: JSON.stringify(body) },
		);
		setSaving(false);
		if (res.error || !res.data) {
			setError(res.error || 'Save failed');
			return;
		}
		setStatus({ ...status, config: res.data.config });
		setSaved('Saved');
	}

	const shared = {
		roles,
		onLoadRoles: () => void loadRoles(),
		rolesLoading,
		rolesError,
	};

	return (
		<LcarsPanel label="Permissions" cap="a6">
			<p className="muted tiny">
				Discord Administrator only. Empty lists mean Administrators only for that feature. WebUI staff
				also gain `/roster` reporting in Discord.
			</p>
			{error ? <p className="error">{error}</p> : null}
			{saved ? <p className="ok">{saved}</p> : null}
			<form className="form" onSubmit={(e) => void save(e)}>
				<RoleChecklist
					{...shared}
					label="WebUI staff"
					hint="Access Dashboard, Reports, Surveys. Cannot change Server Config / Permissions. Empty = Discord Administrators only."
					selected={webAdmin}
					onChange={setWebAdmin}
					suggestedIds={suggested}
				/>
				<RoleChecklist
					{...shared}
					label="Roster / DM query roles"
					hint="Also used by `/server assistant` — Discord `/roster` reads and DM roster Q&A (in addition to WebUI staff)."
					selected={dmQuery}
					onChange={setDmQuery}
				/>
				<RoleChecklist
					{...shared}
					label="Survey creators"
					hint="Same as `/survey creators` — create/send/close surveys."
					selected={surveyCreators}
					onChange={setSurveyCreators}
				/>
				<RoleChecklist
					{...shared}
					label="Survey results viewers"
					hint="View survey results / log access beyond creators and Administrators."
					selected={surveyResults}
					onChange={setSurveyResults}
				/>
				{multi ? (
					<RoleChecklist
						{...shared}
						label="Exchange admins"
						hint="Manage exchange resources (`/exchange resource`). Setup layout stays under Resource Exchange."
						selected={exchangeAdmins}
						onChange={setExchangeAdmins}
					/>
				) : null}
				<button type="submit" className="lcars-pill" disabled={saving}>
					{saving ? 'Saving…' : 'Save permissions'}
				</button>
			</form>
		</LcarsPanel>
	);
}
