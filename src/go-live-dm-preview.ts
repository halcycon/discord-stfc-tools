/**
 * Litmus test for deploy_mode testing → live: who would receive automated DMs.
 */
import { needsAgreementBeforeFullAccess } from './agreement';
import {
	getMembersNeedingInvite,
	listPlayersNeedingWelcomeDm,
} from './guild-db';
import type { GuildConfig, GuildMemberRecord, VerifiedPlayer } from './types';
import { WELCOME_DM_MAX_AUTO_ATTEMPTS, welcomeDmConfigured } from './welcome-dm';

const LIST_CAP = 12;
const PREVIEW_SOFT_MAX = 1800;

export type GoLiveDmPreview = {
	inviteCount: number;
	welcomeCount: number;
	invites: GuildMemberRecord[];
	welcomes: VerifiedPlayer[];
	welcomeConfigured: boolean;
	verificationEnabled: boolean;
	/** When channel_panel, join invite DMs are not sent. */
	inviteMode: GuildConfig['verification_invite_mode'];
};

export async function collectGoLiveDmPreview(
	db: D1Database,
	config: GuildConfig,
): Promise<GoLiveDmPreview> {
	const verificationEnabled = Boolean(config.verification_enabled);
	const inviteMode = config.verification_invite_mode ?? 'dm';
	const invites =
		verificationEnabled && inviteMode === 'dm'
			? await getMembersNeedingInvite(db, config.guild_id)
			: [];

	const welcomeConfigured = welcomeDmConfigured(config);
	let welcomes: VerifiedPlayer[] = [];
	if (welcomeConfigured) {
		const candidates = await listPlayersNeedingWelcomeDm(
			db,
			config.guild_id,
			WELCOME_DM_MAX_AUTO_ATTEMPTS,
		);
		welcomes = candidates.filter((p) => !needsAgreementBeforeFullAccess(config, p));
	}

	return {
		inviteCount: invites.length,
		welcomeCount: welcomes.length,
		invites,
		welcomes,
		welcomeConfigured,
		verificationEnabled,
		inviteMode,
	};
}

function formatUserLines(
	rows: Array<{ discord_user_id: string; label: string }>,
	cap = LIST_CAP,
): string {
	if (rows.length === 0) return '_none_';
	const shown = rows.slice(0, cap);
	const lines = shown.map((r) => `• <@${r.discord_user_id}> ${r.label}`);
	if (rows.length > cap) {
		lines.push(`• …and **${rows.length - cap}** more`);
	}
	return lines.join('\n');
}

/** Ephemeral-friendly go-live DM backlog (Discord 2000-char replies). */
export function formatGoLiveDmPreview(preview: GoLiveDmPreview): string {
	const inviteNote = !preview.verificationEnabled
		? '_Verification disabled — no invite DMs._'
		: preview.inviteMode === 'channel_panel'
			? '_Invite mode is **channel_panel** — no auto join invite DMs (members use Start verification)._'
			: preview.inviteCount === 0
				? '_None pending._'
				: formatUserLines(
						preview.invites.map((m) => ({
							discord_user_id: m.discord_user_id,
							label: m.username?.trim() || m.discord_user_id,
						})),
					);

	const welcomeNote = !preview.welcomeConfigured
		? '_Welcome DM not configured — skipped._'
		: preview.welcomeCount === 0
			? '_None pending._'
			: formatUserLines(
					preview.welcomes.map((p) => ({
						discord_user_id: p.discord_user_id,
						label: p.player_name?.trim() || p.discord_user_id,
					})),
				);

	const total = preview.inviteCount + preview.welcomeCount;
	const headline =
		total === 0
			? 'When you go **live**, **no** automated DMs are queued from current D1 state.'
			: `When you go **live**, **${total}** user(s) have automated DMs pending:`;

	let body =
		`📬 **Go-live DM preview**\n` +
		`${headline}\n\n` +
		`**Verification invites** (${preview.inviteCount}) — next member poll (≤5 min after live)\n` +
		`${inviteNote}\n\n` +
		`**Welcome DMs** (${preview.welcomeCount}) — same member poll (≤5 min; batches of 40 if large)\n` +
		`${welcomeNote}\n\n` +
		`_Not included: CoC / consent DMs (those fire on verify/join flows, not a go-live backlog). ` +
		`Exclude list + already verified/guest members are skipped for invites. ` +
		`Morning sync still retries any leftover welcomes._`;

	if (body.length > PREVIEW_SOFT_MAX) {
		body =
			`📬 **Go-live DM preview**\n` +
			`${headline}\n\n` +
			`**Verification invites:** **${preview.inviteCount}** (next member poll ≤5 min)\n` +
			`**Welcome DMs:** **${preview.welcomeCount}** (same poll ≤5 min)\n\n` +
			`_List truncated for Discord length — counts are complete. ` +
			`CoC/consent DMs are not a go-live backlog._`;
	}
	return body;
}
