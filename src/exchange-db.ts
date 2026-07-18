import type { ExchangeRequest, ExchangeRequestStatus, ExchangeResource } from './exchange-types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapResource(row: any): ExchangeResource {
	return {
		id: row.id,
		guild_id: row.guild_id,
		name: row.name,
		slug: row.slug,
		donor_role_id: row.donor_role_id,
		recipient_role_id: row.recipient_role_id,
		channel_id: row.channel_id,
		pinned_message_id: row.pinned_message_id ?? null,
		active: Boolean(row.active ?? 1),
		created_at: row.created_at,
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRequest(row: any): ExchangeRequest {
	return {
		id: row.id,
		resource_id: row.resource_id,
		recipient_discord_user_id: row.recipient_discord_user_id,
		status: row.status as ExchangeRequestStatus,
		claimed_by: row.claimed_by ?? null,
		claimed_at: row.claimed_at ?? null,
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

export async function createExchangeResource(
	db: D1Database,
	data: {
		guild_id: string;
		name: string;
		slug: string;
		donor_role_id: string;
		recipient_role_id: string;
		channel_id: string;
		pinned_message_id?: string | null;
	},
): Promise<ExchangeResource> {
	const result = await db
		.prepare(
			`INSERT INTO exchange_resources
			 (guild_id, name, slug, donor_role_id, recipient_role_id, channel_id, pinned_message_id, active)
			 VALUES (?, ?, ?, ?, ?, ?, ?, 1)
			 RETURNING *`,
		)
		.bind(
			data.guild_id,
			data.name,
			data.slug,
			data.donor_role_id,
			data.recipient_role_id,
			data.channel_id,
			data.pinned_message_id ?? null,
		)
		.first();
	if (!result) throw new Error('Failed to create exchange resource');
	return mapResource(result);
}

export async function updateExchangeResource(
	db: D1Database,
	resourceId: number,
	patch: Partial<{
		pinned_message_id: string | null;
		channel_id: string;
		active: boolean;
	}>,
): Promise<void> {
	await db
		.prepare(
			`UPDATE exchange_resources SET
			 pinned_message_id = COALESCE(?, pinned_message_id),
			 channel_id = COALESCE(?, channel_id),
			 active = COALESCE(?, active)
			 WHERE id = ?`,
		)
		.bind(
			patch.pinned_message_id !== undefined ? patch.pinned_message_id : null,
			patch.channel_id ?? null,
			patch.active !== undefined ? (patch.active ? 1 : 0) : null,
			resourceId,
		)
		.run();
}

export async function getExchangeResource(
	db: D1Database,
	resourceId: number,
): Promise<ExchangeResource | null> {
	const row = await db
		.prepare('SELECT * FROM exchange_resources WHERE id = ?')
		.bind(resourceId)
		.first();
	return row ? mapResource(row) : null;
}

export async function findExchangeResourceBySlug(
	db: D1Database,
	guildId: string,
	slugOrName: string,
): Promise<ExchangeResource | null> {
	const key = slugOrName.trim().toLowerCase();
	const row = await db
		.prepare(
			`SELECT * FROM exchange_resources
			 WHERE guild_id = ? AND active = 1
			   AND (slug = ? OR lower(name) = ?)
			 LIMIT 1`,
		)
		.bind(guildId, key, key)
		.first();
	return row ? mapResource(row) : null;
}

export async function listExchangeResources(
	db: D1Database,
	guildId: string,
	activeOnly = true,
): Promise<ExchangeResource[]> {
	const { results } = await db
		.prepare(
			activeOnly
				? `SELECT * FROM exchange_resources WHERE guild_id = ? AND active = 1 ORDER BY name ASC`
				: `SELECT * FROM exchange_resources WHERE guild_id = ? ORDER BY name ASC`,
		)
		.bind(guildId)
		.all();
	return (results ?? []).map(mapResource);
}

export async function addExchangeDonor(
	db: D1Database,
	resourceId: number,
	discordUserId: string,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO exchange_donors (resource_id, discord_user_id)
			 VALUES (?, ?)
			 ON CONFLICT (resource_id, discord_user_id) DO NOTHING`,
		)
		.bind(resourceId, discordUserId)
		.run();
}

export async function removeExchangeDonor(
	db: D1Database,
	resourceId: number,
	discordUserId: string,
): Promise<void> {
	await db
		.prepare(`DELETE FROM exchange_donors WHERE resource_id = ? AND discord_user_id = ?`)
		.bind(resourceId, discordUserId)
		.run();
}

export async function isExchangeDonor(
	db: D1Database,
	resourceId: number,
	discordUserId: string,
): Promise<boolean> {
	const row = await db
		.prepare(
			`SELECT 1 AS ok FROM exchange_donors WHERE resource_id = ? AND discord_user_id = ?`,
		)
		.bind(resourceId, discordUserId)
		.first();
	return Boolean(row);
}

export async function listExchangeDonorIds(
	db: D1Database,
	resourceId: number,
): Promise<string[]> {
	const { results } = await db
		.prepare(`SELECT discord_user_id FROM exchange_donors WHERE resource_id = ?`)
		.bind(resourceId)
		.all();
	return (results ?? []).map((r) => String((r as { discord_user_id: string }).discord_user_id));
}

export async function countExchangeDonors(db: D1Database, resourceId: number): Promise<number> {
	const row = await db
		.prepare(`SELECT COUNT(*) AS c FROM exchange_donors WHERE resource_id = ?`)
		.bind(resourceId)
		.first<{ c: number }>();
	return Number(row?.c ?? 0);
}

/** Open + claimed requests (shown on the channel pin). */
export async function countActiveExchangeRequests(
	db: D1Database,
	resourceId: number,
): Promise<number> {
	const row = await db
		.prepare(
			`SELECT COUNT(*) AS c FROM exchange_requests
			 WHERE resource_id = ? AND status IN ('open', 'claimed')`,
		)
		.bind(resourceId)
		.first<{ c: number }>();
	return Number(row?.c ?? 0);
}

/** Open (unclaimed) requests oldest-first — queue for new donors. */
export async function listOpenExchangeRequests(
	db: D1Database,
	resourceId: number,
	limit = 50,
): Promise<ExchangeRequest[]> {
	const cap = Math.min(Math.max(Math.floor(limit) || 50, 1), 100);
	const { results } = await db
		.prepare(
			`SELECT * FROM exchange_requests
			 WHERE resource_id = ? AND status = 'open'
			 ORDER BY created_at ASC, id ASC
			 LIMIT ?`,
		)
		.bind(resourceId, cap)
		.all();
	return (results ?? []).map(mapRequest);
}

export async function getActiveRequestForRecipient(
	db: D1Database,
	resourceId: number,
	recipientId: string,
): Promise<ExchangeRequest | null> {
	const row = await db
		.prepare(
			`SELECT * FROM exchange_requests
			 WHERE resource_id = ? AND recipient_discord_user_id = ?
			   AND status IN ('open', 'claimed')
			 LIMIT 1`,
		)
		.bind(resourceId, recipientId)
		.first();
	return row ? mapRequest(row) : null;
}

export async function createExchangeRequest(
	db: D1Database,
	resourceId: number,
	recipientDiscordUserId: string,
): Promise<ExchangeRequest> {
	const result = await db
		.prepare(
			`INSERT INTO exchange_requests (resource_id, recipient_discord_user_id, status)
			 VALUES (?, ?, 'open')
			 RETURNING *`,
		)
		.bind(resourceId, recipientDiscordUserId)
		.first();
	if (!result) throw new Error('Failed to create exchange request');
	return mapRequest(result);
}

export async function getExchangeRequest(
	db: D1Database,
	requestId: number,
): Promise<ExchangeRequest | null> {
	const row = await db
		.prepare('SELECT * FROM exchange_requests WHERE id = ?')
		.bind(requestId)
		.first();
	return row ? mapRequest(row) : null;
}

/** Atomic claim — returns true if this caller won. */
export async function claimExchangeRequest(
	db: D1Database,
	requestId: number,
	donorDiscordUserId: string,
): Promise<boolean> {
	const now = new Date().toISOString();
	const result = await db
		.prepare(
			`UPDATE exchange_requests SET
			 status = 'claimed',
			 claimed_by = ?,
			 claimed_at = ?,
			 updated_at = ?
			 WHERE id = ? AND status = 'open'`,
		)
		.bind(donorDiscordUserId, now, now, requestId)
		.run();
	return (result.meta?.changes ?? 0) > 0;
}

export async function reopenExchangeRequest(db: D1Database, requestId: number): Promise<void> {
	const now = new Date().toISOString();
	await db
		.prepare(
			`UPDATE exchange_requests SET
			 status = 'open',
			 claimed_by = NULL,
			 claimed_at = NULL,
			 updated_at = ?
			 WHERE id = ? AND status = 'claimed'`,
		)
		.bind(now, requestId)
		.run();
}

export async function completeExchangeRequest(db: D1Database, requestId: number): Promise<void> {
	const now = new Date().toISOString();
	await db
		.prepare(
			`UPDATE exchange_requests SET status = 'completed', updated_at = ?
			 WHERE id = ? AND status IN ('open', 'claimed')`,
		)
		.bind(now, requestId)
		.run();
}

export async function cancelExchangeRequest(db: D1Database, requestId: number): Promise<void> {
	const now = new Date().toISOString();
	await db
		.prepare(
			`UPDATE exchange_requests SET status = 'cancelled', updated_at = ?
			 WHERE id = ? AND status IN ('open', 'claimed')`,
		)
		.bind(now, requestId)
		.run();
}
