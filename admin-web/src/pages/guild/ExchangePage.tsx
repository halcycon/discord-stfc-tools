import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../api';
import { useGuild } from '../../guild/GuildContext';
import { LcarsPanel } from '../../lcars/LcarsFrame';

export function ExchangePage() {
	const { guildId, status, setStatus } = useGuild();
	const multi = String(status.config.mode) === 'multi_alliance';
	const [layout, setLayout] = useState(
		String(status.config.exchange_layout ?? '') || '',
	);
	const [hub, setHub] = useState(String(status.config.exchange_hub_channel_id ?? ''));
	const [category, setCategory] = useState(String(status.config.exchange_category_id ?? ''));
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState<string | null>(null);

	if (!status.can_configure || !multi) {
		return <Navigate to={`/guilds/${guildId}`} replace />;
	}

	async function save(e: React.FormEvent) {
		e.preventDefault();
		setSaving(true);
		setError(null);
		setSaved(null);
		const body = {
			exchange_layout: layout === 'hub' || layout === 'category' ? layout : null,
			exchange_hub_channel_id: hub.trim() || null,
			exchange_category_id: category.trim() || null,
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
		setStatus({ ...status, config: res.data.config });
		setSaved('Saved');
	}

	return (
		<LcarsPanel label="Resource Exchange" cap="a7">
			<p className="muted tiny">
				Multi-alliance only. Discord Administrator only. Exchange admin roles are under Permissions.
				Full setup also available via `/exchange setup`.
			</p>
			{error ? <p className="error">{error}</p> : null}
			{saved ? <p className="ok">{saved}</p> : null}
			<form className="form" onSubmit={(e) => void save(e)}>
				<label>
					Layout
					<select value={layout} onChange={(e) => setLayout(e.target.value)}>
						<option value="">(unset)</option>
						<option value="hub">hub</option>
						<option value="category">category</option>
					</select>
				</label>
				<label>
					Hub channel ID
					<input
						value={hub}
						onChange={(e) => setHub(e.target.value)}
						placeholder="Discord channel snowflake"
						spellCheck={false}
					/>
				</label>
				<label>
					Category ID
					<input
						value={category}
						onChange={(e) => setCategory(e.target.value)}
						placeholder="Discord category snowflake"
						spellCheck={false}
					/>
				</label>
				<button type="submit" className="lcars-pill" disabled={saving}>
					{saving ? 'Saving…' : 'Save exchange'}
				</button>
			</form>
		</LcarsPanel>
	);
}
