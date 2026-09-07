import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import { type CSSProperties, domStyle } from "../../lib/dom.tsx";
import type { DotMatrixLoaderProps } from "./index.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

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
interface DotMatrixWeaveProps extends DotMatrixLoaderProps {
	size?: number;
}
export function DotMatrixWeave(_props: DotMatrixWeaveProps) {
	const cycleMs = createMemo(
		() => 1600 / Math.max(_props.speed === undefined ? 1 : _props.speed, 0.1),
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
			{...stylex.attrs(styles.weaveSlot)}
			style={domStyle(
				inlineStyles.getDotMatrixWeaveWeaveSlotStyle(
					_props.size === undefined ? 15 : _props.size,
					_props.size === undefined ? 15 : _props.size,
				) as CSSProperties,
			)}
			{...a11yProps()}
		>
			<div
				{...stylex.attrs(styles.weaveGrid)}
				style={domStyle(
					inlineStyles.getDotMatrixWeaveWeaveGridStyle(
						`repeat(5, ${_props.dotSize === undefined ? 2 : _props.dotSize}px)`,
						`repeat(5, ${_props.dotSize === undefined ? 2 : _props.dotSize}px)`,
						`${_props.gap === undefined ? 1 : _props.gap}px`,
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
								_props.dotSize === undefined ? 2 : _props.dotSize,
								Math.abs(2 - dot.col),
								dot.row,
								_props.dotSize === undefined ? 2 : _props.dotSize,
							) as CSSProperties,
						)}
					/>
				))}
			</div>
		</div>
	);
}
