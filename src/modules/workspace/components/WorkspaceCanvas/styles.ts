import * as stylex from "@octanejs/stylex";
import type { CSSProperties } from "react";
import {
	color,
	controlSize,
	layer,
	motion,
} from "../../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	rowScroller: {
		backgroundColor: color.transparent,
		display: "flex",
		height: "100%",
		overflowX: "auto",
		overscrollBehavior: "none",
	},
	rowCell: {
		backgroundColor: color.transparent,
		borderRightStyle: "solid",
		borderRightWidth: 1,
		flexShrink: 0,
		height: "100%",
		overflow: "hidden",
		transitionDuration: motion.durationBase,
		transitionProperty: "border-color, opacity",
	},
	dockRoot: {
		position: "relative",
		display: "flex",
		width: "100%",
		height: "100%",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		overflowX: "hidden",
		overflowY: "auto",
		overscrollBehavior: "contain",
	},
	dockCanvas: {
		boxSizing: "border-box",
		display: "flex",
		width: "100%",
		height: "100%",
		minWidth: controlSize._0,
		flexShrink: 0,
	},
	dockCanvasSparse: {
		borderRightColor: color.border,
		borderRightStyle: "solid",
		borderRightWidth: 1,
	},
	dockSplit: {
		display: "flex",
		width: "100%",
		height: "100%",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		overflow: "hidden",
	},
	dockHorizontal: { flexDirection: "row" },
	dockVertical: { flexDirection: "column" },
	dockBranch: {
		display: "flex",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		overflow: "hidden",
	},
	dockDivider: {
		position: "relative",
		zIndex: layer.dropdown,
		flexShrink: 0,
		borderWidth: 0,
		padding: controlSize._0,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlActive,
		},
		transitionProperty: "background-color",
		transitionDuration: motion.durationFast,
	},
	dockDividerHorizontal: {
		width: controlSize._1_25,
		height: "100%",
		marginInline: -2,
		cursor: "col-resize",
		"::before": {
			content: "",
			position: "absolute",
			insetBlock: controlSize._0,
			left: controlSize._0_5,
			width: controlSize._0_25,
			backgroundColor: "var(--color-inferay-gray-border)",
		},
	},
	dockDividerVertical: {
		width: "100%",
		height: controlSize._1_25,
		marginBlock: -2,
		cursor: "row-resize",
		"::before": {
			content: "",
			position: "absolute",
			insetInline: controlSize._0,
			top: controlSize._0_5,
			height: controlSize._0_25,
			backgroundColor: "var(--color-inferay-gray-border)",
		},
	},
	dockCell: {
		position: "relative",
		display: "flex",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		flex: 1,
		overflow: "hidden",
	},
	dropIndicator: {
		position: "absolute",
		zIndex: layer.workspaceOverlay,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: "var(--color-inferay-gray-border-bold)",
		backgroundColor:
			"color-mix(in srgb, var(--color-inferay-white) 10%, transparent)",
		pointerEvents: "none",
	},
	rootDropIndicator: {
		zIndex: layer.workspaceDrag,
	},
	dropLeft: { insetBlock: controlSize._2, left: controlSize._2, width: "42%" },
	dropRight: {
		insetBlock: controlSize._2,
		right: controlSize._2,
		width: "42%",
	},
	dropTop: { insetInline: controlSize._2, top: controlSize._2, height: "42%" },
	dropBottom: {
		insetInline: controlSize._2,
		bottom: controlSize._2,
		height: "42%",
	},
	dropCenter: { inset: controlSize._3 },
});

export function getWorkspaceCanvasRowCellStyle(
	overrides: CSSProperties | undefined | null,
): CSSProperties {
	return { ...overrides, width: 400 } as CSSProperties;
}

export function getWorkspaceCanvasDockBranchStyle(
	flexGrow: CSSProperties["flexGrow"],
): CSSProperties {
	return { flexBasis: 0, flexGrow: flexGrow } as CSSProperties;
}

export function getWorkspaceCanvasDockBranchStyle1(
	flexGrow: CSSProperties["flexGrow"],
): CSSProperties {
	return { flexBasis: 0, flexGrow: flexGrow } as CSSProperties;
}

export function getWorkspaceCanvasDockCanvasStyle(
	minHeight: CSSProperties["minHeight"],
	width: CSSProperties["width"],
): CSSProperties {
	return { minHeight: minHeight, width: width } as CSSProperties;
}

export function getCanvasCellStyle(
	borderColor: CSSProperties["borderColor"],
	opacity: CSSProperties["opacity"],
): CSSProperties {
	return { borderColor, opacity };
}
