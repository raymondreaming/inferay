import type { CSSProperties } from "react";

export const DIFF_CONFIG = {
	lineHeight: 14, // Height of each line in pixels
	lineNumFontSize: 9, // Line number font size
	signFontSize: 10, // +/- sign font size
	contentFontSize: 10, // Code content font size
	lineNumWidth: 36, // Line number column width
	signWidth: 12, // +/- sign column width
	lineNumColor: "var(--color-inferay-muted-gray)",
	addLineNumColor: "var(--color-git-added)",
	removeLineNumColor: "var(--color-git-deleted)",
	addSignColor: "var(--color-git-added)",
	removeSignColor: "var(--color-git-deleted)",
	addBg: "color-mix(in srgb, var(--color-git-added) 12%, transparent)",
	addBgHover: "color-mix(in srgb, var(--color-git-added) 18%, transparent)",
	addBgHighlight: "color-mix(in srgb, var(--color-git-added) 28%, transparent)",
	removeBg: "color-mix(in srgb, var(--color-git-deleted) 12%, transparent)",
	removeBgHover:
		"color-mix(in srgb, var(--color-git-deleted) 18%, transparent)",
	removeBgHighlight:
		"color-mix(in srgb, var(--color-git-deleted) 28%, transparent)",
	overscan: 15, // Extra rows to render above/below viewport
};

export const LINE_H = DIFF_CONFIG.lineHeight;

export const GUTTER_W = DIFF_CONFIG.lineNumWidth + DIFF_CONFIG.signWidth;

import * as stylex from "@octanejs/stylex";
import {
	color,
	controlSize,
	effect,
	font,
	layer,
	motion,
	radius,
	shadow,
} from "../../../../../design-system/styles.stylex.ts";

export const diffStyles = stylex.create({
	virtualRoot: {
		display: "flex",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		flex: 1,
		overflow: "hidden",
		width: "100%",
		contain: "layout paint style",
	},
	virtualScroller: {
		flex: 1,
		minWidth: controlSize._0,
		overflow: "auto",
		overflowAnchor: "none",
		overscrollBehavior: "contain",
		scrollbarGutter: "stable",
		contain: "layout paint style",
	},
	splitPanels: {
		display: "flex",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		flex: 1,
		overflow: "hidden",
	},
	splitPanel: {
		display: "flex",
		minWidth: controlSize._0,
		minHeight: controlSize._0,
		flex: 1,
		overflow: "hidden",
	},
	splitPanelLeft: {
		borderRightWidth: 1,
		borderRightStyle: "solid",
		borderRightColor: color.border,
	},
	virtualOffsetLayer: {
		position: "absolute",
		top: controlSize._0,
		left: controlSize._0,
		right: controlSize._0,
		contain: "layout paint style",
		willChange: "transform",
	},
	minimap: {
		width: "16px",
		flexShrink: 0,
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.borderSubtle,
		backgroundColor: color.transparent,
	},
	minimapInteractive: {
		appearance: "none",
		borderTopWidth: 0,
		borderRightWidth: 0,
		borderBottomWidth: 0,
		padding: controlSize._0,
		position: "relative",
		cursor: "pointer",
	},
	minimapSegment: {
		position: "absolute",
		width: "6px",
		borderRadius: radius.none,
	},
	minimapAdd: {
		backgroundColor: "var(--color-git-added)",
	},
	minimapDelete: {
		backgroundColor: "var(--color-git-deleted)",
	},
	minimapThumb: {
		position: "absolute",
		left: controlSize._0,
		right: controlSize._0,
		pointerEvents: "none",
		backgroundColor: color.surfaceWhite14,
	},
	singlePanel: {
		display: "flex",
		minHeight: controlSize._0,
		flex: 1,
		flexDirection: "column",
	},
	toolbar: {
		display: "flex",
		height: controlSize._10,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "flex-end",
		gap: controlSize._2,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.transparent,
		paddingInline: controlSize._3,
	},
	segmented: {
		position: "relative",
		isolation: "isolate",
		display: "flex",
		height: controlSize._7,
		alignItems: "center",
		overflow: "hidden",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.lg,
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.controlDepth,
		boxShadow: shadow.controlDepth,
	},
	viewButton: {
		position: "relative",
		zIndex: layer.content,
		display: "flex",
		height: "100%",
		width: controlSize._6,
		alignItems: "center",
		justifyContent: "center",
		color: color.textMuted,
		transitionProperty: "background-color, color",
		transitionDuration: motion.durationFast,
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceControl,
		},
		backgroundImage: {
			default: "none",
			":hover": effect.controlDepth,
		},
	},
	viewButtonActive: {
		backgroundColor: color.transparent,
		backgroundImage: "none",
		boxShadow: shadow.none,
		color: color.textMain,
	},
	header: {
		display: "flex",
		height: controlSize._8,
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._1_5,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.transparent,
		paddingInline: controlSize._3,
	},
	pathName: {
		minWidth: controlSize._0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMain,
		fontFamily: font.familyDiff,
		fontSize: font.size_1,
		fontWeight: font.weightRegular,
	},
	stats: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._1_5,
		marginLeft: controlSize._2,
		fontSize: font.size_1,
	},
	addedText: {
		color: color.gitAdded,
	},
	deletedText: {
		color: color.gitDeleted,
	},
	headerSpacer: {
		flex: 1,
	},
	rotateHalfTurn: {
		transform: "rotate(180deg)",
	},
	changeNav: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._0_5,
		marginRight: controlSize._2,
	},
	changeCount: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontVariantNumeric: "tabular-nums",
		paddingInline: controlSize._1,
	},
	shell: {
		display: "flex",
		height: "100%",
		flexDirection: "column",
		backgroundColor: color.transparent,
	},
	shellRelative: {
		position: "relative",
	},
	centerState: {
		display: "flex",
		height: "100%",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: color.transparent,
	},
	centerInline: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
	},
	spinner: {
		width: font.size_3,
		height: font.size_3,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.textMuted,
		borderTopColor: color.transparent,
		borderRadius: radius.pill,
		animationName: stylex.keyframes({
			to: {
				transform: "rotate(360deg)",
			},
		}),
		animationDuration: motion.durationLonger,
		animationTimingFunction: "linear",
		animationIterationCount: "infinite",
	},
	centerText: {
		color: color.textMuted,
		fontSize: font.size_4,
	},
	centerBody: {
		display: "flex",
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		paddingInline: controlSize._6,
	},
	centerMessage: {
		maxWidth: "24rem",
		color: color.textMuted,
		fontSize: font.size_4,
		lineHeight: 1.55,
		textAlign: "center",
	},
	body: {
		display: "flex",
		minHeight: controlSize._0,
		flex: 1,
		overflow: "hidden",
	},
	conflictBody: {
		minHeight: controlSize._0,
		flex: 1,
		display: "flex",
		flexDirection: "column",
		backgroundColor: color.transparent,
	},
	conflictActions: {
		display: "flex",
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._1,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		backgroundColor: color.background,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._3,
	},
	conflictActionButton: {
		height: controlSize._5,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.sm,
		backgroundColor: {
			default: color.background,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		fontSize: font.size_1,
		paddingInline: controlSize._2,
	},
	imageBody: {
		display: "flex",
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		overflow: "auto",
		padding: controlSize._4,
	},
	image: {
		maxWidth: "100%",
		maxHeight: "100%",
		objectFit: "contain",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.sm,
	},
	markdownBody: {
		flex: 1,
		overflowY: "auto",
		padding: controlSize._6,
	},
	markdownInner: {
		maxWidth: "48rem",
		marginInline: "auto",
	},
	hunkSeparator: {
		alignItems: "center",
		backgroundColor: color.surfaceSubtle,
		borderBlockColor: color.borderSubtle,
		borderBlockStyle: "solid",
		borderBlockWidth: 1,
		color: color.textMuted,
		display: "flex",
		fontFamily: font.familyDiff,
		fontSize: font.size_1,
		height: LINE_H,
		lineHeight: `${LINE_H}px`,
		paddingInline: controlSize._2,
	},
	hunkText: {
		minWidth: controlSize._0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	spacer: {
		backgroundColor: color.surfaceWhite02,
		backgroundImage:
			"repeating-linear-gradient(-45deg, transparent, transparent 8px, rgba(255,255,255,0.02) 8px, rgba(255,255,255,0.02) 9px)",
		height: LINE_H,
	},
	row: {
		display: "flex",
		height: LINE_H,
		maxHeight: LINE_H,
		minHeight: LINE_H,
		position: "relative",
	},
	lineNumber: {
		borderRightColor: color.borderSubtle,
		borderRightStyle: "solid",
		borderRightWidth: 1,
		flexShrink: 0,
		fontFamily: font.familyDiff,
		lineHeight: `${LINE_H}px`,
		overflow: "hidden",
		paddingRight: controlSize._1_5,
		textAlign: "right",
		userSelect: "none",
		width: DIFF_CONFIG.lineNumWidth,
	},
	sign: {
		flexShrink: 0,
		fontFamily: font.familyDiff,
		lineHeight: `${LINE_H}px`,
		overflow: "hidden",
		textAlign: "center",
		userSelect: "none",
		width: DIFF_CONFIG.signWidth,
	},
	gutterLayer: {
		position: "sticky",
		left: controlSize._0,
		zIndex: layer.chrome,
		width: GUTTER_W,
		height: controlSize._0,
		backgroundColor: color.background,
		pointerEvents: "none",
	},
	gutterBlock: {
		position: "absolute",
		left: controlSize._0,
		width: GUTTER_W,
		backgroundColor: color.background,
	},
	gutterRow: {
		display: "flex",
		height: LINE_H,
		maxHeight: LINE_H,
		minHeight: LINE_H,
		overflow: "hidden",
		backgroundColor: color.background,
	},
	content: {
		flex: 1,
		fontFamily: font.familyDiff,
		fontWeight: font.weight_5,
		lineHeight: `${LINE_H}px`,
		overflow: "hidden",
		minWidth: "max-content",
		paddingLeft: controlSize._2,
		paddingRight: controlSize._3,
		whiteSpace: "pre",
	},
});

export function getDiffGutterCellsLineNumberStyle(
	fontSize: CSSProperties["fontSize"],
	color: CSSProperties["color"],
): CSSProperties {
	return { fontSize: fontSize, color: color } as CSSProperties;
}

export function getDiffGutterCellsSignStyle(
	fontSize: CSSProperties["fontSize"],
	color: CSSProperties["color"],
): CSSProperties {
	return { fontSize: fontSize, color: color } as CSSProperties;
}

export function getDiffMinimapMinimapSegmentStyle(
	left: CSSProperties["left"],
	right: CSSProperties["right"],
	width: CSSProperties["width"],
	top: CSSProperties["top"],
	height: CSSProperties["height"],
): CSSProperties {
	return {
		left: left,
		right: right,
		width: width,
		top: top,
		height: height,
	} as CSSProperties;
}

export function getDiffMinimapMinimapThumbStyle(
	top: CSSProperties["top"],
	height: CSSProperties["height"],
): CSSProperties {
	return { top: top, height: height, minHeight: 16 } as CSSProperties;
}

export function getDiffRowHunkSeparatorStyle(
	minWidth: CSSProperties["minWidth"],
	paddingLeft: CSSProperties["paddingLeft"],
): CSSProperties {
	return { minWidth: minWidth, paddingLeft: paddingLeft } as CSSProperties;
}

export function getDiffRowSpacerStyle(
	minWidth: CSSProperties["minWidth"],
): CSSProperties {
	return { minWidth: minWidth } as CSSProperties;
}

export function getDiffRowSpanStyle(
	backgroundColor: CSSProperties["backgroundColor"],
	color: CSSProperties["color"],
): CSSProperties {
	return { backgroundColor: backgroundColor, color: color } as CSSProperties;
}

export function getDiffRowDivStyle(
	lineHeight: CSSProperties["lineHeight"],
	backgroundColor: CSSProperties["backgroundColor"],
	boxShadow: CSSProperties["boxShadow"],
	minWidth: CSSProperties["minWidth"],
	paddingLeft: CSSProperties["paddingLeft"],
	hoverbg: string | number | undefined,
): CSSProperties {
	return {
		lineHeight: lineHeight,
		backgroundColor: backgroundColor,
		boxShadow: boxShadow,
		minWidth: minWidth,
		paddingLeft: paddingLeft,
		width: "100%",
		"--hover-bg": hoverbg,
	} as CSSProperties;
}

export function getDiffRowContentStyle(
	fontSize: CSSProperties["fontSize"],
	minWidth: CSSProperties["minWidth"],
	color: CSSProperties["color"],
): CSSProperties {
	return {
		fontSize: fontSize,
		minWidth: minWidth,
		color: color,
	} as CSSProperties;
}

export function getVirtualPanelVirtualScrollerStyle(): CSSProperties {
	return { overflowY: "hidden" } as CSSProperties;
}

export function getVirtualPanelDivStyle(
	height: CSSProperties["height"],
	minWidth: CSSProperties["minWidth"],
): CSSProperties {
	return {
		height: height,
		position: "relative",
		minWidth: minWidth,
	} as CSSProperties;
}

export function getVirtualPanelVirtualOffsetLayerStyle(
	transform: CSSProperties["transform"],
	minWidth: CSSProperties["minWidth"],
): CSSProperties {
	return { transform: transform, minWidth: minWidth } as CSSProperties;
}

export function getVirtualPanelGutterBlockStyle(): CSSProperties {
	return { top: 0 } as CSSProperties;
}
