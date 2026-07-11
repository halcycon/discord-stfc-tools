/**
 * Fold player / gamertag Unicode into Latin-ish text for Discord channel slugs
 * and A–Z category buckets. Handles accents (via NFKC/NFD), Latin extensions
 * (Ł→L), Greek/Cyrillic lookalikes (β→b), and a few decorative kana.
 */

/** Single- or multi-char replacements applied before diacritic stripping. */
const LATINIZE_MAP: Record<string, string> = {
	// Polish / Central European (Ł does not NFKD to L)
	Ł: 'L',
	ł: 'l',
	Ą: 'A',
	ą: 'a',
	Ć: 'C',
	ć: 'c',
	Ę: 'E',
	ę: 'e',
	Ń: 'N',
	ń: 'n',
	Ś: 'S',
	ś: 's',
	Ź: 'Z',
	ź: 'z',
	Ż: 'Z',
	ż: 'z',
	Đ: 'D',
	đ: 'd',
	Ħ: 'H',
	ħ: 'h',

	// German / Nordic digraphs (prefer digraphs over bare a/o/u)
	ß: 'ss',
	Æ: 'AE',
	æ: 'ae',
	Œ: 'OE',
	œ: 'oe',
	Ø: 'O',
	ø: 'o',
	Ð: 'D',
	ð: 'd',
	Þ: 'Th',
	þ: 'th',

	// Greek (often used as Latin lookalikes in gamertags)
	Α: 'A',
	α: 'a',
	Β: 'B',
	β: 'b',
	Γ: 'G',
	γ: 'g',
	Δ: 'D',
	δ: 'd',
	Ε: 'E',
	ε: 'e',
	Ζ: 'Z',
	ζ: 'z',
	Η: 'I',
	η: 'i',
	Θ: 'Th',
	θ: 'th',
	Ι: 'I',
	ι: 'i',
	Κ: 'K',
	κ: 'k',
	Λ: 'L',
	λ: 'l',
	Μ: 'M',
	μ: 'u',
	Ν: 'N',
	ν: 'n',
	Ξ: 'X',
	ξ: 'x',
	Ο: 'O',
	ο: 'o',
	Π: 'P',
	π: 'p',
	Ρ: 'P',
	ρ: 'p',
	Σ: 'S',
	σ: 's',
	ς: 's',
	Τ: 'T',
	τ: 't',
	Υ: 'Y',
	υ: 'y',
	Φ: 'F',
	φ: 'f',
	Χ: 'X',
	χ: 'x',
	Ψ: 'Ps',
	ψ: 'ps',
	Ω: 'O',
	ω: 'w',

	// Cyrillic lookalikes (homoglyphs)
	А: 'A',
	а: 'a',
	В: 'B',
	Е: 'E',
	е: 'e',
	Ё: 'E',
	ё: 'e',
	К: 'K',
	к: 'k',
	М: 'M',
	м: 'm',
	Н: 'H',
	О: 'O',
	о: 'o',
	Р: 'P',
	р: 'p',
	С: 'C',
	с: 'c',
	Т: 'T',
	т: 't',
	У: 'Y',
	у: 'y',
	Х: 'X',
	х: 'x',
	І: 'I',
	і: 'i',
	Ї: 'I',
	ї: 'i',
	Ј: 'J',
	ј: 'j',
	Ѕ: 'S',
	ѕ: 's',

	// Decorative kana sometimes prefixed onto Latin names
	ン: 'n',
	ん: 'n',
	ノ: 'n',
	の: 'n',
};

/**
 * Best-effort Latin fold of a display / in-game name.
 * Does not guarantee uniqueness — only readability for channel names.
 */
export function latinizePlayerName(input: string): string {
	// NFKC: fullwidth Latin/digits → ASCII, compatibility forms
	let s = input.normalize('NFKC');
	let out = '';
	for (const ch of s) {
		out += LATINIZE_MAP[ch] ?? ch;
	}
	// Strip combining marks left from accented Latin (é → e)
	return out.normalize('NFD').replace(/\p{M}/gu, '');
}
