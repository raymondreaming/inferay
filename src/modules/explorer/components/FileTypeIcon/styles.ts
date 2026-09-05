import type { CSSProperties } from "react";

export function getFolderTypeIconImgStyle(
	width: CSSProperties["width"],
	height: CSSProperties["height"],
): CSSProperties {
	return {
		width: width,
		height: height,
		flexShrink: 0,
		opacity: 0.98,
		filter: "saturate(0.82) brightness(1.08)",
	} as CSSProperties;
}

export function getFileTypeIconImgStyle(
	width: CSSProperties["width"],
	height: CSSProperties["height"],
	overrides: CSSProperties | undefined | null,
): CSSProperties {
	return {
		width: width,
		height: height,
		flexShrink: 0,
		opacity: 0.96,
		filter: "saturate(0.76) brightness(1.08)",
		...overrides,
	} as CSSProperties;
}
