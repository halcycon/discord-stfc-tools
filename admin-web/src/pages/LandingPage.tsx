import { Link } from 'react-router-dom';
import { legalOperator } from '../legal/operator';

/** Public landing — LCARS hero; no auth required. */
export function LandingPage() {
	return (
		<div className="lcars-screen">
			<div className="lcars-hero">
				<p className="lcars-hero-brand">{legalOperator.productName}</p>
				<div className="lcars-hero-line" aria-hidden="true">
					<span />
					<span />
					<span />
					<span />
				</div>
				<h1>Discord bot for Star Trek Fleet Command alliances</h1>
				<p className="muted">
					Player verification, roles, channels, surveys, and roster tools. Unofficial
					fan-made software — not affiliated with Paramount, CBS, Scopely, Discord,
					Cloudflare, or stfc.pro.
				</p>
				<div className="lcars-hero-actions">
					<Link className="lcars-pill" to="/login">
						Admin console
					</Link>
					<Link className="lcars-pill lcars-pill--ghost" to="/terms">
						Terms
					</Link>
				</div>
				<div className="lcars-hero-links">
					<Link to="/privacy">Privacy Policy</Link>
					<span className="muted">·</span>
					<Link to="/terms">Terms of Service</Link>
				</div>
				<p className="lcars-hero-note">
					Slash commands work inside Discord. This site is optional admin UI and public
					legal pages.
				</p>
			</div>
		</div>
	);
}
