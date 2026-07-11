import { describe, expect, it } from 'vitest';
import { decodePermissionBits } from '../src/channel-permission-audit';

describe('channel-permission-audit', () => {
	it('decodes view/send/history bits', () => {
		const viewSendHistory = String(0x400 | 0x800 | 0x10000);
		expect(decodePermissionBits(viewSendHistory)).toEqual(['View', 'Send', 'History']);
	});

	it('returns empty for zero', () => {
		expect(decodePermissionBits('0')).toEqual([]);
	});
});
