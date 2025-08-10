// Utility functions for ASCII table generation

export interface TableColumn {
	header: string;
	width: number;
	align?: 'left' | 'right' | 'center';
}

export interface TableData {
	[key: string]: string | number;
}

export function generateAsciiTable(data: TableData[], columns: TableColumn[]): string {
	if (data.length === 0) {
		return 'No data to display';
	}

	// Ensure columns have proper widths
	const processedColumns = columns.map(col => ({
		...col,
		width: Math.max(col.width, col.header.length)
	}));

	// Auto-adjust column widths based on data (with max width limit for readability)
	data.forEach(row => {
		processedColumns.forEach(col => {
			const value = String(row[col.header] || '');
			// Limit column width to prevent overly wide tables
			const maxWidth = 50; // Maximum column width
			col.width = Math.max(col.width, Math.min(value.length, maxWidth));
		});
	});

	// Generate table parts using Unicode box-drawing characters
	const horizontalLine = '─';
	const verticalLine = '│';
	const topLeft = '┌';
	const topRight = '┐';
	const topTee = '┬';
	const bottomLeft = '└';
	const bottomRight = '┘';
	const bottomTee = '┴';
	const leftTee = '├';
	const rightTee = '┤';
	const cross = '┼';
	
	const topBorder = topLeft + processedColumns.map(col => horizontalLine.repeat(col.width + 2)).join(topTee) + topRight;
	const middleBorder = leftTee + processedColumns.map(col => horizontalLine.repeat(col.width + 2)).join(cross) + rightTee;
	const bottomBorder = bottomLeft + processedColumns.map(col => horizontalLine.repeat(col.width + 2)).join(bottomTee) + bottomRight;
	
	const header = verticalLine + processedColumns.map(col => ` ${col.header.padEnd(col.width)} `).join(verticalLine) + verticalLine;
	
	const rows = data.map(row => 
		verticalLine + processedColumns.map(col => {
			let value = String(row[col.header] || '');
			
			// Truncate overly long values and add ellipsis
			if (value.length > col.width) {
				value = value.substring(0, col.width - 3) + '...';
			}
			
			const align = col.align || 'left';
			let paddedValue: string;
			
			switch (align) {
				case 'right':
					paddedValue = value.padStart(col.width);
					break;
				case 'center':
					const totalPadding = col.width - value.length;
					const leftPadding = Math.floor(totalPadding / 2);
					const rightPadding = totalPadding - leftPadding;
					paddedValue = ' '.repeat(leftPadding) + value + ' '.repeat(rightPadding);
					break;
				default: // left
					paddedValue = value.padEnd(col.width);
			}
			
			return ` ${paddedValue} `;
		}).join(verticalLine) + verticalLine
	);

	return [topBorder, header, middleBorder, ...rows, bottomBorder].join('\n');
}

export function parseCSV(csvText: string): TableData[] {
	// First, convert literal \n to actual newlines if needed
	let processedText = csvText.replace(/\\n/g, '\n');
	
	const lines = processedText.trim().split('\n');
	console.log('Debug - parseCSV lines:', lines);
	console.log('Debug - parseCSV lines count:', lines.length);
	
	if (lines.length < 2) {
		throw new Error(`CSV must have at least a header row and one data row. Found ${lines.length} lines: ${JSON.stringify(lines)}`);
	}

	// Enhanced CSV parser that handles quoted fields and multi-line content
	function parseCSVLine(line: string): string[] {
		const result: string[] = [];
		let current = '';
		let inQuotes = false;
		let i = 0;

		while (i < line.length) {
			const char = line[i];
			
			if (char === '"') {
				if (inQuotes && line[i + 1] === '"') {
					// Handle escaped quotes ("")
					current += '"';
					i += 2;
				} else {
					// Toggle quote state
					inQuotes = !inQuotes;
					i++;
				}
			} else if (char === ',' && !inQuotes) {
				// Field separator outside quotes
				result.push(current.trim());
				current = '';
				i++;
			} else {
				current += char;
				i++;
			}
		}
		
		result.push(current.trim());
		return result;
	}

	// Parse header
	const headers = parseCSVLine(lines[0]);
	
	// Parse data rows
	const data: TableData[] = [];
	for (let i = 1; i < lines.length; i++) {
		const values = parseCSVLine(lines[i]);
		if (values.length !== headers.length) {
			throw new Error(`Row ${i + 1} has ${values.length} columns, expected ${headers.length}`);
		}
		
		const row: TableData = {};
		headers.forEach((header, index) => {
			// Process multi-line content: handle both \n and | as separators
			let value = values[index];
			if (value.startsWith('"') && value.endsWith('"')) {
				value = value.slice(1, -1); // Remove surrounding quotes
			}
			// Convert \n to | for display, and also support | as input separator
			row[header] = value.replace(/\\n/g, ' | ').replace(/\|/g, ' | ');
		});
		data.push(row);
	}
	
	return data;
}

export function autoGenerateColumns(data: TableData[]): TableColumn[] {
	if (data.length === 0) {
		return [];
	}

	const headers = Object.keys(data[0]);
	return headers.map(header => {
		// Determine if column should be right-aligned (for numbers)
		const isNumeric = data.every(row => {
			const value = row[header];
			return value === '' || !isNaN(Number(value));
		});

		return {
			header,
			width: Math.max(header.length, 10), // Minimum width
			align: isNumeric ? 'right' : 'left'
		};
	});
}
