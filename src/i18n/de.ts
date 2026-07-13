import type { MessageCatalog } from './en';

/** German */
export const de: MessageCatalog = {
	'locale.picker.prompt':
		'Bitte wähle deine bevorzugte Sprache für Bot-Nachrichten.\nPlease choose your preferred language / Choisissez votre langue',
	'locale.picker.confirm': '✅ Sprache auf **{label}** gesetzt.',
	'locale.picker.already': 'Deine Sprache ist bereits **{label}**.',
	'locale.changed': '✅ Bevorzugte Sprache auf **{label}** aktualisiert.',

	'verify.invite.welcome':
		'Willkommen! Bitte verifiziere dein STFC-Konto, um Zugang zu den Mitgliederkanälen zu erhalten.\n\n' +
		'**Verifizierung per DM (empfohlen):**\n' +
		'1. Sende einen **Screenshot** deines Ingame-Profils\n' +
		'2. Sende danach deinen **stfc.pro-Profil-Link**\n\n' +
		'**Oder** nutze `/verify link:<url>` im Server.\n\n' +
		'Wir prüfen deine Allianz auf stfc.pro und weisen Rollen automatisch zu.',

	'verify.dm.no_pending':
		'Keine ausstehende Verifizierung gefunden. Tritt zuerst einem konfigurierten Server bei oder nutze dort `/verify`.',
	'verify.dm.multi_guild':
		'Du hast ausstehende Verifizierungen in mehreren Servern. Bitte nutze `/verify` in dem Discord-Server, dem du beitreten möchtest.',
	'verify.dm.need_screenshot':
		'Bitte sende zuerst einen **Screenshot deines Ingame-Profils**, danach deinen stfc.pro-Link.\n\nDu kannst auch `/verify` im Server nutzen.',
	'verify.dm.screenshot_received':
		'✅ Screenshot empfangen und archiviert. Sende jetzt deinen **stfc.pro-Profil-Link** (z. B. `https://stfc.pro/player/12345?region=US&server=42`).',
	'verify.dm.need_link': 'Bitte sende deinen **stfc.pro-Profil-Link**, um fortzufahren.',
	'verify.dm.need_locale':
		'Bitte wähle zuerst deine Sprache (nutze die Buttons oben oder `/language`).',

	'verify.error.invalid_url':
		'Ungültige stfc.pro-URL. Beispiel: https://stfc.pro/player/12345?region=US&server=1',
	'verify.error.no_server':
		'STFC-Server konnte nicht ermittelt werden. Server in der URL angeben oder Admin `/server setup` ausführen lassen.',
	'verify.error.no_player_id': 'Aus dieser URL konnte keine Spieler-ID oder kein Name gelesen werden.',
	'verify.error.player_not_found': 'Kein Spieler auf Server {server} ({region}) für diesen Link gefunden.',
	'verify.error.no_alliance':
		'Spieler gefunden, aber ohne Allianz — du musst in einer Allianz sein, um dich zu verifizieren.',
	'verify.error.lookup_failed': 'Spielersuche fehlgeschlagen.',

	'verify.result.not_configured':
		'❌ Dieser Server ist noch nicht konfiguriert. Ein Admin muss zuerst `/server setup` ausführen.',
	'verify.result.verified_no_token':
		'✅ **{name}** auf stfc.pro verifiziert, aber Bot-Token fehlt — Rollen wurden nicht aktualisiert.\n\n{summary}',
	'verify.result.active':
		'✅ Verifiziert und aktiviert: **{name}** ({tag}, Ops {level}).\n{notes}\n\n{summary}',
	'verify.result.guest':
		'⏳ **{name}** verifiziert, aber Allianz **{tag}** stimmt nicht mit **{expected}** überein — Gastrolle zugewiesen. Wir prüfen alle {hours}h erneut.\n\n{summary}',
	'verify.result.discord_failed':
		'✅ Auf stfc.pro verifiziert, aber Discord-Rollen-Update fehlgeschlagen: {error}{nickHint}\n\n{summary}',

	'verify.note.roles_updated': 'Rollen aktualisiert',
	'verify.note.nick': 'Nick: {nick}',
	'verify.note.nick_failed': 'Nick fehlgeschlagen (Hierarchie/Owner?)',
	'verify.note.channel': 'Kanal <#{channelId}>',
	'verify.note.diplomacy': 'Diplomatie <#{channelId}>',
	'verify.note.manual': 'Manuell von <@{userId}>',

	'verify.hint.nickname_permissions':
		'\n↳ Meist: Bot braucht **Nicknames verwalten**, seine Rolle muss **über** dem Mitglied stehen, und Discord kann den **Server-Owner** nicht umbenennen.',
	'verify.hint.role_permissions':
		'\n↳ Meist: Bot braucht **Rollen verwalten**, und seine Rolle muss **über** jeder Rolle stehen, die er vergibt (und über der höchsten Rolle des Mitglieds) unter Servereinstellungen → Rollen.',

	'verify.player_summary':
		'**{name}** (ID {id})\nAllianz: [{alliance}] · Rang: {rank}\nOps {ops} · Power {power}\nServer {server} ({region})',

	'exchange.dm.need_request':
		'📦 **{name}** (Ops {ops}) braucht **{resource}**.\nAllianz: [{tag}]\nTippe **Help**, um zu übernehmen (Wer zuerst kommt), oder **Ignore**.',
	'exchange.dm.claimed':
		'🤝 **{donorName}** (Ops {ops}, [{tag}]) hat deine Anfrage für **{resource}** übernommen!\nDiscord: <@{donorId}>\n\nWenn fertig: **Completed**. Wenn nicht möglich: **Ask again**.',
	'exchange.dm.request_cancelled':
		'ℹ️ <@{userId}> hat die Anfrage für **{resource}** (#{id}) abgebrochen.',

	'exchange.btn.help': 'Help',
	'exchange.btn.ignore': 'Ignore',
	'exchange.btn.completed': 'Completed',
	'exchange.btn.ask_again': 'Ask again',

	'survey.default_title': 'Umfrage #{id}',
	'survey.delivery.body': '**{title}**\n{question}\n\nTippe einen Button zum Antworten:',
	'survey.delivery.test_prefix':
		'🧪 **Testzustellung** (nur du — Stimmen im Entwurf zählen nicht)\n\n',
	'survey.delivery.cta': 'Tippe einen Button zum Antworten:',

	'dm.hal.cant_do_that': "Es tut mir leid {player_name}, ich fürchte, das kann ich nicht tun.",
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
	'consent.dm.body': 'Um dich auf diesem Discord-Server zu verifizieren, müssen wir dein **Discord-Konto** mit deiner **Star Trek Fleet Command**-Spieleridentität verknüpfen (Ingame-Name und öffentliche Profildaten von stfc.pro).\n\n' +
		'Wir nutzen diese Informationen **nur**, um deine Identität zu bestätigen, passende Rollen und Kanäle zuzuweisen und Allianz-Mitgliedschaftswerkzeuge auf diesem Server zu betreiben.',
	'consent.dm.details': 'Mit **Ich stimme zu** willigst du in diese Verarbeitung ein. ' +
		'Mit **Ich stimme nicht zu** führen wir keine Verifizierung durch und rufen dein stfc.pro-Profil nicht ab.\n\n' +
		'Du kannst einen Server-Admin fragen, wie die Daten genutzt werden. Diese Einwilligung ist getrennt von einem optionalen Verhaltenskodex.',
	'consent.dm.version': 'Einwilligungsversion: `{version}`',
	'consent.btn.yes': 'Ich stimme zu',
	'consent.btn.no': 'Ich stimme nicht zu',
	'consent.result.accepted': '✅ Danke — deine Einwilligung wurde gespeichert.',
	'consent.result.declined': 'Verstanden. Ohne diese Einwilligung können wir dich nicht verifizieren und dein stfc.pro-Profil nicht abrufen.\n\n' +
		'Wenn du deine Meinung änderst, starte erneut mit `/verify` oder bitte einen Admin um eine neue Einladung.',
	'consent.result.already': 'Du hast die aktuelle Einwilligung zur Datenverarbeitung bereits erteilt.',
	'consent.result.not_required': 'Auf diesem Server ist keine Einwilligung zur Datenverarbeitung erforderlich.',
	'consent.result.continue_verify': 'Als Nächstes: sende einen **Screenshot** deines Ingame-Profils und danach deinen **stfc.pro-Profil-Link** ' +
		'(oder nutze `/verify link:<url>` im Server).',
	'consent.gate.required': 'Bitte akzeptiere zuerst die **Einwilligung zur Datenverarbeitung** (Buttons in der DM oben), ' +
		'danach Screenshot / stfc.pro-Link.',

	'verify.demote.dm.mismatch': 'Wir haben festgestellt, dass dein Spielerprofil auf stfc.pro nicht mehr die Allianz **[{tag}]** zeigt. Falls das ein Fehler ist, tippe unten auf die Schaltfläche, um die Verifizierung neu zu starten.',
	'verify.demote.dm.missing': 'Wir konnten dein Spielerprofil auf stfc.pro nicht mehr finden. Falls das ein Fehler ist, tippe unten auf die Schaltfläche, um die Verifizierung neu zu starten.',
	'verify.demote.btn.restart': 'Verifizierung neu starten',
	'verify.demote.restarted': '✅ Verifizierung neu gestartet. Bitte sende einen **Screenshot** deines Ingame-Profils und danach deinen **stfc.pro-Link**.\n\nOder nutze `/verify link:<url>` im Server.',
	'verify.demote.restart_failed': '❌ Verifizierung konnte nicht neu gestartet werden. Bitte nutze `/verify` im Server oder frage einen Admin.',
	'welcome.dm.personal_channel': 'Dein persönlicher Mitgliederkanal: <#{channelId}>',
	'welcome.dm.fetch_failed':
		'Willkommensnachricht konnte nicht geladen werden (Bot braucht Kanal anzeigen + Nachrichtenverlauf lesen). {detail}',
};
