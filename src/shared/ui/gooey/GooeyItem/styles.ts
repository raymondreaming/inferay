import type { CSSProperties } from "react";

export function getMirroredItemDivStyle(
	overrides: CSSProperties | undefined | null,
): CSSProperties {
	return {
		display: "inline-block",
		...overrides,
		willChange: "transform",
	} as CSSProperties;
}

export function getObservedItemSpanStyle(
	overrides: CSSProperties | undefined | null,
): CSSProperties {
	return { display: "contents", ...overrides } as CSSProperties;
}

export function getObservedItemRectStyle(): CSSProperties {
	return {
		willChange: "transform",
		transformBox: "fill-box",
		transformOrigin: "center",
	} as CSSProperties;
}
