import { getBotUserId, resolveBotManagedRoleId, type ChannelPermissionOverwrite } from './discord-api';
import { decodePermissionBits } from './channel-permission-audit';
import type { GuildConfig } from './types';

const VIEW_CHANNEL = '1024';
/** View + Send + Embed Links + Attach Files + Read History */
export const DEFAULT_PERSONAL_CHANNEL_MEMBER_ALLOW = String(
	0x400 | 0x800 | 0x4000 | 0x8000 | 0x10000,
);
/**
 * Member messaging bits plus Manage Channels, Manage Permissions (Manage Roles),
 * and Administrator — applied as a **role** overwrite on the bot’s managed guild role
 * (same pattern as other bots like Carl-bot in channel settings → Roles).
 */
export const DEFAULT_PERSONAL_CHANNEL_BOT_ALLOW = String(
	Number(DEFAULT_PERSONAL_CHANNEL_MEMBER_ALLOW) | 0x8 | 0x10 | 0x10000000,
);
const BOT_PERMS = DEFAULT_PERSONAL_CHANNEL_BOT_ALLOW;
const MEMBER_PERMS = DEFAULT_PERSONAL_CHANNEL_MEMBER_ALLOW;

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

/**
 * Clone the built-in default (or an existing template) and attach staff/viewer roles.
 * Role allow bits match the member slot (or `roleAllow` if provided).
 * Use this when you have not locked a sample channel — pair with `/server channels extra-roles`.
 */
export function withExtraRolesOnPersonalChannelPermTemplate(
	roleIds: string[],
	base: PersonalChannelPermTemplate | null = null,
	roleAllow?: string,
): PersonalChannelPermTemplate {
	const t = base
		? {
				...base,
				everyone: { ...base.everyone },
				bot: { ...base.bot },
				member: { ...base.member },
			}
		: defaultPersonalChannelPermTemplate();
	const allow = roleAllow ?? t.member.allow;
	const seen = new Set<string>();
	const roles: PersonalChannelRolePerm[] = [];
	for (const raw of roleIds) {
		const role_id = String(raw);
		if (!/^\d{15,20}$/.test(role_id) || seen.has(role_id)) continue;
		seen.add(role_id);
		roles.push({ role_id, allow, deny: '0' });
	}
	return { ...t, roles };
}

/**
 * Template used for create/link/show: locked sample if set; otherwise built-in default
 * with `personal_channel_extra_roles` filled in. Locked templates with an empty role
 * list also pick up extra-roles (same bits as the member slot).
 */
export function effectivePersonalChannelPermTemplate(
	config: Pick<GuildConfig, 'personal_channel_perm_template' | 'personal_channel_extra_roles'>,
): PersonalChannelPermTemplate {
	const locked = config.personal_channel_perm_template;
	if (locked && locked.roles.length > 0) return locked;
	return withExtraRolesOnPersonalChannelPermTemplate(
		config.personal_channel_extra_roles,
		locked,
	);
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
	opts?: { locked?: boolean },
): string {
	const t = template ?? defaultPersonalChannelPermTemplate();
	const isDefault = opts?.locked === false || template == null;
	const lines = [
		isDefault
			? '📋 **Permission template:** built-in default (not locked from a channel)'
			: '📋 **Permission template:** locked-in',
		t.source_channel_id ? `• Source channel: <#${t.source_channel_id}>` : '• Source channel: —',
		!isDefault && t.captured_at ? `• Captured: ${t.captured_at}` : null,
		!isDefault && t.captured_by ? `• By: <@${t.captured_by}>` : null,
		`• @everyone: ${bitsLabel(t.everyone)}`,
		`• Bot role (slot): ${bitsLabel(t.bot)}`,
		`• Member (slot): ${bitsLabel(t.member)}`,
		t.roles.length
			? `• Roles (${t.roles.length}):\n` +
				t.roles.map((r) => `  – <@&${r.role_id}>: ${bitsLabel(r)}`).join('\n')
			: '• Roles: none — set `/server channels extra-roles` (no sample channel needed)',
	].filter(Boolean);
	return lines.join('\n');
}

/** Format the effective template for a guild (locked or default + extra-roles). */
export function formatEffectivePersonalChannelPermTemplate(
	config: Pick<GuildConfig, 'personal_channel_perm_template' | 'personal_channel_extra_roles'>,
): string {
	const locked = Boolean(config.personal_channel_perm_template);
	return formatPersonalChannelPermTemplate(effectivePersonalChannelPermTemplate(config), {
		locked,
	});
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
	const botUserOw = overwrites.find((o) => o.type === 1 && o.id === botUserId);
	const botRoleOw = overwrites.find((o) => o.type === 0 && o.id === botUserId);
	const memberOw = overwrites.find((o) => o.type === 1 && o.id === memberUserId);
	const botOw = botRoleOw ?? botUserOw;

	const roles: PersonalChannelRolePerm[] = [];
	for (const ow of overwrites) {
		if (ow.type !== 0) continue;
		if (ow.id === guildId) continue;
		// Bot's managed guild role shares the bot user snowflake — keep in bot slot, not staff roles.
		if (ow.id === botUserId) continue;
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
	const botRoleId = await resolveBotManagedRoleId(token, guildId, botUserId);
	const template = effectivePersonalChannelPermTemplate(config);

	const overwrites: ChannelPermissionOverwrite[] = [
		// Bot managed role first (Roles list in Discord UI) — same pattern as Carl-bot.
		// Do not also set a member overwrite for the bot user: one overwrite per snowflake.
		{
			id: botRoleId,
			type: 0,
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

	for (const role of template.roles) {
		if (!/^\d{15,20}$/.test(role.role_id)) continue;
		if (role.role_id === botRoleId || role.role_id === botUserId) continue;
		overwrites.push({
			id: role.role_id,
			type: 0,
			allow: role.allow,
			deny: role.deny,
		});
	}

	return overwrites;
}
