import { describe, expect, it } from 'vitest';
import {
	APPROVE_CHUNK_FREE,
	APPROVE_CHUNK_PAID,
	allianceApproveChunkSize,
	resolveWorkersPlan,
} from '../src/workers-plan';

describe('workers-plan', () => {
	it('defaults to free', () => {
		expect(resolveWorkersPlan({})).toBe('free');
		expect(resolveWorkersPlan({ WORKERS_PLAN: 'FREE' })).toBe('free');
		expect(allianceApproveChunkSize({})).toBe(APPROVE_CHUNK_FREE);
	});

	it('accepts paid / standard', () => {
		expect(resolveWorkersPlan({ WORKERS_PLAN: 'paid' })).toBe('paid');
		expect(resolveWorkersPlan({ WORKERS_PLAN: 'standard' })).toBe('paid');
		expect(allianceApproveChunkSize({ WORKERS_PLAN: 'paid' })).toBe(APPROVE_CHUNK_PAID);
	});

	it('honours ALLIANCE_APPROVE_CHUNK override with cap at 10', () => {
		expect(allianceApproveChunkSize({ ALLIANCE_APPROVE_CHUNK: '1' })).toBe(1);
		expect(allianceApproveChunkSize({ WORKERS_PLAN: 'paid', ALLIANCE_APPROVE_CHUNK: '99' })).toBe(
			10,
		);
	});
});
