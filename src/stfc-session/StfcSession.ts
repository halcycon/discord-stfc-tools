import { DurableObject } from 'cloudflare:workers';

const STORAGE_KEY = 'stfc_auth_state';
/** Refresh X-STFC-Token before the site's ~4 min client refresh interval. */
const CLIENT_TOKEN_MAX_AGE_MS = 3 * 60 * 1000;
/** Remint anonymous session this far before cookie expiry. */
const SESSION_REFRESH_SKEW_MS = 24 * 60 * 60 * 1000;

const STFC_HEADERS = {
	'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
	Referer: 'https://stfc.pro/',
	Origin: 'https://stfc.pro',
	Accept: 'application/json',
};

interface StfcAuthState {
	/** Cookie value only (signed token.signature), URL-decoded. */
	sessionCookieValue: string;
	sessionExpiresAt: number;
	clientToken: string | null;
	clientTokenFetchedAt: number | null;
}

export type StfcAuthHeaders = {
	cookie: string;
	token: string;
	sessionExpiresAt: string;
	clientTokenAgeMs: number;
};

function cookieHeader(value: string): string {
	return `__Secure-better-auth.session_token=${value}`;
}

function parseSessionSetCookie(setCookie: string): { value: string; maxAgeSec: number } | null {
	const match = setCookie.match(/__Secure-better-auth\.session_token=([^;]+)/i);
	if (!match?.[1]) return null;
	const value = decodeURIComponent(match[1]);
	const maxAgeMatch = setCookie.match(/Max-Age=(\d+)/i);
	const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 2_592_000;
	return { value, maxAgeSec: Number.isFinite(maxAgeSec) ? maxAgeSec : 2_592_000 };
}

/**
 * Singleton Durable Object: anonymous stfc.pro Better Auth session + short-lived X-STFC-Token.
 */
export class StfcSession extends DurableObject<Env> {
	private memory: StfcAuthState | null = null;

	private async load(): Promise<StfcAuthState | null> {
		if (this.memory) return this.memory;
		const stored = await this.ctx.storage.get<StfcAuthState>(STORAGE_KEY);
		this.memory = stored ?? null;
		return this.memory;
	}

	private async save(state: StfcAuthState): Promise<void> {
		this.memory = state;
		await this.ctx.storage.put(STORAGE_KEY, state);
	}

	private async clear(): Promise<void> {
		this.memory = null;
		await this.ctx.storage.delete(STORAGE_KEY);
	}

	private async signInAnonymous(): Promise<StfcAuthState> {
		const response = await fetch('https://stfc.pro/api/auth/sign-in/anonymous', {
			method: 'POST',
			headers: {
				...STFC_HEADERS,
				'Content-Type': 'application/json',
			},
			body: '{}',
		});
		if (!response.ok) {
			throw new Error(`stfc.pro anonymous sign-in HTTP ${response.status}`);
		}

		const setCookie = response.headers.get('Set-Cookie');
		if (!setCookie) {
			throw new Error('stfc.pro anonymous sign-in missing Set-Cookie');
		}
		const parsed = parseSessionSetCookie(setCookie);
		if (!parsed) {
			throw new Error('stfc.pro anonymous sign-in: could not parse session cookie');
		}

		const state: StfcAuthState = {
			sessionCookieValue: parsed.value,
			sessionExpiresAt: Date.now() + parsed.maxAgeSec * 1000,
			clientToken: null,
			clientTokenFetchedAt: null,
		};
		await this.save(state);
		return state;
	}

	private async requestClientToken(sessionCookieValue: string): Promise<string> {
		const response = await fetch('https://stfc.pro/api/request-token', {
			headers: {
				...STFC_HEADERS,
				Cookie: cookieHeader(sessionCookieValue),
			},
		});
		if (!response.ok) {
			throw new Error(`stfc.pro request-token HTTP ${response.status}`);
		}
		const body = (await response.json()) as { token?: string };
		if (!body.token) {
			throw new Error('stfc.pro request-token missing token');
		}
		return body.token;
	}

	private sessionNeedsRefresh(state: StfcAuthState | null): boolean {
		if (!state?.sessionCookieValue) return true;
		return state.sessionExpiresAt - Date.now() < SESSION_REFRESH_SKEW_MS;
	}

	private clientTokenNeedsRefresh(state: StfcAuthState): boolean {
		if (!state.clientToken || state.clientTokenFetchedAt == null) return true;
		return Date.now() - state.clientTokenFetchedAt >= CLIENT_TOKEN_MAX_AGE_MS;
	}

	/**
	 * Return Cookie + X-STFC-Token headers, minting/refreshing as needed.
	 * Serialized via blockConcurrencyWhile so concurrent lookups share one refresh.
	 */
	async getAuthHeaders(opts?: { forceSession?: boolean; forceToken?: boolean }): Promise<StfcAuthHeaders> {
		const forceSession = Boolean(opts?.forceSession);
		const forceToken = Boolean(opts?.forceToken);
		return this.ctx.blockConcurrencyWhile(async () => {
			// Always re-read storage inside the critical section (don't trust in-memory after invalidate).
			this.memory = null;
			let state = await this.load();

			if (forceSession || this.sessionNeedsRefresh(state)) {
				state = await this.signInAnonymous();
			}

			if (!state) {
				throw new Error('stfc.pro session unavailable');
			}

			if (forceToken || this.clientTokenNeedsRefresh(state)) {
				try {
					const token = await this.requestClientToken(state.sessionCookieValue);
					state = {
						...state,
						clientToken: token,
						clientTokenFetchedAt: Date.now(),
					};
					await this.save(state);
				} catch {
					// Session may have been revoked — remint once.
					state = await this.signInAnonymous();
					const token = await this.requestClientToken(state.sessionCookieValue);
					state = {
						...state,
						clientToken: token,
						clientTokenFetchedAt: Date.now(),
					};
					await this.save(state);
				}
			}

			if (!state.clientToken || state.clientTokenFetchedAt == null) {
				throw new Error('stfc.pro client token unavailable');
			}

			return {
				cookie: cookieHeader(state.sessionCookieValue),
				token: state.clientToken,
				sessionExpiresAt: new Date(state.sessionExpiresAt).toISOString(),
				clientTokenAgeMs: Date.now() - state.clientTokenFetchedAt,
			};
		});
	}

	/** Drop cached auth (e.g. after persistent no_session / invalid_token). */
	async invalidate(kind: 'session' | 'token' | 'all' = 'all'): Promise<void> {
		await this.ctx.blockConcurrencyWhile(async () => {
			const state = await this.load();
			if (!state || kind === 'all') {
				await this.clear();
				return;
			}
			if (kind === 'token') {
				await this.save({
					...state,
					clientToken: null,
					clientTokenFetchedAt: null,
				});
				return;
			}
			await this.clear();
		});
	}

	async getStatus(): Promise<{
		hasSession: boolean;
		sessionExpiresAt: string | null;
		hasClientToken: boolean;
		clientTokenAgeMs: number | null;
	}> {
		const state = await this.load();
		return {
			hasSession: Boolean(state?.sessionCookieValue),
			sessionExpiresAt: state ? new Date(state.sessionExpiresAt).toISOString() : null,
			hasClientToken: Boolean(state?.clientToken),
			clientTokenAgeMs:
				state?.clientTokenFetchedAt != null ? Date.now() - state.clientTokenFetchedAt : null,
		};
	}
}
