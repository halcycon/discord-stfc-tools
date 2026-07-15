import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LcarsFrame } from '../lcars/LcarsFrame';

export function LoginPage() {
	const [params] = useSearchParams();
	const error = params.get('error');

	const apiBase = useMemo(
		() => (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '') || '(set VITE_API_BASE_URL)',
		[],
	);

	function startLogin() {
		const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
		if (!base) {
			alert('Set VITE_API_BASE_URL to your Worker URL (see admin-web/.env.example)');
			return;
		}
		window.location.href = `${base}/api/admin/auth/login?redirect=1`;
	}

	return (
		<LcarsFrame
			compact
			title="Admin console"
			eyebrow="STFC Tools · Access"
			navTop={[
				{ label: 'Home', to: '/', color: 6 },
				{ label: 'Privacy', to: '/privacy', color: 8 },
			]}
			navBottom={[
				{ label: 'Terms', to: '/terms', color: 2 },
				{ label: '02-4419', color: 3 },
			]}
			actions={
				<button type="button" className="lcars-pill" onClick={startLogin}>
					Discord login
				</button>
			}
		>
			<p className="muted">
				Sign in with Discord. You will see guilds where you are an Administrator or hold a
				configured web-admin role.
			</p>
			{error ? <p className="error">Login failed: {error}</p> : null}
			<div style={{ marginTop: '1.25rem' }}>
				<button type="button" className="lcars-pill" onClick={startLogin}>
					Continue with Discord
				</button>
			</div>
			<p className="tiny muted" style={{ marginTop: '1.25rem' }}>
				API: {apiBase}
			</p>
			<p className="tiny muted">Slash commands still work in Discord — this UI is an addition.</p>
			<p className="landing-links" style={{ marginTop: '1rem' }}>
				<Link to="/privacy">Privacy</Link>
				<span className="muted">·</span>
				<Link to="/terms">Terms</Link>
				<span className="muted">·</span>
				<Link to="/">Home</Link>
			</p>
		</LcarsFrame>
	);
}
