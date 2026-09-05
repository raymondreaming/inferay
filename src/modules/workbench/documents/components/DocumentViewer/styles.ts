import * as stylex from "@octanejs/stylex";
import type { CSSProperties } from "react";
import {
	color,
	controlSize,
	font,
	radius,
} from "../../../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	root: {
		display: "flex",
		width: "100%",
		maxWidth: "100%",
		height: "100%",
		flex: 1,
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		flexDirection: "column",
		overflow: "hidden",
		backgroundColor: color.transparent,
	},
	header: {
		position: "relative",
		display: "flex",
		width: "100%",
		height: controlSize._8,
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._1,
		minWidth: controlSize._0,
		paddingLeft: controlSize._2,
		paddingRight: controlSize._1,
	},
	fileTabs: {
		display: "flex",
		width: "auto",
		minWidth: controlSize._0,
		height: "100%",
		flex: 1,
		alignItems: "stretch",
		overflowX: "auto",
		overflowY: "hidden",
	},
	fileTab: {
		display: "flex",
		minWidth: 92,
		maxWidth: 180,
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._1_5,
		borderRightWidth: 1,
		borderRightStyle: "solid",
		borderRightColor: color.border,
		backgroundColor: color.transparent,
		color: { default: color.textMuted, ":hover": color.textMain },
		paddingInline: controlSize._2,
		cursor: "grab",
	},
	fileTabActive: {
		backgroundColor: color.surfaceControl,
		color: color.textMain,
	},
	fileTabSelect: {
		display: "flex",
		minWidth: controlSize._0,
		flex: 1,
		height: "100%",
		alignItems: "center",
		gap: controlSize._1_5,
		backgroundColor: color.transparent,
		color: "inherit",
	},
	fileTabName: {
		minWidth: controlSize._0,
		flex: 1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		fontFamily: font.familyDiff,
		fontSize: font.size_1,
	},
	fileTabClose: {
		display: "flex",
		width: controlSize._4,
		height: controlSize._4,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: radius.sm,
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
	},
	iconButton: {
		display: "flex",
		width: controlSize._5,
		height: controlSize._5,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: radius.md,
		backgroundColor: { default: color.transparent, ":hover": color.dangerWash },
		color: { default: color.textMuted, ":hover": color.danger },
	},
	body: {
		position: "relative",
		display: "flex",
		width: "100%",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		flex: 1,
		overflow: "hidden",
	},
	emptyState: {
		display: "flex",
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		flexDirection: "column",
		gap: controlSize._2,
		color: color.textMuted,
		fontSize: font.size_2,
		textAlign: "center",
	},
	sourceScroll: {
		flex: 1,
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		overflow: "auto",
		contain: "layout paint style",
	},
	sourceTable: {
		position: "absolute",
		top: controlSize._0,
		left: controlSize._0,
		width: "100%",
		minWidth: "100%",
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		lineHeight: "14px",
	},
	sourceCanvas: {
		position: "relative",
		width: "100%",
	},
	sourceLine: {
		display: "grid",
		height: controlSize._3_5,
		gridTemplateColumns: "36px minmax(0, 1fr)",
	},
	lineNumber: {
		position: "sticky",
		left: controlSize._0,
		paddingRight: controlSize._2,
		backgroundColor: color.background,
		color: color.textFaint,
		fontSize: font.size_1,
		textAlign: "right",
		userSelect: "none",
	},
	sourceCode: { paddingRight: controlSize._5, whiteSpace: "pre" },
	error: {
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: color.dangerBorder,
		backgroundColor: color.dangerWash,
		color: color.danger,
		fontSize: font.size_1,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
	},
});

export function getSourcePreviewSourceCanvasStyle(
	height: CSSProperties["height"],
	minWidth: CSSProperties["minWidth"],
): CSSProperties {
	return { height: height, minWidth: minWidth } as CSSProperties;
}

export function getSourcePreviewSourceTableStyle(
	transform: CSSProperties["transform"],
): CSSProperties {
	return { transform: transform } as CSSProperties;
}

export function getSourcePreviewSpanStyle(
	color: CSSProperties["color"],
	backgroundColor: CSSProperties["backgroundColor"],
): CSSProperties {
	return { color: color, backgroundColor: backgroundColor } as CSSProperties;
}
