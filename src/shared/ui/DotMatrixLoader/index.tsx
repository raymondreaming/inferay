import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import { type CSSProperties, domStyle } from "../../lib/dom.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

const SPIRAL_ORDER_5 = [
	0, 1, 2, 3, 4, 15, 16, 17, 18, 5, 14, 23, 24, 19, 6, 13, 22, 21, 20, 7, 12,
	11, 10, 9, 8,
] as const;
const SPIRAL_DOTS = SPIRAL_ORDER_5.map((order, id) => ({
	id,
	order,
}));
const BASE_CYCLE_MS = 2400;
function DotMatrixLoader(_props: DotMatrixLoaderProps) {
	const cycleMs = createMemo(
		() =>
			BASE_CYCLE_MS /
			Math.max(_props.speed === undefined ? 1 : _props.speed, 0.1),
	);
	const a11yProps = createMemo(() =>
		_props.ariaLabel
			? {
					role: "status" as const,
					"aria-label": _props.ariaLabel,
				}
			: {
					role: "presentation" as const,
					"aria-hidden": "true" as const,
				},
	);
	return (
		<div
			{...stylex.attrs(styles.matrixGrid)}
			style={domStyle(
				inlineStyles.getDotMatrixLoaderMatrixGridStyle(
					`repeat(5, ${_props.dotSize === undefined ? 2 : _props.dotSize}px)`,
					`repeat(5, ${_props.dotSize === undefined ? 2 : _props.dotSize}px)`,
					`${_props.gap === undefined ? 1 : _props.gap}px`,
				) as CSSProperties,
			)}
			{...a11yProps()}
		>
			{SPIRAL_DOTS.map((dot) => (
				<span
					{...stylex.attrs(styles.spiralDot)}
					style={domStyle(
						inlineStyles.getDotMatrixLoaderSpiralDotStyle(
							`${_props.dotSize === undefined ? 2 : _props.dotSize}px`,
							`${_props.dotSize === undefined ? 2 : _props.dotSize}px`,
							`${cycleMs()}ms`,
							dot.order,
						) as CSSProperties,
					)}
				/>
			))}
		</div>
	);
}
void DotMatrixLoader;

export { DotMatrixRipple } from "./DotMatrixRipple.tsx";
export { DotMatrixWeave } from "./DotMatrixWeave.tsx";
export { ThinkingIndicator } from "./ThinkingIndicator.tsx";
export interface DotMatrixLoaderProps {
	dotSize?: number;
	gap?: number;
	speed?: number;
	ariaLabel?: string;
}
