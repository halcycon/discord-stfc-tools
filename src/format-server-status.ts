import type { GuildConfig } from './types';
import { formatCategoryMap, personalChannelsEnabled } from './channel-utils';
import { diplomacyChannelsEnabled, formatDiplomacyChannelMap } from './diplomacy-channels';
import { defaultNicknameTemplate } from './nickname-utils';
import { formatDeployModeLine } from './deploy-mode';
import { BOT_VERSION } from './version';

/** Shared server config summary for `/server status` and DM wizard. */
export function formatServerStatus(config: GuildConfig): string {
	return (
		`📋 **Server configuration** (bot v${BOT_VERSION})\n` +
		`• Mode: ${config.mode}\n` +
		`• STFC server: ${config.stfc_server} (${config.stfc_region})\n` +
		`• Alliance tag: ${config.alliance_tag ?? '—'}` +
		(config.stfc_alliance_id ? ` (id \`${config.stfc_alliance_id}\`)` : '') +
		`\n` +
		`• Nickname template: \`${config.nickname_template?.trim() || defaultNicknameTemplate(config.mode)}\`` +
		`${config.nickname_template?.trim() ? '' : ' (default)'}\n` +
		`• Nickname ranks: ${config.nickname_display_ranks.join(', ') || 'all'}\n` +
		`• Verification log: ${config.verification_log_channel_id ? `<#${config.verification_log_channel_id}>` : 'not set'}\n` +
		`• Audit log: ${config.audit_log_channel_id ? `<#${config.audit_log_channel_id}>` : 'not set'}\n` +
		`• Urgent alerts: ${config.urgent_notify_channel_id ? `<#${config.urgent_notify_channel_id}>` : 'not set'}\n` +
		`${formatDeployModeLine(config)}\n` +
		`• Demotion policy: **${config.demotion_policy}**` +
		(config.demotion_policy === 'approval'
			? ' (confirm leaves in urgent channel)'
			: ' (auto guest on leave; missing players recheck after 1h)') +
		`\n` +
		`• Diplomacy channels: ${diplomacyChannelsEnabled(config) ? 'enabled' : 'disabled'}` +
		(diplomacyChannelsEnabled(config)
			? ` (${formatDiplomacyChannelMap(config.diplomacy_channel_map)})`
			: '') +
		`\n` +
		(config.mode === 'multi_alliance'
			? `• Defer untracked Admiral roles: ${config.defer_untracked_admiral_roles ? 'on' : 'off'}\n`
			: '') +
		`• Verification: ${config.verification_enabled ? 'enabled' : 'disabled'}\n` +
		`• Invite DM on join: **${config.verification_invite_mode === 'channel_panel' ? 'off' : 'on'}**` +
		` (\`${config.verification_invite_mode}\`)` +
		(config.verify_panel_channel_id ? ` → <#${config.verify_panel_channel_id}>` : '') +
		`\n` +
		`• Demotion notify: **${config.demotion_notify}**\n` +
		`• Poll interval: ${config.poll_interval_hours}h\n` +
		`• Member roles: ${config.member_role_ids.join(', ') || 'none'}\n` +
		`• Guest role: ${config.guest_role_id ?? 'none'}\n` +
		`• DM query roles: ${config.dm_query_role_ids.map((id) => `<@&${id}>`).join(', ') || 'Administrators only'}\n` +
		`• DM AI: ${config.dm_ai_enabled ? 'enabled (opt-in)' : 'disabled'}\n` +
		`• Data consent: ${config.data_consent_enabled ? `on (v${config.data_consent_version ?? '1'})` : 'off'}\n` +
		`• CoC agreement: ${config.agreement_enabled ? `on (${config.agreement_timing}, ${config.agreement_mode})` : 'off'}` +
		(config.agreement_channel_id ? ` → <#${config.agreement_channel_id}>` : '') +
		`\n` +
		`• Personal channels: ${personalChannelsEnabled(config) ? 'enabled' : 'disabled'}\n` +
		`• Category map: ${formatCategoryMap(config.channel_category_map)}\n` +
		`• Channel extra roles: ${config.personal_channel_extra_roles.join(', ') || 'none'}`
	);
}
