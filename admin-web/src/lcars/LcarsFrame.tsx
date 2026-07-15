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
	children: ReactNode;
};

function Block({ item }: { item: LcarsNavItem }) {
	const colorClass =
		item.color === 'alert'
			? 'lcars-block--alert'
			: item.color
				? `lcars-block--a${item.color}`
				: 'lcars-block--a3';
	const className = `lcars-block ${colorClass}${item.active ? ' lcars-block--active' : ''}${
		!(item.to || item.onClick) ? ' lcars-block--ghost' : ''
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
	return <div className={className}>{item.label}</div>;
}

function MobileNav({ items }: { items: LcarsNavItem[] }) {
	const interactive = items.filter((i) => i.to || i.onClick);
	if (interactive.length === 0) return null;
	return (
		<nav className="lcars-mobile-nav" aria-label="Console navigation">
			{interactive.map((item) => {
				const className = `lcars-pill lcars-pill--sm${
					item.color === 8
						? ' lcars-pill--a8'
						: item.color === 6
							? ' lcars-pill--a6'
							: item.color === 1
								? ' lcars-pill--a1'
								: ''
				}`;
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
 * Classic LCARS console frame (louh/lcars-style elbows):
 * sidebar-top + title/divider, sidebar-bottom + main.
 */
export function LcarsFrame({
	title,
	eyebrow,
	actions,
	navTop = [],
	navBottom = [],
	children,
}: Props) {
	const allNav = [...navTop, ...navBottom];
	const topBlocks =
		navTop.length > 0
			? navTop
			: [
					{ label: '01-220', color: 3 as const },
					{ label: 'LCARS', color: 7 as const },
				];
	const botBlocks =
		navBottom.length > 0
			? navBottom
			: [
					{ label: '04-881', color: 2 as const },
					{ label: '44-019', color: 4 as const },
				];

	return (
		<div className="lcars-screen">
			<div className="lcars-frame">
				<aside className="lcars-rail-top">
					<div className="lcars-rail-blocks">
						{topBlocks.map((item) => (
							<Block key={item.label} item={item} />
						))}
						{/* elbow filler — transparent so rail color shows through */}
						<div className="lcars-block lcars-block--elbow" aria-hidden="true" />
					</div>
				</aside>

				<header className="lcars-header">
					{eyebrow ? <p className="lcars-eyebrow">{eyebrow}</p> : null}
					<div className="lcars-title-row">
						<h1 className="lcars-title">{title}</h1>
						{actions ? <div className="lcars-title-actions">{actions}</div> : null}
					</div>
				</header>

				<div className="lcars-bar-top" aria-hidden="true" />
				<div className="lcars-bar-bot" aria-hidden="true" />

				<aside className="lcars-rail-bot">
					<div className="lcars-rail-blocks">
						<div className="lcars-block lcars-block--elbow" aria-hidden="true" />
						{botBlocks.map((item) => (
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
