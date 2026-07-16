/**
 * `/alliance` — multi-alliance track + link suggestions.
 */
import {
	deferredComponentResponse,
	deferredResponse,
	editInteractionResponse,
	interactionResponse,
	listAllGuildMembers,
} from './discord-api';
import { requireGuildAdmin } from './discord-admin';
import {
	getExcludedUserIds,
	getGuildConfig,
	getVerifiedDiscordUserIds,
	listActiveVerifiedPlayers,
	listAllianceMembersMissingVerify,
	type AllianceRosterMemberRow,
} from './guild-db';
import { collectTrackedAllianceTags, isMultiAllianceGuild } from './alliance-roster-sync';
import { trackAndScrapeAlliance, untrackAllianceTag } from './alliance-track';
import {
	buildApproveContinueComponents,
	buildLinkSuggestComponents,
	confidenceEmoji,
	confidenceFromCode,
	formatLinkSuggestions,
	stfcProPlayerUrl,
	suggestRosterDiscordLinks,
	type LinkSuggestion,
	type LinkSuggestionConfidence,
} from './link-suggest';
import { AuditColor, postAuditLog } from './audit-log';
import { processVerification } from './verification';
import {
	allianceApproveChunkSize,
	resolveWorkersPlan,
	workersPlanLabel,
} from './workers-plan';

function getOptionValue(
	options: Array<{ name: string; value?: unknown }> | undefined,
	name: string,
): unknown {
	return options?.find((o) => o.name === name)?.value;
}

/** Load unlinked roster rows for suggest — filter by tag in SQL; page past the UI 200-cap. */
async function loadMissingRosterForSuggest(
	db: D1Database,
	guildId: string,
	tagFilter: string | null,
): Promise<AllianceRosterMemberRow[]> {
	const pageSize = 500;
	const maxRows = 4000;
	const out: AllianceRosterMemberRow[] = [];
	for (let offset = 0; offset < maxRows; offset += pageSize) {
		const batch = await listAllianceMembersMissingVerify(db, guildId, {
			limit: pageSize,
			offset,
			sort: 'name',
			allianceTag: tagFilter,
			maxLimit: pageSize,
		});
		out.push(...batch);
		if (batch.length < pageSize) break;
	}
	return out;
}

async function collectLinkSuggestions(
	env: Env,
	guildId: string,
	tagFilter: string | null,
): Promise<{ suggestions: LinkSuggestion[]; rosterCount: number; discordCount: number }> {
	const [verifiedIds, excluded, members, missing] = await Promise.all([
		getVerifiedDiscordUserIds(env.STFC_DB, guildId),
		getExcludedUserIds(env.STFC_DB, guildId),
		listAllGuildMembers(env.DISCORD_BOT_TOKEN!, guildId),
		loadMissingRosterForSuggest(env.STFC_DB, guildId, tagFilter),
	]);

	const discordCandidates = members
		.filter((m) => !m.user.bot)
		.filter((m) => !verifiedIds.has(m.user.id))
		.filter((m) => !excluded.has(m.user.id))
		.map((m) => ({
			discordUserId: m.user.id,
			username: m.user.username,
			// Prefer server nick, then Discord display name, then username.
			nick: m.nick?.trim() || m.user.global_name?.trim() || null,
		}));

	const roster = missing
		.map((r) => ({
			playerId: r.player_id,
			playerName: r.player_name ?? '',
			allianceTag: r.alliance_tag,
			opsLevel: r.ops_level,
		}))
		.filter((r) => r.playerName);

	return {
		suggestions: suggestRosterDiscordLinks(discordCandidates, roster, {
			tagFilter,
			limit: 30,
		}),
		rosterCount: roster.length,
		discordCount: discordCandidates.length,
	};
}

function suggestMessage(
	env: Env,
	guildId: string,
	suggestions: LinkSuggestion[],
	tagFilter: string | null,
	prefix?: string,
	meta?: { rosterCount: number; discordCount: number },
): { content: string; components: ReturnType<typeof buildLinkSuggestComponents> } {
	const chunkSize = allianceApproveChunkSize(env);
	const plan = resolveWorkersPlan(env);
	let text = formatLinkSuggestions(suggestions, {
		tag: tagFilter,
		rosterCount: meta?.rosterCount,
		discordCount: meta?.discordCount,
		approveChunkSize: chunkSize,
		workersPlanLabel: workersPlanLabel(plan),
	});
	if (prefix) text = `${prefix}\n\n${text}`;
	if (text.length > 1900) text = text.slice(0, 1890) + '\n…';
	return {
		content: text,
		components: buildLinkSuggestComponents(guildId, suggestions, tagFilter, {
			approveChunkSize: chunkSize,
		}),
	};
}

export async function handleAllianceCommand(
	env: Env,
	ctx: ExecutionContext,
	interaction: {
		guild_id?: string;
		application_id?: string;
		token: string;
		member?: { permissions?: string; user?: { id: string } };
		data?: {
			options?: Array<{
				name: string;
				type?: number;
				value?: unknown;
				options?: Array<{ name: string; value?: unknown }>;
			}>;
		};
	},
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction);
	if (adminError) return adminError;

	const guildId = interaction.guild_id;
	if (!guildId) {
		return interactionResponse('❌ Run this command inside your server.', true);
	}

	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return interactionResponse('❌ Server not configured. Run `/server setup` first.', true);
	}
	if (!isMultiAllianceGuild(config)) {
		return interactionResponse(
			'❌ `/alliance` is for **multi_alliance** servers. Switch with `/server setup mode:multi_alliance`.',
			true,
		);
	}

	const sub = interaction.data?.options?.[0];
	const subName = sub?.name;
	const opts = sub?.options;

	if (subName === 'list') {
		const verified = await listActiveVerifiedPlayers(env.STFC_DB, guildId);
		const all = [...collectTrackedAllianceTags(config, verified)].sort();
		const explicit = (config.tracked_alliance_tags ?? []).slice().sort();
		const diplomacy = Object.keys(config.diplomacy_channel_map ?? {})
			.map((t) => t.toUpperCase())
			.sort();
		return interactionResponse(
			`🏷 **Tracked alliances** (morning scrape)\n` +
				`• Combined: ${all.length ? all.map((t) => `\`${t}\``).join(', ') : '_none_'}\n` +
				`• Explicit (\`/alliance track\`): ${explicit.length ? explicit.map((t) => `\`${t}\``).join(', ') : '_none_'}\n` +
				`• Diplomacy map: ${diplomacy.length ? diplomacy.map((t) => `\`${t}\``).join(', ') : '_none_'}\n` +
				`• Plus any tags on verified players\n\n` +
				`Track + scrape now: \`/alliance track tag:TAG\``,
			true,
		);
	}

	if (subName === 'untrack') {
		const tag = String(getOptionValue(opts, 'tag') ?? '');
		const result = await untrackAllianceTag(env, config, tag);
		if (!result.ok) return interactionResponse(`❌ ${result.error}`, true);
		await postAuditLog(env, config, {
			title: 'Alliance untracked',
			description: `Removed **${tag.trim().toUpperCase()}** from explicit track list.`,
			actorId: interaction.member?.user?.id,
			source: 'admin',
			color: AuditColor.info,
		});
		return interactionResponse(
			`✅ Untracked **${tag.trim().toUpperCase()}** from explicit list.\n` +
				`Still tracked if on diplomacy map or a verified player: ` +
				`${result.trackedTags.length ? result.trackedTags.map((t) => `\`${t}\``).join(', ') : '_none explicit_'}`,
			true,
		);
	}

	if (subName === 'track') {
		const tag = getOptionValue(opts, 'tag') as string | undefined;
		const allianceId = getOptionValue(opts, 'alliance_id') as string | undefined;
		const appId = interaction.application_id ?? env.DISCORD_APPLICATION_ID;
		if (!appId) {
			return interactionResponse('❌ DISCORD_APPLICATION_ID not configured.', true);
		}

		const deferred = deferredResponse();
		ctx.waitUntil(
			(async () => {
				const result = await trackAndScrapeAlliance(env, config, {
					tag: tag ?? null,
					allianceId: allianceId ?? null,
				});
				if (!result.ok) {
					await editInteractionResponse(appId, interaction.token, `❌ ${result.error}`, true);
					return;
				}
				await postAuditLog(env, config, {
					title: 'Alliance tracked + scraped',
					description:
						`**[${result.allianceTag}]** \`${result.allianceId}\` · **${result.playerCount}** players` +
						(result.allianceName ? ` · ${result.allianceName}` : ''),
					actorId: interaction.member?.user?.id,
					source: 'admin',
					color: AuditColor.success,
				});
				const unlinked = result.playerCount - result.alreadyVerifiedOnRoster;
				await editInteractionResponse(
					appId,
					interaction.token,
					`✅ Tracked **[${result.allianceTag}]**` +
						(result.allianceName ? ` (${result.allianceName})` : '') +
						`\n` +
						`• Alliance id: \`${result.allianceId}\`\n` +
						`• Players on roster: **${result.playerCount}**` +
						` (${result.alreadyVerifiedOnRoster} already verified, ~**${unlinked}** unlinked)\n` +
						`• Guild missing-verify total: **${result.missingVerify}**\n` +
						`• All tracked tags: ${result.trackedTags.map((t) => `\`${t}\``).join(', ') || '—'}\n\n` +
						`Next: \`/alliance suggest tag:${result.allianceTag}\` to match Discord nicks, ` +
						`or \`/roster missing-verify\`.`,
					true,
				);
			})(),
		);
		return deferred;
	}

	if (subName === 'suggest') {
		const tagFilter = (getOptionValue(opts, 'tag') as string | undefined)?.trim() || null;
		const appId = interaction.application_id ?? env.DISCORD_APPLICATION_ID;
		if (!appId || !env.DISCORD_BOT_TOKEN) {
			return interactionResponse('❌ Bot token / application id missing.', true);
		}

		const deferred = deferredResponse();
		ctx.waitUntil(
			(async () => {
				try {
					const { suggestions, rosterCount, discordCount } = await collectLinkSuggestions(
						env,
						guildId,
						tagFilter,
					);
					const msg = suggestMessage(env, guildId, suggestions, tagFilter, undefined, {
						rosterCount,
						discordCount,
					});
					await editInteractionResponse(appId, interaction.token, msg.content, true, {
						components: msg.components,
						config,
					});
				} catch (err) {
					await editInteractionResponse(
						appId,
						interaction.token,
						`❌ Suggest failed: ${err instanceof Error ? err.message : String(err)}`,
						true,
					);
				}
			})(),
		);
		return deferred;
	}

	return interactionResponse(
		`🏷 **Alliance** (multi)\n` +
			`• \`/alliance track tag:TAG\` — scrape now + keep in morning sync\n` +
			`• \`/alliance suggest [tag:]\` — match unverified Discord members to roster (Approve buttons)\n` +
			`• \`/alliance list\` · \`/alliance untrack tag:\``,
		true,
	);
}

function formatApproveProgress(opts: {
	confidence: LinkSuggestionConfidence;
	done: number;
	batchTotal: number;
	ok: number;
	fail: number;
	lines: string[];
	current?: LinkSuggestion | null;
	chunkSize: number;
	planLabel: string;
	waiting: number;
}): string {
	const {
		confidence,
		done,
		batchTotal,
		ok,
		fail,
		lines,
		current,
		chunkSize,
		planLabel,
		waiting,
	} = opts;
	const emoji = confidenceEmoji(confidence);
	const head =
		`⏳ **Approve ${emoji} (${confidence}) — this batch: ${done} / ${batchTotal}**` +
		` · ✅ ${ok}` +
		(fail ? ` · ❌ ${fail}` : '') +
		`\n_Chunk size **${chunkSize}** (${planLabel})` +
		(waiting > batchTotal
			? ` · ~**${waiting - batchTotal}** more after this batch_`
			: '_') +
		(current ? `\n_Working on <@${current.discordUserId}> → **${current.playerName}**…_` : '') +
		`\n_Buttons cleared until this batch finishes — keep this message open._`;
	const recent = lines.slice(-10);
	const body = recent.length
		? `\n\n${recent.join('\n')}` +
			(lines.length > recent.length ? `\n_…${lines.length - recent.length} earlier_` : '')
		: '';
	const text = head + body;
	return text.length > 1900 ? text.slice(0, 1890) + '\n…' : text;
}

async function runConfidenceApproveChunk(
	env: Env,
	opts: {
		appId: string;
		token: string;
		guildId: string;
		tagFilter: string | null;
		adminId?: string;
		confidence: LinkSuggestionConfidence;
		config: NonNullable<Awaited<ReturnType<typeof getGuildConfig>>>;
	},
): Promise<void> {
	const { appId, token, guildId, tagFilter, adminId, config, confidence } = opts;
	const chunkSize = allianceApproveChunkSize(env);
	const plan = resolveWorkersPlan(env);
	const planLabel = workersPlanLabel(plan);
	const emoji = confidenceEmoji(confidence);

	await editInteractionResponse(
		appId,
		token,
		`⏳ Preparing **Approve ${emoji}**…\n_Chunk **${chunkSize}** (${planLabel}); loading suggestions._`,
		true,
		{ components: [], config },
	);

	const collected = await collectLinkSuggestions(env, guildId, tagFilter);
	const pool = collected.suggestions.filter((s) => s.confidence === confidence);
	if (pool.length === 0) {
		const msg = suggestMessage(
			env,
			guildId,
			collected.suggestions,
			tagFilter,
			`ℹ️ No ${confidence}-confidence suggestions left to approve.`,
			collected,
		);
		await editInteractionResponse(appId, token, msg.content, true, {
			components: msg.components,
			config,
		});
		return;
	}

	const batch = pool.slice(0, chunkSize);
	const lines: string[] = [];
	let ok = 0;
	let fail = 0;

	await editInteractionResponse(
		appId,
		token,
		formatApproveProgress({
			confidence,
			done: 0,
			batchTotal: batch.length,
			ok,
			fail,
			lines,
			current: batch[0] ?? null,
			chunkSize,
			planLabel,
			waiting: pool.length,
		}),
		true,
		{ components: [], config },
	);

	for (let i = 0; i < batch.length; i++) {
		const s = batch[i]!;
		const link = stfcProPlayerUrl(s.playerId, config.stfc_server, config.stfc_region);
		try {
			const result = await processVerification(
				env,
				guildId,
				s.discordUserId,
				link,
				undefined,
				adminId ? { manualByUserId: adminId, sendWelcomeDm: false } : undefined,
			);
			const short = result.length > 120 ? result.slice(0, 117) + '…' : result;
			if (result.startsWith('❌') || result.includes('failed')) {
				fail++;
				lines.push(`• ❌ <@${s.discordUserId}> → ${s.playerName}: ${short}`);
			} else {
				ok++;
				lines.push(`• ✅ <@${s.discordUserId}> → **${s.playerName}**`);
			}
		} catch (err) {
			fail++;
			lines.push(
				`• ❌ <@${s.discordUserId}> → ${s.playerName}: ${
					err instanceof Error ? err.message : String(err)
				}`.slice(0, 180),
			);
		}

		const done = i + 1;
		await editInteractionResponse(
			appId,
			token,
			formatApproveProgress({
				confidence,
				done,
				batchTotal: batch.length,
				ok,
				fail,
				lines,
				current: batch[done] ?? null,
				chunkSize,
				planLabel,
				waiting: pool.length,
			}),
			true,
			{ components: [], config },
		);
	}

	const after = await collectLinkSuggestions(env, guildId, tagFilter);
	const left = after.suggestions.filter((s) => s.confidence === confidence).length;
	const batchSummary =
		`✅ Batch finished — **${ok}** linked` +
		(fail ? `, **${fail}** failed` : '') +
		` this click (${batch.length} attempted · ${confidence} · chunk ${chunkSize} / ${planLabel})\n` +
		`${lines.join('\n')}`;

	if (left > 0) {
		const continueText =
			`${batchSummary}\n\n` +
			`⏸ **${left}** ${confidence} still waiting — press **Continue ${emoji}** ` +
			`(next **${Math.min(left, chunkSize)}**).\n` +
			`_Each click stays within Cloudflare Workers Free subrequest / waitUntil limits._`;
		const text =
			continueText.length > 1900 ? continueText.slice(0, 1890) + '\n…' : continueText;
		await editInteractionResponse(appId, token, text, true, {
			components: buildApproveContinueComponents(
				guildId,
				tagFilter,
				left,
				chunkSize,
				confidence,
			),
			config,
		});
		return;
	}

	const msg = suggestMessage(
		env,
		guildId,
		after.suggestions,
		tagFilter,
		`${batchSummary}\n\n✅ Approve ${emoji} complete — no ${confidence} left.`,
		after,
	);
	await editInteractionResponse(appId, token, msg.content, true, {
		components: msg.components,
		config,
	});
}

/**
 * Button handler for `/alliance suggest`:
 * `alink:1:…`, `alink:grp:h|m|l:…`, `alink:more:h|m|l:…`
 * (legacy `alink:high:` still accepted as high group).
 */
export async function handleAllianceLinkComponent(
	env: Env,
	ctx: ExecutionContext,
	interaction: {
		guild_id?: string;
		application_id?: string;
		token: string;
		member?: { permissions?: string; user?: { id: string } };
		data?: { custom_id?: string };
	},
): Promise<Response> {
	const adminError = requireGuildAdmin(interaction);
	if (adminError) return adminError;

	const customId = interaction.data?.custom_id ?? '';
	const single = customId.match(/^alink:1:(\d{15,20}):(\d{15,20}):(\d+):([A-Za-z0-9_]+)$/);
	const group = customId.match(/^alink:grp:([hml]):(\d{15,20}):([A-Za-z0-9_]+)$/);
	const more = customId.match(/^alink:more:([hml]):(\d{15,20}):([A-Za-z0-9_]+)$/);
	const legacyHigh = customId.match(/^alink:high:(\d{15,20}):([A-Za-z0-9_]+)$/);
	const legacyMore = customId.match(/^alink:more:(\d{15,20}):([A-Za-z0-9_]+)$/);
	if (!single && !group && !more && !legacyHigh && !legacyMore) {
		return interactionResponse('❌ Unknown link button.', true);
	}

	const guildId = (single?.[1] ??
		group?.[2] ??
		more?.[2] ??
		legacyHigh?.[1] ??
		legacyMore?.[1])!;
	if (interaction.guild_id && interaction.guild_id !== guildId) {
		return interactionResponse('❌ Guild mismatch.', true);
	}

	const appId = interaction.application_id ?? env.DISCORD_APPLICATION_ID;
	if (!appId || !env.DISCORD_BOT_TOKEN) {
		return interactionResponse('❌ Bot token / application id missing.', true);
	}

	const adminId = interaction.member?.user?.id;
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return interactionResponse('❌ Server not configured.', true);
	}
	if (!isMultiAllianceGuild(config)) {
		return interactionResponse('❌ Link buttons are for multi_alliance servers only.', true);
	}

	ctx.waitUntil(
		(async () => {
			try {
				if (single) {
					const discordUserId = single[2]!;
					const playerId = Number(single[3]);
					const tagKey = single[4]!;
					const tagFilter = tagKey === '_' ? null : tagKey;
					await editInteractionResponse(
						appId,
						interaction.token,
						`⏳ Linking <@${discordUserId}> → \`${playerId}\`…\n_Other approve buttons paused._`,
						true,
						{ components: [], config },
					);
					const link = stfcProPlayerUrl(playerId, config.stfc_server, config.stfc_region);
					const result = await processVerification(
						env,
						guildId,
						discordUserId,
						link,
						undefined,
						adminId ? { manualByUserId: adminId, sendWelcomeDm: false } : undefined,
					);
					const remaining = await collectLinkSuggestions(env, guildId, tagFilter);
					const msg = suggestMessage(
						env,
						guildId,
						remaining.suggestions,
						tagFilter,
						`✅ ${result}`,
						remaining,
					);
					await editInteractionResponse(appId, interaction.token, msg.content, true, {
						components: msg.components,
						config,
					});
					return;
				}

				let confidence: LinkSuggestionConfidence = 'high';
				let tagKey: string;
				if (group) {
					confidence = confidenceFromCode(group[1]!) ?? 'high';
					tagKey = group[3]!;
				} else if (more) {
					confidence = confidenceFromCode(more[1]!) ?? 'high';
					tagKey = more[3]!;
				} else if (legacyHigh) {
					confidence = 'high';
					tagKey = legacyHigh[2]!;
				} else {
					confidence = 'high';
					tagKey = legacyMore![2]!;
				}
				const tagFilter = tagKey === '_' ? null : tagKey;
				await runConfidenceApproveChunk(env, {
					appId,
					token: interaction.token,
					guildId,
					tagFilter,
					adminId,
					confidence,
					config,
				});
			} catch (err) {
				try {
					await editInteractionResponse(
						appId,
						interaction.token,
						`❌ Link failed: ${err instanceof Error ? err.message : String(err)}`,
						true,
						{ components: [], config },
					);
				} catch (editErr) {
					console.error('alliance link: failed to report error', err, editErr);
				}
			}
		})(),
	);

	return deferredComponentResponse();
}
