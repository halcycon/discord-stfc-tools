import { latinizePlayerName } from './name-latinize';

/** Letter keys for personal-channel buckets: A–Z then # (non-alphabetic). */
export const LETTER_KEYS = [
	'A',
	'B',
	'C',
	'D',
	'E',
	'F',
	'G',
	'H',
	'I',
	'J',
	'K',
	'L',
	'M',
	'N',
	'O',
	'P',
	'Q',
	'R',
	'S',
	'T',
	'U',
	'V',
	'W',
	'X',
	'Y',
	'Z',
	'#',
] as const;

export type LetterKey = (typeof LETTER_KEYS)[number];

export const DEFAULT_SOFT_LIMIT = 45;
export const DEFAULT_CATEGORY_NAME_TEMPLATE = 'Member Channels {range}';

/** Index of a letter key in A–Z–# order (# is last). */
export function letterKeyIndex(key: LetterKey): number {
	if (key === '#') return 26;
	return key.charCodeAt(0) - 65;
}

/** First-letter bucket for a player/channel name. Non A–Z → `#`. */
export function letterKeyForName(name: string): LetterKey {
	const latin = latinizePlayerName(name).trim();
	const c = latin.charAt(0).toUpperCase();
	if (c >= 'A' && c <= 'Z') return c as LetterKey;
	return '#';
}

export function emptyLetterCounts(): Record<LetterKey, number> {
	const counts = {} as Record<LetterKey, number>;
	for (const key of LETTER_KEYS) counts[key] = 0;
	return counts;
}

export function buildLetterHistogram(names: string[]): Record<LetterKey, number> {
	const counts = emptyLetterCounts();
	for (const name of names) {
		if (!name?.trim()) continue;
		counts[letterKeyForName(name)]++;
	}
	return counts;
}

export function formatLetterRange(start: LetterKey, end: LetterKey): string {
	return start === end ? start : `${start}-${end}`;
}

/** Parse `A-F`, `M`, or `N-#` into start/end keys. */
export function parseLetterRange(range: string): { start: LetterKey; end: LetterKey } | null {
	const raw = range.trim().toUpperCase();
	if (!raw) return null;
	const parts = raw.split('-');
	if (parts.length === 1) {
		const key = parts[0] as LetterKey;
		if (!LETTER_KEYS.includes(key)) return null;
		return { start: key, end: key };
	}
	if (parts.length !== 2) return null;
	const start = parts[0] as LetterKey;
	const end = parts[1] as LetterKey;
	if (!LETTER_KEYS.includes(start) || !LETTER_KEYS.includes(end)) return null;
	if (letterKeyIndex(start) > letterKeyIndex(end)) return null;
	return { start, end };
}

export function letterInRange(letter: LetterKey, start: LetterKey, end: LetterKey): boolean {
	const i = letterKeyIndex(letter);
	return i >= letterKeyIndex(start) && i <= letterKeyIndex(end);
}

export interface PlannedBucket {
	range: string;
	start: LetterKey;
	end: LetterKey;
	count: number;
}

export interface CategoryPlan {
	softLimit: number;
	total: number;
	categoryCount: number;
	buckets: PlannedBucket[];
	warnings: string[];
}

function evenTargets(total: number, k: number): number[] {
	const base = Math.floor(total / k);
	const extra = total % k;
	return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

export type PlanCategoryBucketsOptions = {
	/**
	 * Do not plan fewer buckets than this (sticky splits).
	 * Used so raising soft_limit later does not merge existing diplomacy categories.
	 */
	minBuckets?: number;
};

/**
 * Plan contiguous A–Z–# letter ranges that stay under softLimit and split
 * fairly evenly (e.g. 50 players → two ~25 buckets, not 45+5).
 */
export function planCategoryBuckets(
	counts: Record<LetterKey, number>,
	softLimit: number = DEFAULT_SOFT_LIMIT,
	opts?: PlanCategoryBucketsOptions,
): CategoryPlan {
	const limit = Number.isFinite(softLimit) && softLimit > 0 ? Math.floor(softLimit) : DEFAULT_SOFT_LIMIT;
	const warnings: string[] = [];
	let total = 0;
	for (const key of LETTER_KEYS) {
		const n = counts[key] ?? 0;
		total += n;
		if (n > limit) {
			warnings.push(
				`Letter ${key} alone has ${n} channels (soft limit ${limit}); contiguous splits cannot fix this.`,
			);
		}
	}

	if (total === 0) {
		return {
			softLimit: limit,
			total: 0,
			categoryCount: 1,
			buckets: [{ range: 'A-#', start: 'A', end: '#', count: 0 }],
			warnings,
		};
	}

	const minBuckets =
		opts?.minBuckets != null && Number.isFinite(opts.minBuckets)
			? Math.max(1, Math.floor(opts.minBuckets))
			: 1;
	const k = Math.max(1, Math.ceil(total / limit), minBuckets);
	const targets = evenTargets(total, k);
	const n = LETTER_KEYS.length;
	const prefix: number[] = [0];
	for (const key of LETTER_KEYS) {
		prefix.push(prefix[prefix.length - 1] + (counts[key] ?? 0));
	}
	const rangeCount = (from: number, to: number) => prefix[to + 1] - prefix[from];

	const buckets: PlannedBucket[] = [];
	let startIdx = 0;

	for (let b = 0; b < k; b++) {
		const remainingBuckets = k - b;
		const isLast = remainingBuckets === 1;
		const maxEnd = n - remainingBuckets; // leave one letter per remaining bucket after this
		const target = targets[b];
		let endIdx = startIdx;
		let bestEnd = startIdx;

		if (isLast) {
			endIdx = n - 1;
		} else {
			for (let end = startIdx; end <= maxEnd; end++) {
				const c = rangeCount(startIdx, end);
				bestEnd = end;
				// Prefer reaching the even target without exceeding soft limit.
				if (c >= target && c <= limit) {
					endIdx = end;
					break;
				}
				if (c > limit && end > startIdx) {
					// Step back one letter if possible.
					endIdx = end - 1;
					break;
				}
				endIdx = end;
				if (c >= target) break;
			}
			// Ensure we leave enough letters for remaining buckets.
			endIdx = Math.min(endIdx, maxEnd);
			if (endIdx < startIdx) endIdx = startIdx;
			// If still over limit with a multi-letter bucket, shrink (single oversize letter keeps warning).
			while (endIdx > startIdx && rangeCount(startIdx, endIdx) > limit) {
				endIdx--;
			}
			void bestEnd;
		}

		// Absorb trailing empty letters into this bucket so ranges read A-M / N-#
		// rather than A / B-# when B–M have no players.
		if (!isLast) {
			while (endIdx < maxEnd) {
				const next = endIdx + 1;
				if ((counts[LETTER_KEYS[next]] ?? 0) > 0) break;
				if (n - (next + 1) < remainingBuckets - 1) break;
				endIdx = next;
			}
		}

		const start = LETTER_KEYS[startIdx];
		const end = LETTER_KEYS[endIdx];
		buckets.push({
			range: formatLetterRange(start, end),
			start,
			end,
			count: rangeCount(startIdx, endIdx),
		});
		startIdx = endIdx + 1;
	}

	// Absorb any leftover letters into the last bucket (should not happen).
	if (startIdx < n && buckets.length > 0) {
		const last = buckets[buckets.length - 1];
		last.end = '#';
		last.range = formatLetterRange(last.start, last.end);
		last.count = rangeCount(letterKeyIndex(last.start), n - 1);
	}

	return {
		softLimit: limit,
		total,
		categoryCount: buckets.length,
		buckets,
		warnings,
	};
}

export function applyCategoryNameTemplate(template: string, range: string): string {
	const name = template.replaceAll('{range}', range).trim() || DEFAULT_CATEGORY_NAME_TEMPLATE.replace('{range}', range);
	return name.slice(0, 100);
}

/** Prefix before `{range}` — used to recognize prior rebalance categories by name. */
export function categoryNameTemplatePrefix(template: string): string {
	const raw = template.trim() || DEFAULT_CATEGORY_NAME_TEMPLATE;
	const idx = raw.indexOf('{range}');
	if (idx <= 0) return 'Member Channels ';
	return raw.slice(0, idx);
}

/** Human-readable plan summary for Discord. */
export function formatCategoryPlan(plan: CategoryPlan, opts?: { title?: string }): string {
	const title = opts?.title ?? 'Personal channel plan';
	const lines = plan.buckets.map(
		(b) => `• \`${b.range}\` — ${b.count} channel${b.count === 1 ? '' : 's'}`,
	);
	const warn =
		plan.warnings.length > 0 ? `\n\n⚠ ${plan.warnings.join('\n⚠ ')}` : '';
	return (
		`📋 **${title}**\n` +
		`• Total: ${plan.total}\n` +
		`• Soft limit: ${plan.softLimit}\n` +
		`• Categories: ${plan.categoryCount}\n` +
		lines.join('\n') +
		warn
	);
}

/**
 * Sort existing category map entries by range start (A–Z–# order).
 * Invalid ranges are dropped.
 */
export function sortedCategoryMapEntries(
	map: Record<string, string>,
): Array<{ range: string; start: LetterKey; end: LetterKey; categoryId: string }> {
	const out: Array<{ range: string; start: LetterKey; end: LetterKey; categoryId: string }> = [];
	for (const [range, categoryId] of Object.entries(map)) {
		const parsed = parseLetterRange(range);
		if (!parsed || !/^\d{15,20}$/.test(categoryId)) continue;
		out.push({ range: formatLetterRange(parsed.start, parsed.end), ...parsed, categoryId });
	}
	out.sort((a, b) => letterKeyIndex(a.start) - letterKeyIndex(b.start));
	return out;
}
