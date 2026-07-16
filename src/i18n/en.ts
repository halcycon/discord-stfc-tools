/**
 * English (default) catalog for player-facing bot messages.
 * Keys use dot notation; placeholders are `{name}` style.
 */
export const en = {
	'locale.picker.prompt':
		'Please choose your preferred language for bot messages.\nWähle deine Sprache / Choisissez votre langue / Elige tu idioma',
	'locale.picker.confirm': '✅ Language set to **{label}**.',
	'locale.picker.already': 'Your language is already **{label}**.',
	'locale.changed': '✅ Preferred language updated to **{label}**.',

	'verify.invite.welcome':
		'Welcome! Please verify your STFC account to access member channels.\n\n' +
		'**Verify via DM (recommended):**\n' +
		'1. Send a **screenshot** of your in-game profile\n' +
		'2. Then send your **stfc.pro profile link**\n\n' +
		'**Or** use `/verify link:<url>` in the server.\n\n' +
		"We'll check your alliance on stfc.pro and assign roles automatically.",

	'verify.dm.no_pending':
		'No pending verification found. Join a configured server first, or use `/verify` there.',
	'verify.dm.multi_guild':
		'You have pending verification in multiple servers. Please use `/verify` in the Discord server you want to join.',
	'verify.dm.need_screenshot':
		'Please send a **screenshot of your in-game profile** first, then your stfc.pro link.\n\nYou can also use `/verify` in the server.',
	'verify.dm.screenshot_received':
		'✅ Screenshot received and archived. Now send your **stfc.pro profile link** (e.g. `https://stfc.pro/player/12345?region=US&server=42`).',
	'verify.dm.need_link': 'Please send your **stfc.pro profile link** to continue verification.',
	'verify.dm.need_locale': 'Please choose your preferred language first (use the buttons above, or run `/language`).',

	'verify.error.invalid_url':
		'Invalid stfc.pro URL. Example: https://stfc.pro/player/12345?region=US&server=1',
	'verify.error.no_server':
		'Could not determine STFC server. Include server in the URL or ask an admin to run `/server setup`.',
	'verify.error.no_player_id': 'Could not extract a player ID or name from that URL.',
	'verify.error.player_not_found': 'No player found on server {server} ({region}) for that link.',
	'verify.error.no_alliance':
		'Player found but has no alliance — on a single-alliance server you must be in the home alliance to verify.',
	'verify.error.lookup_failed': 'Player lookup failed.',

	'verify.result.not_configured':
		'❌ This server is not configured yet. An admin must run `/server setup` first.',
	'verify.result.verified_no_token':
		'✅ Verified **{name}** on stfc.pro, but bot token is not configured — roles were not updated.\n\n{summary}',
	'verify.result.active':
		'✅ Verified and activated **{name}** ({tag}, Ops {level}).\n{notes}\n\n{summary}',
	'verify.result.guest':
		'⏳ Verified **{name}** but alliance **{tag}** does not match **{expected}** — guest role assigned. We will re-check every {hours}h.\n\n{summary}',
	'verify.result.discord_failed':
		'✅ Verified on stfc.pro but failed to update Discord roles: {error}{nickHint}\n\n{summary}',

	'verify.note.roles_updated': 'Roles updated',
	'verify.note.nick': 'Nick: {nick}',
	'verify.note.nick_failed': 'Nick failed (hierarchy/owner?)',
	'verify.note.channel': 'Channel <#{channelId}>',
	'verify.note.diplomacy': 'Diplomacy <#{channelId}>',
	'verify.note.manual': 'Manual by <@{userId}>',

	'verify.hint.nickname_permissions':
		'\n↳ Usually: bot needs **Manage Nicknames**, its role must be **above** the member, and Discord cannot rename the **server owner**.',
	'verify.hint.role_permissions':
		'\n↳ Usually: bot needs **Manage Roles**, and its role must sit **above** every role it assigns (and above the member’s highest role) in Server Settings → Roles.',

	'verify.player_summary':
		'**{name}** (ID {id})\nAlliance: [{alliance}] · Rank: {rank}\nOps {ops} · Power {power}\nServer {server} ({region})',

	'exchange.dm.need_request':
		'📦 **{name}** (Ops {ops}) needs **{resource}**.\nAlliance: [{tag}]\nHit **Help** to claim (first wins), or **Ignore**.',
	'exchange.dm.claimed':
		'🤝 **{donorName}** (Ops {ops}, [{tag}]) claimed your **{resource}** request!\nDiscord: <@{donorId}>\n\nWhen done, tap **Completed**. If they can\'t help, tap **Ask again**.',
	'exchange.dm.request_cancelled':
		'ℹ️ <@{userId}> cancelled their **{resource}** request (#{id}) — no longer needed.',

	'exchange.btn.help': 'Help',
	'exchange.btn.ignore': 'Ignore',
	'exchange.btn.completed': 'Completed',
	'exchange.btn.ask_again': 'Ask again',

	'survey.default_title': 'Survey #{id}',
	'survey.delivery.body': '**{title}**\n{question}\n\nTap a button to respond:',
	'survey.delivery.test_prefix': '🧪 **Test delivery** (only you — votes while draft are not counted)\n\n',
	'survey.delivery.cta': 'Tap a button to respond:',

	// --- DM assistant (HAL / Badgey) ---
	'dm.hal.cant_do_that': "I'm sorry {player_name}, I'm afraid I can't do that.",
	'dm.badgey.hal_admin_hint': '_Administrators: say **menu** for the admin console._',
	'dm.badgey.no_guild':
		"Greetings! I'm **Badgey**, your STFC training hologram! I don't recognize a verified server for you yet. " +
		'Join a configured Discord server and verify (`/verify` or the DM flow), then we can chat!',
	'dm.badgey.pick_guild':
		"Excellent! You're linked to multiple servers. Which one should we work with? (Select a button — procedure requires a clear training context!)",
	'dm.badgey.guild_selected': '✅ Context set to **{guild}**. How may I assist you today?',
	'dm.badgey.menu_intro':
		"**Badgey** online! Admin procedures ready. Select a task — I'll walk you through it step by step. " +
		'Failure is not an option… unless you tap Cancel.',
	'dm.badgey.menu_denied':
		"I'd love to help with admin procedures, but those require **Administrator** (or Manage Server) in that Discord server.",
	'dm.badgey.cancelled': 'Procedure cancelled. Standing by! Say **menu** when you are ready.',
	'dm.badgey.wizard_done': '✅ Procedure complete! Another triumphant day for Starfleet training!',

	'dm.wizard.btn.status': 'Server status',
	'dm.wizard.btn.setup': 'Server setup',
	'dm.wizard.btn.log': 'Verification log',
	'dm.wizard.btn.audit': 'Audit log',
	'dm.wizard.btn.cancel': 'Cancel',
	'dm.wizard.btn.create': 'Create',
	'dm.wizard.btn.link': 'Link existing',
	'dm.wizard.btn.clear': 'Clear',
	'dm.wizard.btn.back': 'Back',
	'dm.wizard.btn.confirm': 'Confirm',
	'dm.wizard.not_configured':
		'This server is not configured yet. Run **Server setup** from the menu (or `/server setup` in Discord).',
	'dm.wizard.status_intro': 'Affirmative! Retrieving server configuration…',
	'dm.wizard.setup.ask_mode': 'Step 1/5 — Choose server **mode**:',
	'dm.wizard.setup.mode_single': 'Single alliance',
	'dm.wizard.setup.mode_multi': 'Multi alliance',
	'dm.wizard.setup.ask_server': 'Step 2/5 — Reply with the **STFC server number** (e.g. `108`).',
	'dm.wizard.setup.ask_region': 'Step 3/5 — Choose **region**:',
	'dm.wizard.setup.ask_tag': 'Step 4/5 — Reply with the expected **alliance tag** (e.g. `KWSN`).',
	'dm.wizard.setup.ask_nick':
		'Step 5/5 — Reply with a **nickname template**, or `skip` for the mode default.\n' +
		'Placeholders: `{player_name}` `{alliance_tag}` `{rank}` `{rank_prefix}` `{rank_paren}`',
	'dm.wizard.setup.confirm':
		'Confirm setup?\n• Mode: **{mode}**\n• STFC: **{server}** ({region})\n• Tag: **{tag}**\n• Nick: `{nick}`\n\n' +
		'(Role lists can still be set with `/server setup` — this wizard covers the core fields.)',
	'dm.wizard.channel.log_intro':
		'Verification log channel (screenshots/archive). Current: {current}\nChoose an action:',
	'dm.wizard.channel.audit_intro':
		'Audit log channel (admin + automated events). Current: {current}\nChoose an action:',
	'dm.wizard.channel.ask_id': 'Reply with the Discord **channel ID** (or a channel mention) to link.',

	'dm.roster.grade_count':
		'Training report: we have **{count}** verified player(s) at **G{grade}**. Efficiency is paramount!',
	'dm.roster.grades_breakdown': 'Grade distribution (verified roster):\n{lines}',
	'dm.roster.alliance_breakdown': 'Alliance breakdown (verified roster):\n{lines}',
	'dm.roster.status_breakdown': 'Verification status breakdown:\n{lines}',
	'dm.roster.empty': 'No verified players found for that query. The training simulation remains… empty.',
	'dm.roster.denied':
		'That roster query is restricted. Ask an admin to allow your role via `/server assistant roles`.',

	// --- Discord agreement / CoC ---
	'agree.btn.accept': 'I agree',
	'agree.dm.body':
		'Please read this server\'s **code of conduct / Discord agreement**, then tap **I agree** below to continue.',
	'agree.dm.channel_link': 'Read it here: <#{channelId}>',
	'agree.dm.version': 'Agreement version: `{version}`',
	'agree.dm.react_coming_soon':
		'_Channel reaction acceptance is coming soon — for now, please use the button below._',
	'agree.gate.before_verify':
		'Please accept data-processing consent first (tap **I agree** in the DM above), then send your screenshot / stfc.pro link.',
	'agree.result.accepted': '✅ Agreement recorded. Thank you!',
	'agree.result.already': 'You have already accepted the current agreement.',
	'agree.result.not_required': 'No agreement is required on this server.',
	'agree.result.continue_verify':
		'You can continue verification: send a **profile screenshot**, then your **stfc.pro link**.',
	'agree.result.access_granted': 'Full member access granted for **{name}**.',
	'agree.result.guest_ok': 'Agreement recorded. You remain on the guest roster until your alliance matches.',
	'agree.result.access_failed': 'Agreement recorded, but updating Discord roles failed — ask an admin.',

	'consent.dm.body':
		'To verify you on this Discord server, we need to **link your Discord account** to your ' +
		'**Star Trek Fleet Command** player identity (in-game name and public profile data from stfc.pro).\n\n' +
		'We use this information **only** to confirm who you are, assign the correct roles and channels, ' +
		'and operate alliance membership tools on this server.',
	'consent.dm.details':
		'By tapping **I agree**, you consent to this processing. ' +
		'If you tap **I do not agree**, we will not run verification and will not look up your stfc.pro profile.\n\n' +
		'You can ask a server admin about how this data is used. This consent is separate from any optional server code of conduct.',
	'consent.dm.version': 'Consent version: `{version}`',
	'consent.btn.yes': 'I agree',
	'consent.btn.no': 'I do not agree',
	'consent.result.accepted': '✅ Thank you — your consent has been recorded.',
	'consent.result.declined':
		'Understood. Without this consent we cannot verify you or look up your stfc.pro profile.\n\n' +
		'If you change your mind later, start again with `/verify` or ask an admin to re-send the invite.',
	'consent.result.already': 'You have already accepted the current data-processing consent.',
	'consent.result.not_required': 'Data-processing consent is not required on this server.',
	'consent.result.continue_verify':
		'Next: send a **screenshot** of your in-game profile, then your **stfc.pro profile link** ' +
		'(or use `/verify link:<url>` in the server).',
	'consent.gate.required':
		'Please accept **data-processing consent** first (use the buttons in the DM above), ' +
		'then send your screenshot / stfc.pro link.',

	'verify.note.agreement_pending': 'Awaiting CoC agreement (guest/lounge access for now)',
	'verify.result.needs_agreement':
		'✅ Verified **{name}** ({tag}, Ops {level}) on stfc.pro.\n' +
		'Please accept the **Discord agreement** in your DMs to unlock full member access (guest/lounge for now).\n\n{summary}',

	'verify.demote.dm.mismatch':
		'We detected that your player profile on stfc.pro no longer reflects **[{tag}]** as your alliance. ' +
		'If you feel this is in error, please click the button below to restart the verification process.',
	'verify.demote.dm.missing':
		'We could not find your player profile on stfc.pro anymore. ' +
		'If you feel this is in error, please click the button below to restart the verification process.',
	'verify.demote.btn.restart': 'Restart verification',
	'verify.demote.restarted':
		'✅ Verification restarted. Please send a **screenshot** of your in-game profile, then your **stfc.pro link**.\n\n' +
		'Or use `/verify link:<url>` in the server.',
	'verify.demote.restart_failed':
		'❌ Could not restart verification. Please use `/verify` in the server, or ask an admin.',

	'welcome.dm.personal_channel': 'Your personal member channel: <#{channelId}>',
	'welcome.dm.fetch_failed':
		'Could not fetch the welcome message (bot needs View Channel + Read Message History). {detail}',
} as const;

export type MessageKey = keyof typeof en;
export type MessageCatalog = Record<MessageKey, string>;
