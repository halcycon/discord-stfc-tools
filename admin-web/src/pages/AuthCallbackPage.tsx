import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { setStoredSessionToken } from '../api';
import { LcarsFrame } from '../lcars/LcarsFrame';

/**
 * OAuth return landing: Worker redirects here with ?stfc_session=… because the
 * HttpOnly cookie on the Worker origin is treated as a third-party cookie by
 * mobile Safari when the SPA (Pages) later calls the API — so it never sticks.
 */
export function AuthCallbackPage() {
	const [params] = useSearchParams();
	const navigate = useNavigate();

	useEffect(() => {
		const token = params.get('stfc_session');
		if (!token) {
			navigate('/login?error=missing_session', { replace: true });
			return;
		}
		try {
			setStoredSessionToken(token);
		} catch {
			navigate('/login?error=storage_blocked', { replace: true });
			return;
		}
		navigate('/app', { replace: true });
	}, [params, navigate]);

	return (
		<LcarsFrame title="Signing in" eyebrow="STFC Tools" navBottom={[{ label: 'Auth', color: 5 }]}>
			<p className="lcars-status">Completing Discord sign-in…</p>
		</LcarsFrame>
	);
}
