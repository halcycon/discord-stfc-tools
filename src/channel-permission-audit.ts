import {
	fetchGuildChannel,
	getBotUserId,
	listGuildChannels,
	isLinkableGuildTextChannel,
	type ChannelPermissionOverwrite,
	type DiscordChannel,
} from './discord-api';
import type { GuildConfig, VerifiedPlayer } from './types';

/** Common Discord permission bits we care about for member channels. */
const PERM_LABELS: Array<{ bit: bigint; label: string }> = [
	{ bit: 0x400n, label: 'View' },
	{ bit: 0x800n, label: 'Send' },
	{ bit: 0x2000n, label: 'ManageMessages' },
	{ bit: 0x4000n, label: 'Embed' },
	{ bit: 0x8000n, label: 'Attach' },
	{ bit: 0x10000n, label: 'History' },
	{ bit: 0x10n, label: 'ManageChannels' },
];

export function decodePermissionBits(bits: string | number | bigint | null | undefined): string[] {
	let value: bigint;
	try {
		value = BigInt(bits ?? 0);
	} catch {
		return [];
	}
	if (value === 0n) return [];
	const labels: string[] = [];
	for (const { bit, label } of PERM_LABELS) {
		if ((value & bit) === bit) labels.push(label);
	}
	if (labels.length === 0 && value !== 0n) labels.push(`other(0x${value.toString(16)})`);
	return labels;
}

export interface ChannelOverwriteAudit {
	id: string;
	type: 0 | 1;
	allow: string;
	deny: string;
	allowLabels: string[];
	denyLabels: string[];
}

export interface ChannelPermissionAuditRow {
	channelId: string;
	channelName: string;
	parentId: string | null;
	linkedDiscordUserId: string | null;
	linkedPlayerName: string | null;
	accessible: boolean;
	error?: string;
	overwrites: ChannelOverwriteAudit[];
	flags: string[];
}

export interface ChannelPermissionAuditReport {
	guildId: string;
	auditedAt: string;
	botUserId: string;
	channelCount: number;
	inaccessibleCount: number;
	flaggedCount: number;
	rows: ChannelPermissionAuditRow[];
	summaryLines: string[];
}

function mapOverwrite(ow: ChannelPermissionOverwrite): ChannelOverwriteAudit {
	return {
		id: ow.id,
		type: ow.type,
		allow: String(ow.allow ?? '0'),
		deny: String(ow.deny ?? '0'),
		allowLabels: decodePermissionBits(ow.allow),
		denyLabels: decodePermissionBits(ow.deny),
	};
}

function buildFlags(
	row: Omit<ChannelPermissionAuditRow, 'flags'>,
	guildId: string,
	botUserId: string,
): string[] {
	const flags: string[] = [];
	if (!row.accessible) {
		flags.push('inaccessible');
		return flags;
	}

	const botOw = row.overwrites.find((o) => o.type === 1 && o.id === botUserId);
	const everyoneOw = row.overwrites.find((o) => o.type === 0 && o.id === guildId);
	const memberOw = row.linkedDiscordUserId
		? row.overwrites.find((o) => o.type === 1 && o.id === row.linkedDiscordUserId)
		: undefined;

	if (!botOw || !botOw.allowLabels.includes('View')) {
		flags.push('bot_missing_view');
	} else if (!botOw.allowLabels.includes('Send')) {
		flags.push('bot_missing_send');
	}

	if (!everyoneOw || !everyoneOw.denyLabels.includes('View')) {
		flags.push('everyone_not_denied_view');
	}

	if (row.linkedDiscordUserId && !memberOw) {
		flags.push('linked_member_no_overwrite');
	} else if (memberOw && !memberOw.allowLabels.includes('View')) {
		flags.push('linked_member_no_view');
	}

	if (row.overwrites.length === 0) {
		flags.push('no_overwrites');
	}

	return flags;
}

function channelsToAudit(
	allChannels: DiscordChannel[],
	config: GuildConfig,
	linkedByChannel: Map<string, VerifiedPlayer>,
): DiscordChannel[] {
	const categoryIds = new Set<string>();
	for (const id of Object.values(config.channel_category_map)) {
		if (/^\d{15,20}$/.test(id)) categoryIds.add(id);
	}
	if (config.personal_channel_archive_category_id) {
		categoryIds.add(config.personal_channel_archive_category_id);
	}

	const byId = new Map(allChannels.map((c) => [c.id, c]));
	const selected = new Map<string, DiscordChannel>();

	for (const [channelId, _player] of linkedByChannel) {
		const ch = byId.get(channelId);
		if (ch && isLinkableGuildTextChannel(ch.type)) selected.set(channelId, ch);
		else if (!ch) {
			// Placeholder — will fetch individually
			selected.set(channelId, {
				id: channelId,
				name: channelId,
				type: 0,
				parent_id: null,
			});
		}
	}

	for (const ch of allChannels) {
		if (!isLinkableGuildTextChannel(ch.type)) continue;
		if (ch.parent_id && categoryIds.has(ch.parent_id)) {
			selected.set(ch.id, ch);
		}
	}

	return [...selected.values()].sort((a, b) =>
		(a.name || a.id).localeCompare(b.name || b.id, undefined, { sensitivity: 'base' }),
	);
}

/**
 * Read-only audit of permission overwrites on linked + member-category channels.
 * Does not modify Discord permissions.
 */
export async function auditPersonalChannelPermissions(
	token: string,
	guildId: string,
	config: GuildConfig,
	linkedPlayers: VerifiedPlayer[],
): Promise<ChannelPermissionAuditReport> {
	const botUserId = await getBotUserId(token);
	const allChannels = await listGuildChannels(token, guildId);
	const linkedByChannel = new Map<string, VerifiedPlayer>();
	for (const p of linkedPlayers) {
		if (p.personal_channel_id) linkedByChannel.set(p.personal_channel_id, p);
	}

	const targets = channelsToAudit(allChannels, config, linkedByChannel);
	const rows: ChannelPermissionAuditRow[] = [];

	for (const target of targets) {
		const linked = linkedByChannel.get(target.id) ?? null;
		let channel = target;
		let accessible = true;
		let error: string | undefined;
		let overwritesRaw = target.permission_overwrites;

		// listGuildChannels usually includes overwrites; fetch if missing or placeholder.
		if (!overwritesRaw || target.name === target.id) {
			const fetched = await fetchGuildChannel(token, target.id);
			if (!fetched.ok) {
				accessible = false;
				error = fetched.error;
			} else {
				channel = fetched.channel;
				overwritesRaw = fetched.channel.permission_overwrites;
			}
		}

		const overwrites = (overwritesRaw ?? []).map(mapOverwrite);
		const base: Omit<ChannelPermissionAuditRow, 'flags'> = {
			channelId: channel.id,
			channelName: channel.name || channel.id,
			parentId: channel.parent_id ?? null,
			linkedDiscordUserId: linked?.discord_user_id ?? null,
			linkedPlayerName: linked?.player_name ?? null,
			accessible,
			error,
			overwrites,
		};
		rows.push({ ...base, flags: buildFlags(base, guildId, botUserId) });
	}

	const inaccessibleCount = rows.filter((r) => !r.accessible).length;
	const flaggedCount = rows.filter((r) => r.flags.length > 0).length;

	const summaryLines = [
		`Channels scanned: **${rows.length}**`,
		`Inaccessible to bot: **${inaccessibleCount}**`,
		`With flags: **${flaggedCount}**`,
		`Bot user: <@${botUserId}>`,
	];

	const flagCounts = new Map<string, number>();
	for (const row of rows) {
		for (const f of row.flags) flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
	}
	if (flagCounts.size > 0) {
		summaryLines.push(
			'Flag counts: ' +
				[...flagCounts.entries()]
					.sort((a, b) => b[1] - a[1])
					.map(([k, n]) => `\`${k}\`×${n}`)
					.join(', '),
		);
	}

	return {
		guildId,
		auditedAt: new Date().toISOString(),
		botUserId,
		channelCount: rows.length,
		inaccessibleCount,
		flaggedCount,
		rows,
		summaryLines,
	};
}

/** Human-readable full report (for audit-log file / long paste). */
export function formatPermissionAuditReportText(report: ChannelPermissionAuditReport): string {
	const guildId = report.guildId;
	const lines: string[] = [
		`Personal channel permission audit`,
		`Guild: ${report.guildId}`,
		`At: ${report.auditedAt}`,
		`Bot: ${report.botUserId}`,
		``,
		...report.summaryLines.map((l) => l.replace(/\*\*/g, '').replace(/<@!?(\d+)>/g, '@$1')),
		``,
	];

	for (const row of report.rows) {
		const link =
			row.linkedPlayerName || row.linkedDiscordUserId
				? ` linked=${row.linkedPlayerName ?? '?'} (${row.linkedDiscordUserId ?? '—'})`
				: ' unlinked';
		const parent = row.parentId ? ` parent=${row.parentId}` : '';
		lines.push(`#${row.channelName} (${row.channelId})${parent}${link}`);
		if (!row.accessible) {
			lines.push(`  ERROR: ${row.error ?? 'inaccessible'}`);
			lines.push('');
			continue;
		}
		if (row.flags.length) lines.push(`  FLAGS: ${row.flags.join(', ')}`);
		if (row.overwrites.length === 0) {
			lines.push(`  (no overwrites)`);
		}
		for (const ow of row.overwrites) {
			const who =
				ow.type === 0 && ow.id === guildId
					? '@everyone'
					: ow.type === 0
						? `role:${ow.id}`
						: `user:${ow.id}`;
			const allow = ow.allowLabels.join('+') || '—';
			const deny = ow.denyLabels.join('+') || '—';
			lines.push(`  ${who} allow=[${allow}] deny=[${deny}]`);
		}
		lines.push('');
	}

	return lines.join('\n');
}

/** Compact Discord message (truncated). */
export function formatPermissionAuditSummaryMessage(
	report: ChannelPermissionAuditReport,
	maxChars = 1800,
): string {
	const header =
		`🔎 **Personal channel permissions audit** (read-only)\n` +
		report.summaryLines.join('\n') +
		`\n\n`;

	const flagged = report.rows.filter((r) => r.flags.length > 0).slice(0, 25);
	const detailLines: string[] = [];
	for (const row of flagged) {
		detailLines.push(
			`• <#${row.channelId}> — ${row.flags.map((f) => `\`${f}\``).join(', ')}` +
				(row.linkedDiscordUserId ? ` → <@${row.linkedDiscordUserId}>` : ''),
		);
	}
	if (flagged.length === 0) {
		detailLines.push('_No flags — overwrites look consistent for scanned channels._');
	} else if (report.flaggedCount > flagged.length) {
		detailLines.push(`_…and ${report.flaggedCount - flagged.length} more flagged (see audit log file)._`);
	}

	detailLines.push(
		`\n_This does **not** sync or rewrite permissions. Full dump posted to the audit log when configured._`,
	);

	let body = header + detailLines.join('\n');
	if (body.length > maxChars) {
		body = body.slice(0, maxChars - 20) + '\n…(truncated)';
	}
	return body;
}
