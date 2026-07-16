import { Link, useLocation } from 'react-router-dom';
import type { CSSProperties, ReactNode } from 'react';
import './lcars.css';

export type LcarsNavItem = {
	label: string;
	short?: string;
	to?: string;
	onClick?: () => void;
	color?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 'alert';
	active?: boolean;
};

type Props = {
	title: string;
	eyebrow?: string;
	actions?: ReactNode;
	navTop?: LcarsNavItem[];
	navBottom?: LcarsNavItem[];
	children: ReactNode;
};

function colorClass(color: LcarsNavItem['color'], base: string) {
	if (color === 'alert') return `${base}--alert`;
	if (color) return `${base}--a${color}`;
	return `${base}--a3`;
}

function frameColorVar(color: LcarsNavItem['color']) {
	if (color === 'alert') return 'var(--lcars-alert)';
	return `var(--lcars-a${color ?? 6})`;
}

function NavButton({ item }: { item: LcarsNavItem }) {
	const className = `lcars-nav-btn ${colorClass(item.color, 'lcars-nav-btn')}${
		item.active ? ' lcars-nav-btn--active' : ''
	}`;

	if (item.to) {
		return (
			<Link className={className} to={item.to}>
				{item.label}
			</Link>
		);
	}
	if (item.onClick) {
		return (
			<button type="button" className={className} onClick={item.onClick}>
				{item.label}
			</button>
		);
	}
	return <div className={`${className} lcars-nav-btn--deco`}>{item.label}</div>;
}

function MobileNav({ items }: { items: LcarsNavItem[] }) {
	const interactive = items.filter((i) => i.to || i.onClick);
	if (interactive.length === 0) return null;
	return (
		<nav className="lcars-mobile-nav" aria-label="Console navigation">
			{interactive.map((item) => {
				const pill = `lcars-pill lcars-pill--sm ${colorClass(item.color, 'lcars-pill')}`;
				if (item.to) {
					return (
						<Link key={item.label} className={pill} to={item.to}>
							{item.label}
						</Link>
					);
				}
				return (
					<button key={item.label} type="button" className={pill} onClick={item.onClick}>
						{item.label}
					</button>
				);
			})}
		</nav>
	);
}

/**
 * Single continuous LCARS pillar with one top elbow.
 * Sidebar spans the full height; the horizontal bar sweeps out of it,
 * and a concave scoop rounds the inner corner where they meet.
 */
export function LcarsFrame({
	title,
	eyebrow,
	actions,
	navTop = [],
	navBottom = [],
	children,
}: Props) {
	const { pathname } = useLocation();
	const nav: LcarsNavItem[] = [...navTop, ...navBottom].map((item) => ({
		...item,
		active: item.active ?? (item.to != null && item.to === pathname),
	}));
	const activeItem = nav.find((item) => item.active);
	const frameStyle = {
		'--lcars-frame-color': frameColorVar(activeItem?.color),
	} as CSSProperties;
	const deco: LcarsNavItem[] =
		nav.length > 0
			? [{ label: '01-4409', color: 3 }, { label: 'LCARS 24', color: 3 }]
			: [];

	return (
		<div className="lcars-screen">
			<div className="lcars-frame" style={frameStyle}>
				<aside className="lcars-sidebar" aria-label="Console navigation">
					<div className="lcars-sidebar-nav">
						{nav.map((item) => (
							<NavButton key={item.label} item={item} />
						))}
					</div>
					<div className="lcars-sidebar-fill" aria-hidden="true" />
					<div className="lcars-sidebar-deco" aria-hidden="true">
						{deco.map((item) => (
							<NavButton key={item.label} item={item} />
						))}
					</div>
				</aside>

				<header className="lcars-header">
					{eyebrow ? <p className="lcars-eyebrow">{eyebrow}</p> : null}
					<div className="lcars-banner-row">
						<h1 className="lcars-banner">{title}</h1>
						{actions ? <div className="lcars-banner-actions">{actions}</div> : null}
					</div>
				</header>

				<div className="lcars-topbar" aria-hidden="true">
					<span className="lcars-bar lcars-bar--elbow" />
					<span className="lcars-bar lcars-bar--gap1" />
					<span className="lcars-bar lcars-bar--seg2" />
					<span className="lcars-bar lcars-bar--seg3" />
					<span className="lcars-bar lcars-bar--tail" />
				</div>

				<main className="lcars-main">
					<MobileNav items={nav} />
					{children}
				</main>
			</div>
		</div>
	);
}

type PanelProps = {
	label: string;
	cap?: 'a1' | 'a2' | 'a5' | 'a6' | 'a7' | 'a8';
	children: ReactNode;
};

export function LcarsPanel({ label, cap = 'a1', children }: PanelProps) {
	return (
		<section className="lcars-section">
			<div className={`lcars-text-bar lcars-text-bar--${cap}`}>{label}</div>
			<div className="lcars-section-body">{children}</div>
		</section>
	);
}
