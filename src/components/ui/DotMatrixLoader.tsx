import * as stylex from "@octanejs/stylex";
import { useEffect, useState } from "octane";
import type { CSSProperties } from "react";
import { formatElapsedMs } from "../../lib/format.ts";
import { color, controlSize, font, radius } from "../../tokens.stylex.ts";

const SPIRAL_ORDER_5 = [
	0, 1, 2, 3, 4, 15, 16, 17, 18, 5, 14, 23, 24, 19, 6, 13, 22, 21, 20, 7, 12,
	11, 10, 9, 8,
] as const;

const RIPPLE_RING_5 = [
	4, 3, 2, 3, 4, 3, 2, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 2, 3, 4, 3, 2, 3, 4,
] as const;

const SPIRAL_DOTS = SPIRAL_ORDER_5.map((order, id) => ({ id, order }));
const RIPPLE_DOTS = RIPPLE_RING_5.map((ring, id) => ({ id, ring }));
const WEAVE_DOTS = Array.from({ length: 25 }, (_, id) => {
	const row = Math.floor(id / 5);
	const col = id % 5;
	return {
		col,
		id,
		peak: col === 1 || col === 3,
		row,
	};
});

const BASE_CYCLE_MS = 2400;
const RIPPLE_CYCLE_MS = 1500;
const rippleEcho = stylex.keyframes({
	"0%, 100%": { opacity: 0.1 },
	"28%": { opacity: 0.98 },
	"56%": { opacity: 0.32 },
	"78%": { opacity: 0.78 },
});
const spiralFade = stylex.keyframes({
	"0%, 100%": { opacity: 0.15 },
	"8%": { opacity: 1 },
	"16%": { opacity: 0.73 },
	"24%": { opacity: 0.56 },
	"32%": { opacity: 0.4 },
	"40%": { opacity: 0.22 },
});
const weaveStrand = stylex.keyframes({
	"0%, 100%": {
		opacity: 0.08,
		transform: "scale(0.72)",
	},
	"45%": {
		opacity: 1,
		transform: "scale(1)",
	},
	"76%": {
		opacity: 0.34,
		transform: "scale(0.88)",
	},
});

interface DotMatrixLoaderProps {
	dotSize?: number;
	gap?: number;
	speed?: number;
	ariaLabel?: string;
}

interface DotMatrixWeaveProps extends DotMatrixLoaderProps {
	size?: number;
}

function DotMatrixLoader({
	dotSize = 2,
	gap = 1,
	speed = 1,
	ariaLabel,
}: DotMatrixLoaderProps = {}) {
	const cycleMs = BASE_CYCLE_MS / Math.max(speed, 0.1);
	const a11yProps = ariaLabel
		? { role: "status", "aria-label": ariaLabel }
		: { role: "presentation", "aria-hidden": true as const };
	return (
		<div
			{...stylex.props(styles.matrixGrid)}
			style={
				{
					gridTemplateColumns: `repeat(5, ${dotSize}px)`,
					gridTemplateRows: `repeat(5, ${dotSize}px)`,
					gap: `${gap}px`,
				} as CSSProperties
			}
			{...a11yProps}
		>
			{SPIRAL_DOTS.map((dot) => (
				<span
					key={dot.id}
					{...stylex.props(styles.spiralDot)}
					style={
						{
							width: `${dotSize}px`,
							height: `${dotSize}px`,
							"--dmx-cycle": `${cycleMs}ms`,
							"--dmx-spiral-order": dot.order,
						} as CSSProperties
					}
				/>
			))}
		</div>
	);
}

export function DotMatrixRipple({
	dotSize = 2,
	gap = 1,
	speed = 1,
	ariaLabel,
}: DotMatrixLoaderProps = {}) {
	const cycleMs = RIPPLE_CYCLE_MS / Math.max(speed, 0.1);
	const a11yProps = ariaLabel
		? { role: "status", "aria-label": ariaLabel }
		: { role: "presentation", "aria-hidden": true as const };
	return (
		<div
			{...stylex.props(styles.matrixGrid)}
			style={
				{
					gridTemplateColumns: `repeat(5, ${dotSize}px)`,
					gridTemplateRows: `repeat(5, ${dotSize}px)`,
					gap: `${gap}px`,
				} as CSSProperties
			}
			{...a11yProps}
		>
			{RIPPLE_DOTS.map((dot) => (
				<span
					key={dot.id}
					{...stylex.props(styles.rippleDot)}
					style={
						{
							width: `${dotSize}px`,
							height: `${dotSize}px`,
							"--dmx-cycle": `${cycleMs}ms`,
							"--dmx-ripple-ring": dot.ring,
							"--dmx-ripple-parity": dot.ring % 2,
						} as CSSProperties
					}
				/>
			))}
		</div>
	);
}

export function DotMatrixWeave({
	size = 15,
	dotSize = 2,
	gap = 1,
	speed = 1,
	ariaLabel,
}: DotMatrixWeaveProps = {}) {
	const cycleMs = 1600 / Math.max(speed, 0.1);
	const a11yProps = ariaLabel
		? { role: "status", "aria-label": ariaLabel }
		: { role: "presentation", "aria-hidden": true as const };
	return (
		<div
			{...stylex.props(styles.weaveSlot)}
			style={
				{
					height: size,
					width: size,
				} as CSSProperties
			}
			{...a11yProps}
		>
			<div
				{...stylex.props(styles.weaveGrid)}
				style={
					{
						gridTemplateColumns: `repeat(5, ${dotSize}px)`,
						gridTemplateRows: `repeat(5, ${dotSize}px)`,
						gap: `${gap}px`,
						"--dmx-weave-cycle": `${cycleMs}ms`,
					} as CSSProperties
				}
			>
				{WEAVE_DOTS.map((dot) => (
					<span
						key={dot.id}
						{...stylex.props(
							styles.weaveDot,
							dot.peak ? styles.weaveDotPeak : styles.weaveDotBase,
						)}
						style={
							{
								height: dotSize,
								"--dmx-weave-center-distance": Math.abs(2 - dot.col),
								"--dmx-weave-row": dot.row,
								width: dotSize,
							} as CSSProperties
						}
					/>
				))}
			</div>
		</div>
	);
}

export function ThinkingIndicator({ startTime }: { startTime: number }) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, []);
	const elapsed = formatElapsedMs(now - startTime);
	return (
		<output
			{...stylex.props(styles.thinkingRow)}
			aria-live="polite"
			aria-label={`Agent active, ${elapsed} elapsed`}
		>
			<DotMatrixRipple />
			<span {...stylex.props(styles.thinkingTime)}>{elapsed}</span>
		</output>
	);
}

const styles = stylex.create({
	matrixGrid: {
		display: "grid",
		flexShrink: 0,
	},
	rippleDot: {
		animationDelay:
			"calc(var(--dmx-ripple-ring, 0) * 0.14 * var(--dmx-cycle, 1500ms) + var(--dmx-ripple-parity, 0) * 0.03 * var(--dmx-cycle, 1500ms))",
		animationDuration: "var(--dmx-cycle, 1500ms)",
		animationIterationCount: "infinite",
		animationName: rippleEcho,
		animationTimingFunction: "ease-in-out",
		backgroundColor: color.textSoft,
		borderRadius: 1,
		display: "block",
		willChange: "opacity",
	},
	spiralDot: {
		animationDelay:
			"calc(var(--dmx-spiral-order, 0) * 0.04 * var(--dmx-cycle, 2400ms))",
		animationDuration: "var(--dmx-cycle, 2400ms)",
		animationIterationCount: "infinite",
		animationName: spiralFade,
		animationTimingFunction: "linear",
		backgroundColor: color.textSoft,
		borderRadius: 1,
		display: "block",
		willChange: "opacity",
	},
	thinkingRow: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._1_5,
		flexShrink: 0,
	},
	thinkingTime: {
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
		fontVariantNumeric: "tabular-nums",
	},
	weaveSlot: {
		alignItems: "center",
		borderRadius: radius.sm,
		color: "currentColor",
		display: "inline-flex",
		flexShrink: 0,
		justifyContent: "center",
	},
	weaveGrid: {
		display: "grid",
		flexShrink: 0,
	},
	weaveDot: {
		animationDelay:
			"calc((var(--dmx-weave-row, 0) * 0.13 + var(--dmx-weave-center-distance, 0) * 0.08) * -1 * var(--dmx-weave-cycle, 1600ms))",
		animationDirection: "alternate",
		animationDuration: "var(--dmx-weave-cycle, 1600ms)",
		animationIterationCount: "infinite",
		animationName: weaveStrand,
		animationTimingFunction: "ease",
		backgroundColor: "currentColor",
		borderRadius: radius.pill,
		display: "block",
		willChange: "opacity, transform",
	},
	weaveDotBase: {
		opacity: 0.16,
	},
	weaveDotPeak: {
		opacity: 0.58,
	},
});

void DotMatrixLoader;
