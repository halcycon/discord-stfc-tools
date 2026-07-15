import { Link } from 'react-router-dom';
import { marked } from 'marked';
import { applyLegalOperator, legalOperator } from '../legal/operator';
import './pages.css';
import './legal.css';

marked.setOptions({ gfm: true, breaks: false });

type Props = {
	title: string;
	markdown: string;
};

export function LegalPage({ title, markdown }: Props) {
	const html = marked.parse(applyLegalOperator(markdown), { async: false }) as string;

	return (
		<div className="shell legal-shell">
			<header className="top">
				<div>
					<p className="eyebrow">{legalOperator.productName}</p>
					<h1>{title}</h1>
					<p className="muted tiny">
						Effective {legalOperator.effectiveDate} · v{legalOperator.version}
					</p>
				</div>
					<nav className="legal-nav">
					<Link to="/">Home</Link>
					<Link to="/privacy">Privacy</Link>
					<Link to="/terms">Terms</Link>
					<Link to="/login">Admin login</Link>
				</nav>
			</header>
			<article
				className="card legal-doc"
				dangerouslySetInnerHTML={{ __html: html }}
			/>
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
		</div>
	);
}
