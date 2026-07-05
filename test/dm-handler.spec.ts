import { describe, it, expect } from 'vitest';
import { extractStfcProUrls, pickImageAttachmentUrl } from '../src/discord-gateway/dm-handler';

describe('dm-handler', () => {
	it('extracts stfc.pro URLs from message content', () => {
		const urls = extractStfcProUrls(
			'Here is my profile https://stfc.pro/player/12345?region=US&server=42 thanks',
		);
		expect(urls).toHaveLength(1);
		expect(urls[0]).toContain('stfc.pro/player/12345');
	});

	it('picks image attachments', () => {
		const url = pickImageAttachmentUrl([
			{ url: 'https://cdn.discord.com/a.png', content_type: 'image/png', filename: 'profile.png' },
			{ url: 'https://cdn.discord.com/b.txt', content_type: 'text/plain', filename: 'notes.txt' },
		]);
		expect(url).toBe('https://cdn.discord.com/a.png');
	});

	it('returns undefined when no image attachments', () => {
		expect(pickImageAttachmentUrl([{ url: 'https://x.com/f.pdf', filename: 'f.pdf' }])).toBeUndefined();
	});
});
