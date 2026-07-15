/**
 * HMAC-signed session cookies for the admin web UI (Discord OAuth).
 */
export interface AdminSession {
	userId: string;
	username: string;
	globalName: string | null;
	avatar: string | null;
	accessToken: string;
	exp: number;
}

const COOKIE_NAME = 'stfc_admin_session';
const SESSION_TTL_SEC = 60 * 60 * 12; // 12h

function b64urlEncode(data: ArrayBuffer | Uint8Array | string): string {
	const bytes =
		typeof data === 'string'
			? new TextEncoder().encode(data)
			: data instanceof Uint8Array
				? data
				: new Uint8Array(data);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
	const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
	const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify'],
	);
}

export async function sealSession(session: AdminSession, secret: string): Promise<string> {
	const payload = b64urlEncode(JSON.stringify(session));
	const key = await hmacKey(secret);
	const sig = b64urlEncode(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
	return `${payload}.${sig}`;
}

export async function openSession(token: string, secret: string): Promise<AdminSession | null> {
	const parts = token.split('.');
	if (parts.length !== 2) return null;
	const [payload, sig] = parts;
	const key = await hmacKey(secret);
	const ok = await crypto.subtle.verify(
		'HMAC',
		key,
		b64urlDecode(sig),
		new TextEncoder().encode(payload),
	);
	if (!ok) return null;
	try {
		const raw = new TextDecoder().decode(b64urlDecode(payload));
		const session = JSON.parse(raw) as AdminSession;
		if (!session?.userId || !session.accessToken || !session.exp) return null;
		if (session.exp * 1000 < Date.now()) return null;
		return session;
	} catch {
		return null;
	}
}

export function newSessionExpiry(): number {
	return Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
}

export function parseCookies(header: string | null): Record<string, string> {
	const out: Record<string, string> = {};
	if (!header) return out;
	for (const part of header.split(';')) {
		const idx = part.indexOf('=');
		if (idx < 0) continue;
		const k = part.slice(0, idx).trim();
		const v = part.slice(idx + 1).trim();
		if (k) out[k] = decodeURIComponent(v);
	}
	return out;
}

export function sessionCookieHeader(sealed: string, maxAge = SESSION_TTL_SEC): string {
	return [
		`${COOKIE_NAME}=${encodeURIComponent(sealed)}`,
		'Path=/',
		'HttpOnly',
		'Secure',
		'SameSite=None',
		`Max-Age=${maxAge}`,
	].join('; ');
}

export function clearSessionCookieHeader(): string {
	return [
		`${COOKIE_NAME}=`,
		'Path=/',
		'HttpOnly',
		'Secure',
		'SameSite=None',
		'Max-Age=0',
	].join('; ');
}

export async function readSessionFromRequest(
	request: Request,
	secret: string | undefined,
): Promise<AdminSession | null> {
	if (!secret) return null;

	// Bearer token (SPA sessionStorage) — required for cross-origin Pages→Worker on mobile Safari,
	// which blocks third-party cookies even when SameSite=None.
	const auth = request.headers.get('Authorization');
	if (auth?.toLowerCase().startsWith('bearer ')) {
		const token = auth.slice(7).trim();
		if (token) {
			const fromBearer = await openSession(token, secret);
			if (fromBearer) return fromBearer;
		}
	}

	const cookies = parseCookies(request.headers.get('Cookie'));
	const raw = cookies[COOKIE_NAME];
	if (!raw) return null;
	return openSession(raw, secret);
}

export { COOKIE_NAME, SESSION_TTL_SEC };
