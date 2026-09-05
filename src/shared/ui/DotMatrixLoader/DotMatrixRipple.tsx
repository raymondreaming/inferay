import * as stylex from "@octanejs/stylex";
import type { CSSProperties } from "react";
import type { DotMatrixLoaderProps } from "./shared.ts";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

const RIPPLE_RING_5 = [
	4, 3, 2, 3, 4, 3, 2, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 2, 3, 4, 3, 2, 3, 4,
] as const;

const RIPPLE_DOTS = RIPPLE_RING_5.map((ring, id) => ({ id, ring }));

const RIPPLE_CYCLE_MS = 1500;

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
				inlineStyles.getDotMatrixRippleMatrixGridStyle(
					`repeat(5, ${dotSize}px)`,
					`repeat(5, ${dotSize}px)`,
					`${gap}px`,
				) as CSSProperties
			}
			{...a11yProps}
		>
			{RIPPLE_DOTS.map((dot) => (
				<span
					key={dot.id}
					{...stylex.props(styles.rippleDot)}
					style={
						inlineStyles.getDotMatrixRippleRippleDotStyle(
							`${dotSize}px`,
							`${dotSize}px`,
							`${cycleMs}ms`,
							dot.ring,
							dot.ring % 2,
						) as CSSProperties
					}
				/>
			))}
		</div>
	);
}
