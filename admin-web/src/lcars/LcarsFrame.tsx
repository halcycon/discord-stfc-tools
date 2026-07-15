import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
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

function colorClass(color?: LcarsNavItem['color']) {
	if (color === 'alert') return 'lcars-btn--alert';
	if (color) return `lcars-btn--a${color}`;
	return 'lcars-btn--a3';
}

function NavBtn({ item }: { item: LcarsNavItem }) {
	const className = `lcars-btn ${colorClass(item.color)}${
		item.active ? ' lcars-btn--active' : ''
	}${!(item.to || item.onClick) ? ' lcars-btn--ghost' : ''}`;
	const label = (
		<>
			<span className="lcars-btn__full">{item.label}</span>
			<span className="lcars-btn__short">{item.short ?? item.label.slice(0, 3)}</span>
		</>
	);

	if (item.to) {
		return (
			<Link className={className} to={item.to}>
				{label}
			</Link>
		);
	}
	if (item.onClick) {
		return (
			<button type="button" className={className} onClick={item.onClick}>
				{label}
			</button>
		);
	}
	return <div className={className}>{label}</div>;
}

function MobileNav({ items }: { items: LcarsNavItem[] }) {
	const interactive = items.filter((i) => i.to || i.onClick);
	if (interactive.length === 0) return null;
	return (
		<nav className="lcars-mobile-nav" aria-label="Console navigation">
			{interactive.map((item) => {
				const className = `lcars-pill lcars-pill--sm ${colorClass(item.color).replace(
					'lcars-btn',
					'lcars-pill',
				)}`;
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

/**
 * Single LCARS L-bracket via CSS grid:
 * upper rail spans header+bars rows (flush elbow), lower rail sits beside main.
 */
export function LcarsFrame({
	title,
	eyebrow,
	actions,
	navTop = [],
	navBottom = [],
	children,
}: Props) {
	const top =
		navTop.length > 0
			? navTop
			: [
					{ label: 'STFC', short: '01', color: 5 as const },
					{ label: 'Tools', short: '22', color: 6 as const },
				];
	const bot =
		navBottom.length > 0
			? navBottom
			: [
					{ label: '04-881', short: '04', color: 2 as const },
					{ label: '44-019', short: '44', color: 1 as const },
				];

	return (
		<div className="lcars-screen">
			<div className="lcars-frame">
				<aside className="lcars-rail-upper" aria-label="Primary navigation">
					{top.map((item) => (
						<NavBtn key={item.label} item={item} />
					))}
					<div className="lcars-elbow" aria-hidden="true" />
				</aside>

				<header className="lcars-header">
					{eyebrow ? <p className="lcars-eyebrow">{eyebrow}</p> : null}
					<div className="lcars-title-row">
						<h1 className="lcars-title">{title}</h1>
						{actions ? <div className="lcars-title-actions">{actions}</div> : null}
					</div>
				</header>

				<div className="lcars-bar-row" aria-hidden="true">
					<span className="lcars-bar lcars-bar--1" />
					<span className="lcars-bar lcars-bar--2" />
					<span className="lcars-bar lcars-bar--3" />
					<span className="lcars-bar lcars-bar--4" />
					<span className="lcars-bar lcars-bar--5" />
				</div>

				<aside className="lcars-rail-lower" aria-label="Secondary navigation">
					{bot.map((item) => (
						<NavBtn key={item.label} item={item} />
					))}
					<div className="lcars-rail-fill" aria-hidden="true" />
				</aside>

				<main className="lcars-main">
					<MobileNav items={[...top, ...bot]} />
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
			<div className={`lcars-text-bar lcars-text-bar--${cap}`}>{label}</div>
			<div className="lcars-panel-body">{children}</div>
		</section>
	);
}
