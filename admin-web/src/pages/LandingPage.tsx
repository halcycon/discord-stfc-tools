import { Link } from 'react-router-dom';
import { legalOperator } from '../legal/operator';
import './pages.css';

/** Public landing — no auth (Discord app verification links Privacy / Terms here). */
export function LandingPage() {
	return (
		<div className="shell center">
			<div className="card login-card" style={{ maxWidth: 480 }}>
				<p className="eyebrow">{legalOperator.productName}</p>
				<h1>Discord bot for Star Trek Fleet Command alliances</h1>
				<p className="muted">
					Player verification, roles, channels, surveys, and roster tools for Discord servers.
					Unofficial fan-made software — not affiliated with or endorsed by Paramount, CBS,
					Scopely, Discord, Cloudflare, or stfc.pro. See{' '}
					<Link to="/terms">Terms</Link> (§ trademarks).
				</p>
				<div className="landing-actions">
					<Link className="btn primary" to="/login">
						Admin console
					</Link>
					<div className="landing-links">
						<Link to="/privacy">Privacy Policy</Link>
						<span className="muted">·</span>
						<Link to="/terms">Terms of Service</Link>
					</div>
				</div>
				<p className="tiny muted" style={{ marginTop: '1.25rem' }}>
					Slash commands work inside Discord. This site is optional admin UI and public legal
					pages.
				</p>
			</div>
		</div>
	);
}
