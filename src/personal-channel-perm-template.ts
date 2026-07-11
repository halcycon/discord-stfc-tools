import { getBotUserId, type ChannelPermissionOverwrite } from './discord-api';
import { decodePermissionBits } from './channel-permission-audit';
import type { GuildConfig } from './types';

const VIEW_CHANNEL = '1024';
const MEMBER_PERMS = String(0x400 | 0x800 | 0x10000);
const BOT_PERMS = String(0x400 | 0x800 | 0x4000 | 0x8000 | 0x10000);

export interface PermBits {
	allow: string;
	deny: string;
}

export interface PersonalChannelRolePerm {
	role_id: string;
	allow: string;
	deny: string;
}

/**
 * Locked-in overwrite pattern for new/linked personal channels.
 * Member/bot IDs are slots — filled at apply time.
 */
export interface PersonalChannelPermTemplate {
	version: 1;
	everyone: PermBits;
	bot: PermBits;
	member: PermBits;
	roles: PersonalChannelRolePerm[];
	source_channel_id: string | null;
	captured_at: string;
	captured_by: string | null;
}

export function defaultPersonalChannelPermTemplate(): PersonalChannelPermTemplate {
	return {
		version: 1,
		everyone: { allow: '0', deny: VIEW_CHANNEL },
		bot: { allow: BOT_PERMS, deny: '0' },
		member: { allow: MEMBER_PERMS, deny: '0' },
		roles: [],
		source_channel_id: null,
		captured_at: new Date().toISOString(),
		captured_by: null,
	};
}

export function parsePersonalChannelPermTemplate(
	raw: string | null | undefined,
): PersonalChannelPermTemplate | null {
	if (!raw?.trim()) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<PersonalChannelPermTemplate>;
		if (parsed.version !== 1 || !parsed.everyone || !parsed.bot || !parsed.member) return null;
		return {
			version: 1,
			everyone: {
				allow: String(parsed.everyone.allow ?? '0'),
				deny: String(parsed.everyone.deny ?? '0'),
			},
			bot: {
				allow: String(parsed.bot.allow ?? '0'),
				deny: String(parsed.bot.deny ?? '0'),
			},
			member: {
				allow: String(parsed.member.allow ?? '0'),
				deny: String(parsed.member.deny ?? '0'),
			},
			roles: Array.isArray(parsed.roles)
				? parsed.roles
						.filter((r) => r && /^\d{15,20}$/.test(String(r.role_id)))
						.map((r) => ({
							role_id: String(r.role_id),
							allow: String(r.allow ?? '0'),
							deny: String(r.deny ?? '0'),
						}))
				: [],
			source_channel_id: parsed.source_channel_id ? String(parsed.source_channel_id) : null,
			captured_at: parsed.captured_at ? String(parsed.captured_at) : new Date().toISOString(),
			captured_by: parsed.captured_by ? String(parsed.captured_by) : null,
		};
	} catch {
		return null;
	}
}

function bitsLabel(bits: PermBits): string {
	const allow = decodePermissionBits(bits.allow).join('+') || '—';
	const deny = decodePermissionBits(bits.deny).join('+') || '—';
	return `allow [${allow}] deny [${deny}]`;
}

export function formatPersonalChannelPermTemplate(
	template: PersonalChannelPermTemplate | null,
): string {
	const t = template ?? defaultPersonalChannelPermTemplate();
	const isDefault = !template;
	const lines = [
		isDefault
			? '📋 **Permission template:** built-in default (not locked from a channel)'
			: '📋 **Permission template:** locked-in',
		t.source_channel_id ? `• Source channel: <#${t.source_channel_id}>` : '• Source channel: —',
		t.captured_at ? `• Captured: ${t.captured_at}` : null,
		t.captured_by ? `• By: <@${t.captured_by}>` : null,
		`• @everyone: ${bitsLabel(t.everyone)}`,
		`• Bot (slot): ${bitsLabel(t.bot)}`,
		`• Member (slot): ${bitsLabel(t.member)}`,
		t.roles.length
			? `• Roles (${t.roles.length}):\n` +
				t.roles.map((r) => `  – <@&${r.role_id}>: ${bitsLabel(r)}`).join('\n')
			: '• Roles: none (only @everyone + bot + member)',
	].filter(Boolean);
	return lines.join('\n');
}

/**
 * Capture a template from an existing channel's overwrites.
 * `memberUserId` identifies which user overwrite is the channel owner slot.
 */
export function capturePersonalChannelPermTemplate(opts: {
	guildId: string;
	botUserId: string;
	memberUserId: string;
	channelId: string;
	overwrites: ChannelPermissionOverwrite[];
	capturedBy?: string | null;
}): PersonalChannelPermTemplate {
	const { guildId, botUserId, memberUserId, channelId, overwrites, capturedBy } = opts;
	const defaults = defaultPersonalChannelPermTemplate();

	const everyoneOw = overwrites.find((o) => o.type === 0 && o.id === guildId);
	const botOw = overwrites.find((o) => o.type === 1 && o.id === botUserId);
	const memberOw = overwrites.find((o) => o.type === 1 && o.id === memberUserId);

	const roles: PersonalChannelRolePerm[] = [];
	for (const ow of overwrites) {
		if (ow.type !== 0) continue;
		if (ow.id === guildId) continue;
		if (!/^\d{15,20}$/.test(ow.id)) continue;
		roles.push({
			role_id: ow.id,
			allow: String(ow.allow ?? '0'),
			deny: String(ow.deny ?? '0'),
		});
	}

	return {
		version: 1,
		everyone: everyoneOw
			? { allow: String(everyoneOw.allow ?? '0'), deny: String(everyoneOw.deny ?? '0') }
			: defaults.everyone,
		bot: botOw
			? { allow: String(botOw.allow ?? '0'), deny: String(botOw.deny ?? '0') }
			: defaults.bot,
		member: memberOw
			? { allow: String(memberOw.allow ?? '0'), deny: String(memberOw.deny ?? '0') }
			: defaults.member,
		roles,
		source_channel_id: channelId,
		captured_at: new Date().toISOString(),
		captured_by: capturedBy ?? null,
	};
}

/** Resolve template (or default) into concrete overwrites for a target member. */
export async function buildOverwritesFromTemplate(
	token: string,
	guildId: string,
	memberUserId: string,
	config: GuildConfig,
): Promise<ChannelPermissionOverwrite[]> {
	const botUserId = await getBotUserId(token);
	const template = config.personal_channel_perm_template ?? defaultPersonalChannelPermTemplate();

	const overwrites: ChannelPermissionOverwrite[] = [
		// Bot first — never lock ourselves out when denying @everyone.
		{
			id: botUserId,
			type: 1,
			allow: template.bot.allow,
			deny: template.bot.deny,
		},
		{
			id: guildId,
			type: 0,
			allow: template.everyone.allow,
			deny: template.everyone.deny,
		},
		{
			id: memberUserId,
			type: 1,
			allow: template.member.allow,
			deny: template.member.deny,
		},
	];

	const roleIds =
		template.roles.length > 0
			? template.roles
			: config.personal_channel_extra_roles.map((role_id) => ({
					role_id,
					allow: MEMBER_PERMS,
					deny: '0',
				}));

	for (const role of roleIds) {
		if (!/^\d{15,20}$/.test(role.role_id)) continue;
		overwrites.push({
			id: role.role_id,
			type: 0,
			allow: role.allow,
			deny: role.deny,
		});
	}

	return overwrites;
}
