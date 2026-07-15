/**
 * Legal operator identity for Privacy / Terms pages.
 *
 * Committed defaults are placeholders only. Set real values via Cloudflare Pages
 * (or admin-web/.env locally) as VITE_LEGAL_* — those are not committed.
 *
 * Vite only exposes env vars prefixed with VITE_ to the browser bundle (baked at build time).
 */

function env(name: keyof ImportMetaEnv, fallback: string): string {
	const raw = import.meta.env[name];
	if (typeof raw === 'string' && raw.trim()) return raw.trim();
	return fallback;
}

export const legalOperator = {
	/** Shown in titles and “who we are” */
	productName: env('VITE_LEGAL_PRODUCT_NAME', 'STFC Tools'),
	/** Legal / trading name of the operator */
	legalName: env('VITE_LEGAL_LEGAL_NAME', '[OPERATOR LEGAL NAME]'),
	/** Privacy / ToS contact (email or form URL) */
	contact: env('VITE_LEGAL_CONTACT', '[CONTACT EMAIL OR FORM]'),
	/** Optional postal address */
	address: env('VITE_LEGAL_ADDRESS', '[ADDRESS]'),
	/** Governing law section */
	governingLaw: env('VITE_LEGAL_GOVERNING_LAW', '[COUNTRY / REGION]'),
	venue: env('VITE_LEGAL_VENUE', '[VENUE]'),
	/** Liability cap wording */
	liabilityCap: env('VITE_LEGAL_LIABILITY_CAP', '[AMOUNT, e.g. £0 / USD 0]'),
	effectiveDate: env('VITE_LEGAL_EFFECTIVE_DATE', '14 July 2026'),
	version: env('VITE_LEGAL_VERSION', '1.0'),
};

/** Replace bracket placeholders used in the legal markdown. */
export function applyLegalOperator(markdown: string): string {
	const o = legalOperator;
	return markdown
		.replaceAll('[OPERATOR LEGAL NAME]', o.legalName)
		.replaceAll('[CONTACT EMAIL OR FORM]', o.contact)
		.replaceAll('[ADDRESS]', o.address)
		.replaceAll('[COUNTRY / REGION]', o.governingLaw)
		.replaceAll('[VENUE]', o.venue)
		.replaceAll('[AMOUNT, e.g. £0 / USD 0]', o.liabilityCap)
		.replaceAll('STFC Tools', o.productName);
}
