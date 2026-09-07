import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import { type CSSProperties, domStyle } from "../../lib/dom.tsx";
import type { DotMatrixLoaderProps } from "./index.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

const RIPPLE_RING_5 = [
	4, 3, 2, 3, 4, 3, 2, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 2, 3, 4, 3, 2, 3, 4,
] as const;
const RIPPLE_DOTS = RIPPLE_RING_5.map((ring, id) => ({
	id,
	ring,
}));
const RIPPLE_CYCLE_MS = 1500;
export function DotMatrixRipple(_props: DotMatrixLoaderProps) {
	const cycleMs = createMemo(
		() =>
			RIPPLE_CYCLE_MS /
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
				inlineStyles.getDotMatrixRippleMatrixGridStyle(
					`repeat(5, ${_props.dotSize === undefined ? 2 : _props.dotSize}px)`,
					`repeat(5, ${_props.dotSize === undefined ? 2 : _props.dotSize}px)`,
					`${_props.gap === undefined ? 1 : _props.gap}px`,
				) as CSSProperties,
			)}
			{...a11yProps()}
		>
			{RIPPLE_DOTS.map((dot) => (
				<span
					{...stylex.attrs(styles.rippleDot)}
					style={domStyle(
						inlineStyles.getDotMatrixRippleRippleDotStyle(
							`${_props.dotSize === undefined ? 2 : _props.dotSize}px`,
							`${_props.dotSize === undefined ? 2 : _props.dotSize}px`,
							`${cycleMs()}ms`,
							dot.ring,
							dot.ring % 2,
						) as CSSProperties,
					)}
				/>
			))}
		</div>
	);
}
