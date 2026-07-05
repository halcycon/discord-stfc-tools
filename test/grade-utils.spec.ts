import { describe, it, expect } from 'vitest';
import { opsLevelToGrade, formatGrade } from '../src/grade-utils';

describe('grade-utils', () => {
	it('maps ops levels to grades', () => {
		expect(opsLevelToGrade(39)).toBe(3);
		expect(opsLevelToGrade(40)).toBe(4);
		expect(opsLevelToGrade(50)).toBe(4);
		expect(opsLevelToGrade(51)).toBe(5);
		expect(opsLevelToGrade(60)).toBe(5);
		expect(opsLevelToGrade(61)).toBe(6);
		expect(opsLevelToGrade(70)).toBe(6);
		expect(opsLevelToGrade(71)).toBe(7);
		expect(opsLevelToGrade(80)).toBe(7);
	});

	it('returns null for invalid levels', () => {
		expect(opsLevelToGrade(0)).toBeNull();
		expect(opsLevelToGrade(81)).toBeNull();
	});

	it('formats grade labels', () => {
		expect(formatGrade(45)).toBe('G4');
		expect(formatGrade(0)).toBe('Ops 0');
	});
});
