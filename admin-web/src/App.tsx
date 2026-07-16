import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { HomePage } from './pages/HomePage';
import { PrivacyPage } from './pages/PrivacyPage';
import { TermsPage } from './pages/TermsPage';
import { GuildLayout } from './guild/GuildLayout';
import { DashboardPage } from './pages/guild/DashboardPage';
import { ReportsPage } from './pages/guild/ReportsPage';
import { SurveysPage } from './pages/guild/SurveysPage';
import { ConfigPage } from './pages/guild/ConfigPage';
import { PermissionsPage } from './pages/guild/PermissionsPage';
import { ExchangePage } from './pages/guild/ExchangePage';
import './App.css';

export default function App() {
	return (
		<BrowserRouter>
			<Routes>
				<Route path="/" element={<LandingPage />} />
				<Route path="/privacy" element={<PrivacyPage />} />
				<Route path="/terms" element={<TermsPage />} />
				<Route path="/login" element={<LoginPage />} />
				<Route path="/auth/callback" element={<AuthCallbackPage />} />
				<Route path="/app" element={<HomePage />} />
				<Route path="/guilds/:guildId" element={<GuildLayout />}>
					<Route index element={<DashboardPage />} />
					<Route path="reports" element={<ReportsPage />} />
					<Route path="surveys" element={<SurveysPage />} />
					<Route path="config" element={<ConfigPage />} />
					<Route path="permissions" element={<PermissionsPage />} />
					<Route path="exchange" element={<ExchangePage />} />
				</Route>
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
		</BrowserRouter>
	);
}
