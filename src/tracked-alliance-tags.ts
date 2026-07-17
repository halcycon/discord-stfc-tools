/**
 * Parse / normalize multi-alliance tracked tag lists + leadership-track helpers.
 */
import { normalizeAllianceRank } from './nickname-utils';
import type { GuildConfig } from './types';

export function parseTrackedAllianceTags(
	raw: string | string[] | null | undefined,
): string[] {
	let parts: string[] = [];
	if (Array.isArray(raw)) {
		parts = raw.map(String);
	} else if (typeof raw === 'string' && raw.trim()) {
		const trimmed = raw.trim();
		if (trimmed.startsWith('[')) {
			try {
				const parsed = JSON.parse(trimmed);
				if (Array.isArray(parsed)) parts = parsed.map(String);
			} catch {
				parts = trimmed.split(/[,|]/);
			}
		} else {
			parts = trimmed.split(/[,|]/);
		}
	}
	const out: string[] = [];
	const seen = new Set<string>();
	for (const p of parts) {
		const t = p.trim().toUpperCase();
		if (!t || seen.has(t)) continue;
		seen.add(t);
		out.push(t);
	}
	return out;
}

/**
 * Alliances that count as "tracked" for Admiral role + diplomacy deferral.
 * Explicit `/alliance track` list ∪ diplomacy channel map — not "any verified tag"
 * (otherwise the first verify would mark the alliance tracked).
 */
export function isAllianceExplicitlyTracked(
	config: Pick<GuildConfig, 'tracked_alliance_tags' | 'diplomacy_channel_map'>,
	allianceTag: string | null | undefined,
): boolean {
	const tag = allianceTag?.trim().toUpperCase();
	if (!tag) return false;
	for (const t of config.tracked_alliance_tags ?? []) {
		if (t.trim().toUpperCase() === tag) return true;
	}
	for (const key of Object.keys(config.diplomacy_channel_map ?? {})) {
		if (key.trim().toUpperCase() === tag) return true;
	}
	return false;
}

/** Skip Admiral roles/overlays when flag on, multi mode, rank Admiral, tag untracked. */
export function shouldDeferUntrackedAdmiralRoles(
	config: Pick<
		GuildConfig,
		| 'mode'
		| 'defer_untracked_admiral_roles'
		| 'tracked_alliance_tags'
		| 'diplomacy_channel_map'
	>,
	allianceTag: string | null | undefined,
	playerRank: string | null | undefined,
): boolean {
	if (!config.defer_untracked_admiral_roles) return false;
	if (config.mode !== 'multi_alliance') return false;
	if (normalizeAllianceRank(playerRank) !== 'Admiral') return false;
	if (!allianceTag?.trim()) return false;
	return !isAllianceExplicitlyTracked(config, allianceTag);
}

/** Defer diplomacy channel create for untracked tags when the admiral-defer flag is on. */
export function shouldDeferUntrackedDiplomacy(
	config: Pick<
		GuildConfig,
		| 'mode'
		| 'defer_untracked_admiral_roles'
		| 'tracked_alliance_tags'
		| 'diplomacy_channel_map'
	>,
	allianceTag: string | null | undefined,
): boolean {
	if (!config.defer_untracked_admiral_roles) return false;
	if (config.mode !== 'multi_alliance') return false;
	if (!allianceTag?.trim()) return false;
	return !isAllianceExplicitlyTracked(config, allianceTag);
}
