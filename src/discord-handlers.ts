import { verifyKey } from 'discord-interactions';
import {
	deferredResponse,
	editInteractionResponse,
	interactionResponse,
} from './discord-api';
import { getGuildConfig, upsertGuildConfig } from './guild-db';
import { findPlayerByIdOrName, formatPlayerSummary } from './stfc-utils';
import { processVerification } from './verification';
import { parseCSV, autoGenerateColumns, generateAsciiTable } from './tableUtils';
import {
	handleCoordinateLookup,
	parseCoordinateLink,
	parseMultipleCoordinates,
} from './systemUtils';
import type { GuildMode, StfcRegion } from './types';

function getOptionValue(options: Array<{ name: string; value?: unknown }> | undefined, name: string): unknown {
	return options?.find((opt) => opt.name === name)?.value;
}

async function handlePlayerCommand(
	env: Env,
	ctx: ExecutionContext,
	interaction: { token: string; application_id?: string; guild_id?: string },
	data: { options?: Array<{ name: string; value?: unknown }> },
): Promise<Response> {
	const playerName = getOptionValue(data.options, 'name') as string | undefined;
	const guildId = interaction.guild_id;

	if (!playerName) {
		return interactionResponse('Please provide a player name or ID.', true);
	}

	const config = guildId ? await getGuildConfig(env.STFC_DB, guildId) : null;
	const server = config?.stfc_server;
	const region = config?.stfc_region ?? 'US';

	if (!server) {
		return interactionResponse(
			'❌ No STFC server configured for this Discord server. An admin must run `/server setup` first.',
			true,
		);
	}

	const appId = interaction.application_id ?? env.DISCORD_APPLICATION_ID;
	if (!appId) {
		return interactionResponse('❌ DISCORD_APPLICATION_ID not configured.', true);
	}

	const deferred = deferredResponse();

	ctx.waitUntil(
		(async () => {
			try {
				const searchTerm = /^\d+$/.test(playerName) ? parseInt(playerName, 10) : playerName;
				const player = await findPlayerByIdOrName(searchTerm, server, region);
				const content = player
					? `🔍 **Player lookup**\n\n${formatPlayerSummary(player)}`
					: `❌ No player found matching "${playerName}" on server ${server} (${region}).`;
				await editInteractionResponse(appId, interaction.token, content, true);
			} catch (error) {
				await editInteractionResponse(
					appId,
					interaction.token,
					`❌ Lookup failed: ${error instanceof Error ? error.message : 'unknown error'}`,
					true,
				);
			}
		})(),
	);

	return deferred;
}

async function handleVerifyCommand(
	env: Env,
	ctx: ExecutionContext,
	interaction: { guild_id?: string; member?: { user?: { id: string } }; token: string; application_id?: string },
	data: { options?: Array<{ name: string; value?: unknown }>; resolved?: { attachments?: Record<string, { url: string; filename?: string }> } },
): Promise<Response> {
	const guildId = interaction.guild_id;
	const userId = interaction.member?.user?.id;

	if (!guildId || !userId) {
		return interactionResponse('❌ Verification must be run inside a configured Discord server.', true);
	}

	const link = getOptionValue(data.options, 'link') as string | undefined;
	if (!link) {
		return interactionResponse('Please provide your stfc.pro profile link.', true);
	}

	let screenshotUrl: string | undefined;
	const screenshotOption = data.options?.find((opt) => opt.name === 'screenshot');
	if (screenshotOption?.value && data.resolved?.attachments) {
		const attachment = data.resolved.attachments[String(screenshotOption.value)];
		if (attachment?.url) screenshotUrl = attachment.url;
	}

	const appId = interaction.application_id ?? env.DISCORD_APPLICATION_ID;
	if (!appId) {
		return interactionResponse('❌ DISCORD_APPLICATION_ID not configured.', true);
	}

	const deferred = deferredResponse();

	ctx.waitUntil(
		(async () => {
			const result = await processVerification(env, guildId, userId, link, screenshotUrl);
			await editInteractionResponse(appId, interaction.token, result, true);
		})(),
	);

	return deferred;
}

async function handleServerSetupCommand(
	env: Env,
	interaction: { guild_id?: string; member?: { permissions?: string } },
	data: { options?: Array<{ name: string; value?: unknown }> },
): Promise<Response> {
	const guildId = interaction.guild_id;
	if (!guildId) {
		return interactionResponse('❌ This command must be run in a server.', true);
	}

	const permissions = BigInt(interaction.member?.permissions ?? '0');
	if ((permissions & 0x8n) === 0n) {
		return interactionResponse('❌ You need Administrator permission to configure the server.', true);
	}

	const mode = (getOptionValue(data.options, 'mode') as GuildMode | undefined) ?? 'single_alliance';
	const server = getOptionValue(data.options, 'server') as number | undefined;
	const region = (getOptionValue(data.options, 'region') as StfcRegion | undefined) ?? 'US';
	const allianceTag = getOptionValue(data.options, 'alliance_tag') as string | undefined;
	const guestRoleId = getOptionValue(data.options, 'guest_role') as string | undefined;
	const memberRoles = getOptionValue(data.options, 'member_roles') as string | undefined;

	if (!server) {
		return interactionResponse('❌ `server` is required (your STFC server number).', true);
	}

	if (mode === 'single_alliance' && !allianceTag) {
		return interactionResponse('❌ `alliance_tag` is required for single-alliance mode.', true);
	}

	const memberRoleIds = memberRoles
		? memberRoles.split(',').map((r) => r.trim()).filter(Boolean)
		: [];

	await upsertGuildConfig(env.STFC_DB, {
		guild_id: guildId,
		mode,
		stfc_server: server,
		stfc_region: region,
		alliance_tag: allianceTag ?? null,
		guest_role_id: guestRoleId ?? null,
		member_role_ids: memberRoleIds,
		verification_enabled: true,
	});

	return interactionResponse(
		`✅ Server configured!\n` +
			`• Mode: **${mode}**\n` +
			`• STFC: server **${server}** (${region})\n` +
			(mode === 'single_alliance' ? `• Alliance tag: **${allianceTag}**\n` : '') +
			`• Member roles: ${memberRoleIds.length ? memberRoleIds.join(', ') : 'none yet'}\n` +
			`• Guest role: ${guestRoleId ?? 'not set'}\n\n` +
			`New members will receive a verification DM. They can also run \`/verify\`.`,
		true,
	);
}

async function handleServerStatusCommand(env: Env, guildId: string | undefined): Promise<Response> {
	if (!guildId) {
		return interactionResponse('❌ Run this command inside your server.', true);
	}

	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) {
		return interactionResponse('❌ Server not configured. Run `/server setup` first.', true);
	}

	return interactionResponse(
		`📋 **Server configuration**\n` +
			`• Mode: ${config.mode}\n` +
			`• STFC server: ${config.stfc_server} (${config.stfc_region})\n` +
			`• Alliance tag: ${config.alliance_tag ?? '—'}\n` +
			`• Verification: ${config.verification_enabled ? 'enabled' : 'disabled'}\n` +
			`• Poll interval: ${config.poll_interval_hours}h\n` +
			`• Member roles: ${config.member_role_ids.join(', ') || 'none'}\n` +
			`• Guest role: ${config.guest_role_id ?? 'none'}`,
		true,
	);
}

export async function handleDiscordInteraction(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const signature = request.headers.get('X-Signature-Ed25519');
	const timestamp = request.headers.get('X-Signature-Timestamp');
	const body = await request.text();

	if (!signature || !timestamp || !env.DISCORD_PUBLIC_KEY) {
		return new Response('Unauthorized', { status: 401 });
	}

	if (!verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY)) {
		return new Response('Invalid signature', { status: 401 });
	}

	const interaction = JSON.parse(body);

	if (interaction.type === 1) {
		return Response.json({ type: 1 });
	}

	if (interaction.type === 2) {
		const { data } = interaction;

		if (data.name === 'lookup') {
			const coordinateLink = data.options?.[0]?.value as string | undefined;
			if (!coordinateLink) return interactionResponse('Please provide a coordinate link.', true);

			const coordinates = parseMultipleCoordinates(coordinateLink);
			const parsed = parseCoordinateLink(coordinateLink);
			if (coordinates.length === 0 && !parsed) {
				return interactionResponse('Invalid coordinate format. Expected: [[ALLIANCE] Player S:12345 X:123.456 Y:789.012]', true);
			}
			return interactionResponse(handleCoordinateLookup(coordinateLink));
		}

		if (data.name === 'tablehelp') {
			return interactionResponse(
				`**📊 Table Command Help**\n\n` +
					`• \`/table csv_data:Name,Age\\nJohn,25\`\n` +
					`• Upload a .csv file with the csv_file option (max 1MB)\n` +
					`• Use \\\\n for rows, | for multi-line cells`,
				true,
			);
		}

		if (data.name === 'player') {
			return handlePlayerCommand(env, ctx, interaction, data);
		}

		if (data.name === 'verify') {
			return handleVerifyCommand(env, ctx, interaction, data);
		}

		if (data.name === 'server') {
			const sub = data.options?.[0];
			if (sub?.name === 'setup') {
				return handleServerSetupCommand(env, interaction, sub);
			}
			if (sub?.name === 'status') {
				return handleServerStatusCommand(env, interaction.guild_id);
			}
		}

		if (data.name === 'table') {
			const csvInput = getOptionValue(data.options, 'csv_data') as string | undefined;
			const csvFileOption = data.options?.find((opt) => opt.name === 'csv_file');
			let csvFile = null;
			if (csvFileOption?.value) {
				csvFile = interaction.data.resolved?.attachments?.[String(csvFileOption.value)];
			}

			if (!csvInput && !csvFile) {
				return interactionResponse('Provide csv_data or upload a csv_file. See `/tablehelp`.', true);
			}

			try {
				let csvData = '';
				if (csvFile) {
					if (!csvFile.filename?.toLowerCase().endsWith('.csv')) {
						return interactionResponse('Error: upload a .csv file only.', true);
					}
					if (csvFile.size && csvFile.size > 1048576) {
						return interactionResponse('Error: file too large (max 1MB).', true);
					}
					const fileResponse = await fetch(csvFile.url);
					if (!fileResponse.ok) throw new Error(`HTTP ${fileResponse.status}`);
					csvData = await fileResponse.text();
				} else {
					csvData = csvInput!;
				}

				if (!csvData.trim()) return interactionResponse('Error: empty CSV data.', true);

				const tableData = parseCSV(csvData);
				const columns = autoGenerateColumns(tableData);
				const asciiTable = generateAsciiTable(tableData, columns);

				if (asciiTable.length > 1900) {
					return interactionResponse('Table too large. Reduce data or column widths.', true);
				}
				return interactionResponse('```\n' + asciiTable + '\n```');
			} catch (error) {
				return interactionResponse(
					`Error parsing CSV: ${error instanceof Error ? error.message : 'unknown error'}. See /tablehelp.`,
					true,
				);
			}
		}
	}

	return new Response('Unknown interaction', { status: 400 });
}
