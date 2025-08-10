import { verifyKey } from 'discord-interactions';
import { generateAsciiTable, parseCSV, autoGenerateColumns, type TableColumn, type TableData } from './tableUtils';
import { handleCoordinateLookup, parseCoordinateLink, parseMultipleCoordinates, getFactionName, loadSystemData, type SystemData, type CoordinateMatch } from './systemUtils';

async function handleDiscordInteraction(request: Request, env: Env): Promise<Response> {
	const signature = request.headers.get('X-Signature-Ed25519');
	const timestamp = request.headers.get('X-Signature-Timestamp');
	const body = await request.text();

	if (!signature || !timestamp || !env.DISCORD_PUBLIC_KEY) {
		return new Response('Unauthorized', { status: 401 });
	}

	const isValidRequest = verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY);
	if (!isValidRequest) {
		return new Response('Invalid signature', { status: 401 });
	}

	const interaction = JSON.parse(body);

	// Handle Discord ping
	if (interaction.type === 1) {
		return Response.json({ type: 1 });
	}

	// Handle application commands
	if (interaction.type === 2) {
		const { data } = interaction;
		
		if (data.name === 'lookup') {
			const coordinateLink = data.options?.[0]?.value;
			
			if (!coordinateLink) {
				return Response.json({
					type: 4,
					data: {
						content: 'Please provide a coordinate link to lookup.',
						flags: 64 // Ephemeral
					}
				});
			}

			const parsed = parseCoordinateLink(coordinateLink);
			const coordinates = parseMultipleCoordinates(coordinateLink);
			
			if (coordinates.length === 0 && !parsed) {
				return Response.json({
					type: 4,
					data: {
						content: 'Invalid coordinate format. Expected format: [[ALLIANCE] Player S:12345 X:123.456 Y:789.012]',
						flags: 64
					}
				});
			}

			const result = handleCoordinateLookup(coordinateLink);
			
			return Response.json({
				type: 4,
				data: {
					content: result
				}
			});
		}

		if (data.name === 'tablehelp') {
			const helpText = `**📊 Table Command Help**

**Usage Options:**
1️⃣ **Inline CSV with line breaks**: \`/table csv_data:"Name,Age\\nJohn,25\\nJane,30"\`
2️⃣ **File upload**: Use the csv_file option to upload a .csv file
3️⃣ **Simple CSV**: \`/table csv_data:"Product,Price\\nLaptop,999\\nPhone,599"\`

**Important for Multi-line:**
• Use \\\\n for line breaks in the csv_data field
• Discord doesn't support actual multi-line input in slash commands

**CSV Format Examples:**
\`\`\`
Name,Age,City\\nJohn,25,NYC\\nJane,30,LA\\nBob,22,SF
\`\`\`

**Working Examples:**
• \`/table csv_data:"Name,Age\\nAlice,28\\nBob,32"\`
• \`/table csv_data:"Item,Cost\\nLaptop,$999\\nMouse,$29"\`

**File Upload:**
• Use the csv_file field to upload .csv files
• Max file size: 1MB
• Must be .csv format

**Tips:**
• First row = column headers
• Use commas to separate values  
• Max display: ~1900 characters`;

			return Response.json({
				type: 4,
				data: {
					content: helpText,
					flags: 64 // Ephemeral
				}
			});
		}

		if (data.name === 'table') {
			const csvInput = data.options?.find((opt: any) => opt.name === 'csv_data')?.value;
			const csvFileOption = data.options?.find((opt: any) => opt.name === 'csv_file');
			
			// Debug: Log the entire interaction to understand Discord's structure
			console.log('Debug - Full interaction data:', JSON.stringify(interaction.data, null, 2));
			console.log('Debug - csvInput:', csvInput);
			console.log('Debug - csvFileOption:', JSON.stringify(csvFileOption, null, 2));
			console.log('Debug - resolved:', JSON.stringify(interaction.data.resolved, null, 2));
			
			// For file attachments, Discord uses a different structure
			let csvFile = null;
			if (csvFileOption && csvFileOption.value) {
				// The value contains the attachment ID
				const attachmentId = csvFileOption.value;
				csvFile = interaction.data.resolved?.attachments?.[attachmentId];
			}
			
			console.log('Debug - csvFile after resolution:', JSON.stringify(csvFile, null, 2));
			
			// Check if we have either CSV data or a file attachment
			if (!csvInput && !csvFile) {
				return Response.json({
					type: 4,
					data: {
						content: `No CSV data provided. Debug: csvInput=${!!csvInput}, csvFile=${!!csvFile}, options=${JSON.stringify(data.options)}, resolved=${!!interaction.data.resolved}`,
						flags: 64 // Ephemeral
					}
				});
			}

			try {
				let csvData = '';
				
				// Handle file attachment
				if (csvFile) {
					console.log('Debug - Processing file attachment:', JSON.stringify(csvFile, null, 2));
					
					// Check file type
					if (!csvFile.filename?.toLowerCase().endsWith('.csv')) {
						return Response.json({
							type: 4,
							data: {
								content: 'Error: Please upload a .csv file only.',
								flags: 64
							}
						});
					}
					
					// Check file size (Discord limit is usually 8MB, but we want smaller for CSV)
					if (csvFile.size && csvFile.size > 1048576) { // 1MB limit
						return Response.json({
							type: 4,
							data: {
								content: 'Error: File too large. Please keep CSV files under 1MB.',
								flags: 64
							}
						});
					}
					
					// Fetch file content
					try {
						const fileResponse = await fetch(csvFile.url);
						if (!fileResponse.ok) {
							throw new Error(`HTTP ${fileResponse.status}`);
						}
						
						csvData = await fileResponse.text();
						
						// Validate that we got some content
						if (!csvData || csvData.trim().length === 0) {
							return Response.json({
								type: 4,
								data: {
									content: 'Error: The uploaded file appears to be empty.',
									flags: 64
								}
							});
						}
					} catch (fetchError) {
						return Response.json({
							type: 4,
							data: {
								content: `Error downloading file: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`,
								flags: 64
							}
						});
					}
				} else if (csvInput) {
					// Use inline CSV data
					csvData = csvInput;
				} else {
					// This shouldn't happen due to earlier validation, but just in case
					return Response.json({
						type: 4,
						data: {
							content: 'No CSV data provided. Please use csv_data parameter or upload a csv_file.',
							flags: 64
						}
					});
				}

				// Validate csvData before parsing
				if (!csvData || typeof csvData !== 'string' || csvData.trim().length === 0) {
					return Response.json({
						type: 4,
						data: {
							content: 'Error: No valid CSV data found. Please check your input.',
							flags: 64
						}
					});
				}

				const tableData = parseCSV(csvData);
				const columns = autoGenerateColumns(tableData);
				const asciiTable = generateAsciiTable(tableData, columns);
				
				// Discord has a 2000 character limit for messages
				if (asciiTable.length > 1900) {
					return Response.json({
						type: 4,
						data: {
							content: 'Table is too large to display. Please reduce the amount of data or column widths.',
							flags: 64
						}
					});
				}

				return Response.json({
					type: 4,
					data: {
						content: '```\n' + asciiTable + '\n```'
					}
				});
			} catch (error) {
				return Response.json({
					type: 4,
					data: {
						content: `Error parsing CSV: ${error instanceof Error ? error.message : 'Unknown error'}. Use \`/tablehelp\` for format examples.`,
						flags: 64
					}
				});
			}
		}
	}

	return new Response('Unknown interaction', { status: 400 });
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		
		// Handle Discord interactions webhook
		if (url.pathname === '/discord' && request.method === 'POST') {
			return handleDiscordInteraction(request, env);
		}
		
		// Handle direct API calls for testing
		if (url.pathname === '/lookup' && request.method === 'POST') {
			const body = await request.json() as { message: string };
			const result = handleCoordinateLookup(body.message);
			
			return Response.json({ result });
		}

		// Handle GET request for testing
		if (url.pathname === '/lookup' && request.method === 'GET') {
			const message = url.searchParams.get('message');
			if (!message) {
				return new Response('Missing message parameter', { status: 400 });
			}
			
			const result = handleCoordinateLookup(message);
			return new Response(result, { 
				headers: { 'Content-Type': 'text/plain' }
			});
		}

		// Table generation endpoint for testing
		if (url.pathname === '/table' && request.method === 'POST') {
			try {
				const body = await request.json() as { csv: string };
				const tableData = parseCSV(body.csv);
				const columns = autoGenerateColumns(tableData);
				const asciiTable = generateAsciiTable(tableData, columns);
				
				return new Response(asciiTable, {
					headers: { 'Content-Type': 'text/plain' }
				});
			} catch (error) {
				return new Response(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, { 
					status: 400,
					headers: { 'Content-Type': 'text/plain' }
				});
			}
		}

		// Debug endpoint to test coordinate parsing
		if (url.pathname === '/debug' && request.method === 'GET') {
			const message = url.searchParams.get('message');
			if (!message) {
				return new Response('Missing message parameter', { status: 400 });
			}
			
			const parsed = parseCoordinateLink(message);
			const multiple = parseMultipleCoordinates(message);
			const debugInfo = {
				input: message,
				singleParsed: parsed,
				multipleParsed: multiple,
				count: multiple.length,
				isValid: parsed !== null || multiple.length > 0,
				patterns: {
					main: /\[\[([^\]]+)\]\s*([^S]+?)\s*S:(\d+)\s*X:([-\d.]+)\s*Y:([-\d.]+)\]/.test(message),
					alternative: /\[([^\]]+)\]\s*([^S]+?)\s*S:(\d+)\s*X:([-\d.]+)\s*Y:([-\d.]+)\]/.test(message)
				}
			};
			
			return Response.json(debugInfo, { 
				headers: { 'Content-Type': 'application/json' }
			});
		}

		// Debug endpoint to show faction mappings - need to get this from systemUtils now
		if (url.pathname === '/factions' && request.method === 'GET') {
			// For now, return a simple message - we could export FACTION_NAMES from systemUtils if needed
			return new Response(`Faction mappings are now handled internally. Use the /lookup command to see faction information.`, {
				headers: { 'Content-Type': 'text/plain' }
			});
		}

		// KV management endpoint for loading all systems (for debugging)
		if (url.pathname === '/systems' && request.method === 'GET') {
			try {
				const systems = loadSystemData();
				return Response.json({ 
					count: systems.length,
					systems: systems.slice(0, 10) // Show first 10 as sample
				});
			} catch (error) {
				return Response.json({ 
					error: error instanceof Error ? error.message : 'Unknown error' 
				}, { status: 500 });
			}
		}

		// Default response
		return new Response(`
STFC Coordinate Lookup Bot

Endpoints:
- POST /discord - Discord interactions webhook
- POST /lookup - Direct lookup API (JSON: {"message": "coordinate_link"})
- GET /lookup?message=coordinate_link - Direct lookup API
- POST /table - Generate ASCII table from CSV (JSON: {"csv": "header1,header2\\nvalue1,value2"})
- GET /factions - Show current faction ID mappings
- GET /systems - Show loaded systems (first 10)

Example coordinate format: [[RONE] RogueOneAdmiral S:73559 X:628.7432 Y:43.3874]

Discord Commands:
- /lookup <coordinates> - Lookup STFC coordinate information
- /table <csv_data> - Generate ASCII table from CSV data

The bot now uses Unicode box-drawing characters for prettier tables!
		`, { 
			headers: { 'Content-Type': 'text/plain' }
		});
	},
} satisfies ExportedHandler<Env>;
