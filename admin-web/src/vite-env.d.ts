/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_API_BASE_URL?: string;
	readonly VITE_LEGAL_PRODUCT_NAME?: string;
	readonly VITE_LEGAL_LEGAL_NAME?: string;
	readonly VITE_LEGAL_CONTACT?: string;
	readonly VITE_LEGAL_ADDRESS?: string;
	readonly VITE_LEGAL_GOVERNING_LAW?: string;
	readonly VITE_LEGAL_VENUE?: string;
	readonly VITE_LEGAL_LIABILITY_CAP?: string;
	readonly VITE_LEGAL_EFFECTIVE_DATE?: string;
	readonly VITE_LEGAL_VERSION?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare module '*.md?raw' {
	const content: string;
	export default content;
}
