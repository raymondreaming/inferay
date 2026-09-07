import type { CSSProperties } from "../../../lib/dom.tsx";
export function getLiquidActionSurfaceLiquidStyle(
	display: CSSProperties["display"],
	width: CSSProperties["width"],
): CSSProperties {
	return {
		display: display,
		width: width,
	} as CSSProperties;
}
