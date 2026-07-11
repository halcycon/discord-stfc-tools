import { describe, expect, it } from 'vitest';
import {
	capturePersonalChannelPermTemplate,
	defaultPersonalChannelPermTemplate,
	parsePersonalChannelPermTemplate,
} from '../src/personal-channel-perm-template';

describe('personal-channel-perm-template', () => {
	const guildId = '111111111111111111';
	const botId = '222222222222222222';
	const memberId = '333333333333333333';
	const officerRole = '444444444444444444';

	it('captures slots from overwrites', () => {
		const template = capturePersonalChannelPermTemplate({
			guildId,
			botUserId: botId,
			memberUserId: memberId,
			channelId: '999999999999999999',
			overwrites: [
				{ id: guildId, type: 0, allow: '0', deny: '1024' },
				{ id: botId, type: 1, allow: '59392', deny: '0' },
				{ id: memberId, type: 1, allow: '3072', deny: '0' },
				{ id: officerRole, type: 0, allow: '3072', deny: '0' },
			],
			capturedBy: '555555555555555555',
		});
		expect(template.everyone.deny).toBe('1024');
		expect(template.bot.allow).toBe('59392');
		expect(template.member.allow).toBe('3072');
		expect(template.roles).toEqual([{ role_id: officerRole, allow: '3072', deny: '0' }]);
		expect(template.source_channel_id).toBe('999999999999999999');
	});

	it('round-trips JSON', () => {
		const t = defaultPersonalChannelPermTemplate();
		t.roles = [{ role_id: officerRole, allow: '3072', deny: '0' }];
		const parsed = parsePersonalChannelPermTemplate(JSON.stringify(t));
		expect(parsed?.roles[0]?.role_id).toBe(officerRole);
	});
});
