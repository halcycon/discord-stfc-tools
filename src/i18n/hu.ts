import type { MessageCatalog } from './en';

/** Hungarian */
export const hu: MessageCatalog = {
	'locale.picker.prompt':
		'Válaszd ki a botüzenetek preferált nyelvét.\nPlease choose your preferred language / Wähle deine Sprache',
	'locale.picker.confirm': '✅ Nyelv beállítva: **{label}**.',
	'locale.picker.already': 'A nyelved már **{label}**.',
	'locale.changed': '✅ Preferált nyelv frissítve: **{label}**.',

	'verify.invite.welcome':
		'Üdvözlünk! Igazold az STFC-fiókodat a tagcsatornák eléréséhez.\n\n' +
		'**Igazolás DM-ben (ajánlott):**\n' +
		'1. Küldj egy **képernyőképet** a játékbeli profilodról\n' +
		'2. Utána küldd el az **stfc.pro profil linked**\n\n' +
		'**Vagy** használd a `/verify link:<url>` parancsot a szerveren.\n\n' +
		'Ellenőrizzük a szövetségedet az stfc.pro-n, és automatikusan kiosztjuk a szerepeket.',

	'verify.dm.no_pending':
		'Nincs függőben lévő igazolás. Először csatlakozz egy beállított szerverhez, vagy használd ott a `/verify` parancsot.',
	'verify.dm.multi_guild':
		'Több szerveren is van függő igazolásod. Használd a `/verify` parancsot azon a Discord-szerveren, amelyhez csatlakozni szeretnél.',
	'verify.dm.need_screenshot':
		'Először küldj egy **képernyőképet a játékbeli profilodról**, majd az stfc.pro linked.\n\nA szerveren a `/verify` is használható.',
	'verify.dm.screenshot_received':
		'✅ Képernyőkép megérkezett és archiválva. Most küldd el az **stfc.pro profil linked** (pl. `https://stfc.pro/player/12345?region=US&server=42`).',
	'verify.dm.need_link': 'Küldd el az **stfc.pro profil linked** az igazolás folytatásához.',
	'verify.dm.need_locale':
		'Először válaszd ki a nyelved (a fenti gombokkal, vagy `/language`).',

	'verify.error.invalid_url':
		'Érvénytelen stfc.pro URL. Példa: https://stfc.pro/player/12345?region=US&server=1',
	'verify.error.no_server':
		'Nem sikerült meghatározni az STFC-szervert. Add meg a szervert az URL-ben, vagy kérj admin `/server setup`-ot.',
	'verify.error.no_player_id': 'Nem sikerült játékos-azonosítót vagy nevet kinyerni ebből az URL-ből.',
	'verify.error.player_not_found':
		'Nem található játékos a(z) {server} szerveren ({region}) ehhez a linkhez.',
	'verify.error.no_alliance':
		'Játékos megtalálva, de nincs szövetsége — az igazoláshoz szövetségben kell lenned.',
	'verify.error.lookup_failed': 'A játékos keresése sikertelen.',

	'verify.result.not_configured':
		'❌ Ez a szerver még nincs beállítva. Egy adminnak először futtatnia kell a `/server setup` parancsot.',
	'verify.result.verified_no_token':
		'✅ **{name}** igazolva az stfc.pro-n, de a bot token nincs beállítva — a szerepek nem frissültek.\n\n{summary}',
	'verify.result.active':
		'✅ Igazolva és aktiválva: **{name}** ({tag}, Ops {level}).\n{notes}\n\n{summary}',
	'verify.result.guest':
		'⏳ **{name}** igazolva, de a **{tag}** szövetség nem egyezik a várt **{expected}** értékkel — vendég szerep kiosztva. {hours} óránként újraellenőrizzük.\n\n{summary}',
	'verify.result.discord_failed':
		'✅ Igazolva az stfc.pro-n, de a Discord szerepek frissítése sikertelen: {error}{nickHint}\n\n{summary}',

	'verify.note.roles_updated': 'Szerepek frissítve',
	'verify.note.nick': 'Becenév: {nick}',
	'verify.note.nick_failed': 'Becenév sikertelen (hierarchia/tulajdonos?)',
	'verify.note.channel': 'Csatorna <#{channelId}>',
	'verify.note.diplomacy': 'Diplomácia <#{channelId}>',
	'verify.note.manual': 'Kézi: <@{userId}>',

	'verify.hint.nickname_permissions':
		'\n↳ Általában: a botnak kell a **Becenevek kezelése**, a szerepének **a tag felett** kell lennie, és a Discord nem tudja átnevezni a **szerver tulajdonosát**.',
	'verify.hint.role_permissions':
		'\n↳ Általában: a botnak kell a **Szerepek kezelése**, és a szerepének **minden kiosztott szerep felett** kell lennie (és a tag legmagasabb szerepe felett) a Szerverbeállítások → Szerepek listában.',

	'verify.player_summary':
		'**{name}** (ID {id})\nSzövetség: [{alliance}] · Rang: {rank}\nOps {ops} · Power {power}\nSzerver {server} ({region})',

	'exchange.dm.need_request':
		'📦 **{name}** (Ops {ops}) **{resource}**-t kér.\nSzövetség: [{tag}]\nNyomj **Help**-et a foglaláshoz (aki előbb, az nyer), vagy **Ignore**.',
	'exchange.dm.claimed':
		'🤝 **{donorName}** (Ops {ops}, [{tag}]) elfogadta a **{resource}** kérésedet!\nDiscord: <@{donorId}>\n\nHa kész: **Completed**. Ha mégsem tud segíteni: **Ask again**.',
	'exchange.dm.request_cancelled':
		'ℹ️ <@{userId}> visszavonta a **{resource}** kérését (#{id}) — már nincs rá szükség.',

	'exchange.btn.help': 'Help',
	'exchange.btn.ignore': 'Ignore',
	'exchange.btn.completed': 'Completed',
	'exchange.btn.ask_again': 'Ask again',

	'survey.default_title': 'Felmérés #{id}',
	'survey.delivery.body': '**{title}**\n{question}\n\nNyomj egy gombot a válaszhoz:',
	'survey.delivery.test_prefix':
		'🧪 **Tesztküldés** (csak neked — a piszkozatban adott szavazatok nem számítanak)\n\n',
	'survey.delivery.cta': 'Nyomj egy gombot a válaszhoz:',

	'dm.hal.cant_do_that': "Sajnálom {player_name}, attól tartok, ezt nem tehetem meg.",
	'dm.badgey.hal_admin_hint': "_Administrators: say **menu** for the admin console._",
	'dm.badgey.no_guild': "Greetings! I'm **Badgey**, your STFC training hologram! I don't recognize a verified server for you yet. Join a configured Discord server and verify (`/verify` or the DM flow), then we can chat!",
	'dm.badgey.pick_guild': "Excellent! You're linked to multiple servers. Which one should we work with? (Select a button — procedure requires a clear training context!)",
	'dm.badgey.guild_selected': "✅ Context set to **{guild}**. How may I assist you today?",
	'dm.badgey.menu_intro': "**Badgey** online! Admin procedures ready. Select a task — I'll walk you through it step by step. Failure is not an option… unless you tap Cancel.",
	'dm.badgey.menu_denied': "I'd love to help with admin procedures, but those require **Administrator** (or Manage Server) in that Discord server.",
	'dm.badgey.cancelled': "Procedure cancelled. Standing by! Say **menu** when you are ready.",
	'dm.badgey.wizard_done': "✅ Procedure complete! Another triumphant day for Starfleet training!",
	'dm.wizard.btn.status': "Server status",
	'dm.wizard.btn.setup': "Server setup",
	'dm.wizard.btn.log': "Verification log",
	'dm.wizard.btn.audit': "Audit log",
	'dm.wizard.btn.cancel': "Cancel",
	'dm.wizard.btn.create': "Create",
	'dm.wizard.btn.link': "Link existing",
	'dm.wizard.btn.clear': "Clear",
	'dm.wizard.btn.back': "Back",
	'dm.wizard.btn.confirm': "Confirm",
	'dm.wizard.not_configured': "This server is not configured yet. Run **Server setup** from the menu (or `/server setup` in Discord).",
	'dm.wizard.status_intro': "Affirmative! Retrieving server configuration…",
	'dm.wizard.setup.ask_mode': "Step 1/5 — Choose server **mode**:",
	'dm.wizard.setup.mode_single': "Single alliance",
	'dm.wizard.setup.mode_multi': "Multi alliance",
	'dm.wizard.setup.ask_server': "Step 2/5 — Reply with the **STFC server number** (e.g. `108`).",
	'dm.wizard.setup.ask_region': "Step 3/5 — Choose **region**:",
	'dm.wizard.setup.ask_tag': "Step 4/5 — Reply with the expected **alliance tag** (e.g. `KWSN`).",
	'dm.wizard.setup.ask_nick': "Step 5/5 — Reply with a **nickname template**, or `skip` for the mode default.\nPlaceholders: `{player_name}` `{alliance_tag}` `{rank}` `{rank_prefix}` `{rank_paren}`",
	'dm.wizard.setup.confirm': "Confirm setup?\n• Mode: **{mode}**\n• STFC: **{server}** ({region})\n• Tag: **{tag}**\n• Nick: `{nick}`\n\n(Role lists can still be set with `/server setup` — this wizard covers the core fields.)",
	'dm.wizard.channel.log_intro': "Verification log channel (screenshots/archive). Current: {current}\nChoose an action:",
	'dm.wizard.channel.audit_intro': "Audit log channel (admin + automated events). Current: {current}\nChoose an action:",
	'dm.wizard.channel.ask_id': "Reply with the Discord **channel ID** (or a channel mention) to link.",
	'dm.roster.grade_count': "Training report: we have **{count}** verified player(s) at **G{grade}**. Efficiency is paramount!",
	'dm.roster.grades_breakdown': "Grade distribution (verified roster):\n{lines}",
	'dm.roster.alliance_breakdown': "Alliance breakdown (verified roster):\n{lines}",
	'dm.roster.status_breakdown': "Verification status breakdown:\n{lines}",
	'dm.roster.empty': "No verified players found for that query. The training simulation remains… empty.",
	'dm.roster.denied': "That roster query is restricted. Ask an admin to allow your role via `/server assistant roles`.",

	'agree.btn.accept': "I agree",
	'agree.dm.body': "Please read this server's **Discord agreement / code of conduct**, then tap **I agree** below to continue.",
	'agree.dm.channel_link': "Read it here: <#{channelId}>",
	'agree.dm.version': "Agreement version: `{version}`",
	'agree.dm.react_coming_soon': "_Channel reaction acceptance is coming soon — for now, please use the button below._",
	'agree.gate.before_verify': "Please accept the Discord agreement first (tap **I agree** in the DM above), then send your screenshot / stfc.pro link.",
	'agree.result.accepted': "✅ Agreement recorded. Thank you!",
	'agree.result.already': "You have already accepted the current agreement.",
	'agree.result.not_required': "No agreement is required on this server.",
	'agree.result.continue_verify': "You can continue verification: send a **profile screenshot**, then your **stfc.pro link**.",
	'agree.result.access_granted': "Full member access granted for **{name}**.",
	'agree.result.guest_ok': "Agreement recorded. You remain on the guest roster until your alliance matches.",
	'agree.result.access_failed': "Agreement recorded, but updating Discord roles failed — ask an admin.",
	'verify.note.agreement_pending': "Awaiting agreement (guest/lounge access for now)",
	'verify.result.needs_agreement': "✅ Verified **{name}** ({tag}, Ops {level}) on stfc.pro.\nPlease accept the **Discord agreement** in your DMs to unlock full member access (guest/lounge for now).\n\n{summary}",

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

	'verify.demote.dm.mismatch': 'Észleltük, hogy az stfc.pro játékosprofilod már nem a(z) **[{tag}]** szövetséget mutatja. Ha szerinted ez hiba, kattints az alábbi gombra a hitelesítés újraindításához.',
	'verify.demote.dm.missing': 'Már nem találjuk a játékosprofilodat az stfc.pro-n. Ha szerinted ez hiba, kattints az alábbi gombra a hitelesítés újraindításához.',
	'verify.demote.btn.restart': 'Hitelesítés újraindítása',
	'verify.demote.restarted': '✅ Hitelesítés újraindítva. Küldj egy **képernyőképet** a játékbeli profilodról, majd az **stfc.pro linkedet**.\n\nVagy használd a `/verify link:<url>` parancsot a szerveren.',
	'verify.demote.restart_failed': '❌ Nem sikerült újraindítani a hitelesítést. Használd a `/verify` parancsot a szerveren, vagy kérj segítséget egy admintól.',
	'welcome.dm.personal_channel': 'A személyes tagsági csatornád: <#{channelId}>',
	'welcome.dm.fetch_failed':
		'A üdvözlő üzenet nem tölthető be (a botnak Csatorna megtekintése + Üzenetelőzmények olvasása kell). {detail}',
};
