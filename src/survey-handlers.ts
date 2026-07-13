import {
	deferredComponentResponse,
	editInteractionResponse,
	interactionResponse,
	interactionResponseWithComponents,
	updateMessageResponse,
} from './discord-api';
import { requireGuildAdmin, isGuildAdministrator } from './discord-admin';
import { getGuildConfig, upsertGuildConfig } from './guild-db';
import { AuditColor, postAuditLog } from './audit-log';
import { deleteSurvey, getSurvey, listSurveys, updateSurvey } from './survey-db';
import {
	buildSurveyAdminComponents,
	buildSurveyResultsMessage,
	createSurveyDraft,
	createSurveyLogCategory,
	handleSurveyVote,
	sendSurveyBroadcast,
	sendSurveyTest,
	surveyPreviewEmbed,
} from './survey-service';
import type { SurveyDelivery, SurveyTargetType } from './survey-types';
import type { GuildConfig } from './types';

function getOptionValue(options: Array<{ name: string; value?: unknown }> | undefined, name: string): unknown {
	return options?.find((opt) => opt.name === name)?.value;
}

function formatSurveySettings(config: GuildConfig): string {
	return (
		`📋 **Survey settings**\n` +
		`• Creators: ${config.survey_creator_role_ids.map((id) => `<@&${id}>`).join(', ') || 'Administrators only'}\n` +
		`• Log / results viewers: ${config.survey_results_role_ids.map((id) => `<@&${id}>`).join(', ') || 'creator + admins (+ creator roles)'}\n` +
		`• Log channel name: \`${config.survey_log_name_template || 'survey-{id}'}\`\n` +
		`• Log category: ${config.survey_log_category_id ? `<#${config.survey_log_category_id}>` : 'none (server root)'}`
	);
}

function memberRoleIds(interaction: {
	member?: { roles?: string[]; permissions?: string; user?: { id: string } };
	user?: { id: string };
}): string[] {
	return interaction.member?.roles ?? [];
}

function actorUserId(interaction: {
	member?: { user?: { id: string } };
	user?: { id: string };
}): string | undefined {
	return interaction.member?.user?.id ?? interaction.user?.id;
}

export function canCreateSurvey(
	config: GuildConfig,
	interaction: { member?: { roles?: string[]; permissions?: string } },
): boolean {
	if (isGuildAdministrator(interaction.member?.permissions)) return true;
	const allowed = config.survey_creator_role_ids;
	if (!allowed.length) return false;
	const roles = interaction.member?.roles ?? [];
	return allowed.some((id) => roles.includes(id));
}

export function canViewSurveyResults(
	survey: { created_by: string; viewer_role_ids: string[] },
	config: GuildConfig,
	interaction: {
		member?: { roles?: string[]; permissions?: string; user?: { id: string } };
		user?: { id: string };
	},
): boolean {
	const uid = actorUserId(interaction);
	if (uid && uid === survey.created_by) return true;
	if (isGuildAdministrator(interaction.member?.permissions)) return true;
	const roles = memberRoleIds(interaction);
	const allowed = [...config.survey_results_role_ids, ...survey.viewer_role_ids];
	return allowed.some((id) => roles.includes(id));
}

export async function handleSurveyCommand(
	env: Env,
	ctx: ExecutionContext,
	interaction: {
		guild_id?: string;
		member?: { permissions?: string; roles?: string[]; user?: { id: string } };
		user?: { id: string };
		token?: string;
		application_id?: string;
	},
	data: { options?: Array<{ name: string; value?: unknown; options?: Array<{ name: string; value?: unknown }> }> },
): Promise<Response> {
	const guildId = interaction.guild_id;
	if (!guildId) return interactionResponse('❌ Run this in a server.', true);

	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) return interactionResponse('❌ Server not configured. Run `/server setup` first.', true);

	const sub = data.options?.[0];
	if (!sub) return interactionResponse('❌ Missing survey subcommand.', true);

	if (sub.name === 'creators') {
		const adminError = requireGuildAdmin(interaction);
		if (adminError) return adminError;
		const rolesRaw = getOptionValue(sub.options, 'roles') as string | undefined;
		const resultsRaw = getOptionValue(sub.options, 'results_roles') as string | undefined;
		const logNameRaw = getOptionValue(sub.options, 'log_name') as string | undefined;
		const categoryOpt = getOptionValue(sub.options, 'category');
		const createCategory = getOptionValue(sub.options, 'create_category') as boolean | undefined;
		const categoryNameRaw = getOptionValue(sub.options, 'category_name') as string | undefined;
		const clearCategory = getOptionValue(sub.options, 'clear_category') as boolean | undefined;

		const patch: Partial<GuildConfig> & { guild_id: string } = { guild_id: guildId };
		const notes: string[] = [];

		if (rolesRaw !== undefined) {
			patch.survey_creator_role_ids = rolesRaw
				.split(',')
				.map((s) => s.trim().replace(/^<@&|>$/g, ''))
				.filter((id) => /^\d{15,20}$/.test(id));
		}
		if (resultsRaw !== undefined) {
			patch.survey_results_role_ids = resultsRaw
				.split(',')
				.map((s) => s.trim().replace(/^<@&|>$/g, ''))
				.filter((id) => /^\d{15,20}$/.test(id));
		}
		if (logNameRaw !== undefined) {
			patch.survey_log_name_template = logNameRaw.trim() || null;
		}
		if (clearCategory) {
			patch.survey_log_category_id = null;
			notes.push('Cleared survey log category (new logs go to the channel list root).');
		} else if (createCategory) {
			if (!env.DISCORD_BOT_TOKEN) {
				return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
			}
			// Apply role patches first so new category overwrites use updated viewer roles.
			if (
				rolesRaw !== undefined ||
				resultsRaw !== undefined ||
				logNameRaw !== undefined
			) {
				await upsertGuildConfig(env.STFC_DB, patch);
			}
			const cfgForCreate =
				(await getGuildConfig(env.STFC_DB, guildId)) ?? config;
			try {
				const cat = await createSurveyLogCategory(
					env.DISCORD_BOT_TOKEN,
					guildId,
					cfgForCreate,
					categoryNameRaw || 'Surveys',
				);
				patch.survey_log_category_id = cat.id;
				notes.push(`Created category **${cat.name}** (<#${cat.id}>).`);
			} catch (err) {
				return interactionResponse(
					`❌ Could not create category: ${err instanceof Error ? err.message : 'error'}`,
					true,
				);
			}
		} else if (categoryOpt !== undefined && categoryOpt !== null) {
			const cat = String(categoryOpt);
			if (!/^\d{15,20}$/.test(cat)) {
				return interactionResponse('❌ Invalid category.', true);
			}
			patch.survey_log_category_id = cat;
			notes.push(`Linked category <#${cat}>.`);
		}

		const anyChange =
			rolesRaw !== undefined ||
			resultsRaw !== undefined ||
			logNameRaw !== undefined ||
			clearCategory === true ||
			createCategory === true ||
			(categoryOpt !== undefined && categoryOpt !== null);

		if (!anyChange) {
			return interactionResponse(
				formatSurveySettings(config) +
					`\n\nLog channels are **private**. Use \`category:\` to link an existing category, or \`create_category:true\` to make one.`,
				true,
			);
		}

		await upsertGuildConfig(env.STFC_DB, patch);
		const refreshed = await getGuildConfig(env.STFC_DB, guildId);
		return interactionResponse(
			`✅ Survey settings updated.\n` +
				formatSurveySettings(refreshed!) +
				(notes.length ? `\n${notes.map((n) => `• ${n}`).join('\n')}` : '') +
				`\n(Category/name apply to **new** survey logs.)`,
			true,
		);
	}

	if (!canCreateSurvey(config, interaction) && sub.name !== 'results') {
		return interactionResponse(
			'❌ You need Administrator or a configured survey creator role (`/survey creators`).',
			true,
		);
	}

	if (sub.name === 'list') {
		const surveys = await listSurveys(env.STFC_DB, guildId);
		if (!surveys.length) return interactionResponse('No surveys yet.', true);
		const lines = surveys.map(
			(s) =>
				`#${s.id} [${s.status}] ${s.question.slice(0, 60)}${s.question.length > 60 ? '…' : ''} — ${s.target_count} targets`,
		);
		return interactionResponse(`📋 **Surveys**\n${lines.join('\n')}`, true);
	}

	if (sub.name === 'results') {
		const id = Number(getOptionValue(sub.options, 'id'));
		if (!Number.isFinite(id)) return interactionResponse('❌ Provide survey `id`.', true);
		const survey = await getSurvey(env.STFC_DB, id);
		if (!survey || survey.guild_id !== guildId) return interactionResponse('❌ Survey not found.', true);
		if (!canViewSurveyResults(survey, config, interaction)) {
			return interactionResponse('❌ You cannot view results for this survey.', true);
		}
		const msg = await buildSurveyResultsMessage(env, id);
		return interactionResponse(msg.slice(0, 1900), true);
	}

	if (sub.name === 'close') {
		const id = Number(getOptionValue(sub.options, 'id'));
		if (!Number.isFinite(id)) return interactionResponse('❌ Provide survey `id`.', true);
		const survey = await getSurvey(env.STFC_DB, id);
		if (!survey || survey.guild_id !== guildId) return interactionResponse('❌ Survey not found.', true);
		await updateSurvey(env.STFC_DB, id, {
			status: 'closed',
			closed_at: new Date().toISOString(),
		});
		await postAuditLog(env, config, {
			title: 'Survey closed',
			description: `Survey #${id}`,
			actorId: actorUserId(interaction),
			source: 'admin',
			color: AuditColor.warn,
		});
		return interactionResponse(`✅ Survey #${id} closed.`, true);
	}

	if (sub.name === 'create') {
		const question = getOptionValue(sub.options, 'question') as string | undefined;
		const titleRaw = getOptionValue(sub.options, 'title') as string | undefined;
		const optionsRaw = getOptionValue(sub.options, 'options') as string | undefined;
		const delivery = ((getOptionValue(sub.options, 'delivery') as string) || 'dm') as SurveyDelivery;
		const targetType = ((getOptionValue(sub.options, 'target') as string) || 'all') as SurveyTargetType;
		const gradesRaw = getOptionValue(sub.options, 'grades') as string | undefined;
		const ranksRaw = getOptionValue(sub.options, 'ranks') as string | undefined;
		const rolesRaw = getOptionValue(sub.options, 'roles') as string | undefined;
		const usersRaw = getOptionValue(sub.options, 'users') as string | undefined;
		const opsMin = getOptionValue(sub.options, 'ops_min') as number | undefined;
		const opsMax = getOptionValue(sub.options, 'ops_max') as number | undefined;
		const allianceTagsRaw = getOptionValue(sub.options, 'alliance_tags') as string | undefined;
		const logCategoryOpt = getOptionValue(sub.options, 'log_category');

		if (!question?.trim() || !optionsRaw?.trim()) {
			return interactionResponse('❌ `question` and `options` (A|B|C) are required.', true);
		}

		let logCategoryId: string | null = null;
		if (logCategoryOpt !== undefined && logCategoryOpt !== null) {
			const cat = String(logCategoryOpt);
			if (!/^\d{15,20}$/.test(cat)) {
				return interactionResponse('❌ Invalid log_category.', true);
			}
			logCategoryId = cat;
		}

		const createdBy = actorUserId(interaction);
		if (!createdBy) return interactionResponse('❌ Could not resolve your user id.', true);

		try {
			const { survey, targetCount } = await createSurveyDraft(env, config, {
				guildId,
				createdBy,
				title: titleRaw?.trim() || null,
				question: question.trim(),
				optionsRaw,
				delivery: delivery === 'personal_channel' ? 'personal_channel' : 'dm',
				targetType,
				targetGrades: gradesRaw
					? gradesRaw.split(',').map((g) => Number(g.trim())).filter((n) => Number.isFinite(n))
					: undefined,
				targetRanks: ranksRaw
					? ranksRaw.split(',').map((r) => r.trim()).filter(Boolean)
					: undefined,
				targetRoleIds: rolesRaw
					? rolesRaw
							.split(',')
							.map((s) => s.trim().replace(/^<@&|>$/g, ''))
							.filter((id) => /^\d{15,20}$/.test(id))
					: undefined,
				targetUserIds: usersRaw
					? usersRaw
							.split(',')
							.map((s) => s.trim().replace(/^<@!?|>$/g, ''))
							.filter((id) => /^\d{15,20}$/.test(id))
					: undefined,
				targetOpsMin: opsMin ?? null,
				targetOpsMax: opsMax ?? null,
				targetAllianceTags: allianceTagsRaw
					? allianceTagsRaw.split(',').map((t) => t.trim()).filter(Boolean)
					: undefined,
				logCategoryId,
			});

			return interactionResponseWithComponents(
				`Draft survey #${survey.id} ready. Matched **${targetCount}** player(s).`,
				{
					ephemeral: true,
					embeds: [surveyPreviewEmbed(survey, targetCount)],
					components: buildSurveyAdminComponents(survey.id),
				},
			);
		} catch (err) {
			return interactionResponse(
				`❌ ${err instanceof Error ? err.message : 'Failed to create survey'}`,
				true,
			);
		}
	}

	return interactionResponse(`❌ Unknown survey subcommand: ${sub.name}`, true);
}

export async function handleSurveyComponent(
	env: Env,
	ctx: ExecutionContext,
	interaction: {
		guild_id?: string;
		member?: { permissions?: string; roles?: string[]; user?: { id: string } };
		user?: { id: string };
		token: string;
		application_id: string;
		data?: { custom_id?: string };
		message?: { id?: string };
	},
): Promise<Response> {
	const customId = interaction.data?.custom_id ?? '';
	const userId = actorUserId(interaction);
	if (!userId) return interactionResponse('❌ Could not resolve user.', true);

	const voteMatch = customId.match(/^survey:vote:(\d+):(\d+)$/);
	if (voteMatch) {
		const surveyId = Number(voteMatch[1]);
		const optionIndex = Number(voteMatch[2]);
		const msg = await handleSurveyVote(env, surveyId, optionIndex, userId);
		return interactionResponse(msg, true);
	}

	const adminMatch = customId.match(/^survey:admin:(test|send|cancel):(\d+)$/);
	if (!adminMatch) return interactionResponse('❌ Unknown survey button.', true);

	const action = adminMatch[1];
	const surveyId = Number(adminMatch[2]);
	const survey = await getSurvey(env.STFC_DB, surveyId);
	if (!survey) return interactionResponse('❌ Survey not found.', true);

	const guildId = survey.guild_id;
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) return interactionResponse('❌ Server not configured.', true);

	if (!canCreateSurvey(config, interaction) && userId !== survey.created_by) {
		return interactionResponse('❌ Not allowed.', true);
	}

	if (action === 'cancel') {
		if (survey.status !== 'draft') {
			return interactionResponse('❌ Only draft surveys can be cancelled this way.', true);
		}
		await deleteSurvey(env.STFC_DB, surveyId);
		return updateMessageResponse(`🗑️ Survey #${surveyId} cancelled.`);
	}

	if (action === 'test') {
		try {
			const result = await sendSurveyTest(env, survey, userId);
			if (result.delivery === 'personal_channel' && result.channelId) {
				return interactionResponse(
					`🧪 Test survey posted in your personal channel: <#${result.channelId}>.`,
					true,
				);
			}
			return interactionResponse('🧪 Test survey sent to your DMs.', true);
		} catch (err) {
			return interactionResponse(
				`❌ Test send failed: ${err instanceof Error ? err.message : 'error'}`,
				true,
			);
		}
	}

	if (action === 'send') {
		if (survey.status !== 'draft') {
			return interactionResponse('❌ Only draft surveys can be sent.', true);
		}
		const appId = interaction.application_id;
		const token = interaction.token;
		ctx.waitUntil(
			(async () => {
				try {
					await editInteractionResponse(
						appId,
						token,
						`⏳ Sending survey #${surveyId}…`,
						false,
						{ components: [] },
					);
					const result = await sendSurveyBroadcast(env, config, surveyId);
					await postAuditLog(env, config, {
						title: 'Survey sent',
						description: `Survey #${surveyId} → **${result.sent}** player(s)` +
							(result.failed ? ` (${result.failed} failed)` : ''),
						source: 'admin',
						color: AuditColor.success,
						fields: [{ name: 'Log', value: `<#${result.logChannelId}>`, inline: true }],
					});
					await editInteractionResponse(
						appId,
						token,
						`✅ Survey #${surveyId} sent to **${result.sent}** player(s)` +
							(result.failed ? ` (${result.failed} failed)` : '') +
							`\nLog: <#${result.logChannelId}>`,
						false,
						{ components: [] },
					);
				} catch (err) {
					await editInteractionResponse(
						appId,
						token,
						`❌ Send failed: ${err instanceof Error ? err.message : 'error'}`,
						false,
						{ components: [] },
					);
				}
			})(),
		);
		return deferredComponentResponse();
	}

	return interactionResponse('❌ Unknown action.', true);
}
