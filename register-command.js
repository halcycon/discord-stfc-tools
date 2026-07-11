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
					{
						type: 5,
						name: 'create_missing_roles',
						description: 'If a provided role name does not exist, create it (by name)',
						required: false,
					},
					{
						type: 3,
						name: 'operative_roles',
						description: 'Comma-separated Discord role IDs for alliance rank Operative',
						required: false,
					},
					{
						type: 3,
						name: 'agent_roles',
						description: 'Comma-separated Discord role IDs for alliance rank Agent',
						required: false,
					},
					{
						type: 3,
						name: 'premier_roles',
						description: 'Comma-separated Discord role IDs for alliance rank Premier',
						required: false,
					},
					{
						type: 3,
						name: 'commodore_roles',
						description: 'Comma-separated Discord role IDs for alliance rank Commodore',
						required: false,
					},
					{
						type: 3,
						name: 'admiral_roles',
						description: 'Comma-separated Discord role IDs for alliance rank Admiral',
						required: false,
					},
					{
						type: 3,
						name: 'nickname_template',
						description:
							'Nick pattern ({player_name} {alliance_tag} {rank} {rank_prefix} {rank_paren}); empty=default',
						required: false,
					},
				],
			},
			{
				type: 1,
				name: 'status',
				description: 'Show current server configuration',
			},
			{
				type: 1,
				name: 'test-invite',
				description: 'Admin: send verification DM (simulate new member join)',
				options: [
					{
						type: 6,
						name: 'user',
						description: 'User to test (defaults to you)',
						required: false,
					},
				],
			},
			{
				type: 1,
				name: 'test-reset',
				description: 'Admin: clear verification so you can test again',
				options: [
					{
						type: 6,
						name: 'user',
						description: 'User to reset (defaults to you)',
						required: false,
					},
				],
			},
			{
				type: 1,
				name: 'gateway',
				description: 'Admin: show Discord Gateway connection status',
			},
			{
				type: 1,
				name: 'roles',
				description: 'Admin: list roles and IDs',
				options: [
					{
						type: 4,
						name: 'limit',
						description: 'Max roles to show (5-50)',
						required: false,
					},
				],
			},
			{
				type: 1,
				name: 'bucket',
				description: 'Admin: configure named overlay buckets (e.g. leadership)',
				options: [
					{
						type: 3,
						name: 'name',
						description: 'Bucket name (e.g. leadership)',
						required: true,
					},
					{
						type: 3,
						name: 'ranks',
						description: 'Comma-separated ranks (Operative,Agent,Premier,Commodore,Admiral)',
						required: true,
					},
					{
						type: 3,
						name: 'role_ids',
						description: 'Comma-separated Discord role IDs or mentions to add',
						required: false,
					},
					{
						type: 5,
						name: 'create_if_missing',
						description: 'If a provided role name does not exist, create it (by name)',
						required: false,
					},
				],
			},
			{
				type: 1,
				name: 'rank-roles',
				description: 'Admin: show resolved Discord roles for a given in-game rank',
				options: [
					{
						type: 3,
						name: 'rank',
						description: 'Operative, Agent, Premier, Commodore, Admiral',
						required: true,
					},
				],
			},
			{
				type: 1,
				name: 'categories',
				description: 'Admin: list channel categories and IDs',
				options: [
					{
						type: 4,
						name: 'limit',
						description: 'Max categories to show (5-50)',
						required: false,
					},
				],
			},
			{
				type: 2,
				name: 'channels',
				description: 'Admin: configure personal member channels',
				options: [
					{
						type: 1,
						name: 'map',
						description: 'Set letter-range to category mappings',
						options: [
							{
								type: 3,
								name: 'category_map',
								description: 'Bulk map e.g. A-F=123,G-M=456',
								required: false,
							},
							{
								type: 3,
								name: 'range',
								description: 'Single letter range e.g. A-F or M',
								required: false,
							},
							{
								type: 3,
								name: 'category_id',
								description: 'Category snowflake for single range',
								required: false,
							},
							{
								type: 5,
								name: 'clear',
								description: 'Clear all category mappings',
								required: false,
							},
						],
					},
					{
						type: 1,
						name: 'extra-roles',
						description: 'Roles that can access all personal channels',
						options: [
							{
								type: 3,
								name: 'roles',
								description: 'Comma-separated role IDs, mentions, or names',
								required: false,
							},
							{
								type: 5,
								name: 'create_if_missing',
								description: 'Create roles by name if they do not exist',
								required: false,
							},
						],
					},
					{
						type: 1,
						name: 'link',
						description: 'Link an existing member/diplomacy channel to a verified player',
						options: [
							{
								type: 7,
								name: 'channel',
								description: 'Existing text channel to link',
								required: true,
							},
							{
								type: 3,
								name: 'player',
								description: 'In-game name, STFC player ID, or Discord user ID',
								required: false,
							},
							{
								type: 6,
								name: 'user',
								description: 'Discord member (alternative to player)',
								required: false,
							},
							{
								type: 5,
								name: 'apply_permissions',
								description: 'Rewrite channel perms for member+extra-roles (default true)',
								required: false,
							},
						],
					},
					{
						type: 1,
						name: 'status',
						description: 'Show personal channel configuration',
					},
					{
						type: 1,
						name: 'diplomacy',
						description: 'Configure multi-alliance diplomacy channels (per alliance tag)',
						options: [
							{
								type: 5,
								name: 'enable',
								description: 'Enable diplomacy channels and save config options',
								required: false,
							},
							{
								type: 5,
								name: 'disable',
								description: 'Disable auto-create (keeps existing links)',
								required: false,
							},
							{
								type: 5,
								name: 'everyone_can_view',
								description: 'If true, @everyone can see channels (default true)',
								required: false,
							},
							{
								type: 7,
								name: 'category',
								description: 'Category for newly created diplomacy channels',
								required: false,
								channel_types: [4],
							},
							{
								type: 3,
								name: 'view_roles',
								description: 'Roles that can view when everyone_can_view is false',
								required: false,
							},
							{
								type: 3,
								name: 'write_roles',
								description: 'Roles that can write (e.g. Diplomat)',
								required: false,
							},
							{
								type: 3,
								name: 'write_ranks',
								description: 'Ranks that can write via their Discord roles (e.g. Commodore,Admiral)',
								required: false,
							},
							{
								type: 3,
								name: 'name_template',
								description: 'Channel name pattern; use {tag} (default diplomacy-{tag})',
								required: false,
							},
							{
								type: 3,
								name: 'create_tag',
								description: 'Create/update diplomacy channel for this alliance tag',
								required: false,
							},
							{
								type: 3,
								name: 'link_tag',
								description: 'Adopt existing channel for this alliance tag',
								required: false,
							},
							{
								type: 7,
								name: 'channel',
								description: 'Existing text channel (with link_tag)',
								required: false,
								channel_types: [0],
							},
							{
								type: 5,
								name: 'apply_permissions',
								description: 'When linking, rewrite perms from config (default true)',
								required: false,
							},
						],
					},
					{
						type: 1,
						name: 'log',
						description: 'Set or create the admin verification log channel',
						options: [
							{
								type: 7,
								name: 'channel',
								description: 'Existing text channel for verification archives',
								required: false,
							},
							{
								type: 5,
								name: 'create',
								description: 'Create a private verification-log channel',
								required: false,
							},
							{
								type: 3,
								name: 'name',
								description: 'Name when create:true (default verification-log)',
								required: false,
							},
							{
								type: 5,
								name: 'clear',
								description: 'Disable verification log posting',
								required: false,
							},
						],
					},
				],
			},
		],
	},
	{
		name: 'survey',
		description: 'Create and manage button surveys / polls for verified players',
		options: [
			{
				type: 1,
				name: 'create',
				description: 'Draft a survey (test, then approve & send)',
				options: [
					{
						type: 3,
						name: 'question',
						description: 'Survey question shown to players',
						required: true,
					},
					{
						type: 3,
						name: 'options',
						description: 'Answers separated by | (2–5), e.g. Yes|No|Maybe',
						required: true,
					},
					{
						type: 3,
						name: 'target',
						description: 'Who receives it (default all verified)',
						required: false,
						choices: [
							{ name: 'All verified', value: 'all' },
							{ name: 'Discord role', value: 'role' },
							{ name: 'In-game rank', value: 'rank' },
							{ name: 'Ops level range', value: 'level' },
							{ name: 'Ops grade (G3–G7)', value: 'grade' },
							{ name: 'Specific users', value: 'users' },
						],
					},
					{
						type: 3,
						name: 'delivery',
						description: 'Where to send (default dm)',
						required: false,
						choices: [
							{ name: 'Direct message', value: 'dm' },
							{ name: 'Personal channel (DM fallback)', value: 'personal_channel' },
						],
					},
					{
						type: 3,
						name: 'grades',
						description: 'For target:grade — e.g. 5,6',
						required: false,
					},
					{
						type: 3,
						name: 'ranks',
						description: 'For target:rank — e.g. Commodore,Admiral',
						required: false,
					},
					{
						type: 3,
						name: 'roles',
						description: 'For target:role — role IDs or <@&id>, comma-separated',
						required: false,
					},
					{
						type: 3,
						name: 'users',
						description: 'For target:users — Discord IDs or <@id>, comma-separated',
						required: false,
					},
					{
						type: 4,
						name: 'ops_min',
						description: 'For target:level — minimum ops',
						required: false,
						min_value: 1,
						max_value: 80,
					},
					{
						type: 4,
						name: 'ops_max',
						description: 'For target:level — maximum ops',
						required: false,
						min_value: 1,
						max_value: 80,
					},
					{
						type: 3,
						name: 'alliance_tags',
						description: 'Optional filter — tags comma-separated',
						required: false,
					},
					{
						type: 7,
						name: 'log_category',
						description: 'Category for this survey’s log channel (else server default)',
						required: false,
						channel_types: [4],
					},
				],
			},
			{
				type: 1,
				name: 'list',
				description: 'List recent surveys for this server',
			},
			{
				type: 1,
				name: 'results',
				description: 'Show vote summary tables for a survey',
				options: [
					{
						type: 4,
						name: 'id',
						description: 'Survey ID from /survey list',
						required: true,
					},
				],
			},
			{
				type: 1,
				name: 'close',
				description: 'Close a survey (no more votes)',
				options: [
					{
						type: 4,
						name: 'id',
						description: 'Survey ID to close',
						required: true,
					},
				],
			},
			{
				type: 1,
				name: 'creators',
				description: 'Admin: survey roles, log viewers, and log channel name',
				options: [
					{
						type: 3,
						name: 'roles',
						description: 'Creator role IDs or mentions, comma-separated (empty = admins)',
						required: false,
					},
					{
						type: 3,
						name: 'results_roles',
						description: 'Roles that see private survey log channels + /survey results',
						required: false,
					},
					{
						type: 3,
						name: 'log_name',
						description: 'Log channel name template; use {id} (default survey-{id})',
						required: false,
					},
					{
						type: 7,
						name: 'category',
						description: 'Existing category for new survey log channels',
						required: false,
						channel_types: [4],
					},
					{
						type: 5,
						name: 'create_category',
						description: 'Create a private category and use it for survey logs',
						required: false,
					},
					{
						type: 3,
						name: 'category_name',
						description: 'Name when create_category:true (default Surveys)',
						required: false,
					},
					{
						type: 5,
						name: 'clear_category',
						description: 'Stop putting new survey logs in a category',
						required: false,
					},
				],
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
