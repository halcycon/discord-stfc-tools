import {
	countAllianceMembersMissingVerify,
	countMergedPlayersByAlliance,
	countMergedPlayersByGrade,
	countPlayersByGradeAndAlliance,
	countPlayersByStatus,
	getGuildConfig,
	listConfiguredGuilds,
	listMergedRosterPlayers,
	listRosterPlayers,
	sumGuildPowerByDay,
	sumGuildPowerByDayAndAlliance,
	upsertGuildConfig,
} from '../guild-db';
import {
	countSurveyResponses,
	countSurveyResponsesByOption,
	getSurvey,
	listSurveys,
} from '../survey-db';
import { getDiscordGatewayStatus } from '../discord-gateway/wake';
import { listGuildRoles } from '../discord-api';
import { AuditColor, postAuditLog } from '../audit-log';
import { defaultNicknameTemplate } from '../nickname-utils';
import { BOT_VERSION } from '../version';
import type { GuildConfig } from '../types';
import { corsHeaders, jsonCors, withCors } from './cors';
import {
	exchangeOAuthCode,
	fetchOAuthGuilds,
	fetchOAuthUser,
	oauthAuthorizeUrl,
	oauthRedirectUri,
	userCanAccessGuild,
	type DiscordOAuthGuild,
	type GuildAccessOk,
} from './discord-oauth';
import {
	clearSessionCookieHeader,
	newSessionExpiry,
	readSessionFromRequest,
	sealSession,
	sessionCookieHeader,
	type AdminSession,
} from './session';

function b64url(s: string): string {
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function requireAdminEnv(env: Env): string | null {
	if (!env.ADMIN_SESSION_SECRET?.trim()) {
		return 'ADMIN_SESSION_SECRET not configured';
	}
	if (!(env.DISCORD_CLIENT_ID || env.DISCORD_APPLICATION_ID) || !env.DISCORD_CLIENT_SECRET) {
		return 'Discord OAuth not configured (DISCORD_CLIENT_ID/APPLICATION_ID + DISCORD_CLIENT_SECRET)';
	}
	return null;
}

async function requireSession(
	request: Request,
	env: Env,
): Promise<AdminSession | Response> {
	const missing = requireAdminEnv(env);
	if (missing) {
		return jsonCors(request, env, { error: missing }, { status: 503 });
	}
	const session = await readSessionFromRequest(request, env.ADMIN_SESSION_SECRET);
	if (!session) {
		return jsonCors(request, env, { error: 'Unauthorized' }, { status: 401 });
	}
	return session;
}

async function requireGuildAccess(
	request: Request,
	env: Env,
	session: AdminSession,
	guildId: string,
): Promise<
	| { config: GuildConfig; oauthGuild?: DiscordOAuthGuild; access: GuildAccessOk }
	| Response
> {
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return jsonCors(request, env, { error: 'Guild not configured for this bot' }, { status: 404 });
	}
	const oauthGuilds = await fetchOAuthGuilds(session.accessToken);
	const oauthGuild = oauthGuilds.find((g) => g.id === guildId);
	const access = await userCanAccessGuild(env, session, config, oauthGuild);
	if (!access.ok) {
		return jsonCors(request, env, { error: access.reason }, { status: 403 });
	}
	return { config, oauthGuild, access };
}

function requireConfigure(
	request: Request,
	env: Env,
	access: GuildAccessOk,
): Response | null {
	if (access.can_configure) return null;
	return jsonCors(
		request,
		env,
		{ error: 'Discord Administrator required to change guild configuration' },
		{ status: 403 },
	);
}

function parseRoleIdArray(val: unknown): string[] {
	if (!Array.isArray(val)) return [];
	return val.map(String).filter((id) => /^\d{15,20}$/.test(id));
}

function publicConfig(config: GuildConfig) {
	const storedNick = config.nickname_template?.trim() || null;
	const nicknameDefault = defaultNicknameTemplate(config.mode);
	return {
		guild_id: config.guild_id,
		mode: config.mode,
		stfc_server: config.stfc_server,
		stfc_region: config.stfc_region,
		alliance_tag: config.alliance_tag,
		stfc_alliance_id: config.stfc_alliance_id,
		guest_role_id: config.guest_role_id,
		member_role_ids: config.member_role_ids,
		nickname_template: storedNick,
		nickname_template_default: nicknameDefault,
		nickname_template_effective: storedNick || nicknameDefault,
		verification_enabled: config.verification_enabled,
		poll_interval_hours: config.poll_interval_hours,
		deploy_mode: config.deploy_mode,
		demotion_policy: config.demotion_policy,
		data_consent_enabled: config.data_consent_enabled,
		data_consent_version: config.data_consent_version,
		agreement_enabled: config.agreement_enabled,
		agreement_timing: config.agreement_timing,
		agreement_version: config.agreement_version,
		welcome_dm_enabled: config.welcome_dm_enabled,
		verification_log_channel_id: config.verification_log_channel_id,
		audit_log_channel_id: config.audit_log_channel_id,
		urgent_notify_channel_id: config.urgent_notify_channel_id,
		web_admin_role_ids: config.web_admin_role_ids,
		suggested_web_admin_role_ids: Array.from(
			new Set([
				...config.premier_role_ids,
				...config.commodore_role_ids,
				...config.admiral_role_ids,
			]),
		),
		dm_query_role_ids: config.dm_query_role_ids,
		survey_creator_role_ids: config.survey_creator_role_ids,
		survey_results_role_ids: config.survey_results_role_ids,
		exchange_layout: config.exchange_layout,
		exchange_hub_channel_id: config.exchange_hub_channel_id,
		exchange_category_id: config.exchange_category_id,
		exchange_admin_role_ids: config.exchange_admin_role_ids,
	};
}

function publicRosterPlayer(p: {
	player_name: string | null;
	alliance_tag: string | null;
	alliance_rank: string | null;
	ops_level: number | null;
	power: number | null;
	grade: number | null;
	activity_streak: number | null;
	days_inactive: number;
	verification_status?: string;
	status?: string;
	discord_user_id: string | null;
	player_id: number | null;
	on_discord?: boolean;
}) {
	return {
		player_name: p.player_name,
		alliance_tag: p.alliance_tag,
		alliance_rank: p.alliance_rank,
		ops_level: p.ops_level,
		power: p.power,
		grade: p.grade,
		activity_streak: p.activity_streak,
		days_inactive: p.days_inactive,
		verification_status: p.verification_status ?? p.status ?? '—',
		discord_user_id: p.discord_user_id,
		player_id: p.player_id,
		on_discord: p.on_discord ?? Boolean(p.discord_user_id),
	};
}

const CONFIG_PATCH_KEYS = [
	'alliance_tag',
	'nickname_template',
	'verification_enabled',
	'poll_interval_hours',
	'deploy_mode',
	'demotion_policy',
	'data_consent_enabled',
	'data_consent_version',
	'agreement_enabled',
	'agreement_timing',
	'agreement_version',
	'welcome_dm_enabled',
	'web_admin_role_ids',
	'dm_query_role_ids',
	'survey_creator_role_ids',
	'survey_results_role_ids',
	'exchange_layout',
	'exchange_hub_channel_id',
	'exchange_category_id',
	'exchange_admin_role_ids',
] as const;

const ROLE_ARRAY_KEYS = new Set([
	'web_admin_role_ids',
	'dm_query_role_ids',
	'survey_creator_role_ids',
	'survey_results_role_ids',
	'exchange_admin_role_ids',
]);

export async function handleAdminApi(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const url = new URL(request.url);

	if (request.method === 'OPTIONS') {
		return withCors(request, env, new Response(null, { status: 204 }));
	}

	// GET /api/admin/auth/login
	if (url.pathname === '/api/admin/auth/login' && request.method === 'GET') {
		const missing = requireAdminEnv(env);
		if (missing) {
			return jsonCors(request, env, { error: missing }, { status: 503 });
		}
		const redirectUri = oauthRedirectUri(env, url);
		const state = b64url(crypto.randomUUID());
		const authorize = oauthAuthorizeUrl(env, redirectUri, state);
		if (!authorize) {
			return jsonCors(request, env, { error: 'Missing Discord client id' }, { status: 503 });
		}
		if (url.searchParams.get('redirect') === '1') {
			const headers = new Headers(corsHeadersFrom(request, env));
			headers.set('Location', authorize);
			headers.append(
				'Set-Cookie',
				`stfc_oauth_state=${encodeURIComponent(state)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
			);
			return new Response(null, { status: 302, headers });
		}
		const res = jsonCors(request, env, { url: authorize, state, redirect_uri: redirectUri });
		const headers = new Headers(res.headers);
		headers.append(
			'Set-Cookie',
			`stfc_oauth_state=${encodeURIComponent(state)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
		);
		return new Response(res.body, { status: res.status, headers });
	}

	// GET /api/admin/auth/callback
	if (url.pathname === '/api/admin/auth/callback' && request.method === 'GET') {
		const missing = requireAdminEnv(env);
		const frontend = primaryFrontendOrigin(env);
		if (missing) {
			return Response.redirect(`${frontend}/login?error=${encodeURIComponent(missing)}`, 302);
		}
		const code = url.searchParams.get('code');
		const state = url.searchParams.get('state');
		const err = url.searchParams.get('error');
		if (err) {
			return Response.redirect(`${frontend}/login?error=${encodeURIComponent(err)}`, 302);
		}
		if (!code || !state) {
			return Response.redirect(`${frontend}/login?error=missing_code`, 302);
		}
		const cookies = request.headers.get('Cookie') || '';
		const stateMatch = /(?:^|;\s*)stfc_oauth_state=([^;]+)/.exec(cookies);
		const expected = stateMatch ? decodeURIComponent(stateMatch[1]) : null;
		if (!expected || expected !== state) {
			return Response.redirect(`${frontend}/login?error=state_mismatch`, 302);
		}

		const redirectUri = oauthRedirectUri(env, url);
		const token = await exchangeOAuthCode(env, code, redirectUri);
		if ('error' in token) {
			return Response.redirect(`${frontend}/login?error=${encodeURIComponent(token.error)}`, 302);
		}
		const user = await fetchOAuthUser(token.access_token);
		if (!user) {
			return Response.redirect(`${frontend}/login?error=user_fetch_failed`, 302);
		}
		const session: AdminSession = {
			userId: user.id,
			username: user.username,
			globalName: user.global_name,
			avatar: user.avatar,
			accessToken: token.access_token,
			exp: newSessionExpiry(),
		};
		const sealed = await sealSession(session, env.ADMIN_SESSION_SECRET!);
		const headers = new Headers({
			Location: `${frontend}/auth/callback?stfc_session=${encodeURIComponent(sealed)}`,
		});
		headers.append('Set-Cookie', sessionCookieHeader(sealed));
		headers.append(
			'Set-Cookie',
			'stfc_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
		);
		return new Response(null, { status: 302, headers });
	}

	// POST /api/admin/auth/logout
	if (url.pathname === '/api/admin/auth/logout' && request.method === 'POST') {
		const headers = new Headers(corsHeadersFrom(request, env));
		headers.set('Content-Type', 'application/json');
		headers.append('Set-Cookie', clearSessionCookieHeader());
		return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
	}

	// GET /api/admin/me
	if (url.pathname === '/api/admin/me' && request.method === 'GET') {
		const sessionOrRes = await requireSession(request, env);
		if (sessionOrRes instanceof Response) return sessionOrRes;
		const s = sessionOrRes;
		return jsonCors(request, env, {
			user: {
				id: s.userId,
				username: s.username,
				global_name: s.globalName,
				avatar: s.avatar,
			},
			bot_version: BOT_VERSION,
		});
	}

	// GET /api/admin/guilds
	if (url.pathname === '/api/admin/guilds' && request.method === 'GET') {
		const sessionOrRes = await requireSession(request, env);
		if (sessionOrRes instanceof Response) return sessionOrRes;
		const session = sessionOrRes;
		const configured = await listConfiguredGuilds(env.STFC_DB);
		const oauthGuilds = await fetchOAuthGuilds(session.accessToken);
		const oauthById = new Map(oauthGuilds.map((g) => [g.id, g]));
		const accessible: Array<{
			id: string;
			name: string;
			icon: string | null;
			alliance_tag: string | null;
			mode: string;
			via: string;
			can_configure: boolean;
		}> = [];
		for (const config of configured) {
			const og = oauthById.get(config.guild_id);
			const access = await userCanAccessGuild(env, session, config, og);
			if (!access.ok) continue;
			accessible.push({
				id: config.guild_id,
				name: og?.name || config.alliance_tag || config.guild_id,
				icon: og?.icon ?? null,
				alliance_tag: config.alliance_tag,
				mode: config.mode,
				via: access.via,
				can_configure: access.can_configure,
			});
		}
		return jsonCors(request, env, { guilds: accessible });
	}

	const guildMatch = /^\/api\/admin\/guilds\/(\d{15,20})(\/.*)?$/.exec(url.pathname);
	if (guildMatch) {
		const guildId = guildMatch[1];
		const rest = guildMatch[2] || '';
		const sessionOrRes = await requireSession(request, env);
		if (sessionOrRes instanceof Response) return sessionOrRes;
		const session = sessionOrRes;
		const accessOrRes = await requireGuildAccess(request, env, session, guildId);
		if (accessOrRes instanceof Response) return accessOrRes;
		const { config, access } = accessOrRes;

		// GET .../status
		if ((rest === '' || rest === '/' || rest === '/status') && request.method === 'GET') {
			const [byGrade, byGradeAlliance, byStatus, byAlliance, gateway, unlinkedCount, powerByDay, powerByAlliance] =
				await Promise.all([
					countMergedPlayersByGrade(env.STFC_DB, guildId),
					config.mode === 'multi_alliance'
						? countPlayersByGradeAndAlliance(env.STFC_DB, guildId, { includeGuests: false })
						: Promise.resolve([]),
					countPlayersByStatus(env.STFC_DB, guildId),
					countMergedPlayersByAlliance(env.STFC_DB, guildId),
					getDiscordGatewayStatus(env),
					countAllianceMembersMissingVerify(env.STFC_DB, guildId),
					sumGuildPowerByDay(env.STFC_DB, guildId, 90, { includeGuests: false }),
					config.mode === 'multi_alliance'
						? sumGuildPowerByDayAndAlliance(env.STFC_DB, guildId, 90, { includeGuests: false })
						: Promise.resolve([]),
				]);
			const verified = byStatus
				.filter((r) => r.verification_status !== 'guest')
				.reduce((n, r) => n + r.count, 0);
			const guestCount = byStatus.find((r) => r.verification_status === 'guest')?.count ?? 0;
			const allianceTotal = verified + unlinkedCount;
			return jsonCors(request, env, {
				guild_id: guildId,
				bot_version: BOT_VERSION,
				can_configure: access.can_configure,
				via: access.via,
				config: publicConfig(config),
				stats: {
					alliance_total: allianceTotal,
					verified_total: verified,
					guest_total: guestCount,
					unlinked_total: unlinkedCount,
					by_grade: byGrade,
					by_status: byStatus,
					by_alliance: byAlliance,
				},
				charts: {
					power_by_day: powerByDay,
					power_by_day_alliance: powerByAlliance,
					by_grade_alliance: byGradeAlliance,
				},
				gateway: gateway ?? null,
			});
		}

		// GET .../players?grade=N (legacy grade drill-down)
		if (rest === '/players' && request.method === 'GET') {
			const gradeRaw = url.searchParams.get('grade');
			const grade = gradeRaw != null ? Number(gradeRaw) : NaN;
			if (!Number.isInteger(grade) || grade < 3 || grade > 7) {
				return jsonCors(
					request,
					env,
					{ error: 'Query grade must be an integer 3–7' },
					{ status: 400 },
				);
			}
			const players = await listRosterPlayers(env.STFC_DB, guildId, {
				grade,
				includeGuests: false,
				limit: 200,
				sort: 'ops',
			});
			return jsonCors(request, env, {
				guild_id: guildId,
				grade,
				count: players.length,
				players: players.map(publicRosterPlayer),
			});
		}

		// GET .../reports/players
		if (rest === '/reports/players' && request.method === 'GET') {
			const gradeRaw = url.searchParams.get('grade');
			const grade =
				gradeRaw != null && gradeRaw !== '' ? Number(gradeRaw) : undefined;
			if (grade != null && (!Number.isInteger(grade) || grade < 3 || grade > 7)) {
				return jsonCors(request, env, { error: 'Invalid grade' }, { status: 400 });
			}
			const includeUnlinked = url.searchParams.get('include_unlinked') === '1';
			const daysInactiveMinRaw = url.searchParams.get('days_inactive_min');
			const daysInactiveMin =
				daysInactiveMinRaw != null && daysInactiveMinRaw !== ''
					? Number(daysInactiveMinRaw)
					: undefined;
			const sortRaw = url.searchParams.get('sort') || 'ops';
			const sort =
				sortRaw === 'name' ||
				sortRaw === 'streak' ||
				sortRaw === 'inactive' ||
				sortRaw === 'grade' ||
				sortRaw === 'ops'
					? sortRaw
					: 'ops';
			const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 200) || 200, 1), 500);

			if (includeUnlinked) {
				const players = await listMergedRosterPlayers(env.STFC_DB, guildId, {
					grade,
					includeGuests: false,
					daysInactiveMin: Number.isFinite(daysInactiveMin as number)
						? daysInactiveMin
						: undefined,
					includeUnlinked: true,
					limit,
					sort,
				});
				return jsonCors(request, env, {
					guild_id: guildId,
					count: players.length,
					include_unlinked: true,
					players: players.map((p) =>
						publicRosterPlayer({
							...p,
							verification_status: p.status,
						}),
					),
				});
			}

			const players = await listRosterPlayers(env.STFC_DB, guildId, {
				grade,
				includeGuests: false,
				daysInactiveMin: Number.isFinite(daysInactiveMin as number)
					? daysInactiveMin
					: undefined,
				limit,
				sort,
			});
			return jsonCors(request, env, {
				guild_id: guildId,
				count: players.length,
				include_unlinked: false,
				players: players.map(publicRosterPlayer),
			});
		}

		// GET .../surveys
		if (rest === '/surveys' && request.method === 'GET') {
			const surveys = await listSurveys(env.STFC_DB, guildId, 50);
			const summaries = await Promise.all(
				surveys.map(async (s) => {
					const [response_count, by_option] = await Promise.all([
						countSurveyResponses(env.STFC_DB, s.id),
						countSurveyResponsesByOption(env.STFC_DB, s.id),
					]);
					return {
						id: s.id,
						title: s.title,
						question: s.question,
						status: s.status,
						delivery: s.delivery,
						options: s.options,
						target_count: s.target_count,
						response_count,
						by_option,
						sent_at: s.sent_at,
						closed_at: s.closed_at,
						created_at: s.created_at,
					};
				}),
			);
			return jsonCors(request, env, { guild_id: guildId, surveys: summaries });
		}

		// GET .../surveys/:id
		const surveyMatch = /^\/surveys\/(\d+)$/.exec(rest);
		if (surveyMatch && request.method === 'GET') {
			const surveyId = Number(surveyMatch[1]);
			const survey = await getSurvey(env.STFC_DB, surveyId);
			if (!survey || survey.guild_id !== guildId) {
				return jsonCors(request, env, { error: 'Survey not found' }, { status: 404 });
			}
			const [response_count, by_option] = await Promise.all([
				countSurveyResponses(env.STFC_DB, surveyId),
				countSurveyResponsesByOption(env.STFC_DB, surveyId),
			]);
			return jsonCors(request, env, {
				guild_id: guildId,
				survey: {
					id: survey.id,
					title: survey.title,
					question: survey.question,
					status: survey.status,
					delivery: survey.delivery,
					options: survey.options,
					target_count: survey.target_count,
					response_count,
					by_option,
					sent_at: survey.sent_at,
					closed_at: survey.closed_at,
					created_at: survey.created_at,
				},
			});
		}

		// GET .../roles — Discord guild roles via bot token (view OK; used by Permissions)
		if (rest === '/roles' && request.method === 'GET') {
			const token = env.DISCORD_BOT_TOKEN?.trim();
			if (!token) {
				return jsonCors(request, env, { error: 'Bot token not configured' }, { status: 503 });
			}
			try {
				const roles = await listGuildRoles(token, guildId);
				const publicRoles = roles
					.filter((r) => r.id !== guildId)
					.sort((a, b) => b.position - a.position)
					.map((r) => ({
						id: r.id,
						name: r.name,
						position: r.position,
						managed: Boolean(r.managed),
						color: Number(r.color ?? 0) || 0,
					}));
				return jsonCors(request, env, {
					guild_id: guildId,
					roles: publicRoles,
					suggested_web_admin_role_ids: Array.from(
						new Set([
							...config.premier_role_ids,
							...config.commodore_role_ids,
							...config.admiral_role_ids,
						]),
					),
					can_configure: access.can_configure,
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return jsonCors(
					request,
					env,
					{ error: `Failed to list roles: ${msg.slice(0, 200)}` },
					{ status: 502 },
				);
			}
		}

		// GET/PATCH .../config
		if (rest === '/config' && request.method === 'GET') {
			return jsonCors(request, env, {
				config: publicConfig(config),
				can_configure: access.can_configure,
			});
		}
		if (rest === '/config' && request.method === 'PATCH') {
			const denied = requireConfigure(request, env, access);
			if (denied) return denied;
			let body: Record<string, unknown>;
			try {
				body = (await request.json()) as Record<string, unknown>;
			} catch {
				return jsonCors(request, env, { error: 'Invalid JSON' }, { status: 400 });
			}
			const patch: Partial<GuildConfig> & { guild_id: string } = { guild_id: guildId };
			for (const key of CONFIG_PATCH_KEYS) {
				if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
				const val = body[key];
				if (ROLE_ARRAY_KEYS.has(key)) {
					(patch as Record<string, unknown>)[key] = parseRoleIdArray(val);
				} else if (
					key === 'verification_enabled' ||
					key === 'data_consent_enabled' ||
					key === 'agreement_enabled' ||
					key === 'welcome_dm_enabled'
				) {
					(patch as Record<string, unknown>)[key] = Boolean(val);
				} else if (key === 'poll_interval_hours') {
					const n = Number(val);
					if (Number.isFinite(n) && n >= 1 && n <= 168) patch.poll_interval_hours = n;
				} else if (key === 'deploy_mode') {
					if (val === 'testing' || val === 'live') patch.deploy_mode = val;
				} else if (key === 'demotion_policy') {
					if (val === 'approval' || val === 'yolo') patch.demotion_policy = val;
				} else if (key === 'agreement_timing') {
					if (val === 'after_verify' || val === 'before_verify') patch.agreement_timing = val;
				} else if (key === 'exchange_layout') {
					if (val === 'hub' || val === 'category' || val === null) {
						patch.exchange_layout = val as 'hub' | 'category' | null;
					}
				} else if (typeof val === 'string' || val === null) {
					(patch as Record<string, unknown>)[key] = val;
				}
			}
			await upsertGuildConfig(env.STFC_DB, patch);
			const refreshed = await getGuildConfig(env.STFC_DB, guildId);
			ctx.waitUntil(
				postAuditLog(env, refreshed, {
					title: 'Admin web config update',
					description: `Updated via web UI`,
					actorId: session.userId,
					source: 'web',
					color: AuditColor.info,
					fields: Object.keys(body)
						.slice(0, 8)
						.map((k) => ({ name: k, value: String(body[k]).slice(0, 100), inline: true })),
				}),
			);
			return jsonCors(request, env, {
				config: publicConfig(refreshed!),
				can_configure: true,
			});
		}
	}

	return jsonCors(request, env, { error: 'Not found' }, { status: 404 });
}

function corsHeadersFrom(request: Request, env: Env): Record<string, string> {
	return corsHeaders(request, env) as Record<string, string>;
}

function primaryFrontendOrigin(env: Env): string {
	const raw = env.ADMIN_WEB_ORIGIN?.split(',')[0]?.trim().replace(/\/$/, '');
	return raw || 'http://localhost:5173';
}
