import { useMemo, useState } from 'react';
import type { GuildRoleRow } from '../api';

function roleColorCss(color: number): string | undefined {
	if (!color) return undefined;
	return `#${color.toString(16).padStart(6, '0')}`;
}

type Props = {
	roles: GuildRoleRow[] | null;
	selected: string[];
	onChange: (ids: string[]) => void;
	disabled?: boolean;
	suggestedIds?: string[];
	label: string;
	hint: string;
	onLoadRoles: () => void;
	rolesLoading?: boolean;
	rolesError?: string | null;
};

export function RoleChecklist({
	roles,
	selected,
	onChange,
	disabled,
	suggestedIds = [],
	label,
	hint,
	onLoadRoles,
	rolesLoading,
	rolesError,
}: Props) {
	const [filter, setFilter] = useState('');
	const filterLc = filter.trim().toLowerCase();
	const visible = useMemo(
		() =>
			(roles ?? []).filter((r) => {
				if (!filterLc) return true;
				return r.name.toLowerCase().includes(filterLc) || r.id.includes(filterLc);
			}),
		[roles, filterLc],
	);

	function toggle(id: string) {
		if (disabled) return;
		onChange(
			selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id],
		);
	}

	const selectedNames = selected.map((id) => {
		const known = roles?.find((r) => r.id === id);
		return known ? known.name : id;
	});

	return (
		<div className="role-picker">
			<div className="role-picker-head">
				<span className="role-picker-title">{label}</span>
				<div className="role-picker-actions">
					<button
						type="button"
						className="lcars-pill lcars-pill--sm lcars-pill--a6"
						onClick={onLoadRoles}
						disabled={rolesLoading || disabled}
					>
						{rolesLoading ? 'Loading…' : roles ? 'Refresh roles' : 'List roles'}
					</button>
					{suggestedIds.length > 0 ? (
						<button
							type="button"
							className="lcars-pill lcars-pill--sm lcars-pill--a2"
							disabled={disabled}
							onClick={() =>
								onChange(Array.from(new Set([...selected, ...suggestedIds])))
							}
						>
							Suggest leadership
						</button>
					) : null}
					<button
						type="button"
						className="lcars-pill lcars-pill--sm lcars-pill--ghost"
						disabled={disabled || selected.length === 0}
						onClick={() => onChange([])}
					>
						Clear
					</button>
				</div>
			</div>
			<span className="field-hint">{hint}</span>
			<p className="role-selected muted tiny">
				Selected ({selected.length}):{' '}
				{selected.length ? selectedNames.join(', ') : 'none'}
			</p>
			{rolesError ? <p className="error">{rolesError}</p> : null}
			{roles ? (
				<>
					<input
						className="role-filter"
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						placeholder="Filter roles by name or id"
						spellCheck={false}
						disabled={disabled}
					/>
					<ul className="role-checklist">
						{visible.length === 0 ? (
							<li className="muted">No roles match</li>
						) : (
							visible.map((r) => {
								const checked = selected.includes(r.id);
								const swatch = roleColorCss(r.color);
								return (
									<li key={r.id}>
										<label className={`role-check${checked ? ' role-check--on' : ''}`}>
											<input
												type="checkbox"
												checked={checked}
												disabled={disabled}
												onChange={() => toggle(r.id)}
											/>
											<span
												className="role-swatch"
												style={swatch ? { background: swatch } : undefined}
												aria-hidden
											/>
											<span className="role-name">
												{r.name}
												{r.managed ? (
													<span className="role-managed"> managed</span>
												) : null}
											</span>
											<code className="role-id">{r.id}</code>
										</label>
									</li>
								);
							})
						)}
					</ul>
				</>
			) : (
				<p className="muted tiny">
					Click <strong>List roles</strong> to load Discord roles via the bot.
				</p>
			)}
		</div>
	);
}
