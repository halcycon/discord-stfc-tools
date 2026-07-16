const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

const SESSION_STORAGE_KEY = 'stfc_admin_session';

export function getStoredSessionToken(): string | null {
	try {
		return sessionStorage.getItem(SESSION_STORAGE_KEY);
	} catch {
		return null;
	}
}

export function setStoredSessionToken(token: string): void {
	sessionStorage.setItem(SESSION_STORAGE_KEY, token);
}

export function clearStoredSessionToken(): void {
	try {
		sessionStorage.removeItem(SESSION_STORAGE_KEY);
	} catch {
		/* ignore */
	}
}

export async function api<T>(
	path: string,
	init: RequestInit = {},
): Promise<{ data?: T; error?: string; status: number }> {
	const url = `${API_BASE}${path}`;
	const headers: Record<string, string> = {
		...(init.body ? { 'Content-Type': 'application/json' } : {}),
		...(init.headers as Record<string, string> | undefined),
	};
	const token = getStoredSessionToken();
	if (token && !headers.Authorization && !headers.authorization) {
		headers.Authorization = `Bearer ${token}`;
	}
	const res = await fetch(url, {
		...init,
		credentials: 'include',
		headers,
	});
	let body: unknown = null;
	const text = await res.text();
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		body = { error: text };
	}
	if (!res.ok) {
		const err =
			body && typeof body === 'object' && 'error' in body
				? String((body as { error: unknown }).error)
				: res.statusText;
		return { error: err, status: res.status };
	}
	return { data: body as T, status: res.status };
}

export type MeResponse = {
	user: { id: string; username: string; global_name: string | null; avatar: string | null };
	bot_version: string;
};

export type GuildListItem = {
	id: string;
	name: string;
	icon: string | null;
	alliance_tag: string | null;
	mode: string;
	via: string;
	can_configure: boolean;
};

export type GuildStatus = {
	guild_id: string;
	bot_version: string;
	can_configure: boolean;
	via: string;
	config: Record<string, unknown>;
	stats: {
		verified_total: number;
		guest_total: number;
		unlinked_total: number;
		by_grade: Array<{ grade: number; count: number }>;
		by_status: Array<{ verification_status: string; count: number }>;
		by_alliance: Array<{ alliance_tag: string; count: number }>;
	};
	charts: {
		power_by_day: Array<{ day: string; total_power: number; sample_count: number }>;
		power_by_day_alliance: Array<{
			day: string;
			alliance_tag: string;
			total_power: number;
			sample_count: number;
		}>;
		by_grade_alliance: Array<{ alliance_tag: string; grade: number; count: number }>;
	};
	gateway: { ready?: boolean; lastEventAt?: string | null } | null;
};

export type RosterPlayerRow = {
	player_name: string | null;
	alliance_tag: string | null;
	alliance_rank: string | null;
	ops_level: number | null;
	power: number | null;
	grade: number | null;
	activity_streak: number | null;
	days_inactive: number;
	verification_status: string;
	discord_user_id: string | null;
	player_id: number | null;
	on_discord?: boolean;
};

export type GradePlayersResponse = {
	guild_id: string;
	grade: number;
	count: number;
	players: RosterPlayerRow[];
};

export type ReportsPlayersResponse = {
	guild_id: string;
	count: number;
	include_unlinked: boolean;
	players: RosterPlayerRow[];
};

export type GuildRoleRow = {
	id: string;
	name: string;
	position: number;
	managed: boolean;
	color: number;
};

export type GuildRolesResponse = {
	guild_id: string;
	roles: GuildRoleRow[];
	suggested_web_admin_role_ids: string[];
	can_configure?: boolean;
};

export type SurveySummary = {
	id: number;
	title: string | null;
	question: string;
	status: string;
	delivery: string;
	options: string[];
	target_count: number;
	response_count: number;
	by_option: Array<{ response: string; count: number }>;
	sent_at: string | null;
	closed_at: string | null;
	created_at: string;
};

export type SurveysResponse = {
	guild_id: string;
	surveys: SurveySummary[];
};
