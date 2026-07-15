import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import './lcars.css';

export type LcarsNavItem = {
	label: string;
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
	compact?: boolean;
	children: ReactNode;
};

function Block({ item }: { item: LcarsNavItem }) {
	const colorClass =
		item.color === 'alert'
			? 'lcars-block--alert'
			: item.color
				? `lcars-block--a${item.color}`
				: 'lcars-block--a3';
	const className = `lcars-block ${colorClass}${item.active ? ' lcars-block--active' : ''}`;

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
	return <div className={`${className} lcars-block--ghost`}>{item.label}</div>;
}

function MobileNav({ items }: { items: LcarsNavItem[] }) {
	const interactive = items.filter((i) => i.to || i.onClick);
	if (interactive.length === 0) return null;
	return (
		<nav className="lcars-mobile-nav" aria-label="Console navigation">
			{interactive.map((item) => {
				const className = `lcars-pill lcars-pill--sm${item.color === 8 ? ' lcars-pill--a8' : item.color === 6 ? ' lcars-pill--a6' : item.color === 1 ? ' lcars-pill--a1' : ''}`;
				if (item.to) {
					return (
						<Link key={item.label} className={className} to={item.to}>
							{item.label}
						</Link>
					);
				}
				return (
					<button key={item.label} type="button" className={className} onClick={item.onClick}>
						{item.label}
					</button>
				);
			})}
		</nav>
	);
}

/** Full LCARS console frame with elbow rails (desktop) and pill nav (mobile). */
export function LcarsFrame({
	title,
	eyebrow,
	actions,
	navTop = [],
	navBottom = [],
	compact = false,
	children,
}: Props) {
	const allNav = [...navTop, ...navBottom];

	return (
		<div className="lcars-screen">
			<div className={`lcars-frame${compact ? ' lcars-frame--compact' : ''}`}>
				<aside className="lcars-rail-top" aria-hidden={navTop.length === 0}>
					<div className="lcars-rail-blocks">
						{navTop.map((item) => (
							<Block key={item.label} item={item} />
						))}
					</div>
				</aside>

				<header className="lcars-header">
					{eyebrow ? <p className="lcars-eyebrow">{eyebrow}</p> : null}
					<div className="lcars-title-row">
						<h1 className="lcars-title">{title}</h1>
						{actions ? <div className="lcars-title-actions">{actions}</div> : null}
					</div>
					<div className="lcars-divider" aria-hidden="true">
						<span />
						<span />
						<span />
					</div>
				</header>

				<aside className="lcars-rail-bot" aria-hidden={navBottom.length === 0}>
					<div className="lcars-rail-blocks">
						{navBottom.map((item) => (
							<Block key={item.label} item={item} />
						))}
					</div>
				</aside>

				<main className="lcars-main">
					<MobileNav items={allNav} />
					{children}
				</main>
			</div>
		</div>
	);
}

type PanelProps = {
	label: string;
	cap?: 'a1' | 'a2' | 'a5' | 'a6' | 'a8';
	children: ReactNode;
};

export function LcarsPanel({ label, cap = 'a1', children }: PanelProps) {
	return (
		<section className="lcars-panel">
			<div className="lcars-panel-head">
				<div className={`lcars-panel-cap lcars-panel-cap--${cap}`} aria-hidden="true" />
				<div className="lcars-panel-label">{label}</div>
			</div>
			<div className="lcars-panel-body">{children}</div>
		</section>
	);
}
