import type { CSSProperties } from "react";

export function getMirroredItemDivStyle(
	overrides: CSSProperties | undefined | null,
): CSSProperties {
	return {
		display: "inline-block",
		...overrides,
		willChange: "transform",
		transform: "translate(0px, 0px)",
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

export const mirroredBlobStyle: CSSProperties = {
	transformBox: "fill-box",
	transformOrigin: "center",
	willChange: "transform",
	transform: "translate(0px, 0px)",
};
