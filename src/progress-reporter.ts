/**
 * Non-blocking progress updates for long Discord jobs.
 * Awaiting webhook edits on every step can stall scrapes when Discord rate-limits
 * (~10–15 edits), so callers should `report()` without awaiting and `flush()` at the end.
 */

function sleepMs(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

export type ProgressReporter = {
	/** Queue latest status (never blocks the caller). */
	report: (message: string) => void;
	/** Wait until queued updates finish (call before final summary edit). */
	flush: () => Promise<void>;
};

/**
 * Coalesce progress to the latest message and throttle Discord edits.
 * @param minIntervalMs minimum gap between successful Discord edits (default 2s)
 */
export function createProgressReporter(
	onProgress?: (message: string) => Promise<void>,
	opts?: { minIntervalMs?: number },
): ProgressReporter {
	if (!onProgress) {
		return { report: () => undefined, flush: async () => undefined };
	}

	const minIntervalMs = opts?.minIntervalMs ?? 2_000;
	let latest: string | null = null;
	let chain: Promise<void> = Promise.resolve();
	let pumping = false;
	let lastSentAt = 0;

	const pump = () => {
		if (pumping) return;
		pumping = true;
		chain = chain
			.then(async () => {
				while (latest !== null) {
					const message = latest;
					latest = null;
					const wait = Math.max(0, minIntervalMs - (Date.now() - lastSentAt));
					if (wait > 0) await sleepMs(wait);
					try {
						await onProgress(message);
						lastSentAt = Date.now();
					} catch (err) {
						console.warn('Progress update failed (non-fatal):', err);
					}
				}
			})
			.finally(() => {
				pumping = false;
				if (latest !== null) pump();
			});
	};

	return {
		report(message: string) {
			latest = message;
			pump();
		},
		flush: async () => {
			await chain;
			// One more pass if something arrived during the last await.
			if (latest !== null) {
				pump();
				await chain;
			}
		},
	};
}
