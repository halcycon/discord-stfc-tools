import { parseStfcProUrl } from '../stfc-url';

const STFC_PRO_URL_RE = /https?:\/\/(?:www\.)?stfc\.pro\/[^\s<>]+/gi;

export function extractStfcProUrls(content: string): string[] {
	const matches = content.match(STFC_PRO_URL_RE) ?? [];
	const valid: string[] = [];
	for (const raw of matches) {
		const cleaned = raw.replace(/[>,)\]]+$/, '');
		if (parseStfcProUrl(cleaned)) valid.push(cleaned);
	}
	return valid;
}

export function pickImageAttachmentUrl(
	attachments: Array<{ url: string; content_type?: string; filename?: string }> | undefined,
): string | undefined {
	if (!attachments?.length) return undefined;
	const image = attachments.find(
		(a) =>
			a.content_type?.startsWith('image/') ||
			/\.(png|jpe?g|gif|webp)$/i.test(a.filename ?? ''),
	);
	return image?.url;
}

export function isDirectMessage(channelType: number): boolean {
	return channelType === 1;
}
