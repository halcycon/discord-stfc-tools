import { sendChannelMessage } from '../discord-api';
import { getGuildConfig, getPendingVerificationsForUser, upsertVerifiedPlayer } from '../guild-db';
import { processVerification } from '../verification';
import { extractStfcProUrls, pickImageAttachmentUrl } from './dm-handler';
import type { DiscordMessage } from './protocol';
import type { VerificationStatus } from '../types';

const SCREENSHOT_RECEIVED_MESSAGE =
	'✅ Screenshot received and archived. Now send your **stfc.pro profile link** (e.g. `https://stfc.pro/player/12345?region=US&server=42`).';

const NEED_SCREENSHOT_MESSAGE =
	'Please send a **screenshot of your in-game profile** first, then your stfc.pro link.\n\nYou can also use `/verify` in the server.';

const NEED_LINK_MESSAGE =
	'Please send your **stfc.pro profile link** to continue verification.';

const MULTI_GUILD_MESSAGE =
	'You have pending verification in multiple servers. Please use `/verify` in the Discord server you want to join.';

export async function handleDirectMessage(env: Env, message: DiscordMessage): Promise<void> {
	if (message.author.bot) return;

	const userId = message.author.id;
	const token = env.DISCORD_BOT_TOKEN;
	if (!token) {
		console.warn('DISCORD_BOT_TOKEN missing — cannot handle DM');
		return;
	}

	const pending = await getPendingVerificationsForUser(env.STFC_DB, userId);
	if (pending.length === 0) {
		await sendChannelMessage(
			token,
			message.channel_id,
			'No pending verification found. Join a configured server first, or use `/verify` there.',
		);
		return;
	}

	if (pending.length > 1) {
		await sendChannelMessage(token, message.channel_id, MULTI_GUILD_MESSAGE);
		return;
	}

	const record = pending[0];
	const config = await getGuildConfig(env.STFC_DB, record.guild_id);
	if (!config) return;

	const status = record.verification_status as VerificationStatus;
	const imageUrl = pickImageAttachmentUrl(message.attachments);
	const stfcUrls = extractStfcProUrls(message.content);

	if (status === 'pending_invite' || status === 'pending_screenshot') {
		if (imageUrl) {
			await upsertVerifiedPlayer(env.STFC_DB, {
				guild_id: record.guild_id,
				discord_user_id: userId,
				verification_status: 'pending_link',
			});

			if (stfcUrls.length > 0) {
				const result = await processVerification(env, record.guild_id, userId, stfcUrls[0], imageUrl);
				await sendChannelMessage(token, message.channel_id, result);
				return;
			}

			await sendChannelMessage(token, message.channel_id, SCREENSHOT_RECEIVED_MESSAGE);
			return;
		}

		if (stfcUrls.length > 0) {
			const result = await processVerification(env, record.guild_id, userId, stfcUrls[0]);
			await sendChannelMessage(token, message.channel_id, result);
			return;
		}

		await sendChannelMessage(token, message.channel_id, NEED_SCREENSHOT_MESSAGE);
		return;
	}

	if (status === 'pending_link') {
		if (stfcUrls.length > 0) {
			const screenshotUrl = imageUrl;
			const result = await processVerification(env, record.guild_id, userId, stfcUrls[0], screenshotUrl);
			await sendChannelMessage(token, message.channel_id, result);
			return;
		}

		if (imageUrl) {
			await sendChannelMessage(token, message.channel_id, NEED_LINK_MESSAGE);
			return;
		}

		await sendChannelMessage(token, message.channel_id, NEED_LINK_MESSAGE);
	}
}
