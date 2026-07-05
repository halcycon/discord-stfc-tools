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
	// Double-line characters for outer border
	const doubleHorizontal = '═';
	const doubleVertical = '║';
	const doubleTopLeft = '╔';
	const doubleTopRight = '╗';
	const doubleBottomLeft = '╚';
	const doubleBottomRight = '╝';
	const doubleLeftTee = '╠';
	const doubleRightTee = '╣';
	
	// Single-line characters for inner separators
	const singleHorizontal = '─';
	const singleVertical = '│';
	const singleCross = '┼';
	const singleLeftTee = '├';
	const singleRightTee = '┤';
	
	// Mixed characters for borders (double horizontal, single vertical)
	const topTee = '╤'; // double horizontal, single vertical down
	const bottomTee = '╧'; // double horizontal, single vertical up
	const headerSeparatorCross = '╪'; // double horizontal, single vertical up/down
	
	// Mixed characters for data separators (single horizontal, double vertical)
	const dataLeftTee = '╟'; // double vertical, single horizontal right
	const dataRightTee = '╢'; // double vertical, single horizontal left
	
	// Create borders
	const topBorder = doubleTopLeft + processedColumns.map(col => doubleHorizontal.repeat(col.width + 2)).join(topTee) + doubleTopRight;
	const headerSeparator = doubleLeftTee + processedColumns.map(col => doubleHorizontal.repeat(col.width + 2)).join(headerSeparatorCross) + doubleRightTee;
	const dataSeparator = dataLeftTee + processedColumns.map(col => singleHorizontal.repeat(col.width + 2)).join(singleCross) + dataRightTee;
	const bottomBorder = doubleBottomLeft + processedColumns.map(col => doubleHorizontal.repeat(col.width + 2)).join(bottomTee) + doubleBottomRight;
	
	const header = doubleVertical + processedColumns.map(col => ` ${col.header.padEnd(col.width)} `).join(singleVertical) + doubleVertical;
	
	const rows = data.map((row, rowIndex) => {
		// Process multi-line content for this row
		const rowData: string[][] = processedColumns.map(col => {
			let value = String(row[col.header] || '');
			
			// Handle multi-line content - split on \n or | 
			let lines = value.includes('\\n') ? value.split('\\n') : value.split('|').map(s => s.trim()).filter(s => s);
			if (lines.length === 0) lines = [value];
			
			// Ensure each line fits in the column width
			lines = lines.map(line => {
				if (line.length > col.width) {
					return line.substring(0, col.width - 3) + '...';
				}
				return line;
			});
			
			return lines;
		});
		
		// Find the maximum number of lines in any cell for this row
		const maxLines = Math.max(...rowData.map(cellLines => cellLines.length));
		
		// Generate each line of the row
		const rowLines: string[] = [];
		for (let lineIndex = 0; lineIndex < maxLines; lineIndex++) {
			const line = doubleVertical + processedColumns.map((col, colIndex) => {
				const cellLines = rowData[colIndex];
				const lineContent = lineIndex < cellLines.length ? cellLines[lineIndex] : '';
				
				const align = col.align || 'left';
				let paddedValue: string;
				
				switch (align) {
					case 'right':
						paddedValue = lineContent.padStart(col.width);
						break;
					case 'center':
						const totalPadding = col.width - lineContent.length;
						const leftPadding = Math.floor(totalPadding / 2);
						const rightPadding = totalPadding - leftPadding;
						paddedValue = ' '.repeat(leftPadding) + lineContent + ' '.repeat(rightPadding);
						break;
					default: // left
						paddedValue = lineContent.padEnd(col.width);
				}
				
				return ` ${paddedValue} `;
			}).join(singleVertical) + doubleVertical;
			
			rowLines.push(line);
		}
		
		return rowLines;
	});
	
	// Flatten rows and add separators between data rows (but not after the last row)
	const flattenedRows: string[] = [];
	rows.forEach((rowLines, rowIndex) => {
		flattenedRows.push(...rowLines);
		// Add separator after each row except the last one
		if (rowIndex < rows.length - 1) {
			flattenedRows.push(dataSeparator);
		}
	});

	return [topBorder, header, headerSeparator, ...flattenedRows, bottomBorder].join('\n');
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
