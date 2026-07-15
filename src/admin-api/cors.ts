/** CORS helpers for the admin SPA (Cloudflare Pages). */

export function adminAllowedOrigins(env: {
	ADMIN_WEB_ORIGIN?: string;
	WORKER_URL?: string;
}): string[] {
	const raw = env.ADMIN_WEB_ORIGIN?.trim() || '';
	const list = raw
		.split(',')
		.map((s) => s.trim().replace(/\/$/, ''))
		.filter(Boolean);
	// Local Vite defaults
	for (const local of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
		if (!list.includes(local)) list.push(local);
	}
	return list;
}

export function corsHeaders(
	request: Request,
	env: { ADMIN_WEB_ORIGIN?: string; WORKER_URL?: string },
): HeadersInit {
	const origin = request.headers.get('Origin') || '';
	const allowed = adminAllowedOrigins(env);
	const headers: Record<string, string> = {
		'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		'Access-Control-Allow-Credentials': 'true',
		'Access-Control-Max-Age': '86400',
		Vary: 'Origin',
	};
	if (origin && allowed.includes(origin.replace(/\/$/, ''))) {
		headers['Access-Control-Allow-Origin'] = origin;
	}
	return headers;
}

export function withCors(
	request: Request,
	env: { ADMIN_WEB_ORIGIN?: string; WORKER_URL?: string },
	response: Response,
): Response {
	const headers = new Headers(response.headers);
	const extra = corsHeaders(request, env);
	for (const [k, v] of Object.entries(extra)) {
		headers.set(k, v);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export function jsonCors(
	request: Request,
	env: { ADMIN_WEB_ORIGIN?: string; WORKER_URL?: string },
	data: unknown,
	init: ResponseInit = {},
): Response {
	const headers = new Headers(init.headers);
	headers.set('Content-Type', 'application/json');
	for (const [k, v] of Object.entries(corsHeaders(request, env))) {
		headers.set(k, v);
	}
	return new Response(JSON.stringify(data), { ...init, headers });
}
