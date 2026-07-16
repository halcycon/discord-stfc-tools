/**
 * Paginated /roster list replies: ASCII table or dense list + Prev/Next/Format buttons.
 */

import {
	deferredComponentResponse,
	editInteractionResponse,
	interactionResponse,
	interactionResponseWithComponents,
	sendMessageWithComponents,
	type DiscordActionRow,
} from './discord-api';
import type { GuildConfig } from './types';
import {
	countAllianceMembersMissingVerify,
	countMergedRosterPlayers,
	createRosterListSession,
	getRosterListSession,
	listAllianceMembersMissingVerify,
	listMergedRosterPlayers,
	updateRosterListSessionPayload,
	type AllianceRosterMemberRow,
	type MergedRosterRow,
	type RosterListSessionPayload,
	type RosterPlayerSort,
	type UnverifiedDiscordMemberRow,
} from './guild-db';
import {
	formatReportTable,
	playerCell,
	ReportCols,
	tagCell,
} from './report-table';
import type { TableColumn } from './tableUtils';

const TABLE_PAGE_SIZE = 15;
const LIST_PAGE_SIZE = 80;
const CONTENT_BUDGET = 1850;

export type RosterListFormat = 'table' | 'list';
export type RosterListVisibility = 'private' | 'public';

function sortLabel(sort: RosterListSessionPayload['sort']): string {
	switch (sort) {
		case 'name':
			return 'name ↑';
		case 'streak':
			return 'streak ↓';
		case 'inactive':
			return 'inactive ↓';
		case 'grade':
			return 'grade ↓';
		case 'rank':
			return 'rank ↑';
		case 'ops':
		default:
			return 'ops ↓';
	}
}

function pageSizeFor(format: RosterListFormat): number {
	return format === 'list' ? LIST_PAGE_SIZE : TABLE_PAGE_SIZE;
}

function visibilityOf(payload: RosterListSessionPayload): RosterListVisibility {
	return payload.visibility === 'public' ? 'public' : 'private';
}

function includeUnlinkedOf(payload: RosterListSessionPayload): boolean {
	return payload.includeUnlinked !== false;
}

function mergedDenseLine(p: MergedRosterRow): string {
	const name = playerCell(p.player_name, p.player_id ?? undefined);
	const tag = tagCell(p.alliance_tag);
	const ops = p.ops_level != null ? String(p.ops_level) : '—';
	const grade = p.grade != null ? `G${p.grade}` : '—';
	const streak =
		p.days_inactive > 0
			? `inactive ${p.days_inactive}d`
			: p.activity_streak != null
				? `s${p.activity_streak}`
				: 's—';
	const dc = p.on_discord ? 'DC' : 'no Discord';
	return `${name} · ${tag} · ${ops} · ${grade} · ${streak} · ${dc}`;
}

function missingDenseLine(m: AllianceRosterMemberRow): string {
	const name = playerCell(m.player_name, m.player_id);
	const tag = tagCell(m.alliance_tag);
	const ops = m.ops_level != null ? String(m.ops_level) : '—';
	const rank = m.alliance_rank || '—';
	return `${name} · ${tag} · ${ops} · ${rank} · \`${m.player_id}\` · no Discord`;
}

function unverifiedDenseLine(m: UnverifiedDiscordMemberRow): string {
	const nick = m.displayNick?.trim();
	return nick
		? `<@${m.discordUserId}> \`${m.username}\` (${nick})`
		: `<@${m.discordUserId}> \`${m.username}\``;
}

function sortUnverifiedMembers(
	members: UnverifiedDiscordMemberRow[],
	sort: RosterListSessionPayload['sort'],
): UnverifiedDiscordMemberRow[] {
	const key = (m: UnverifiedDiscordMemberRow) =>
		(m.displayNick || m.username || '').toLowerCase();
	const sorted = [...members];
	sorted.sort((a, b) => {
		const cmp = key(a).localeCompare(key(b));
		return sort === 'name' ? cmp : cmp;
	});
	return sorted;
}

const UNVERIFIED_COLS: TableColumn[] = [
	{ header: '#', width: 3, align: 'right' },
	{ header: 'Nick', width: 14 },
	{ header: 'User', width: 12 },
	{ header: 'Discord ID', width: 18 },
];

function unverifiedTableBody(
	rows: UnverifiedDiscordMemberRow[],
	pageStartIndex: number,
	maxRows: number,
	maxChars: number,
): string {
	return formatReportTable(
		rows.map((m, i) => ({
			'#': String(pageStartIndex + i + 1),
			Nick: playerCell(m.displayNick),
			User: playerCell(m.username),
			'Discord ID': m.discordUserId,
		})),
		UNVERIFIED_COLS,
		{ maxRows, maxChars },
	);
}

function mergedTableBody(players: MergedRosterRow[], maxRows: number, maxChars: number): string {
	return formatReportTable(
		players.map((p) => ({
			Player: playerCell(p.player_name, p.player_id ?? undefined),
			Tag: tagCell(p.alliance_tag),
			Ops: p.ops_level != null ? p.ops_level : '—',
			Grade: p.grade != null ? `G${p.grade}` : '—',
			Status: p.on_discord ? p.status || '—' : 'unlinked',
			Streak: p.activity_streak != null ? p.activity_streak : '—',
			Inactive: p.days_inactive > 0 ? `${p.days_inactive}d` : '—',
			DC: p.on_discord ? 'yes' : 'no',
		})),
		[
			ReportCols.player,
			ReportCols.tag,
			ReportCols.ops,
			ReportCols.grade,
			ReportCols.status,
			ReportCols.streak,
			ReportCols.inactive,
			ReportCols.discord,
		],
		{ maxRows, maxChars, omitEmptyColumns: true },
	);
}

function missingTableBody(rows: AllianceRosterMemberRow[], maxRows: number, maxChars: number): string {
	return formatReportTable(
		rows.map((m) => ({
			Player: playerCell(m.player_name, m.player_id),
			Tag: tagCell(m.alliance_tag),
			Ops: m.ops_level != null ? m.ops_level : '—',
			Rank: m.alliance_rank || '—',
			Id: String(m.player_id),
			DC: 'no',
		})),
		[
			ReportCols.player,
			ReportCols.tag,
			ReportCols.ops,
			ReportCols.rank,
			{ header: 'Id', width: 8, align: 'right' },
			ReportCols.discord,
		],
		{ maxRows, maxChars, omitEmptyColumns: true },
	);
}

function packLines(lines: string[], maxChars: number): { text: string; shown: number } {
	const out: string[] = [];
	let used = 0;
	for (const line of lines) {
		const add = (out.length ? 1 : 0) + line.length;
		if (used + add > maxChars && out.length > 0) break;
		out.push(line);
		used += add;
	}
	return { text: out.join('\n'), shown: out.length };
}

/**
 * Discord button styles: Primary=1, Secondary=2, Success=3, Danger=4.
 * There is no yellow style — "Post to channel" uses Primary (blurple) as the CTA.
 */
function buildComponents(
	token: string,
	page: number,
	totalPages: number,
	format: RosterListFormat,
	visibility: RosterListVisibility,
	opts?: { publishDisabled?: boolean },
): DiscordActionRow[] {
	const prevDisabled = page <= 1;
	const nextDisabled = page >= totalPages;
	const rows: DiscordActionRow[] = [
		{
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					label: 'Previous',
					custom_id: `rst:${token}:prev`,
					disabled: prevDisabled,
				},
				{
					type: 2,
					style: 1,
					label: 'Next',
					custom_id: `rst:${token}:next`,
					disabled: nextDisabled,
				},
				{
					type: 2,
					style: format === 'list' ? 2 : 3,
					label: 'Full list',
					custom_id: `rst:${token}:list`,
					disabled: format === 'list',
				},
				{
					type: 2,
					style: format === 'table' ? 2 : 3,
					label: 'Table',
					custom_id: `rst:${token}:table`,
					disabled: format === 'table',
				},
			],
		},
	];
	if (visibility === 'private') {
		rows.push({
			type: 1,
			components: [
				{
					type: 2,
					// Discord has no yellow button style; Primary (blurple) is the CTA.
					// Label uses 🟡 so the control reads as the “yellow” publish action.
					style: 1,
					label: '🟡 Post to channel',
					custom_id: `rst:${token}:publish`,
					disabled: opts?.publishDisabled === true,
				},
			],
		});
	}
	return rows;
}

async function loadPage(
	db: D1Database,
	guildId: string,
	payload: RosterListSessionPayload,
): Promise<{ total: number; body: string; shown: number; pageSize: number }> {
	const format = payload.format;
	const pageSize = pageSizeFor(format);
	const page = Math.max(1, Math.floor(payload.page || 1));
	const offset = (page - 1) * pageSize;
	const headerBudget = Math.min(400, payload.title.length + 80);
	const bodyBudget = Math.max(400, CONTENT_BUDGET - headerBudget);

	if (payload.kind === 'missing-verify') {
		const total = await countAllianceMembersMissingVerify(db, guildId);
		const sort =
			payload.sort === 'name' || payload.sort === 'rank' || payload.sort === 'ops'
				? payload.sort
				: 'ops';
		const rows = await listAllianceMembersMissingVerify(db, guildId, {
			limit: pageSize,
			offset,
			sort,
		});
		if (format === 'list') {
			const packed = packLines(rows.map(missingDenseLine), bodyBudget);
			return { total, body: packed.text, shown: packed.shown, pageSize };
		}
		const body = missingTableBody(rows, pageSize, bodyBudget);
		return { total, body, shown: Math.min(rows.length, pageSize), pageSize };
	}

	if (payload.kind === 'unverified') {
		const sorted = sortUnverifiedMembers(payload.members ?? [], payload.sort);
		const total = sorted.length;
		const rows = sorted.slice(offset, offset + pageSize);
		if (format === 'list') {
			const packed = packLines(rows.map(unverifiedDenseLine), bodyBudget);
			return { total, body: packed.text, shown: packed.shown, pageSize };
		}
		const body = unverifiedTableBody(rows, offset, pageSize, bodyBudget);
		return { total, body, shown: Math.min(rows.length, pageSize), pageSize };
	}

	const filters = {
		grade: payload.filters.grade,
		opsMin: payload.filters.opsMin,
		opsMax: payload.filters.opsMax,
		allianceRank: payload.filters.allianceRank,
		daysInactiveMin: payload.filters.daysInactiveMin,
		includeUnlinked: includeUnlinkedOf(payload),
	};
	const sort: RosterPlayerSort =
		payload.sort === 'rank' ? 'ops' : (payload.sort as RosterPlayerSort);
	const total = await countMergedRosterPlayers(db, guildId, { ...filters, sort });
	const players = await listMergedRosterPlayers(db, guildId, {
		...filters,
		sort,
		limit: pageSize,
		offset,
	});

	if (format === 'list') {
		const packed = packLines(players.map(mergedDenseLine), bodyBudget);
		return { total, body: packed.text, shown: packed.shown, pageSize };
	}
	const body = mergedTableBody(players, pageSize, bodyBudget);
	return { total, body, shown: Math.min(players.length, pageSize), pageSize };
}

export async function renderRosterListContent(
	db: D1Database,
	guildId: string,
	payload: RosterListSessionPayload,
): Promise<{ content: string; payload: RosterListSessionPayload; totalPages: number }> {
	let page = Math.max(1, Math.floor(payload.page || 1));
	let working: RosterListSessionPayload = {
		...payload,
		visibility: visibilityOf(payload),
		includeUnlinked: includeUnlinkedOf(payload),
		page,
	};

	let loaded = await loadPage(db, guildId, working);
	const totalPages = Math.max(1, Math.ceil(loaded.total / loaded.pageSize) || 1);
	if (page > totalPages) {
		page = totalPages;
		working = { ...working, page };
		loaded = await loadPage(db, guildId, working);
	}

	const from = loaded.total === 0 ? 0 : (page - 1) * loaded.pageSize + 1;
	const to = loaded.total === 0 ? 0 : Math.min(loaded.total, from + loaded.shown - 1);
	const vis = visibilityOf(working);
	const isUnverified = working.kind === 'unverified';
	const footer =
		`Showing **${from}–${to}** of **${loaded.total}**` +
		` · sorted by ${sortLabel(working.sort)}` +
		` · format **${working.format}**` +
		` · **${vis}**` +
		(!isUnverified && includeUnlinkedOf(working) ? ' · +unlinked' : '') +
		(totalPages > 1 ? ` · page **${page}/${totalPages}**` : '') +
		(!isUnverified && includeUnlinkedOf(working)
			? `\n_DC **no** = on alliance roster, not linked in Discord._`
			: isUnverified
				? `\n_Nick = server nick or Discord display name (mentions show this). Use \`set_guest:true\` to bulk-assign guest._`
				: '');

	const content = `${working.title}\n${loaded.body}\n\n_${footer}_`;
	return {
		content: content.length > 2000 ? content.slice(0, 1990) + '\n_…_' : content,
		payload: working,
		totalPages,
	};
}

export async function startRosterListReply(
	env: Env,
	opts: {
		guildId: string;
		userId: string;
		payload: Omit<RosterListSessionPayload, 'page' | 'visibility' | 'includeUnlinked'> & {
			page?: number;
			visibility?: RosterListVisibility;
			includeUnlinked?: boolean;
		};
	},
): Promise<Response> {
	const initial: RosterListSessionPayload = {
		...opts.payload,
		visibility: opts.payload.visibility === 'public' ? 'public' : 'private',
		includeUnlinked: opts.payload.includeUnlinked !== false,
		page: Math.max(1, opts.payload.page ?? 1),
	};
	const total =
		initial.kind === 'unverified'
			? (initial.members?.length ?? 0)
			: initial.kind === 'missing-verify'
				? await countAllianceMembersMissingVerify(env.STFC_DB, opts.guildId)
				: await countMergedRosterPlayers(env.STFC_DB, opts.guildId, {
						...initial.filters,
						includeUnlinked: includeUnlinkedOf(initial),
					});
	if (total === 0) {
		return interactionResponse(
			`${initial.title}\n\n${initial.kind === 'unverified' ? 'Everyone else is verified or excluded.' : 'No matching players.'}`,
			true,
		);
	}

	const rendered = await renderRosterListContent(env.STFC_DB, opts.guildId, initial);
	const session = await createRosterListSession(env.STFC_DB, {
		guildId: opts.guildId,
		userId: opts.userId,
		payload: rendered.payload,
	});
	const vis = visibilityOf(rendered.payload);

	return interactionResponseWithComponents(rendered.content, {
		ephemeral: vis === 'private',
		components: buildComponents(
			session.token,
			rendered.payload.page,
			rendered.totalPages,
			rendered.payload.format,
			vis,
		),
	});
}

/**
 * Finish a deferred `/roster unverified` (or similar) list after members are loaded.
 * Edits the original deferred interaction with the paginated table + buttons.
 */
export async function finishDeferredRosterListReply(
	env: Env,
	opts: {
		applicationId: string;
		interactionToken: string;
		guildId: string;
		userId: string;
		payload: RosterListSessionPayload;
		config?: Pick<GuildConfig, 'deploy_mode'> | null;
	},
): Promise<void> {
	const initial: RosterListSessionPayload = {
		...opts.payload,
		visibility: opts.payload.visibility === 'public' ? 'public' : 'private',
		includeUnlinked: opts.payload.includeUnlinked !== false,
		page: Math.max(1, opts.payload.page || 1),
	};

	const total =
		initial.kind === 'unverified'
			? (initial.members?.length ?? 0)
			: initial.kind === 'missing-verify'
				? await countAllianceMembersMissingVerify(env.STFC_DB, opts.guildId)
				: await countMergedRosterPlayers(env.STFC_DB, opts.guildId, {
						...initial.filters,
						includeUnlinked: includeUnlinkedOf(initial),
					});

	if (total === 0) {
		await editInteractionResponse(
			opts.applicationId,
			opts.interactionToken,
			`${initial.title}\n\n${initial.kind === 'unverified' ? 'Everyone else is verified or excluded.' : 'No matching players.'}`,
			true,
			{ components: [], config: opts.config },
		);
		return;
	}

	const rendered = await renderRosterListContent(env.STFC_DB, opts.guildId, initial);
	const session = await createRosterListSession(env.STFC_DB, {
		guildId: opts.guildId,
		userId: opts.userId,
		payload: rendered.payload,
	});
	const vis = visibilityOf(rendered.payload);
	await editInteractionResponse(
		opts.applicationId,
		opts.interactionToken,
		rendered.content,
		vis === 'private',
		{
			components: buildComponents(
				session.token,
				rendered.payload.page,
				rendered.totalPages,
				rendered.payload.format,
				vis,
			),
			config: opts.config,
		},
	);
}

export async function handleRosterListComponent(
	env: Env,
	ctx: ExecutionContext,
	interaction: {
		application_id?: string;
		token?: string;
		guild_id?: string;
		channel_id?: string;
		member?: { user?: { id: string } };
		user?: { id: string };
		data?: { custom_id?: string };
	},
): Promise<Response> {
	const customId = interaction.data?.custom_id ?? '';
	const m = /^rst:([a-f0-9]+):(prev|next|list|table|publish)$/i.exec(customId);
	if (!m) {
		return interactionResponse('❌ Unknown roster button.', true);
	}
	const token = m[1]!;
	const action = m[2]!.toLowerCase() as 'prev' | 'next' | 'list' | 'table' | 'publish';
	const userId = interaction.member?.user?.id ?? interaction.user?.id;
	const guildId = interaction.guild_id;
	const appId = interaction.application_id;
	const interactionToken = interaction.token;

	const session = await getRosterListSession(env.STFC_DB, token);
	if (!session || !guildId || session.guild_id !== guildId) {
		return interactionResponse('❌ This roster list expired. Run the `/roster` command again.', true);
	}

	const vis = visibilityOf(session.payload);
	const isOwner = !!userId && session.user_id === userId;

	if (action === 'publish') {
		if (!isOwner) {
			return interactionResponse('❌ Only the person who ran the command can post this to the channel.', true);
		}
		if (vis !== 'private') {
			return interactionResponse('❌ This report is already public.', true);
		}
	} else if (vis === 'private' && !isOwner) {
		return interactionResponse('❌ Only the person who ran the command can use these buttons.', true);
	}

	if (!appId || !interactionToken) {
		return interactionResponse('❌ Missing application id / interaction token.', true);
	}

	// Discord requires an ACK within 3s; D1 page renders (esp. large public lists) can exceed that.
	ctx.waitUntil(
		(async () => {
			try {
				if (action === 'publish') {
					const channelId = interaction.channel_id;
					if (!channelId || !env.DISCORD_BOT_TOKEN) {
						await editInteractionResponse(
							appId,
							interactionToken,
							'❌ Cannot post to channel (missing channel or bot token).',
							false,
							{ components: [] },
						);
						return;
					}

					const publicPayload: RosterListSessionPayload = {
						...session.payload,
						visibility: 'public',
					};
					const rendered = await renderRosterListContent(env.STFC_DB, guildId, publicPayload);
					const publicSession = await createRosterListSession(env.STFC_DB, {
						guildId,
						userId: session.user_id,
						payload: rendered.payload,
					});

					try {
						await sendMessageWithComponents(env.DISCORD_BOT_TOKEN, channelId, {
							content: rendered.content,
							components: buildComponents(
								publicSession.token,
								rendered.payload.page,
								rendered.totalPages,
								rendered.payload.format,
								'public',
							),
						});
					} catch (err) {
						console.error('Roster post to channel failed:', err);
						await editInteractionResponse(
							appId,
							interactionToken,
							'❌ Failed to post to channel (check bot Send Messages permission here).',
							false,
							{ components: [] },
						);
						return;
					}

					const privateRendered = await renderRosterListContent(env.STFC_DB, guildId, session.payload);
					await editInteractionResponse(
						appId,
						interactionToken,
						`${privateRendered.content}\n\n✅ **Posted to channel** (public copy — anyone can use Prev/Next there).`,
						false,
						{
							components: buildComponents(
								token,
								privateRendered.payload.page,
								privateRendered.totalPages,
								privateRendered.payload.format,
								'private',
								{ publishDisabled: true },
							),
						},
					);
					return;
				}

				// prev / next / list / table (public: anyone in the channel may paginate)
				const payload = { ...session.payload, visibility: vis };
				if (action === 'prev') payload.page = Math.max(1, payload.page - 1);
				else if (action === 'next') payload.page = payload.page + 1;
				else if (action === 'list') {
					payload.format = 'list';
					payload.page = 1;
				} else if (action === 'table') {
					payload.format = 'table';
					payload.page = 1;
				}

				const rendered = await renderRosterListContent(env.STFC_DB, guildId, payload);
				await updateRosterListSessionPayload(env.STFC_DB, token, rendered.payload);

				await editInteractionResponse(appId, interactionToken, rendered.content, false, {
					components: buildComponents(
						token,
						rendered.payload.page,
						rendered.totalPages,
						rendered.payload.format,
						visibilityOf(rendered.payload),
					),
				});
			} catch (err) {
				console.error('Roster list button failed:', err);
				try {
					await editInteractionResponse(
						appId,
						interactionToken,
						`❌ Roster list update failed: ${err instanceof Error ? err.message : String(err)}\n_Re-run \`/roster\` if buttons stop working._`,
						false,
						{ components: [] },
					);
				} catch (editErr) {
					console.error('Roster list: failed to report error', err, editErr);
				}
			}
		})(),
	);

	return deferredComponentResponse();
}

export function parseRosterSort(
	raw: unknown,
	fallback: RosterPlayerSort | 'rank',
	allowed: Array<RosterPlayerSort | 'rank'>,
): RosterPlayerSort | 'rank' {
	const s = String(raw ?? '').trim().toLowerCase();
	if (allowed.includes(s as RosterPlayerSort | 'rank')) return s as RosterPlayerSort | 'rank';
	return fallback;
}

export function parseRosterFormat(raw: unknown): RosterListFormat {
	return String(raw ?? '').trim().toLowerCase() === 'list' ? 'list' : 'table';
}

export function parseRosterVisibility(raw: unknown): RosterListVisibility {
	return String(raw ?? '').trim().toLowerCase() === 'public' ? 'public' : 'private';
}

/** Default true — include alliance members with no Discord link (DC=no). */
export function parseRosterIncludeUnlinked(raw: unknown): boolean {
	if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
	if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
	return true;
}
