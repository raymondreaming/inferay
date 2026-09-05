import * as stylex from "@octanejs/stylex";
import type { CSSProperties } from "react";
import type { DotMatrixLoaderProps } from "../../lib/data.ts";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

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

interface DotMatrixWeaveProps extends DotMatrixLoaderProps {
	size?: number;
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
				inlineStyles.getDotMatrixWeaveWeaveSlotStyle(
					size,
					size,
				) as CSSProperties
			}
			{...a11yProps}
		>
			<div
				{...stylex.props(styles.weaveGrid)}
				style={
					inlineStyles.getDotMatrixWeaveWeaveGridStyle(
						`repeat(5, ${dotSize}px)`,
						`repeat(5, ${dotSize}px)`,
						`${gap}px`,
						`${cycleMs}ms`,
					) as CSSProperties
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
							inlineStyles.getDotMatrixWeaveWeaveDotStyle(
								dotSize,
								Math.abs(2 - dot.col),
								dot.row,
								dotSize,
							) as CSSProperties
						}
					/>
				))}
			</div>
		</div>
	);
}
