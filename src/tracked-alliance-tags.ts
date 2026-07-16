/**
 * Parse / normalize multi-alliance tracked tag lists.
 */
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
