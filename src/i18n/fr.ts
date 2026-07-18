import type { MessageCatalog } from './en';

/** French */
export const fr: MessageCatalog = {
	'locale.picker.prompt':
		'Veuillez choisir votre langue préférée pour les messages du bot.\nPlease choose your preferred language / Wähle deine Sprache',
	'locale.picker.confirm': '✅ Langue définie sur **{label}**.',
	'locale.picker.already': 'Votre langue est déjà **{label}**.',
	'locale.changed': '✅ Langue préférée mise à jour : **{label}**.',

	'verify.invite.welcome':
		'Bienvenue ! Veuillez vérifier votre compte STFC pour accéder aux salons membres.\n\n' +
		'**Vérification par MP (recommandé) :**\n' +
		'1. Envoyez une **capture d’écran** de votre profil en jeu\n' +
		'2. Puis envoyez votre **lien de profil stfc.pro**\n\n' +
		'**Ou** utilisez `/verify link:<url>` sur le serveur.\n\n' +
		'Nous vérifierons votre alliance sur stfc.pro et attribuerons les rôles automatiquement.',

	'verify.dm.no_pending':
		'Aucune vérification en cours. Rejoignez d’abord un serveur configuré, ou utilisez `/verify` sur ce serveur.',
	'verify.dm.multi_guild':
		'Vous avez des vérifications en cours sur plusieurs serveurs. Utilisez `/verify` sur le serveur Discord que vous souhaitez rejoindre.',
	'verify.dm.need_screenshot':
		'Envoyez d’abord une **capture d’écran de votre profil en jeu**, puis votre lien stfc.pro.\n\nVous pouvez aussi utiliser `/verify` sur le serveur.',
	'verify.dm.screenshot_received':
		'✅ Capture reçue et archivée. Envoyez maintenant votre **lien de profil stfc.pro** (ex. `https://stfc.pro/player/12345?region=US&server=42`).',
	'verify.dm.need_link': 'Envoyez votre **lien de profil stfc.pro** pour continuer.',
	'verify.dm.need_locale':
		'Choisissez d’abord votre langue (boutons ci-dessus, ou `/language`).',

	'verify.error.invalid_url':
		'URL stfc.pro invalide. Exemple : https://stfc.pro/player/12345?region=US&server=1',
	'verify.error.no_server':
		'Impossible de déterminer le serveur STFC. Incluez le serveur dans l’URL ou demandez `/server setup`.',
	'verify.error.no_player_id': 'Impossible d’extraire un ID ou un nom de joueur de cette URL.',
	'verify.error.player_not_found': 'Aucun joueur trouvé sur le serveur {server} ({region}) pour ce lien.',
	'verify.error.no_alliance':
		'Joueur trouvé mais sans alliance — vous devez être dans une alliance pour vous vérifier.',
	'verify.error.lookup_failed': 'Échec de la recherche du joueur.',
	'verify.error.player_id_in_use_member':
		'⚠️ Un problème avec ce lien de joueur nécessite l’examen d’un administrateur. Les admins ont été notifiés — merci d’attendre leur suite.',
	'verify.error.player_id_in_use_admin':
		'⚠️ **Player ID already linked**\n\nSTFC player **{playerName}** (ID `{playerId}`) is already linked to <@{existingUserId}> ({existingStatus}).\n\nYou are about to link it to <@{targetUserId}> instead.\n**Approve** clears the existing link (guest roles / reset verify) and applies the new one. **Reject** leaves things unchanged.{extraOwners}',

	'verify.result.not_configured':
		'❌ Ce serveur n’est pas encore configuré. Un admin doit exécuter `/server setup`.',
	'verify.result.verified_no_token':
		'✅ **{name}** vérifié sur stfc.pro, mais le token du bot manque — rôles non mis à jour.\n\n{summary}',
	'verify.result.active':
		'✅ Vérifié et activé : **{name}** ({tag}, Ops {level}).\n{notes}\n\n{summary}',
	'verify.result.guest':
		'⏳ **{name}** vérifié, mais l’alliance **{tag}** ne correspond pas à **{expected}** — rôle invité attribué. Nouvelle vérif. toutes les {hours}h.\n\n{summary}',
	'verify.result.discord_failed':
		'✅ Vérifié sur stfc.pro, mais échec de la mise à jour Discord : {error}{nickHint}\n\n{summary}',

	'verify.note.roles_updated': 'Rôles mis à jour',
	'verify.note.nick': 'Pseudo : {nick}',
	'verify.note.nick_failed': 'Pseudo échoué (hiérarchie/propriétaire ?)',
	'verify.note.channel': 'Salon <#{channelId}>',
	'verify.note.diplomacy': 'Diplomatie <#{channelId}>',
	'verify.note.manual': 'Manuel par <@{userId}>',

	'verify.hint.nickname_permissions':
		'\n↳ Souvent : le bot a besoin de **Gérer les pseudos**, son rôle doit être **au-dessus** du membre, et Discord ne peut pas renommer le **propriétaire**.',
	'verify.hint.role_permissions':
		'\n↳ Souvent : le bot a besoin de **Gérer les rôles**, et son rôle doit être **au-dessus** de chaque rôle qu’il attribue (et au-dessus du rôle le plus élevé du membre) dans Paramètres du serveur → Rôles.',

	'verify.player_summary':
		'**{name}** (ID {id})\nAlliance : [{alliance}] · Rang : {rank}\nOps {ops} · Power {power}\nServeur {server} ({region})',

	'exchange.dm.need_request':
		'📦 **{name}** (Ops {ops}) a besoin de **{resource}**.\nAlliance : [{tag}]\nAppuyez sur **Help** pour prendre en charge (premier arrivé), ou **Ignore**.',
	'exchange.dm.claimed':
		'🤝 **{donorName}** (Ops {ops}, [{tag}]) a pris en charge votre demande **{resource}** !\nDiscord : <@{donorId}>\n\nQuand c’est fait : **Completed**. Sinon : **Ask again**.',
	'exchange.dm.request_cancelled':
		'ℹ️ <@{userId}> a annulé sa demande **{resource}** (#{id}).',

	'exchange.dm.request_completed':
		'✅ <@{userId}> a marqué sa demande **{resource}** (#{id}) comme terminée. Merci pour votre aide !',
	'exchange.btn.help': 'Help',
	'exchange.btn.ignore': 'Ignore',
	'exchange.btn.completed': 'Completed',
	'exchange.btn.ask_again': 'Ask again',

	'survey.default_title': 'Sondage #{id}',
	'survey.delivery.body': '**{title}**\n{question}\n\nAppuyez sur un bouton pour répondre :',
	'survey.delivery.test_prefix':
		'🧪 **Test** (vous seul — les votes en brouillon ne comptent pas)\n\n',
	'survey.delivery.cta': 'Appuyez sur un bouton pour répondre :',

	'dm.hal.cant_do_that': "Je suis désolé {player_name}, j'ai peur de ne pas pouvoir faire cela.",
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
	'dm.wizard.setup.ask_tag': "Step 4/5 — Reply with the expected **alliance tag** (e.g. `ABCD`).",
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

	'verify.demote.dm.mismatch': 'Nous avons détecté que votre profil joueur sur stfc.pro ne reflète plus l’alliance **[{tag}]**. Si c’est une erreur, cliquez sur le bouton ci-dessous pour relancer la vérification.',
	'verify.demote.dm.missing': 'Nous n’avons plus trouvé votre profil joueur sur stfc.pro. Si c’est une erreur, cliquez sur le bouton ci-dessous pour relancer la vérification.',
	'verify.demote.btn.restart': 'Relancer la vérification',
	'verify.demote.restarted': "✅ Vérification relancée. Envoyez une **capture** de votre profil en jeu, puis votre **lien stfc.pro**.\n\nOu utilisez `/verify link:<url>` sur le serveur.",
	'verify.demote.restart_failed': '❌ Impossible de relancer la vérification. Utilisez `/verify` sur le serveur ou demandez à un admin.',
	'welcome.dm.personal_channel': 'Votre salon membre personnel : <#{channelId}>',
	'welcome.dm.fetch_failed':
		'Impossible de charger le message de bienvenue (le bot a besoin de Voir le salon + Lire l’historique). {detail}',
};
