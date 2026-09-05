import * as stylex from "@octanejs/stylex";
import type { CSSProperties } from "react";
import type { DotMatrixLoaderProps } from "./shared.ts";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

const SPIRAL_ORDER_5 = [
	0, 1, 2, 3, 4, 15, 16, 17, 18, 5, 14, 23, 24, 19, 6, 13, 22, 21, 20, 7, 12,
	11, 10, 9, 8,
] as const;

const SPIRAL_DOTS = SPIRAL_ORDER_5.map((order, id) => ({ id, order }));

const BASE_CYCLE_MS = 2400;

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
				inlineStyles.getDotMatrixLoaderMatrixGridStyle(
					`repeat(5, ${dotSize}px)`,
					`repeat(5, ${dotSize}px)`,
					`${gap}px`,
				) as CSSProperties
			}
			{...a11yProps}
		>
			{SPIRAL_DOTS.map((dot) => (
				<span
					key={dot.id}
					{...stylex.props(styles.spiralDot)}
					style={
						inlineStyles.getDotMatrixLoaderSpiralDotStyle(
							`${dotSize}px`,
							`${dotSize}px`,
							`${cycleMs}ms`,
							dot.order,
						) as CSSProperties
					}
				/>
			))}
		</div>
	);
}

void DotMatrixLoader;

export { DotMatrixRipple } from "./DotMatrixRipple.tsx";

export { DotMatrixWeave } from "./DotMatrixWeave.tsx";

export { ThinkingIndicator } from "./ThinkingIndicator.tsx";
