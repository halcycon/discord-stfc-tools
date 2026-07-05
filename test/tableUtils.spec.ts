import { describe, it, expect } from 'vitest';
import { generateAsciiTable, parseCSV, autoGenerateColumns } from '../src/tableUtils';

describe('Table Utils', () => {
	describe('parseCSV', () => {
		it('should parse simple CSV data', () => {
			const csv = `Name,Age
John,25
Jane,30`;

			const result = parseCSV(csv);
			expect(result).toHaveLength(2);
			expect(result[0]).toEqual({ Name: 'John', Age: '25' });
			expect(result[1]).toEqual({ Name: 'Jane', Age: '30' });
		});

		it('should handle CSV with spaces', () => {
			const csv = `Name, Age, City
John, 25, New York
Jane, 30, San Francisco`;

			const result = parseCSV(csv);
			expect(result).toHaveLength(2);
			expect(result[0]).toEqual({ Name: 'John', Age: '25', City: 'New York' });
			expect(result[1]).toEqual({ Name: 'Jane', Age: '30', City: 'San Francisco' });
		});

		it('should throw error for invalid CSV', () => {
			const csv = `Name,Age
John,25,Extra`;

			expect(() => parseCSV(csv)).toThrow('Row 2 has 3 columns, expected 2');
		});
	});

	describe('autoGenerateColumns', () => {
		it('should auto-detect numeric columns for right alignment', () => {
			const data = [
				{ Name: 'John', Age: '25', Score: '95.5' },
				{ Name: 'Jane', Age: '30', Score: '88.2' },
			];

			const columns = autoGenerateColumns(data);

			expect(columns).toHaveLength(3);
			expect(columns[0]).toEqual({ header: 'Name', width: 10, align: 'left' });
			expect(columns[1]).toEqual({ header: 'Age', width: 10, align: 'right' });
			expect(columns[2]).toEqual({ header: 'Score', width: 10, align: 'right' });
		});
	});

	describe('generateAsciiTable', () => {
		it('should generate a proper ASCII table with Unicode characters', () => {
			const data = [
				{ Name: 'John', Age: '25' },
				{ Name: 'Jane', Age: '30' },
			];
			const columns = [
				{ header: 'Name', width: 4, align: 'left' as const },
				{ header: 'Age', width: 3, align: 'right' as const },
			];

			const result = generateAsciiTable(data, columns);

			expect(result).toContain('║ Name');
			expect(result).toContain('║ John');
			expect(result).toContain('╔');
			expect(result).toContain('╚');
		});

		it('should handle empty data', () => {
			const result = generateAsciiTable([], []);
			expect(result).toBe('No data to display');
		});
	});
});
