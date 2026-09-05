import type { CSSProperties } from "react";

export function getLiquidSegmentedRailLiquidStyle(): CSSProperties {
	return { height: "100%", width: "100%" } as CSSProperties;
}

export function getLiquidSegmentedRailSpanStyle(
	borderRadius: CSSProperties["borderRadius"],
	width: CSSProperties["width"],
	height: CSSProperties["height"],
	transform: CSSProperties["transform"],
): CSSProperties {
	return {
		borderRadius: borderRadius,
		width: width,
		height: height,
		transform: transform,
	} as CSSProperties;
}
