import type { StfcAuthHeaders } from './StfcSession';

function stub(env: Env) {
	if (!env.STFC_SESSION) return null;
	return env.STFC_SESSION.get(env.STFC_SESSION.idFromName('main'));
}

export async function getStfcAuthHeaders(
	env: Env,
	opts?: { forceSession?: boolean; forceToken?: boolean },
): Promise<StfcAuthHeaders> {
	const s = stub(env);
	if (!s) {
		throw new Error('STFC_SESSION Durable Object binding not configured');
	}
	return s.getAuthHeaders(opts);
}

export async function invalidateStfcAuth(
	env: Env,
	kind: 'session' | 'token' | 'all' = 'all',
): Promise<void> {
	const s = stub(env);
	if (!s) return;
	await s.invalidate(kind);
}

export async function getStfcSessionStatus(env: Env) {
	const s = stub(env);
	if (!s) return null;
	return s.getStatus();
}
