import { describe, expect, it } from 'vitest';
import { formatRoleChangeNote, type RoleChangeResult } from '../src/verification-access';

describe('formatRoleChangeNote', () => {
	it('reports no changes', () => {
		const result: RoleChangeResult = { added: [], removed: [], unchanged: ['1'] };
		expect(formatRoleChangeNote(result)).toBe('Roles: no changes');
	});

	it('lists adds and removes with role mentions', () => {
		const result: RoleChangeResult = {
			added: ['111', '222'],
			removed: ['333'],
			unchanged: [],
		};
		expect(formatRoleChangeNote(result)).toBe('Roles: +<@&111> <@&222>; −<@&333>');
	});
});
