import {
	createGuildCategory,
	createGuildTextChannel,
	getBotUserId,
	sendChannelMessage,
	sendMessageWithComponents,
	type ChannelPermissionOverwrite,
	type DiscordActionRow,
	type DiscordEmbed,
} from './discord-api';
import { generateAsciiTable, type TableColumn, type TableData } from './tableUtils';
import {
	createSurvey,
	getSurvey,
	listSurveyResponses,
	recordSurveyResponse,
	updateSurvey,
} from './survey-db';
import { describeSurveyTarget, resolveSurveyTargets } from './survey-targeting';
import type { SurveyDelivery, SurveyRecord, SurveyTargetType } from './survey-types';
import type { GuildConfig, VerifiedPlayer } from './types';

const VIEW = 0x400;
const SEND = 0x800;
const EMBED = 0x4000;
const ATTACH = 0x8000;
const READ = 0x10000;
const STAFF_ALLOW = String(VIEW | SEND | EMBED | ATTACH | READ);
const DENY_VIEW = String(VIEW);

const BUTTON_STYLES = [1, 3, 2, 4, 1] as const;

/** Default Discord channel name for a survey vote log. */
export const DEFAULT_SURVEY_LOG_NAME_TEMPLATE = 'survey-{id}';

/**
 * Resolve a Discord channel name from a template.
 * Placeholders: `{id}` / `{n}` → survey id. Always includes the id to avoid collisions.
 */
export function resolveSurveyLogChannelName(
	template: string | null | undefined,
	surveyId: number,
): string {
	const id = String(surveyId);
	let name = (template?.trim() || DEFAULT_SURVEY_LOG_NAME_TEMPLATE)
		.replace(/\{id\}/gi, id)
		.replace(/\{n\}/gi, id);
	name = name
		.toLowerCase()
		.replace(/[^a-z0-9-_]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 100);
	if (!name) return `survey-${id}`;
	if (!name.includes(id)) {
		name = `${name}-${id}`.slice(0, 100);
	}
	return name;
}

export function parseSurveyOptions(raw: string): string[] {
	return raw
		.split('|')
		.map((s) => s.trim())
		.filter(Boolean)
		.slice(0, 5);
}

export function buildSurveyVoteComponents(surveyId: number, options: string[]): DiscordActionRow[] {
	return [
		{
			type: 1,
			components: options.map((label, i) => ({
				type: 2,
				style: BUTTON_STYLES[i % BUTTON_STYLES.length],
				label: label.slice(0, 80),
				custom_id: `survey:vote:${surveyId}:${i}`,
			})),
		},
	];
}

export function buildSurveyAdminComponents(surveyId: number): DiscordActionRow[] {
	return [
		{
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					label: 'Test to me',
					custom_id: `survey:admin:test:${surveyId}`,
				},
				{
					type: 2,
					style: 3,
					label: 'Approve & send',
					custom_id: `survey:admin:send:${surveyId}`,
				},
				{
					type: 2,
					style: 4,
					label: 'Cancel',
					custom_id: `survey:admin:cancel:${surveyId}`,
				},
			],
		},
	];
}

export function surveyPreviewEmbed(survey: SurveyRecord, targetCount: number): DiscordEmbed {
	return {
		title: `📋 Survey #${survey.id} (draft)`,
		description: survey.question,
		color: 0x5865f2,
		fields: [
			{
				name: 'Options',
				value: survey.options.map((o, i) => `\`${i + 1}.\` ${o}`).join('\n') || '—',
				inline: false,
			},
			{ name: 'Target', value: describeSurveyTarget(survey), inline: false },
			{ name: 'Matched players', value: String(targetCount), inline: true },
			{ name: 'Delivery', value: survey.delivery, inline: true },
			{
				name: 'Log category',
				value: survey.log_category_id
					? `<#${survey.log_category_id}> (this survey)`
					: 'server default',
				inline: true,
			},
		],
		footer: { text: 'Test to yourself first, then Approve & send' },
	};
}

export async function createSurveyDraft(
	env: Env,
	config: GuildConfig,
	opts: {
		guildId: string;
		createdBy: string;
		question: string;
		optionsRaw: string;
		delivery: SurveyDelivery;
		targetType: SurveyTargetType;
		targetGrades?: number[];
		targetAllianceTags?: string[];
		targetRoleIds?: string[];
		targetRanks?: string[];
		targetOpsMin?: number | null;
		targetOpsMax?: number | null;
		targetUserIds?: string[];
		logCategoryId?: string | null;
	},
): Promise<{ survey: SurveyRecord; targetCount: number }> {
	const options = parseSurveyOptions(opts.optionsRaw);
	if (options.length < 2) {
		throw new Error('Provide at least 2 options separated by | (max 5).');
	}

	const survey = await createSurvey(env.STFC_DB, {
		guild_id: opts.guildId,
		created_by: opts.createdBy,
		question: opts.question,
		options,
		delivery: opts.delivery,
		target_type: opts.targetType,
		target_grades: opts.targetGrades,
		target_alliance_tags: opts.targetAllianceTags,
		target_role_ids: opts.targetRoleIds,
		target_ranks: opts.targetRanks,
		target_ops_min: opts.targetOpsMin,
		target_ops_max: opts.targetOpsMax,
		target_user_ids: opts.targetUserIds,
		viewer_role_ids: config.survey_results_role_ids,
		log_category_id: opts.logCategoryId ?? null,
	});

	const targets = await resolveSurveyTargets(env, survey);
	await updateSurvey(env.STFC_DB, survey.id, { target_count: targets.length });
	return { survey: { ...survey, target_count: targets.length }, targetCount: targets.length };
}

async function deliverSurveyMessage(
	token: string,
	player: VerifiedPlayer,
	survey: SurveyRecord,
	delivery: SurveyDelivery,
	prefix?: string,
): Promise<void> {
	const content =
		(prefix ? `${prefix}\n\n` : '') +
		`**Survey #${survey.id}**\n${survey.question}\n\nTap a button to respond:`;
	const components = buildSurveyVoteComponents(survey.id, survey.options);

	if (delivery === 'personal_channel' && player.personal_channel_id) {
		await sendMessageWithComponents(token, player.personal_channel_id, { content, components });
		return;
	}

	const channelResponse = await fetch('https://discord.com/api/v10/users/@me/channels', {
		method: 'POST',
		headers: {
			Authorization: `Bot ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ recipient_id: player.discord_user_id }),
	});
	if (!channelResponse.ok) {
		throw new Error(`DM open failed: ${channelResponse.status}`);
	}
	const channel = (await channelResponse.json()) as { id: string };
	await sendMessageWithComponents(token, channel.id, { content, components });
}

export async function sendSurveyTest(
	env: Env,
	survey: SurveyRecord,
	testerUserId: string,
): Promise<void> {
	if (!env.DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN not configured');
	const fakePlayer: VerifiedPlayer = {
		id: 0,
		guild_id: survey.guild_id,
		discord_user_id: testerUserId,
		player_id: null,
		player_name: null,
		alliance_tag: null,
		alliance_rank: null,
		ops_level: null,
		power: null,
		grade: null,
		stfc_pro_url: null,
		verification_status: 'active',
		personal_channel_id: null,
		verified_at: null,
		last_synced_at: null,
	};
	await deliverSurveyMessage(
		env.DISCORD_BOT_TOKEN,
		fakePlayer,
		survey,
		'dm',
		'🧪 **Test delivery** (only you — votes while draft are not counted)',
	);
}

async function surveyLogPermissionOverwrites(
	token: string,
	guildId: string,
	config: GuildConfig,
	creatorUserId?: string,
): Promise<ChannelPermissionOverwrite[]> {
	const botUserId = await getBotUserId(token);
	const overwrites: ChannelPermissionOverwrite[] = [
		{ id: guildId, type: 0, allow: '0', deny: DENY_VIEW },
		{ id: botUserId, type: 1, allow: STAFF_ALLOW, deny: '0' },
	];
	if (creatorUserId && /^\d{15,20}$/.test(creatorUserId)) {
		overwrites.push({ id: creatorUserId, type: 1, allow: STAFF_ALLOW, deny: '0' });
	}
	const viewRoleIds = new Set([
		...config.survey_results_role_ids,
		...config.survey_creator_role_ids,
	]);
	for (const roleId of viewRoleIds) {
		if (/^\d{15,20}$/.test(roleId)) {
			overwrites.push({ id: roleId, type: 0, allow: STAFF_ALLOW, deny: '0' });
		}
	}
	return overwrites;
}

/** Create a private category for survey logs and return its id. */
export async function createSurveyLogCategory(
	token: string,
	guildId: string,
	config: GuildConfig,
	name = 'Surveys',
): Promise<{ id: string; name: string }> {
	const overwrites = await surveyLogPermissionOverwrites(token, guildId, config);
	return createGuildCategory(token, guildId, name.trim() || 'Surveys', {
		permissionOverwrites: overwrites,
	});
}

async function ensureSurveyLogChannel(
	db: D1Database,
	token: string,
	guildId: string,
	survey: SurveyRecord,
	config: GuildConfig,
): Promise<string> {
	if (survey.log_channel_id) return survey.log_channel_id;

	const overwrites = await surveyLogPermissionOverwrites(
		token,
		guildId,
		config,
		survey.created_by,
	);
	for (const roleId of survey.viewer_role_ids) {
		if (/^\d{15,20}$/.test(roleId) && !overwrites.some((o) => o.id === roleId)) {
			overwrites.push({ id: roleId, type: 0, allow: STAFF_ALLOW, deny: '0' });
		}
	}

	const channelName = resolveSurveyLogChannelName(config.survey_log_name_template, survey.id);
	const parentId = survey.log_category_id || config.survey_log_category_id || undefined;
	const channel = await createGuildTextChannel(token, guildId, channelName, {
		parentId,
		topic: `Survey #${survey.id}: ${survey.question.slice(0, 100)}`,
		permissionOverwrites: overwrites,
	});
	await updateSurvey(db, survey.id, { log_channel_id: channel.id });
	return channel.id;
}

export async function sendSurveyBroadcast(
	env: Env,
	config: GuildConfig,
	surveyId: number,
): Promise<{ sent: number; failed: number; logChannelId: string }> {
	const survey = await getSurvey(env.STFC_DB, surveyId);
	if (!survey) throw new Error('Survey not found');
	if (survey.status === 'closed') throw new Error('Survey is closed');
	if (survey.status === 'sent') throw new Error('Survey was already sent');
	if (survey.status !== 'draft') throw new Error('Survey must be a draft to send');
	if (!env.DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN not configured');

	const token = env.DISCORD_BOT_TOKEN;
	const targets = await resolveSurveyTargets(env, survey);
	const logChannelId = await ensureSurveyLogChannel(
		env.STFC_DB,
		token,
		survey.guild_id,
		survey,
		config,
	);

	await sendChannelMessage(
		token,
		logChannelId,
		`📤 **Survey #${survey.id} sent** to ${targets.length} player(s)\n` +
			`Target: ${describeSurveyTarget(survey)}\n` +
			`Question: ${survey.question}`,
	);

	let sent = 0;
	let failed = 0;
	for (const player of targets) {
		try {
			await deliverSurveyMessage(token, player, survey, survey.delivery);
			sent += 1;
		} catch (err) {
			failed += 1;
			console.error(`Survey ${surveyId} delivery failed for ${player.discord_user_id}:`, err);
		}
		await new Promise((r) => setTimeout(r, 350));
	}

	await updateSurvey(env.STFC_DB, surveyId, {
		status: 'sent',
		sent_at: new Date().toISOString(),
		target_count: targets.length,
		log_channel_id: logChannelId,
	});

	await sendChannelMessage(
		token,
		logChannelId,
		`✅ Delivery finished — sent **${sent}**, failed **${failed}**. Votes will appear below.`,
	);

	return { sent, failed, logChannelId };
}

export function formatSurveyResultsTable(
	survey: SurveyRecord,
	responses: Array<{ discord_user_id: string; response: string; player_name?: string | null }>,
): string {
	const byOption = new Map<string, string[]>();
	for (const opt of survey.options) byOption.set(opt, []);
	for (const r of responses) {
		const list = byOption.get(r.response) ?? [];
		list.push(r.player_name || r.discord_user_id);
		byOption.set(r.response, list);
	}

	const summaryRows: TableData[] = survey.options.map((opt) => ({
		Option: opt,
		Votes: byOption.get(opt)?.length ?? 0,
		Voters: (byOption.get(opt) ?? []).join(', ') || '—',
	}));
	const summaryCols: TableColumn[] = [
		{ header: 'Option', width: 12 },
		{ header: 'Votes', width: 5, align: 'right' },
		{ header: 'Voters', width: 28 },
	];

	const detailRows: TableData[] = responses.map((r) => ({
		Player: r.player_name || r.discord_user_id,
		Answer: r.response,
	}));
	const detailCols: TableColumn[] = [
		{ header: 'Player', width: 16 },
		{ header: 'Answer', width: 16 },
	];

	const summary = generateAsciiTable(summaryRows, summaryCols);
	const detail =
		detailRows.length > 0 ? generateAsciiTable(detailRows, detailCols) : 'No responses yet.';

	return (
		`**Survey #${survey.id} results** (${responses.length}/${survey.target_count || '?'} responses)\n` +
		`${survey.question}\n\n` +
		`**Summary**\n\`\`\`\n${summary}\n\`\`\`\n` +
		`**Who voted**\n\`\`\`\n${detail}\n\`\`\``
	);
}

export async function handleSurveyVote(
	env: Env,
	surveyId: number,
	optionIndex: number,
	voterId: string,
): Promise<string> {
	const survey = await getSurvey(env.STFC_DB, surveyId);
	if (!survey) return '❌ Survey not found.';
	if (survey.status === 'draft') {
		return '✅ Test click received — votes are only counted after Approve & send.';
	}
	if (survey.status === 'closed') return '❌ This survey is closed.';
	if (optionIndex < 0 || optionIndex >= survey.options.length) return '❌ Invalid option.';

	const option = survey.options[optionIndex];
	const result = await recordSurveyResponse(env.STFC_DB, surveyId, voterId, option);
	if (!result.ok) {
		if (result.reason === 'duplicate') return '✅ You already responded to this survey.';
		return `❌ Could not record vote: ${result.message ?? 'error'}`;
	}

	if (env.DISCORD_BOT_TOKEN && survey.log_channel_id) {
		const player = await env.STFC_DB.prepare(
			`SELECT player_name FROM verified_players WHERE guild_id = ? AND discord_user_id = ?`,
		)
			.bind(survey.guild_id, voterId)
			.first<{ player_name: string | null }>();
		const name = player?.player_name || `<@${voterId}>`;
		try {
			await sendChannelMessage(
				env.DISCORD_BOT_TOKEN,
				survey.log_channel_id,
				`🗳️ **${name}** voted **${option}**`,
			);
		} catch (err) {
			console.error('Survey log post failed:', err);
		}
	}

	return `✅ Recorded: **${option}**`;
}

export async function buildSurveyResultsMessage(env: Env, surveyId: number): Promise<string> {
	const survey = await getSurvey(env.STFC_DB, surveyId);
	if (!survey) return '❌ Survey not found.';
	const responses = await listSurveyResponses(env.STFC_DB, surveyId);
	const enriched = [];
	for (const r of responses) {
		const row = await env.STFC_DB.prepare(
			`SELECT player_name FROM verified_players WHERE guild_id = ? AND discord_user_id = ?`,
		)
			.bind(survey.guild_id, r.discord_user_id)
			.first<{ player_name: string | null }>();
		enriched.push({
			discord_user_id: r.discord_user_id,
			response: r.response,
			player_name: row?.player_name ?? null,
		});
	}
	return formatSurveyResultsTable(survey, enriched);
}
