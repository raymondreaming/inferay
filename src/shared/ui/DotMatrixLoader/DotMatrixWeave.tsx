import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import { type CSSProperties, domStyle } from "../../lib/dom.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
import type { DotMatrixLoaderProps } from "./types.ts";

const WEAVE_DOTS = Array.from(
	{
		length: 25,
	},
	(_, id) => {
		const row = Math.floor(id / 5);
		const col = id % 5;
		return {
			col,
			id,
			peak: col === 1 || col === 3,
			row,
		};
	},
);
export function DotMatrixWeave(
	props: DotMatrixLoaderProps & {
		size?: number;
	},
) {
	const cycleMs = createMemo(
		() => 1600 / Math.max(props.speed === undefined ? 1 : props.speed, 0.1),
	);
	const a11yProps = createMemo(() =>
		props.ariaLabel
			? {
					role: "status" as const,
					"aria-label": props.ariaLabel,
				}
			: {
					role: "presentation" as const,
					"aria-hidden": "true" as const,
				},
	);
	return (
		<div
			{...stylex.attrs(styles.weaveSlot)}
			style={domStyle(
				inlineStyles.getDotMatrixWeaveWeaveSlotStyle(
					props.size === undefined ? 15 : props.size,
					props.size === undefined ? 15 : props.size,
				) as CSSProperties,
			)}
			{...a11yProps()}
		>
			<div
				{...stylex.attrs(styles.weaveGrid)}
				style={domStyle(
					inlineStyles.getDotMatrixWeaveWeaveGridStyle(
						`repeat(5, ${props.dotSize === undefined ? 2 : props.dotSize}px)`,
						`repeat(5, ${props.dotSize === undefined ? 2 : props.dotSize}px)`,
						`${props.gap === undefined ? 1 : props.gap}px`,
						`${cycleMs()}ms`,
					) as CSSProperties,
				)}
			>
				{WEAVE_DOTS.map((dot) => (
					<span
						{...stylex.attrs(
							styles.weaveDot,
							dot.peak ? styles.weaveDotPeak : styles.weaveDotBase,
						)}
						style={domStyle(
							inlineStyles.getDotMatrixWeaveWeaveDotStyle(
								props.dotSize === undefined ? 2 : props.dotSize,
								Math.abs(2 - dot.col),
								dot.row,
								props.dotSize === undefined ? 2 : props.dotSize,
							) as CSSProperties,
						)}
					/>
				))}
			</div>
		</div>
	);
}
