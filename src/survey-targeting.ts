import { listAllGuildMembers } from './discord-api';
import { listActiveVerifiedPlayers } from './guild-db';
import { normalizeAllianceRank } from './nickname-utils';
import type { SurveyRecord } from './survey-types';
import type { VerifiedPlayer } from './types';

export async function resolveSurveyTargets(
	env: Env,
	survey: SurveyRecord,
): Promise<VerifiedPlayer[]> {
	let players = await listActiveVerifiedPlayers(env.STFC_DB, survey.guild_id);

	switch (survey.target_type) {
		case 'all':
			break;
		case 'grade': {
			const grades = new Set(survey.target_grades);
			players = players.filter((p) => p.grade != null && grades.has(p.grade));
			break;
		}
		case 'level': {
			players = players.filter((p) => {
				if (p.ops_level == null) return false;
				if (survey.target_ops_min != null && p.ops_level < survey.target_ops_min) return false;
				if (survey.target_ops_max != null && p.ops_level > survey.target_ops_max) return false;
				return true;
			});
			break;
		}
		case 'rank': {
			const ranks = new Set(
				survey.target_ranks
					.map((r) => normalizeAllianceRank(r))
					.filter(Boolean)
					.map((r) => String(r).toLowerCase()),
			);
			players = players.filter((p) => {
				const key = normalizeAllianceRank(p.alliance_rank ?? undefined);
				return key != null && ranks.has(key.toLowerCase());
			});
			break;
		}
		case 'users': {
			const byId = new Map(players.map((p) => [p.discord_user_id, p]));
			players = survey.target_user_ids.map(
				(id) =>
					byId.get(id) ??
					({
						id: 0,
						guild_id: survey.guild_id,
						discord_user_id: id,
						player_id: null,
						player_name: null,
						alliance_tag: null,
						alliance_rank: null,
						ops_level: null,
						power: null,
						grade: null,
						stfc_pro_url: null,
						verification_status: 'active',
						personal_channel_id: null,
						preferred_locale: null,
						data_consent_at: null,
						data_consent_version: null,
						data_consent_choice: null,
						data_consent_method: null,
						agreement_accepted_at: null,
						agreement_version: null,
						agreement_method: null,
						welcome_dm_sent_at: null,
						verified_at: null,
						last_synced_at: null,
						activity_streak: null,
						days_inactive: 0,
						activity_updated_at: null,
					} satisfies VerifiedPlayer),
			);
			break;
		}
		case 'role': {
			if (!env.DISCORD_BOT_TOKEN || survey.target_role_ids.length === 0) {
				players = [];
				break;
			}
			const members = await listAllGuildMembers(env.DISCORD_BOT_TOKEN, survey.guild_id);
			const withRole = new Set<string>();
			for (const m of members) {
				if (survey.target_role_ids.some((rid) => m.roles.includes(rid))) {
					withRole.add(m.user.id);
				}
			}
			players = players.filter((p) => withRole.has(p.discord_user_id));
			break;
		}
		default:
			break;
	}

	if (survey.target_alliance_tags.length > 0) {
		const tags = new Set(survey.target_alliance_tags.map((t) => t.toUpperCase()));
		players = players.filter(
			(p) => p.alliance_tag && tags.has(p.alliance_tag.toUpperCase()),
		);
	}

	return players;
}

export function describeSurveyTarget(survey: SurveyRecord): string {
	const parts: string[] = [];
	switch (survey.target_type) {
		case 'all':
			parts.push('all verified players');
			break;
		case 'grade':
			parts.push(`grades ${survey.target_grades.map((g) => `G${g}`).join(', ') || '—'}`);
			break;
		case 'level':
			parts.push(
				`ops ${survey.target_ops_min ?? '…'}–${survey.target_ops_max ?? '…'}`,
			);
			break;
		case 'rank':
			parts.push(`ranks ${survey.target_ranks.join(', ') || '—'}`);
			break;
		case 'role':
			parts.push(
				`Discord roles ${survey.target_role_ids.map((id) => `<@&${id}>`).join(', ') || '—'}`,
			);
			break;
		case 'users':
			parts.push(
				`users ${survey.target_user_ids.map((id) => `<@${id}>`).join(', ') || '—'}`,
			);
			break;
	}
	if (survey.target_alliance_tags.length) {
		parts.push(`alliances ${survey.target_alliance_tags.map((t) => `[${t}]`).join(', ')}`);
	}
	return parts.join(' · ');
}
