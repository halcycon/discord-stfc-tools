import type { GuildConfig } from './types';
import { formatCategoryMap, personalChannelsEnabled } from './channel-utils';
import { diplomacyChannelsEnabled, formatDiplomacyChannelMap } from './diplomacy-channels';
import { defaultNicknameTemplate } from './nickname-utils';

/** Shared server config summary for `/server status` and DM wizard. */
export function formatServerStatus(config: GuildConfig): string {
	return (
		`📋 **Server configuration**\n` +
		`• Mode: ${config.mode}\n` +
		`• STFC server: ${config.stfc_server} (${config.stfc_region})\n` +
		`• Alliance tag: ${config.alliance_tag ?? '—'}\n` +
		`• Nickname template: \`${config.nickname_template?.trim() || defaultNicknameTemplate(config.mode)}\`` +
		`${config.nickname_template?.trim() ? '' : ' (default)'}\n` +
		`• Verification log: ${config.verification_log_channel_id ? `<#${config.verification_log_channel_id}>` : 'not set'}\n` +
		`• Audit log: ${config.audit_log_channel_id ? `<#${config.audit_log_channel_id}>` : 'not set'}\n` +
		`• Diplomacy channels: ${diplomacyChannelsEnabled(config) ? 'enabled' : 'disabled'}` +
		(diplomacyChannelsEnabled(config)
			? ` (${formatDiplomacyChannelMap(config.diplomacy_channel_map)})`
			: '') +
		`\n` +
		`• Verification: ${config.verification_enabled ? 'enabled' : 'disabled'}\n` +
		`• Poll interval: ${config.poll_interval_hours}h\n` +
		`• Member roles: ${config.member_role_ids.join(', ') || 'none'}\n` +
		`• Guest role: ${config.guest_role_id ?? 'none'}\n` +
		`• DM query roles: ${config.dm_query_role_ids.map((id) => `<@&${id}>`).join(', ') || 'Administrators only'}\n` +
		`• DM AI: ${config.dm_ai_enabled ? 'enabled (opt-in)' : 'disabled'}\n` +
		`• Agreement: ${config.agreement_enabled ? `on (${config.agreement_timing}, ${config.agreement_mode})` : 'off'}` +
		(config.agreement_channel_id ? ` → <#${config.agreement_channel_id}>` : '') +
		`\n` +
		`• Personal channels: ${personalChannelsEnabled(config) ? 'enabled' : 'disabled'}\n` +
		`• Category map: ${formatCategoryMap(config.channel_category_map)}\n` +
		`• Channel extra roles: ${config.personal_channel_extra_roles.join(', ') || 'none'}`
	);
}
