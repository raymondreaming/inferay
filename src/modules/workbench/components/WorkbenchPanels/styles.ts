import * as stylex from "@octanejs/stylex";
import {
	color,
	controlSize,
	font,
	layer,
	radius,
} from "../../../../design-system/styles.stylex.ts";
export const styles = stylex.create({
	persistenceError: {
		position: "fixed",
		bottom: controlSize._4,
		right: controlSize._4,
		maxWidth: "min(360px, calc(100vw - 32px))",
		padding: controlSize._3,
		borderRadius: radius.md,
		backgroundColor: color.backgroundPanel,
		color: color.danger,
		fontSize: font.size_3,
		zIndex: layer.dropdown,
	},
	sidebarShell: {
		position: "relative",
		display: "flex",
		height: "100%",
		minHeight: controlSize._0,
		flexShrink: 0,
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
		backgroundColor: color.transparent,
	},
	diffRail: {
		position: "relative",
		boxSizing: "border-box",
		display: "flex",
		minWidth: controlSize._0,
		height: "100%",
		minHeight: controlSize._0,
		flexShrink: 0,
		backgroundColor: color.transparent,
		overflow: "visible",
	},
	graphRail: {
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.border,
	},
	diffRailZen: {
		minWidth: controlSize._0,
		flex: 1,
	},
	diffResizeHandle: {
		position: "absolute",
		zIndex: layer.sticky,
		top: controlSize._0,
		bottom: controlSize._0,
		left: -4,
		width: controlSize._2,
		borderWidth: 0,
		padding: controlSize._0,
		touchAction: "none",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlActive,
		},
		cursor: "ew-resize",
	},
	resizeHandle: {
		position: "absolute",
		zIndex: layer.sticky,
		top: controlSize._0,
		bottom: controlSize._0,
		left: -3,
		width: controlSize._1_5,
		borderWidth: 0,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlActive,
		},
		cursor: "ew-resize",
	},
});

export function diffRailStyle(width: number, maxWidth: string) {
	return { width, maxWidth };
}
export function sidebarStyle(width: number) {
	return { width };
}
