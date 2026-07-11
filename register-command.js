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
		name: 'language',
		description: 'Choose your preferred language for bot DMs and messages',
	},
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
		name: 'roster',
		description: 'List verified players / find unverified Discord members',
		options: [
			{
				type: 1,
				name: 'grades',
				description: 'Count verified players by grade (G3–G7)',
			},
			{
				type: 1,
				name: 'grade',
				description: 'List verified players at a grade',
				options: [
					{
						type: 4,
						name: 'grade',
						description: 'Grade number 3–7',
						required: true,
						min_value: 3,
						max_value: 7,
					},
				],
			},
			{
				type: 1,
				name: 'ops',
				description: 'List verified players by ops level range',
				options: [
					{
						type: 4,
						name: 'min',
						description: 'Minimum ops level (inclusive)',
						required: false,
						min_value: 1,
						max_value: 99,
					},
					{
						type: 4,
						name: 'max',
						description: 'Maximum ops level (inclusive)',
						required: false,
						min_value: 1,
						max_value: 99,
					},
				],
			},
			{
				type: 1,
				name: 'unverified',
				description: 'Discord members not linked to a verified player (excludes bots + exclude list)',
			},
			{
				type: 1,
				name: 'status',
				description: 'Count verified players by status (active / guest)',
			},
			{
				type: 1,
				name: 'alliances',
				description: 'Count verified players by alliance tag',
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
				name: 'assistant',
				description: 'Admin: DM assistant roster query roles and optional AI flag',
				options: [
					{
						type: 3,
						name: 'roles',
						description: 'Roles that may ask roster questions in DMs (empty = admins only)',
						required: false,
					},
					{
						type: 5,
						name: 'ai',
						description: 'Enable optional Workers AI intent assist for this guild (default off)',
						required: false,
					},
				],
			},
			{
				type: 1,
				name: 'agreement',
				description: 'Admin: Discord agreement / CoC gate (DM button; reaction later)',
				options: [
					{
						type: 5,
						name: 'enabled',
						description: 'Require agreement acceptance',
						required: false,
					},
					{
						type: 3,
						name: 'timing',
						description: 'before_verify or after_verify (default after = guest lounge until agree)',
						required: false,
						choices: [
							{ name: 'After verify (guest lounge until agree)', value: 'after_verify' },
							{ name: 'Before verify (must agree first)', value: 'before_verify' },
						],
					},
					{
						type: 3,
						name: 'mode',
						description: 'dm_button (shipped) or channel_react (planned)',
						required: false,
						choices: [
							{ name: 'DM Agree button', value: 'dm_button' },
							{ name: 'Channel reaction (coming soon)', value: 'channel_react' },
						],
					},
					{
						type: 7,
						name: 'channel',
						description: 'Channel containing the agreement / CoC (linked in DM)',
						required: false,
						channel_types: [0],
					},
					{
						type: 3,
						name: 'message_id',
						description: 'Optional message ID for future reaction mode',
						required: false,
					},
					{
						type: 3,
						name: 'version',
						description: 'Bump to force re-accept after CoC changes (e.g. 2026-07)',
						required: false,
					},
					{
						type: 5,
						name: 'clear_channel',
						description: 'Clear linked channel / message ID',
						required: false,
					},
				],
			},
			{
				type: 1,
				name: 'verify',
				description: 'Admin: manually verify a member with an stfc.pro link (no DM flow)',
				options: [
					{
						type: 6,
						name: 'user',
						description: 'Discord member to verify',
						required: true,
					},
					{
						type: 3,
						name: 'link',
						description: 'stfc.pro player profile URL',
						required: true,
					},
					{
						type: 11,
						name: 'screenshot',
						description: 'Optional screenshot of their in-game profile',
						required: false,
					},
				],
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
				name: 'exclude-add',
				description: 'Exclude a Discord user from invites and unverified stats',
				options: [
					{
						type: 6,
						name: 'user',
						description: 'Discord user to exclude',
						required: true,
					},
					{
						type: 3,
						name: 'reason',
						description: 'Optional note (e.g. other bot, alt)',
						required: false,
					},
				],
			},
			{
				type: 1,
				name: 'exclude-remove',
				description: 'Remove a user from the exclude list',
				options: [
					{
						type: 6,
						name: 'user',
						description: 'Discord user to un-exclude',
						required: true,
					},
				],
			},
			{
				type: 1,
				name: 'exclude-list',
				description: 'List excluded users',
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
								channel_types: [0, 5],
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
						name: 'permissions-audit',
						description:
							'Read-only dump of member-channel permission overwrites (does not sync/rewrite)',
					},
					{
						type: 1,
						name: 'permissions-template-from',
						description: 'Lock permission overwrites from a sample member channel',
						options: [
							{
								type: 7,
								name: 'channel',
								description: 'Existing member channel to copy permissions from',
								required: true,
								channel_types: [0, 5],
							},
							{
								type: 6,
								name: 'member',
								description: 'Channel owner (required if channel is not linked yet)',
								required: false,
							},
							{
								type: 5,
								name: 'sync_extra_roles',
								description: 'Also set extra-roles from role overwrites (default true)',
								required: false,
							},
						],
					},
					{
						type: 1,
						name: 'permissions-template-show',
						description: 'Show the locked-in (or default) permission template',
					},
					{
						type: 1,
						name: 'permissions-template-clear',
						description: 'Clear locked template and return to built-in defaults',
					},
					{
						type: 1,
						name: 'plan',
						description: 'Dry-run: suggest letter-range category splits from member names',
						options: [
							{
								type: 4,
								name: 'soft_limit',
								description: 'Max channels per category (default 45)',
								required: false,
								min_value: 10,
								max_value: 50,
							},
						],
					},
					{
						type: 1,
						name: 'rebalance',
						description: 'Create/rename categories, update map, and move member channels',
						options: [
							{
								type: 5,
								name: 'apply',
								description: 'Actually apply changes (default false = preview only)',
								required: false,
							},
							{
								type: 4,
								name: 'soft_limit',
								description: 'Max channels per category (default 45)',
								required: false,
								min_value: 10,
								max_value: 50,
							},
							{
								type: 3,
								name: 'name_template',
								description: 'Category name template (default: Member Channels {range})',
								required: false,
							},
							{
								type: 5,
								name: 'rename_categories',
								description: 'Rename existing mapped categories to match new ranges (default true)',
								required: false,
							},
							{
								type: 5,
								name: 'create_categories',
								description: 'Create Discord categories when more buckets are needed (default true)',
								required: false,
							},
							{
								type: 5,
								name: 'create_missing',
								description: 'Create personal channels for verified players who have none (default false)',
								required: false,
							},
							{
								type: 5,
								name: 'archive_unlinked',
								description: 'Move unlinked member-category channels to archive (default true)',
								required: false,
							},
							{
								type: 7,
								name: 'archive_category',
								description: 'Existing archive category',
								required: false,
								channel_types: [4],
							},
							{
								type: 3,
								name: 'archive_name',
								description: 'Find or create archive category by name (default: Member Channels Archive)',
								required: false,
							},
						],
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
								description: 'Legacy single category (prefer sync_all letter buckets)',
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
								channel_types: [0, 5],
							},
							{
								type: 5,
								name: 'apply_permissions',
								description: 'When linking/syncing, rewrite perms from config (default true)',
								required: false,
							},
							{
								type: 5,
								name: 'sync_all',
								description:
									'Letter-bucket categories + rename/move/A–Z sort all diplomacy channels',
								required: false,
							},
							{
								type: 5,
								name: 'plan',
								description: 'With sync_all: preview letter buckets only (no writes)',
								required: false,
							},
							{
								type: 4,
								name: 'soft_limit',
								description: 'With sync_all: max channels per category (10–50, default 45)',
								required: false,
								min_value: 10,
								max_value: 50,
							},
							{
								type: 3,
								name: 'category_name_template',
								description:
									'With sync_all: category name; use {range} (default Diplomacy Channels {range})',
								required: false,
							},
							{
								type: 5,
								name: 'create_categories',
								description: 'With sync_all: create missing letter-bucket categories (default true)',
								required: false,
							},
							{
								type: 5,
								name: 'rename_categories',
								description: 'With sync_all: rename categories to template (default true)',
								required: false,
							},
							{
								type: 5,
								name: 'create_missing',
								description: 'With sync_all: also create channels for verified alliance tags',
								required: false,
							},
							{
								type: 5,
								name: 'archive_unlinked',
								description:
									'With sync_all: move unlinked channels under diplomacy cats to archive (default true)',
								required: false,
							},
							{
								type: 7,
								name: 'archive_category',
								description: 'With sync_all: archive category target',
								required: false,
								channel_types: [4],
							},
							{
								type: 3,
								name: 'archive_name',
								description:
									'With sync_all: find/create archive by name (default Diplomacy Channels Archive)',
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
					{
						type: 1,
						name: 'audit',
						description: 'Set or create the general bot audit log channel',
						options: [
							{
								type: 7,
								name: 'channel',
								description: 'Existing text channel for bot audit events',
								required: false,
							},
							{
								type: 5,
								name: 'create',
								description: 'Create a private bot-audit-log channel',
								required: false,
							},
							{
								type: 3,
								name: 'name',
								description: 'Name when create:true (default bot-audit-log)',
								required: false,
							},
							{
								type: 5,
								name: 'clear',
								description: 'Disable audit log posting',
								required: false,
							},
						],
					},
					{
						type: 1,
						name: 'urgent',
						description: 'Set or create the urgent staff alert channel (DM blocked, etc.)',
						options: [
							{
								type: 7,
								name: 'channel',
								description: 'Existing text channel for urgent alerts',
								required: false,
							},
							{
								type: 5,
								name: 'create',
								description: 'Create a private bot-urgent channel',
								required: false,
							},
							{
								type: 3,
								name: 'name',
								description: 'Name when create:true (default bot-urgent)',
								required: false,
							},
							{
								type: 5,
								name: 'clear',
								description: 'Disable urgent alert posting',
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
	{
		name: 'exchange',
		description: 'Cross-alliance resource exchange (donors / recipients)',
		options: [
			{
				type: 1,
				name: 'setup',
				description: 'Admin: hub or category layout for resource exchange',
				options: [
					{
						type: 3,
						name: 'layout',
						description: 'hub = one channel; category = channel per resource',
						required: false,
						choices: [
							{ name: 'Hub (one channel, pinned posts)', value: 'hub' },
							{ name: 'Category (channel per resource)', value: 'category' },
						],
					},
					{
						type: 7,
						name: 'channel',
						description: 'Hub text channel (layout hub)',
						required: false,
						channel_types: [0],
					},
					{
						type: 7,
						name: 'category',
						description: 'Category for per-resource channels',
						required: false,
						channel_types: [4],
					},
					{
						type: 5,
						name: 'create_category',
						description: 'Create a category named Resource Exchange (or category_name)',
						required: false,
					},
					{
						type: 3,
						name: 'category_name',
						description: 'Name when create_category:true',
						required: false,
					},
					{
						type: 3,
						name: 'admin_roles',
						description: 'Roles that can manage resources (comma-separated)',
						required: false,
					},
					{
						type: 5,
						name: 'clear',
						description: 'Clear exchange layout settings',
						required: false,
					},
				],
			},
			{
				type: 2,
				name: 'resource',
				description: 'Manage exchange resources',
				options: [
					{
						type: 1,
						name: 'create',
						description: 'Create a resource (roles + pin + optional channel)',
						options: [
							{
								type: 3,
								name: 'name',
								description: 'Resource name (e.g. Crystal)',
								required: true,
							},
						],
					},
					{
						type: 1,
						name: 'list',
						description: 'List exchange resources',
					},
					{
						type: 1,
						name: 'disable',
						description: 'Disable a resource (unpin, close buttons)',
						options: [
							{
								type: 4,
								name: 'id',
								description: 'Resource id from /exchange resource list',
								required: false,
							},
							{
								type: 3,
								name: 'name',
								description: 'Resource name or slug',
								required: false,
							},
						],
					},
				],
			},
			{
				type: 1,
				name: 'donate',
				description: 'Register as a donor for a resource',
				options: [
					{
						type: 3,
						name: 'resource',
						description: 'Resource name or slug',
						required: true,
					},
				],
			},
			{
				type: 1,
				name: 'undonate',
				description: 'Stop being a donor for a resource',
				options: [
					{
						type: 3,
						name: 'resource',
						description: 'Resource name or slug',
						required: true,
					},
				],
			},
			{
				type: 1,
				name: 'need',
				description: 'Request a resource (notifies cross-alliance donors)',
				options: [
					{
						type: 3,
						name: 'resource',
						description: 'Resource name or slug',
						required: true,
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
