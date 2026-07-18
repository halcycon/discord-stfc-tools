/** Supported player-facing locales (ISO 639-1). */
export const SUPPORTED_LOCALES = ['en', 'de', 'fr', 'es', 'pt', 'nl', 'pl', 'it', 'ru', 'tr', 'hu'] as const;

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: LocaleCode = 'en';

/** Native labels for language picker buttons. */
export const LOCALE_NATIVE_LABELS: Record<LocaleCode, string> = {
	en: 'English',
	de: 'Deutsch',
	fr: 'Français',
	es: 'Español',
	pt: 'Português',
	nl: 'Nederlands',
	pl: 'Polski',
	it: 'Italiano',
	ru: 'Русский',
	tr: 'Türkçe',
	hu: 'Magyar',
};

/** Country flags for diplomacy channel preferred-language suffixes. */
export const LOCALE_FLAG_EMOJI: Record<LocaleCode, string> = {
	en: '🇬🇧',
	de: '🇩🇪',
	fr: '🇫🇷',
	es: '🇪🇸',
	pt: '🇵🇹',
	nl: '🇳🇱',
	pl: '🇵🇱',
	it: '🇮🇹',
	ru: '🇷🇺',
	tr: '🇹🇷',
	hu: '🇭🇺',
};

export function isLocaleCode(value: string | null | undefined): value is LocaleCode {
	return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function resolveLocale(value: string | null | undefined): LocaleCode {
	return isLocaleCode(value) ? value : DEFAULT_LOCALE;
}

/** Concatenate flag emojis for a locale list (order preserved, duplicates dropped). */
export function formatLocaleFlagSuffix(locales: readonly string[]): string {
	const seen = new Set<LocaleCode>();
	const flags: string[] = [];
	for (const raw of locales) {
		const code = String(raw).trim().toLowerCase();
		if (!isLocaleCode(code) || seen.has(code)) continue;
		seen.add(code);
		flags.push(LOCALE_FLAG_EMOJI[code]);
	}
	return flags.join('');
}

/**
 * Parse a CSV / space-separated languages option for diplomacy channels.
 * Empty / `none` / `clear` / `-` clears preferred languages.
 */
export function parseDiplomacyLanguagesOption(
	raw: string | null | undefined,
): { ok: true; locales: LocaleCode[] } | { ok: false; error: string } {
	const trimmed = (raw ?? '').trim();
	if (!trimmed || /^(none|clear|-)$/i.test(trimmed)) {
		return { ok: true, locales: [] };
	}
	const parts = trimmed
		.split(/[,;\s]+/)
		.map((p) => p.trim().toLowerCase())
		.filter(Boolean);
	const locales: LocaleCode[] = [];
	const invalid: string[] = [];
	for (const part of parts) {
		if (!isLocaleCode(part)) {
			invalid.push(part);
			continue;
		}
		if (!locales.includes(part)) locales.push(part);
	}
	if (invalid.length > 0) {
		return {
			ok: false,
			error:
				`Unknown language(s): ${invalid.join(', ')}. ` +
				`Use: ${SUPPORTED_LOCALES.join(', ')} (or none to clear)`,
		};
	}
	return { ok: true, locales };
}
