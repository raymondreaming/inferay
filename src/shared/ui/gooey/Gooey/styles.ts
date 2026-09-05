import type { CSSProperties } from "react";

export function getGooeyRootDivStyle(
	overrides: CSSProperties | undefined | null,
): CSSProperties {
	return {
		position: "relative",
		isolation: "isolate",
		...overrides,
	} as CSSProperties;
}

export function getGooeyRootSvgStyle(
	filter: CSSProperties["filter"],
): CSSProperties {
	return {
		position: "absolute",
		inset: 0,
		width: "100%",
		height: "100%",
		overflow: "visible",
		pointerEvents: "none",
		zIndex: -1,
		filter: filter,
		willChange: "filter, transform",
	} as CSSProperties;
}

export function getGooeyRootGStyle(fill: CSSProperties["fill"]): CSSProperties {
	return { fill: fill } as CSSProperties;
}
