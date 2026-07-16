import { createContext, useContext } from 'react';
import type { GuildStatus } from '../api';

export type GuildContextValue = {
	guildId: string;
	status: GuildStatus;
	reload: () => Promise<void>;
	setStatus: (s: GuildStatus) => void;
};

export const GuildContext = createContext<GuildContextValue | null>(null);

export function useGuild(): GuildContextValue {
	const ctx = useContext(GuildContext);
	if (!ctx) throw new Error('useGuild must be used within GuildLayout');
	return ctx;
}
