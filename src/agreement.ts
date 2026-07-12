import {
	sendDirectMessage,
	sendMessageWithComponents,
	updateMessageResponse,
	type DiscordActionRow,
} from './discord-api';
import {
	getGuildConfig,
	getVerifiedPlayer,
	listPlayersMissingAgreement,
	upsertVerifiedPlayer,
} from './guild-db';
import { resolveLocale, t } from './i18n';
import { AuditColor, postAuditLog } from './audit-log';
import { postVerificationLog } from './verification-log';
import type { GuildConfig, VerifiedPlayer } from './types';
import { findPlayerByIdOrName } from './stfc-utils';
import { grantFullAccessForVerifiedPlayer } from './verification-access';
import { shouldSkipOutboundDm, TESTING_OUTBOUND_DM_SKIP } from './deploy-mode';
import {
	editInteractionResponse,
	loadBotManageContext,
	type BotManageContext,
} from './discord-api';

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ~20s wall budget per Worker invocation — leave headroom before CF cuts waitUntil. */
const BACKFILL_CHUNK_MS = 20_000;
const BACKFILL_PROGRESS_EVERY = 5;

export const AGREE_CUSTOM_ID_PREFIX = 'agree:';

/** `agree:{guildId}` */
export function agreeCustomId(guildId: string): string {
	return `${AGREE_CUSTOM_ID_PREFIX}${guildId}`;
}

export function parseAgreeCustomId(customId: string): { guildId: string } | null {
	if (!customId.startsWith(AGREE_CUSTOM_ID_PREFIX)) return null;
	const guildId = customId.slice(AGREE_CUSTOM_ID_PREFIX.length);
	if (!/^\d{15,20}$/.test(guildId)) return null;
	return { guildId };
}

export function hasMatchingAgreementVersion(
	config: Pick<GuildConfig, 'agreement_version'>,
	player: Pick<VerifiedPlayer, 'agreement_accepted_at' | 'agreement_version'> | null | undefined,
): boolean {
	if (!player?.agreement_accepted_at) return false;
	const required = config.agreement_version?.trim();
	if (!required) return true;
	return (player.agreement_version?.trim() || '') === required;
}

export function playerHasAcceptedAgreement(
	config: GuildConfig,
	player: Pick<VerifiedPlayer, 'agreement_accepted_at' | 'agreement_version'> | null | undefined,
): boolean {
	if (!config.agreement_enabled) return true;
	return hasMatchingAgreementVersion(config, player);
}

export function needsAgreementBeforeVerify(
	_config: GuildConfig,
	_player: Pick<VerifiedPlayer, 'agreement_accepted_at' | 'agreement_version'> | null | undefined,
): boolean {
	// Pre-verify gating is handled by data-consent.ts (GDPR). CoC uses after_verify only.
	return false;
}

/** After stfc.pro verify: withhold full member access (lounge/guest) until agree. */
export function needsAgreementBeforeFullAccess(
	config: GuildConfig,
	player: Pick<VerifiedPlayer, 'agreement_accepted_at' | 'agreement_version'> | null | undefined,
): boolean {
	return (
		config.agreement_enabled &&
		config.agreement_timing === 'after_verify' &&
		!playerHasAcceptedAgreement(config, player)
	);
}

export function buildAgreementComponents(guildId: string, locale: string): DiscordActionRow[] {
	return [
		{
			type: 1,
			components: [
				{
					type: 2,
					style: 3,
					label: t(locale, 'agree.btn.accept').slice(0, 80),
					custom_id: agreeCustomId(guildId),
				},
			],
		},
	];
}

export function agreementDmContent(config: GuildConfig, locale: string): string {
	const channelHint = config.agreement_channel_id
		? t(locale, 'agree.dm.channel_link', { channelId: config.agreement_channel_id })
		: '';
	const versionHint = config.agreement_version
		? t(locale, 'agree.dm.version', { version: config.agreement_version })
		: '';
	return [t(locale, 'agree.dm.body'), channelHint, versionHint].filter(Boolean).join('\n\n');
}

export async function sendAgreementDm(
	token: string,
	userId: string,
	config: GuildConfig,
	locale: string,
): Promise<void> {
	if (shouldSkipOutboundDm(config)) {
		throw new Error(TESTING_OUTBOUND_DM_SKIP);
	}
	const channelResponse = await fetch('https://discord.com/api/v10/users/@me/channels', {
		method: 'POST',
		headers: {
			Authorization: `Bot ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ recipient_id: userId }),
	});
	if (!channelResponse.ok) {
		throw new Error(`DM open failed: ${channelResponse.status}`);
	}
	const channel = (await channelResponse.json()) as { id: string };

	if (config.agreement_mode === 'channel_react') {
		// v1: still send DM button; reaction mode is stubbed for a follow-up.
		await sendMessageWithComponents(token, channel.id, {
			content:
				agreementDmContent(config, locale) +
				'\n\n' +
				t(locale, 'agree.dm.react_coming_soon'),
			components: buildAgreementComponents(config.guild_id, locale),
		});
		return;
	}

	await sendMessageWithComponents(token, channel.id, {
		content: agreementDmContent(config, locale),
		components: buildAgreementComponents(config.guild_id, locale),
	});
}

/**
 * Record CoC acceptance and grant Discord access (same outcome as the Agree button).
 * Used by the member button and by admin backfill.
 */
export async function acceptAgreementAndGrantAccess(
	env: Env,
	config: GuildConfig,
	guildId: string,
	userId: string,
	opts: {
		method: 'dm_button' | 'admin_backfill';
		actorId?: string;
		/** Skip per-user audit when doing bulk backfill (caller posts one summary). */
		skipAudit?: boolean;
		manageContext?: BotManageContext;
	},
): Promise<{ alreadyAccepted: boolean; accessNote: string; ok: boolean; error?: string }> {
	const player = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
	const alreadyAccepted = hasMatchingAgreementVersion(config, player);

	if (alreadyAccepted && opts.method !== 'admin_backfill') {
		return { alreadyAccepted: true, accessNote: '', ok: true };
	}

	// DM button: stamp immediately (member clicked Agree). Admin backfill stamps after grant
	// so a Worker timeout mid-batch does not mark people accepted without role restore.
	if (!alreadyAccepted && opts.method === 'dm_button') {
		const now = new Date().toISOString();
		const version = config.agreement_version ?? now.slice(0, 10);
		await upsertVerifiedPlayer(env.STFC_DB, {
			guild_id: guildId,
			discord_user_id: userId,
			agreement_accepted_at: now,
			agreement_version: version,
			agreement_method: opts.method,
			verification_status: player?.verification_status ?? 'pending_screenshot',
		});

		if (!opts.skipAudit) {
			await postAuditLog(env, config, {
				title: 'Agreement accepted',
				description:
					`<@${userId}> accepted the Discord agreement` +
					(config.agreement_version ? ` (v${config.agreement_version})` : '') +
					' via DM button.',
				actorId: userId,
				source: 'member',
				color: AuditColor.success,
				fields: [
					{ name: 'Method', value: opts.method, inline: true },
					{ name: 'Timing', value: config.agreement_timing, inline: true },
				],
			});
		}
	}

	const refreshed = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
	let accessNote = '';
	const shouldGrantAccess =
		opts.method === 'admin_backfill' || config.agreement_timing === 'after_verify';
	if (
		shouldGrantAccess &&
		refreshed &&
		(refreshed.verification_status === 'active' || refreshed.verification_status === 'guest') &&
		env.DISCORD_BOT_TOKEN
	) {
		try {
			const result = await grantFullAccessForVerifiedPlayer(
				env,
				config,
				guildId,
				userId,
				refreshed,
				opts.method === 'admin_backfill'
					? {
							skipStfcLookup: true,
							skipWelcomeDm: true,
							skipPersonalChannelIfExists: true,
							manageContext: opts.manageContext,
						}
					: undefined,
			);
			accessNote = result.message;
			if (refreshed.player_id && refreshed.player_name && opts.method === 'dm_button') {
				const stfcPlayer = await findPlayerByIdOrName(
					env,
					refreshed.player_id,
					config.stfc_server,
					config.stfc_region,
				);
				if (stfcPlayer) {
					await postVerificationLog(env, config, {
						guildId,
						discordUserId: userId,
						player: stfcPlayer,
						stfcProUrl: refreshed.stfc_pro_url ?? '',
						status: refreshed.verification_status === 'guest' ? 'guest' : 'active',
						notes: ['Agreement accepted (DM button)', ...(result.auditNotes ?? [])],
					});
				}
			}
		} catch (err) {
			console.error('Post-agreement access grant failed:', err);
			const locale = resolveLocale(refreshed?.preferred_locale);
			accessNote = t(locale, 'agree.result.access_failed');
			return {
				alreadyAccepted,
				accessNote,
				ok: false,
				error: err instanceof Error ? err.message : 'access grant failed',
			};
		}
	}

	if (!alreadyAccepted && opts.method === 'admin_backfill') {
		const now = new Date().toISOString();
		const version = config.agreement_version ?? now.slice(0, 10);
		await upsertVerifiedPlayer(env.STFC_DB, {
			guild_id: guildId,
			discord_user_id: userId,
			agreement_accepted_at: now,
			agreement_version: version,
			agreement_method: opts.method,
			verification_status: player?.verification_status ?? refreshed?.verification_status ?? 'active',
		});
	}

	return { alreadyAccepted, accessNote, ok: true };
}

export type AgreementBackfillJob = {
	guildId: string;
	appId: string;
	interactionToken: string;
	actorId?: string;
	/** Fixed snapshot of Discord user IDs to process (continuation-safe). */
	userIds: string[];
	index: number;
	ok: number;
	failed: number;
	skipped: number;
	errors: string[];
	configNote?: string;
};

export type AgreementBackfillChunkResult = {
	job: AgreementBackfillJob;
	done: boolean;
};

async function resolveBackfillTargets(
	env: Env,
	config: GuildConfig,
	guildId: string,
	userId?: string,
): Promise<{ targets: VerifiedPlayer[]; errors: string[] }> {
	if (userId) {
		const one = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
		if (!one?.player_id) {
			return {
				targets: [],
				errors: [`<@${userId}> has no verified STFC player link.`],
			};
		}
		return { targets: [one], errors: [] };
	}
	const missing = await listPlayersMissingAgreement(
		env.STFC_DB,
		guildId,
		config.agreement_version,
	);
	// Repair window: prior runs stamped CoC then died mid-grant (Worker timeout).
	const repairCutoff = Date.now() - 6 * 60 * 60 * 1000;
	const { results } = await env.STFC_DB.prepare(
		`SELECT discord_user_id, agreement_accepted_at FROM verified_players
		 WHERE guild_id = ?
		   AND verification_status IN ('verified', 'active', 'guest')
		   AND player_id IS NOT NULL
		   AND agreement_method = 'admin_backfill'
		   AND agreement_accepted_at IS NOT NULL`,
	)
		.bind(guildId)
		.all();
	const missingIds = new Set(missing.map((p) => p.discord_user_id));
	const repairPlayers: VerifiedPlayer[] = [];
	for (const row of results ?? []) {
		const id = String((row as { discord_user_id?: string }).discord_user_id ?? '');
		const at = String((row as { agreement_accepted_at?: string }).agreement_accepted_at ?? '');
		const acceptedMs = Date.parse(at);
		if (!id || missingIds.has(id) || !Number.isFinite(acceptedMs) || acceptedMs < repairCutoff) {
			continue;
		}
		const full = await getVerifiedPlayer(env.STFC_DB, guildId, id);
		if (full && hasMatchingAgreementVersion(config, full)) repairPlayers.push(full);
	}

	return { targets: [...missing, ...repairPlayers], errors: [] };
}

/**
 * Process a time-bounded chunk of the backfill job. Caller continues via self-fetch when !done.
 */
export async function processAgreementBackfillChunk(
	env: Env,
	config: GuildConfig,
	job: AgreementBackfillJob,
): Promise<AgreementBackfillChunkResult> {
	const token = env.DISCORD_BOT_TOKEN;
	if (!token) {
		job.errors.push('DISCORD_BOT_TOKEN not configured');
		return { job, done: true };
	}

	const manageContext = await loadBotManageContext(token, job.guildId);
	const started = Date.now();
	const total = job.userIds.length;

	while (job.index < total && Date.now() - started < BACKFILL_CHUNK_MS) {
		const userId = job.userIds[job.index];
		const player = await getVerifiedPlayer(env.STFC_DB, job.guildId, userId);
		const label = player?.player_name?.trim() || userId;
		const doneNum = job.index + 1;

		if (doneNum === 1 || doneNum % BACKFILL_PROGRESS_EVERY === 0 || doneNum === total) {
			await editInteractionResponse(
				job.appId,
				job.interactionToken,
				`⏳ Agreement backfill ${doneNum}/${total} (ok ${job.ok}, failed ${job.failed}) — ${label}…`,
				true,
			);
		}

		try {
			const result = await acceptAgreementAndGrantAccess(env, config, job.guildId, userId, {
				method: 'admin_backfill',
				actorId: job.actorId,
				skipAudit: true,
				manageContext,
			});
			if (!result.ok) {
				job.failed++;
				if (job.errors.length < 8) {
					job.errors.push(`<@${userId}>: ${result.error ?? 'failed'}`);
				}
			} else if (result.alreadyAccepted) {
				job.ok++;
				job.skipped++;
			} else {
				job.ok++;
			}
		} catch (err) {
			job.failed++;
			console.error(`Agreement backfill failed for ${userId}:`, err);
			if (job.errors.length < 8) {
				const msg = err instanceof Error ? err.message : 'unknown error';
				job.errors.push(`<@${userId}>: ${msg.slice(0, 180)}`);
			}
		}

		job.index++;
		await sleep(150);
	}

	return { job, done: job.index >= total };
}

/** Start a new backfill job (builds the user-id snapshot). */
export async function startAgreementBackfillJob(
	env: Env,
	config: GuildConfig,
	guildId: string,
	opts: {
		appId: string;
		interactionToken: string;
		actorId?: string;
		userId?: string;
		configNote?: string;
	},
): Promise<AgreementBackfillJob> {
	const { targets, errors } = await resolveBackfillTargets(env, config, guildId, opts.userId);
	return {
		guildId,
		appId: opts.appId,
		interactionToken: opts.interactionToken,
		actorId: opts.actorId,
		userIds: targets.map((p) => p.discord_user_id),
		index: 0,
		ok: 0,
		failed: 0,
		skipped: 0,
		errors: [...errors],
		configNote: opts.configNote,
	};
}

/** Finish Discord followup + audit after the last chunk. */
export async function finishAgreementBackfillJob(
	env: Env,
	config: GuildConfig,
	job: AgreementBackfillJob,
): Promise<void> {
	await postAuditLog(env, config, {
		title: job.userIds.length === 1 ? 'Agreement granted (admin)' : 'Agreement backfill',
		description:
			(job.userIds.length === 1
				? `Marked CoC accepted for <@${job.userIds[0]}>`
				: `Marked CoC accepted for **${job.ok}** verified member(s)`) +
			(job.failed ? ` · **${job.failed}** failed` : '') +
			(job.skipped ? ` · **${job.skipped}** already stamped` : '') +
			(config.agreement_version ? ` · v${config.agreement_version}` : ''),
		actorId: job.actorId,
		source: 'admin',
		color: job.failed ? AuditColor.warn : AuditColor.success,
	});

	const errBlock = job.errors.length > 0 ? `\n\nErrors:\n${job.errors.join('\n')}` : '';
	const configNote = job.configNote ?? '';
	await editInteractionResponse(
		job.appId,
		job.interactionToken,
		`✅ ${configNote}Agreement backfill complete.\n` +
			`• Processed: **${job.userIds.length}**\n` +
			`• Access restored: **${job.ok}**\n` +
			`• Already stamped (roles re-applied): **${job.skipped}**\n` +
			`• Failed: **${job.failed}**` +
			(job.userIds.length === 0 && job.errors.length === 0
				? '\n\nNo verified players needed CoC backfill.'
				: '') +
			errBlock,
		true,
	);
}

/**
 * Run one chunk and, if needed, POST to this Worker to continue (fresh invocation budget).
 */
export async function runAgreementBackfillWithContinuation(
	env: Env,
	config: GuildConfig,
	job: AgreementBackfillJob,
): Promise<void> {
	const { job: next, done } = await processAgreementBackfillChunk(env, config, job);
	if (done) {
		await finishAgreementBackfillJob(env, config, next);
		return;
	}

	const base = env.WORKER_URL?.replace(/\/$/, '');
	if (!base || !env.DISCORD_BOT_TOKEN) {
		await editInteractionResponse(
			next.appId,
			next.interactionToken,
			`⚠️ Agreement backfill paused at **${next.index}/${next.userIds.length}** ` +
				`(Worker time limit). Set \`WORKER_URL\` and re-run, or run again to continue remaining members.\n` +
				`Progress so far: ok ${next.ok}, failed ${next.failed}.`,
			true,
		);
		return;
	}

	await editInteractionResponse(
		next.appId,
		next.interactionToken,
		`⏳ Agreement backfill ${next.index}/${next.userIds.length} (ok ${next.ok}, failed ${next.failed}) — continuing…`,
		true,
	);

	// New Worker invocation picks up the next ~20s chunk (do not await the full job).
	const res = await fetch(`${base}/internal/agreement-backfill`, {
		method: 'POST',
		headers: {
			Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(next),
	});
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		console.error('Agreement backfill continue failed:', res.status, body);
		await editInteractionResponse(
			next.appId,
			next.interactionToken,
			`⚠️ Backfill continuation failed (HTTP ${res.status}) at ${next.index}/${next.userIds.length}. Re-run \`/server agreement backfill:true\`.`,
			true,
		);
	}
}

/** HTTP handler for continued chunks. */
export async function handleAgreementBackfillContinue(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const auth = request.headers.get('Authorization') ?? '';
	const expected = env.DISCORD_BOT_TOKEN ? `Bot ${env.DISCORD_BOT_TOKEN}` : '';
	if (!expected || auth !== expected) {
		return new Response('Unauthorized', { status: 401 });
	}

	let job: AgreementBackfillJob;
	try {
		job = (await request.json()) as AgreementBackfillJob;
	} catch {
		return new Response('Invalid JSON', { status: 400 });
	}
	if (!job?.guildId || !job.appId || !job.interactionToken || !Array.isArray(job.userIds)) {
		return new Response('Invalid job payload', { status: 400 });
	}

	const config = await getGuildConfig(env.STFC_DB, job.guildId);
	if (!config) {
		return new Response('Guild not configured', { status: 400 });
	}

	ctx.waitUntil(
		runAgreementBackfillWithContinuation(env, config, job).catch(async (err) => {
			console.error('Agreement backfill continuation aborted:', err);
			const msg = err instanceof Error ? err.message : 'unknown error';
			await editInteractionResponse(
				job.appId,
				job.interactionToken,
				`❌ Agreement backfill failed: ${msg.slice(0, 400)}`,
				true,
			);
		}),
	);

	return Response.json({ ok: true, index: job.index, total: job.userIds.length });
}

/** @deprecated Prefer startAgreementBackfillJob + runAgreementBackfillWithContinuation */
export async function runAgreementBackfill(
	env: Env,
	config: GuildConfig,
	guildId: string,
	opts: {
		actorId?: string;
		userId?: string;
		onProgress?: (
			done: number,
			total: number,
			ok: number,
			failed: number,
			currentLabel?: string,
		) => Promise<void>;
	},
): Promise<{ total: number; ok: number; failed: number; skipped: number; errors: string[] }> {
	const { targets, errors } = await resolveBackfillTargets(env, config, guildId, opts.userId);
	const job: AgreementBackfillJob = {
		guildId,
		appId: '',
		interactionToken: '',
		actorId: opts.actorId,
		userIds: targets.map((p) => p.discord_user_id),
		index: 0,
		ok: 0,
		failed: 0,
		skipped: 0,
		errors: [...errors],
	};
	const manageContext = env.DISCORD_BOT_TOKEN
		? await loadBotManageContext(env.DISCORD_BOT_TOKEN, guildId)
		: undefined;
	for (; job.index < job.userIds.length; job.index++) {
		const userId = job.userIds[job.index];
		const player = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
		if (opts.onProgress) {
			await opts.onProgress(
				job.index + 1,
				job.userIds.length,
				job.ok,
				job.failed,
				player?.player_name?.trim() || userId,
			);
		}
		const result = await acceptAgreementAndGrantAccess(env, config, guildId, userId, {
			method: 'admin_backfill',
			actorId: opts.actorId,
			skipAudit: true,
			manageContext,
		});
		if (!result.ok) {
			job.failed++;
			if (job.errors.length < 8) job.errors.push(`<@${userId}>: ${result.error ?? 'failed'}`);
		} else if (result.alreadyAccepted) {
			job.ok++;
			job.skipped++;
		} else {
			job.ok++;
		}
		await sleep(150);
	}
	return {
		total: job.userIds.length,
		ok: job.ok,
		failed: job.failed,
		skipped: job.skipped,
		errors: job.errors,
	};
}

/** Send agreement prompt if still required (no-op if accepted / disabled). */
export async function promptAgreementIfNeeded(
	env: Env,
	guildId: string,
	userId: string,
): Promise<boolean> {
	const token = env.DISCORD_BOT_TOKEN;
	if (!token) return false;
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config?.agreement_enabled) return false;
	if (shouldSkipOutboundDm(config)) return false;
	const player = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
	if (playerHasAcceptedAgreement(config, player)) return false;
	const locale = resolveLocale(player?.preferred_locale);
	try {
		await sendAgreementDm(token, userId, config, locale);
		return true;
	} catch (err) {
		console.error('Agreement DM failed:', err);
		try {
			await sendDirectMessage(token, userId, agreementDmContent(config, locale));
		} catch {
			/* ignore */
		}
		return false;
	}
}

export async function handleAgreeComponent(
	env: Env,
	interaction: {
		member?: { user?: { id: string } };
		user?: { id: string };
		data?: { custom_id?: string };
	},
): Promise<Response> {
	const customId = interaction.data?.custom_id ?? '';
	const parsed = parseAgreeCustomId(customId);
	if (!parsed) {
		return updateMessageResponse('❌ Unknown agreement button.');
	}

	const userId = interaction.member?.user?.id ?? interaction.user?.id;
	if (!userId) {
		return updateMessageResponse('❌ Could not resolve user.');
	}

	const { guildId } = parsed;
	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return updateMessageResponse('❌ Server not configured.');
	}

	const player = await getVerifiedPlayer(env.STFC_DB, guildId, userId);
	const locale = resolveLocale(player?.preferred_locale);

	if (!config.agreement_enabled) {
		return updateMessageResponse(t(locale, 'agree.result.not_required'), { components: [] });
	}

	if (playerHasAcceptedAgreement(config, player)) {
		return updateMessageResponse(t(locale, 'agree.result.already'), { components: [] });
	}

	const result = await acceptAgreementAndGrantAccess(env, config, guildId, userId, {
		method: 'dm_button',
	});

	return updateMessageResponse(
		`${t(locale, 'agree.result.accepted')}${result.accessNote ? `\n\n${result.accessNote}` : ''}`,
		{ components: [] },
	);
}
