import type { DeployMode, GuildConfig } from './types';

const TESTING_PREFIX = '[TESTING] ';

/** True when guild is in safe setup / dry-run mode. */
export function isDeployTesting(
	config: Pick<GuildConfig, 'deploy_mode'> | null | undefined,
): boolean {
	return config?.deploy_mode === 'testing';
}

export function parseDeployMode(raw: unknown): DeployMode {
	return raw === 'testing' ? 'testing' : 'live';
}

/**
 * Request-scoped testing flag for slash/component replies.
 * Set via {@link withDeployModeContext}. Deferred waitUntil follow-ups should pass
 * `config` into {@link applyTestingPrefix} / editInteractionResponse when needed.
 */
let requestDeployTesting = false;

export function isRequestDeployTesting(): boolean {
	return requestDeployTesting;
}

/** Prefix slash / follow-up content while in testing (idempotent). */
export function applyTestingPrefix(
	content: string,
	config?: Pick<GuildConfig, 'deploy_mode'> | null,
): string {
	if (!content) return content;
	const testing = config != null ? isDeployTesting(config) : isRequestDeployTesting();
	if (!testing) return content;
	if (content.startsWith(TESTING_PREFIX) || content.startsWith('[TESTING]')) return content;
	return `${TESTING_PREFIX}${content}`;
}

export async function withDeployModeContext<T>(
	config: Pick<GuildConfig, 'deploy_mode'> | null | undefined,
	fn: () => Promise<T>,
): Promise<T> {
	const prev = requestDeployTesting;
	requestDeployTesting = isDeployTesting(config);
	try {
		return await fn();
	} finally {
		requestDeployTesting = prev;
	}
}

export function formatDeployModeLine(config: Pick<GuildConfig, 'deploy_mode'>): string {
	if (isDeployTesting(config)) {
		return (
			`• Deploy mode: **testing** — slash replies are prefixed; automated demotions / leave queues are dry-run only; ` +
			`outbound DMs are off (use \`/test-dm\`).\n` +
			`  Go live: \`/server deploy mode:live\``
		);
	}
	return `• Deploy mode: **live**`;
}

/** Production DMs (invites, welcome, CoC, etc.) are blocked in testing — use `/test-dm`. */
export function shouldSkipOutboundDm(
	config: Pick<GuildConfig, 'deploy_mode'> | null | undefined,
): boolean {
	return isDeployTesting(config);
}

export const TESTING_OUTBOUND_DM_SKIP =
	'deploy_mode=testing — outbound DMs disabled (use `/test-dm` to preview)';

/** Human line for cron “would have …” digests. */
export function formatWouldHaveDemotionLine(opts: {
	discordUserId: string;
	playerName?: string | null;
	kind: 'alliance_mismatch' | 'player_missing';
	policy: string;
}): string {
	const name = opts.playerName?.trim() || 'player';
	const action =
		opts.policy === 'yolo' && opts.kind === 'alliance_mismatch'
			? 'demote to guest now'
			: opts.policy === 'yolo' && opts.kind === 'player_missing'
				? 'queue 1h recheck then demote if still gone'
				: 'queue for urgent-channel approval';
	return `• <@${opts.discordUserId}> **${name}** — would **${action}** (${opts.kind})`;
}
