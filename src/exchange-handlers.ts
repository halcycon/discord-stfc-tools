import {
	interactionResponse,
	updateMessageResponse,
	createGuildCategory,
} from './discord-api';
import { requireGuildAdmin, isGuildAdministrator } from './discord-admin';
import {
	disableExchangeResource,
	handleAskAgain,
	handleHelpClaim,
	handleRequestCompleted,
	openNeedRequest,
	cancelNeedRequest,
	registerDonor,
	unregisterDonor,
	createResourceWithSetup,
} from './exchange-service';
import {
	findExchangeResourceBySlug,
	listExchangeResources,
} from './exchange-db';
import { getGuildConfig, upsertGuildConfig } from './guild-db';
import { AuditColor, postAuditLog } from './audit-log';
import type { GuildConfig } from './types';

function getOptionValue(options: Array<{ name: string; value?: unknown }> | undefined, name: string): unknown {
	return options?.find((opt) => opt.name === name)?.value;
}

function actorUserId(interaction: {
	member?: { user?: { id: string } };
	user?: { id: string };
}): string | undefined {
	return interaction.member?.user?.id ?? interaction.user?.id;
}

function parseRoleIds(raw: string | undefined): string[] {
	if (raw === undefined) return [];
	return raw
		.split(',')
		.map((s) => s.trim().replace(/^<@&|>$/g, ''))
		.filter((id) => /^\d{15,20}$/.test(id));
}

export function canManageExchange(
	config: GuildConfig,
	interaction: { member?: { roles?: string[]; permissions?: string } },
): boolean {
	if (isGuildAdministrator(interaction.member?.permissions)) return true;
	const allowed = config.exchange_admin_role_ids;
	if (!allowed.length) return false;
	const roles = interaction.member?.roles ?? [];
	return allowed.some((id) => roles.includes(id));
}

function formatExchangeSetup(config: GuildConfig): string {
	return (
		`📦 **Resource exchange**\n` +
		`• Layout: ${config.exchange_layout ?? 'not set'}\n` +
		`• Hub channel: ${config.exchange_hub_channel_id ? `<#${config.exchange_hub_channel_id}>` : '—'}\n` +
		`• Category: ${config.exchange_category_id ? `<#${config.exchange_category_id}>` : '—'}\n` +
		`• Admins: ${config.exchange_admin_role_ids.map((id) => `<@&${id}>`).join(', ') || 'Administrators only'}`
	);
}

export async function handleExchangeCommand(
	env: Env,
	_ctx: ExecutionContext,
	interaction: {
		guild_id?: string;
		channel_id?: string;
		member?: { permissions?: string; roles?: string[]; user?: { id: string } };
		user?: { id: string };
	},
	data: {
		options?: Array<{
			name: string;
			value?: unknown;
			options?: Array<{ name: string; value?: unknown; options?: Array<{ name: string; value?: unknown }> }>;
		}>;
	},
): Promise<Response> {
	const guildId = interaction.guild_id;
	if (!guildId) return interactionResponse('❌ Run this in a server.', true);

	const config = await getGuildConfig(env.STFC_DB, guildId);
	if (!config) return interactionResponse('❌ Server not configured. Run `/server setup` first.', true);

	const top = data.options?.[0];
	if (!top) return interactionResponse('❌ Missing exchange subcommand.', true);

	// Nested: /exchange resource create → top=resource, nested create
	if (top.name === 'setup') {
		const adminError = requireGuildAdmin(interaction);
		if (adminError) return adminError;

		const layout = getOptionValue(top.options, 'layout') as string | undefined;
		const channelOpt = getOptionValue(top.options, 'channel');
		const categoryOpt = getOptionValue(top.options, 'category');
		const createCategory = getOptionValue(top.options, 'create_category') as boolean | undefined;
		const categoryName = getOptionValue(top.options, 'category_name') as string | undefined;
		const adminRolesRaw = getOptionValue(top.options, 'admin_roles') as string | undefined;
		const clear = getOptionValue(top.options, 'clear') as boolean | undefined;

		const patch: Partial<GuildConfig> & { guild_id: string } = { guild_id: guildId };
		const notes: string[] = [];

		if (clear) {
			patch.exchange_layout = null;
			patch.exchange_hub_channel_id = null;
			patch.exchange_category_id = null;
			notes.push('Cleared exchange setup (existing resources stay until disabled).');
		}

		if (adminRolesRaw !== undefined) {
			patch.exchange_admin_role_ids = parseRoleIds(adminRolesRaw);
		}

		if (layout === 'hub' || layout === 'category') {
			patch.exchange_layout = layout;
		}

		if (createCategory) {
			if (!env.DISCORD_BOT_TOKEN) {
				return interactionResponse('❌ DISCORD_BOT_TOKEN not configured.', true);
			}
			try {
				const cat = await createGuildCategory(
					env.DISCORD_BOT_TOKEN,
					guildId,
					(categoryName || 'Resource Exchange').slice(0, 100),
				);
				patch.exchange_category_id = cat.id;
				patch.exchange_layout = patch.exchange_layout ?? 'category';
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
			patch.exchange_category_id = cat;
			patch.exchange_layout = patch.exchange_layout ?? 'category';
			notes.push(`Linked category <#${cat}>.`);
		}

		if (channelOpt !== undefined && channelOpt !== null) {
			const ch = String(channelOpt);
			if (!/^\d{15,20}$/.test(ch)) {
				return interactionResponse('❌ Invalid channel.', true);
			}
			patch.exchange_hub_channel_id = ch;
			patch.exchange_layout = patch.exchange_layout ?? 'hub';
			notes.push(`Linked hub channel <#${ch}>.`);
		}

		const anyChange =
			clear === true ||
			adminRolesRaw !== undefined ||
			layout !== undefined ||
			createCategory === true ||
			(categoryOpt !== undefined && categoryOpt !== null) ||
			(channelOpt !== undefined && channelOpt !== null);

		if (!anyChange) {
			return interactionResponse(formatExchangeSetup(config), true);
		}

		await upsertGuildConfig(env.STFC_DB, patch);
		const refreshed = await getGuildConfig(env.STFC_DB, guildId);
		await postAuditLog(env, refreshed, {
			title: 'Exchange setup updated',
			description: notes.join(' · ') || formatExchangeSetup(refreshed!),
			actorId: interaction.member?.user?.id ?? interaction.user?.id,
			source: 'admin',
			color: AuditColor.info,
		});
		return interactionResponse(
			`✅ Exchange setup updated.\n${formatExchangeSetup(refreshed!)}` +
				(notes.length ? `\n${notes.map((n) => `• ${n}`).join('\n')}` : ''),
			true,
		);
	}

	if (top.name === 'resource') {
		const sub = top.options?.[0];
		if (!sub) return interactionResponse('❌ Missing resource subcommand.', true);
		if (!canManageExchange(config, interaction)) {
			return interactionResponse(
				'❌ Need Administrator or an exchange admin role (`/exchange setup admin_roles:`).',
				true,
			);
		}

		if (sub.name === 'create') {
			const name = getOptionValue(sub.options, 'name') as string | undefined;
			if (!name?.trim()) return interactionResponse('❌ Provide `name`.', true);
			try {
				const resource = await createResourceWithSetup(env, config, name.trim());
				return interactionResponse(
					`✅ Created **${resource.name}** (\`${resource.slug}\`).\n` +
						`Channel: <#${resource.channel_id}>\n` +
						`Pinned registration message is ready.\n` +
						`Roles: <@&${resource.donor_role_id}> · <@&${resource.recipient_role_id}>\n` +
						`(Bot role must sit **above** these roles.)`,
					true,
				);
			} catch (err) {
				return interactionResponse(
					`❌ ${err instanceof Error ? err.message : 'Failed to create resource'}`,
					true,
				);
			}
		}

		if (sub.name === 'list') {
			const resources = await listExchangeResources(env.STFC_DB, guildId, false);
			if (!resources.length) return interactionResponse('No resources yet.', true);
			const lines = resources.map(
				(r) =>
					`#${r.id} ${r.active ? '✅' : '⛔'} **${r.name}** (\`${r.slug}\`) → <#${r.channel_id}>`,
			);
			return interactionResponse(`📦 **Resources**\n${lines.join('\n')}`, true);
		}

		if (sub.name === 'disable') {
			const id = Number(getOptionValue(sub.options, 'id'));
			const name = getOptionValue(sub.options, 'name') as string | undefined;
			let resourceId = Number.isFinite(id) ? id : NaN;
			if (!Number.isFinite(resourceId) && name) {
				const found = await findExchangeResourceBySlug(env.STFC_DB, guildId, name);
				if (found) resourceId = found.id;
			}
			if (!Number.isFinite(resourceId)) {
				return interactionResponse('❌ Provide resource `id` or `name`.', true);
			}
			const msg = await disableExchangeResource(env, guildId, resourceId);
			return interactionResponse(msg, true);
		}

		return interactionResponse(`❌ Unknown resource subcommand: ${sub.name}`, true);
	}

	const userId = actorUserId(interaction);
	if (!userId) return interactionResponse('❌ Could not resolve your user id.', true);

	if (top.name === 'donate' || top.name === 'undonate' || top.name === 'need') {
		const name = getOptionValue(top.options, 'resource') as string | undefined;
		if (!name?.trim()) return interactionResponse('❌ Provide `resource` name.', true);
		const resource = await findExchangeResourceBySlug(env.STFC_DB, guildId, name.trim());
		if (!resource) return interactionResponse('❌ Resource not found.', true);

		if (interaction.channel_id && resource.channel_id !== interaction.channel_id) {
			// Hub layout: all resources share hub — allow if channel matches resource.channel_id
			// (already checked). Category: must be in that resource's channel.
			return interactionResponse(
				`❌ Use this in <#${resource.channel_id}> (or use the pinned buttons).`,
				true,
			);
		}

		if (top.name === 'donate') {
			return interactionResponse(await registerDonor(env, guildId, resource.id, userId), true);
		}
		if (top.name === 'undonate') {
			return interactionResponse(await unregisterDonor(env, guildId, resource.id, userId), true);
		}
		return interactionResponse(await openNeedRequest(env, guildId, resource.id, userId), true);
	}

	return interactionResponse(`❌ Unknown exchange subcommand: ${top.name}`, true);
}

export async function handleExchangeComponent(
	env: Env,
	_ctx: ExecutionContext,
	interaction: {
		guild_id?: string;
		member?: { permissions?: string; roles?: string[]; user?: { id: string } };
		user?: { id: string };
		data?: { custom_id?: string };
	},
): Promise<Response> {
	const customId = interaction.data?.custom_id ?? '';
	const userId = actorUserId(interaction);
	if (!userId) return interactionResponse('❌ Could not resolve user.', true);

	const donorAdd = customId.match(/^exch:donor:add:(\d+)$/);
	if (donorAdd) {
		const guildId = interaction.guild_id;
		if (!guildId) return interactionResponse('❌ Use this in a server channel.', true);
		return interactionResponse(
			await registerDonor(env, guildId, Number(donorAdd[1]), userId),
			true,
		);
	}

	const donorRem = customId.match(/^exch:donor:rem:(\d+)$/);
	if (donorRem) {
		const guildId = interaction.guild_id;
		if (!guildId) return interactionResponse('❌ Use this in a server channel.', true);
		return interactionResponse(
			await unregisterDonor(env, guildId, Number(donorRem[1]), userId),
			true,
		);
	}

	const needCancel = customId.match(/^exch:need:cancel:(\d+)$/);
	if (needCancel) {
		const guildId = interaction.guild_id;
		if (!guildId) return interactionResponse('❌ Use this in a server channel.', true);
		return interactionResponse(
			await cancelNeedRequest(env, guildId, Number(needCancel[1]), userId),
			true,
		);
	}

	const need = customId.match(/^exch:need:(\d+)$/);
	if (need) {
		const guildId = interaction.guild_id;
		if (!guildId) return interactionResponse('❌ Use this in a server channel.', true);
		return interactionResponse(
			await openNeedRequest(env, guildId, Number(need[1]), userId),
			true,
		);
	}

	// DM offer/follow-up buttons: update the message so the request is visibly dismissed.
	const help = customId.match(/^exch:help:(\d+)$/);
	if (help) {
		return updateMessageResponse(await handleHelpClaim(env, Number(help[1]), userId), {
			components: [],
		});
	}

	if (/^exch:ignore:(\d+)$/.test(customId)) {
		return updateMessageResponse('👍 Ignored — others can still claim.', { components: [] });
	}

	const done = customId.match(/^exch:done:(\d+)$/);
	if (done) {
		return updateMessageResponse(await handleRequestCompleted(env, Number(done[1]), userId), {
			components: [],
		});
	}

	const again = customId.match(/^exch:again:(\d+)$/);
	if (again) {
		// Keep Completed / Ask again — recipient may still finish or re-ping later.
		return interactionResponse(await handleAskAgain(env, Number(again[1]), userId), true);
	}

	return interactionResponse('❌ Unknown exchange button.', true);
}
