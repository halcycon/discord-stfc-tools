/**
 * Cloudflare Workers plan knobs that affect long-running Discord workflows
 * (especially `/alliance suggest` Approve-all).
 *
 * Free: 10 ms CPU, 50 subrequests/request, ~30s waitUntil after response.
 * Paid: higher CPU (see wrangler limits.cpu_ms), 10k subrequests, same ~30s waitUntil.
 *
 * Empirically, even on Paid a single Approve-all interaction dies around ~10
 * verifications (waitUntil / Discord work), so both plans use the same
 * chunk → Continue flow — Paid just uses a larger chunk. Set WORKERS_PLAN in
 * `.env` → wrangler vars (default: free — safest).
 */

export type WorkersPlan = 'free' | 'paid';

/** Default links processed per Approve-all / Continue click. */
export const APPROVE_CHUNK_FREE = 2;
/** Comfortably under the ~10/interaction cliff observed on Paid. */
export const APPROVE_CHUNK_PAID = 6;
/**
 * Hard ceiling even if ALLIANCE_APPROVE_CHUNK is set high.
 * Do not raise above ~10 without re-testing — batches that large stall mid-run.
 */
export const APPROVE_CHUNK_MAX = 10;

export function resolveWorkersPlan(env: {
	WORKERS_PLAN?: string;
}): WorkersPlan {
	const raw = String(env.WORKERS_PLAN ?? 'free')
		.trim()
		.toLowerCase();
	return raw === 'paid' || raw === 'standard' ? 'paid' : 'free';
}

/**
 * How many high-confidence links to process in one interaction.
 * Override with ALLIANCE_APPROVE_CHUNK (1–10).
 */
export function allianceApproveChunkSize(env: {
	WORKERS_PLAN?: string;
	ALLIANCE_APPROVE_CHUNK?: string;
}): number {
	const override = Number(env.ALLIANCE_APPROVE_CHUNK);
	if (Number.isFinite(override) && override >= 1) {
		return Math.min(Math.floor(override), APPROVE_CHUNK_MAX);
	}
	return resolveWorkersPlan(env) === 'paid' ? APPROVE_CHUNK_PAID : APPROVE_CHUNK_FREE;
}

export function workersPlanLabel(plan: WorkersPlan): string {
	return plan === 'paid' ? 'Workers Paid' : 'Workers Free';
}
