import { Link } from 'react-router-dom';
import { marked } from 'marked';
import { applyLegalOperator, legalOperator } from '../legal/operator';
import { LcarsFrame, LcarsPanel } from '../lcars/LcarsFrame';
import './legal.css';

marked.setOptions({ gfm: true, breaks: false });

type Props = {
	title: string;
	markdown: string;
};

export function LegalPage({ title, markdown }: Props) {
	const html = marked.parse(applyLegalOperator(markdown), { async: false }) as string;

	return (
		<LcarsFrame
			compact
			title={title}
			eyebrow={`${legalOperator.productName} · Effective ${legalOperator.effectiveDate} · v${legalOperator.version}`}
			navTop={[
				{ label: 'Home', to: '/', color: 5 },
				{ label: 'Privacy', to: '/privacy', color: 6 },
			]}
			navBottom={[
				{ label: 'Terms', to: '/terms', color: 2 },
				{ label: 'Login', to: '/login', color: 8 },
			]}
			actions={
				<nav className="legal-nav">
					<Link className="lcars-pill lcars-pill--sm lcars-pill--ghost" to="/">
						Home
					</Link>
					<Link className="lcars-pill lcars-pill--sm lcars-pill--a8" to="/login">
						Admin
					</Link>
				</nav>
			}
		>
			<LcarsPanel label="Document" cap="a8">
				<article className="legal-doc" dangerouslySetInnerHTML={{ __html: html }} />
			</LcarsPanel>
			<footer className="legal-footer muted tiny">
				<p>
					Contact: {legalOperator.contact}
					{legalOperator.address &&
					legalOperator.address !== '[ADDRESS]' &&
					!legalOperator.address.startsWith('[')
						? ` · ${legalOperator.address}`
						: ''}
				</p>
				<p>
					Not legal advice. Set <code>VITE_LEGAL_*</code> in Cloudflare Pages (or{' '}
					<code>admin-web/.env</code>) before relying on these pages for Discord verification.
				</p>
			</footer>
		</LcarsFrame>
	);
}
