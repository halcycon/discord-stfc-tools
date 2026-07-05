// Discord slash command registration — replaces all global commands in one request
require('dotenv').config();

const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_APPLICATION_ID || !DISCORD_BOT_TOKEN) {
	console.error('❌ Missing DISCORD_APPLICATION_ID or DISCORD_BOT_TOKEN in .env');
	process.exit(1);
}

const commands = [
	{
		name: 'lookup',
		description: 'Look up STFC coordinate information',
		options: [
			{
				type: 3,
				name: 'coordinates',
				description: 'STFC coordinate link (e.g. [[ALLY] Player S:73559 X:628.7 Y:43.3])',
				required: true,
			},
		],
	},
	{
		name: 'table',
		description: 'Generate an ASCII table from CSV data',
		options: [
			{
				type: 3,
				name: 'csv_data',
				description: 'Inline CSV data. Use /tablehelp for examples.',
				required: false,
			},
			{
				type: 11,
				name: 'csv_file',
				description: 'Upload a .csv file (max 1MB)',
				required: false,
			},
		],
	},
	{
		name: 'tablehelp',
		description: 'Show help and examples for the /table command',
	},
	{
		name: 'player',
		description: 'Look up a player on stfc.pro (requires /server setup)',
		options: [
			{
				type: 3,
				name: 'name',
				description: 'Player name or numeric player ID',
				required: true,
			},
		],
	},
	{
		name: 'verify',
		description: 'Verify your STFC account with a stfc.pro profile link',
		options: [
			{
				type: 3,
				name: 'link',
				description: 'Your stfc.pro player profile URL',
				required: true,
			},
			{
				type: 11,
				name: 'screenshot',
				description: 'Optional screenshot of your in-game profile',
				required: false,
			},
		],
	},
	{
		name: 'server',
		description: 'Configure STFC server settings (admin)',
		options: [
			{
				type: 1,
				name: 'setup',
				description: 'Configure this Discord server for STFC verification',
				options: [
					{
						type: 4,
						name: 'server',
						description: 'STFC server number',
						required: true,
					},
					{
						type: 3,
						name: 'mode',
						description: 'single_alliance or multi_alliance',
						required: false,
						choices: [
							{ name: 'Single alliance', value: 'single_alliance' },
							{ name: 'Multi alliance (whole server)', value: 'multi_alliance' },
						],
					},
					{
						type: 3,
						name: 'region',
						description: 'STFC region',
						required: false,
						choices: [
							{ name: 'US', value: 'US' },
							{ name: 'EU', value: 'EU' },
						],
					},
					{
						type: 3,
						name: 'alliance_tag',
						description: 'Expected alliance tag (required for single alliance mode)',
						required: false,
					},
					{
						type: 3,
						name: 'guest_role',
						description: 'Discord role ID for unverified / wrong-alliance members',
						required: false,
					},
					{
						type: 3,
						name: 'member_roles',
						description: 'Comma-separated Discord role IDs to assign on verification',
						required: false,
					},
				],
			},
			{
				type: 1,
				name: 'status',
				description: 'Show current server configuration',
			},
		],
	},
];

async function registerCommands() {
	const url = `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands`;

	const response = await fetch(url, {
		method: 'PUT',
		headers: {
			Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(commands),
	});

	if (response.ok) {
		const data = await response.json();
		console.log(`✅ Registered ${data.length} commands:`);
		for (const cmd of data) {
			console.log(`  - /${cmd.name}${cmd.options?.some((o) => o.type === 1) ? ' (with subcommands)' : ''}`);
		}
	} else {
		console.error('❌ Failed to register commands:', await response.text());
		process.exit(1);
	}
}

registerCommands().catch(console.error);
