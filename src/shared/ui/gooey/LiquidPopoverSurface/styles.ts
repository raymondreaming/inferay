import type { CSSProperties } from "react";

export function getLiquidPopoverSurfaceLiquidStyle(
	display: CSSProperties["display"],
	width: CSSProperties["width"],
	zIndex: CSSProperties["zIndex"],
): CSSProperties {
	return { display: display, width: width, zIndex: zIndex } as CSSProperties;
}

export function getLiquidPopoverSurfaceElementStyle(
	width: CSSProperties["width"],
): CSSProperties {
	return { width: width } as CSSProperties;
}
