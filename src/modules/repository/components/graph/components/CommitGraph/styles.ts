import type { CSSProperties } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import {
	color,
	controlSize,
	font,
	layer,
	radius,
} from "../../../../../../design-system/styles.stylex.ts";

export const AVATAR_SIZE = 18;
export const GRAPH_DASH_PATTERN = "1 2";
export const GRAPH_DASH_WIDTH = 1;

export const styles = stylex.create({
	root: {
		position: "relative",
		overflow: "auto",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		backgroundColor: color.background,
	},
	embeddedRoot: {
		height: "100%",
		borderWidth: controlSize._0,
		borderRadius: radius.none,
	},
	loadMore: {
		display: "flex",
		width: "100%",
		height: controlSize._8,
		alignItems: "center",
		justifyContent: "center",
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: color.border,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: color.textMuted,
		fontSize: font.size_2,
	},
	emptyRoot: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		backgroundColor: color.background,
		paddingBlock: controlSize._8,
	},
	emptyText: {
		color: color.textMuted,
		fontSize: font.size_2_75,
	},
	shrink: {
		flexShrink: 0,
	},
	refSymbolIcon: {
		display: "block",
	},
	truncate: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	refBadge: {
		position: "relative",
		zIndex: layer.content,
		display: "inline-flex",
		height: "17px",
		minWidth: controlSize._0,
		maxWidth: "100%",
		boxSizing: "border-box",
		flexShrink: 1,
		alignItems: "center",
		gap: controlSize._1,
		overflow: "hidden",
		borderRadius: "2px",
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		lineHeight: 1,
		paddingInline: "0.375rem",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	dimmedRefBadge: {
		opacity: 0.5,
	},
	ghostRefBadge: {
		opacity: 0.36,
		fontStyle: "italic",
	},
	refBadges: {
		position: "relative",
		zIndex: layer.content,
		display: "flex",
		alignItems: "center",
		gap: controlSize._1,
		overflow: "visible",
		minWidth: controlSize._0,
	},
	refExtra: {
		flexShrink: 0,
		color: color.textSoft,
		fontSize: font.size_0_5,
		fontVariantNumeric: "tabular-nums",
	},
	header: {
		position: "absolute",
		top: 0,
		zIndex: layer.sticky,
		display: "flex",
		minWidth: "100%",
		alignItems: "center",
		backgroundColor: color.transparent,
	},
	headerLabel: {
		color: color.textMuted,
		fontSize: font.size_0_5,
		textTransform: "uppercase",
		pointerEvents: "none",
	},
	headerLabelHidden: {
		visibility: "hidden",
	},
	headerCell: {
		position: "relative",
		display: "flex",
		height: "100%",
		flexShrink: 0,
		alignItems: "center",
		overflow: "visible",
		paddingInline: controlSize._2,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		boxSizing: "border-box",
	},
	draggableHeader: {
		cursor: "grab",
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceWhite04,
		},
	},
	columnMenuOverlay: {
		position: "sticky",
		top: 0,
		left: 0,
		height: 0,
		width: "100%",
		zIndex: layer.dropdown,
	},
	headerTools: {
		position: "absolute",
		right: controlSize._2,
		zIndex: layer.overlayContent,
		display: "flex",
		height: 23,
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.transparent,
	},
	columnResizeHandle: {
		position: "absolute",
		top: 0,
		right: "-4px",
		bottom: 0,
		zIndex: layer.overlayContent,
		width: 8,
		padding: 0,
		borderWidth: 0,
		backgroundColor: color.transparent,
		color: {
			default: color.transparent,
			":hover": color.accentBorder,
		},
		cursor: "col-resize",
		"::after": {
			content: '""',
			position: "absolute",
			left: "50%",
			top: 0,
			bottom: 0,
			width: 1,
			backgroundColor: "currentColor",
			pointerEvents: "none",
		},
	},
	columnResizeHandleVisible: {
		color: color.borderStrong,
	},
	refContextMenu: {
		position: "fixed",
		zIndex: layer.dropdown,
		display: "flex",
		width: "13rem",
		maxHeight: "calc(100vh - 16px)",
		flexDirection: "column",
		overflowY: "auto",
		borderRadius: radius.md,
		padding: controlSize._1,
	},
	refContextTitle: {
		overflow: "hidden",
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_6,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._2,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	refContextItem: {
		width: "100%",
		borderRadius: radius.sm,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		fontSize: font.size_2,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._2,
		textAlign: "left",
	},
	columnsMenuRoot: {
		position: "relative",
		display: "flex",
		width: "100%",
		height: "100%",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "center",
	},
	columnsButton: {
		display: "flex",
		width: "100%",
		height: "100%",
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 0,
		borderRadius: radius.none,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
	},
	columnsMenu: {
		position: "absolute",
		right: controlSize._2,
		top: "22px",
		zIndex: layer.dropdown,
		width: "15rem",
		borderRadius: radius.md,
		padding: controlSize._1,
	},
	columnsMenuSection: {
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: color.border,
		color: color.textMuted,
		fontSize: font.size_0_5,
		letterSpacing: "0.1em",
		marginTop: controlSize._1,
		paddingBlock: controlSize._2,
		paddingInline: controlSize._2,
		textTransform: "uppercase",
	},
	columnsMenuItem: {
		display: "flex",
		width: "100%",
		alignItems: "center",
		justifyContent: "space-between",
		borderRadius: radius.sm,
		color: color.textSoft,
		fontSize: font.size_2,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		textAlign: "left",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
	},
	columnsState: {
		color: color.textMuted,
	},
	searchRoot: {
		display: "flex",
		height: controlSize._6,
		alignItems: "center",
		gap: controlSize._1,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.sm,
		color: color.textMuted,
		marginBottom: controlSize._1,
		paddingInline: controlSize._2,
	},
	searchInput: {
		width: "100%",
		minWidth: controlSize._0,
		borderWidth: 0,
		outline: "none",
		backgroundColor: color.transparent,
		color: color.textSoft,
		fontSize: font.size_2,
	},
	searchCount: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontVariantNumeric: "tabular-nums",
	},
	linesLayer: {
		position: "absolute",
		left: controlSize._0,
		top: controlSize._0,
		pointerEvents: "none",
	},
	rowsLayer: {
		position: "relative",
		zIndex: layer.chrome,
	},
	graphRow: {
		position: "relative",
		display: "flex",
		width: "100%",
		borderWidth: 0,
		cursor: "pointer",
		alignItems: "center",
		color: "inherit",
		font: "inherit",
		padding: controlSize._0,
		textAlign: "left",
		":focus-visible": {
			boxShadow: `inset 0 0 0 1px ${color.borderStrong}`,
		},
	},
	virtualRow: {
		position: "absolute",
		left: controlSize._0,
		right: controlSize._0,
		top: controlSize._0,
	},
	refGutter: {
		position: "relative",
		display: "flex",
		height: "100%",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "flex-start",
		overflow: "visible",
		boxSizing: "border-box",
		paddingInline: controlSize._2,
	},
	refConnector: {
		minWidth: controlSize._1,
		flex: 1,
		height: "1px",
		opacity: 1,
		marginRight: "-0.5rem",
	},
	graphCell: {
		position: "relative",
		height: "100%",
		flexShrink: 0,
		overflow: "hidden",
	},
	nodeAnchoredRowWash: {
		position: "absolute",
		pointerEvents: "none",
		borderRadius: 0,
	},
	refToNodeConnector: {
		position: "absolute",
		left: controlSize._0,
		top: "50%",
		height: "1px",
		opacity: 1,
		transform: "translateY(-0.5px)",
		zIndex: layer.content,
	},
	nodeOutline: {
		position: "absolute",
		inset: 0,
		width: "100%",
		height: "100%",
		pointerEvents: "none",
	},
	wipNode: {
		position: "absolute",
		width: AVATAR_SIZE,
		height: AVATAR_SIZE,
		overflow: "visible",
		zIndex: layer.overlayContent,
	},
	messageCell: {
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.borderStrong,
		":first-of-type": { borderLeftWidth: 0 },
		position: "relative",
		zIndex: layer.overlayContent,
		height: "100%",
		display: "flex",
		boxSizing: "border-box",
		minWidth: controlSize._0,
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._2,
		overflow: "hidden",
		paddingInline: controlSize._3,
	},
	commitMessage: {
		maxWidth: "64%",
		flexShrink: 1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textSoft,
		fontSize: font.size_2_75,
		lineHeight: 1,
	},
	commitBody: {
		minWidth: controlSize._0,
		flex: 1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_2,
	},
	pullRequestBadge: {
		flexShrink: 0,
		maxWidth: "60%",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		fontSize: font.size_1,
		lineHeight: 1.5,
		paddingInline: controlSize._1,
		borderRadius: radius.sm,
		backgroundColor: color.surfaceControl,
		color: color.textSoft,
		textDecoration: "none",
		":hover": { color: color.textMain },
	},
	pullRequestDiffers: {
		color: color.warning,
	},
	authorCell: {
		display: "flex",
		height: "100%",
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._2,
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.borderStrong,
		":first-of-type": { borderLeftWidth: 0 },
		color: color.textMuted,
		fontSize: font.size_2,
		paddingInline: controlSize._3,
	},
	metaCell: {
		display: "flex",
		height: "100%",
		flexShrink: 0,
		alignItems: "center",
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.borderStrong,
		":first-of-type": { borderLeftWidth: 0 },
		color: color.textMuted,
		fontSize: font.size_2,
		fontVariantNumeric: "tabular-nums",
		overflow: "hidden",
		boxSizing: "border-box",
		paddingInline: controlSize._2,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	shaCell: {
		display: "flex",
		height: "100%",
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "flex-start",
		borderLeftWidth: 1,
		borderLeftStyle: "solid",
		borderLeftColor: color.borderStrong,
		":first-of-type": { borderLeftWidth: 0 },
		color: color.textMuted,
		fontFamily:
			"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
		fontSize: font.size_2,
		overflow: "hidden",
		paddingInline: controlSize._3,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	rowEndPad: {
		flexShrink: 0,
		width: 38,
	},
	graphAvatar: {
		position: "absolute",
		width: AVATAR_SIZE,
		height: AVATAR_SIZE,
		borderRadius: radius.pill,
		backgroundColor: "var(--color-inferay-black)",
		zIndex: layer.overlayContent,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		fontSize: "5px",
		fontWeight: font.weight_6,
		overflow: "hidden",
	},
	mergeNode: {
		position: "absolute",
		width: "10px",
		height: "10px",
		borderRadius: radius.pill,
		zIndex: layer.overlayContent,
	},
	stashNode: {
		borderRadius: 0,
		backgroundColor: "transparent",
		overflow: "visible",
	},
	avatarImage: {
		display: "block",
		width: "100%",
		height: "100%",
		borderRadius: radius.pill,
		objectFit: "cover",
	},
	authorName: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textMuted,
		fontSize: font.size_2,
	},
});
export function getAuthorAvatarGraphAvatarStyle(
	left: CSSProperties["left"],
	top: CSSProperties["top"],
	border: CSSProperties["border"],
	boxShadow: CSSProperties["boxShadow"],
): CSSProperties {
	return {
		left: left,
		top: top,
		border: border,
		boxShadow: boxShadow,
	} as CSSProperties;
}
export function getCommitRowGraphRowStyle(
	height: CSSProperties["height"],
	transform: CSSProperties["transform"],
	opacity: CSSProperties["opacity"],
): CSSProperties {
	return {
		height: height,
		transform: transform,
		opacity: opacity,
	} as CSSProperties;
}
export function getCommitRowNodeAnchoredRowWashStyle(
	left: CSSProperties["left"],
	top: CSSProperties["top"],
	height: CSSProperties["height"],
	backgroundColor: CSSProperties["backgroundColor"],
	width: CSSProperties["width"],
): CSSProperties {
	return {
		left: left,
		top: top,
		height: height,
		backgroundColor: backgroundColor,
		width,
	} as CSSProperties;
}
export function getCommitRowMetaCellStyle(
	width: CSSProperties["width"],
): CSSProperties {
	return {
		width: width,
	} as CSSProperties;
}
export function getCommitRowRefGutterStyle(
	width: CSSProperties["width"],
): CSSProperties {
	return {
		width: width,
	} as CSSProperties;
}
export function getCommitRowRefConnectorStyle(
	backgroundColor: CSSProperties["backgroundColor"],
): CSSProperties {
	return {
		backgroundColor: backgroundColor,
	} as CSSProperties;
}
export function getCommitRowGraphCellStyle(
	width: CSSProperties["width"],
): CSSProperties {
	return {
		width: width,
	} as CSSProperties;
}
export function getCommitRowRefToNodeConnectorStyle(
	width: CSSProperties["width"],
	backgroundColor: CSSProperties["backgroundColor"],
): CSSProperties {
	return {
		width: width,
		backgroundColor: backgroundColor,
	} as CSSProperties;
}
export function getCommitRowMessageCellStyle(
	width: CSSProperties["width"],
): CSSProperties {
	return {
		width: width,
	} as CSSProperties;
}
export function getCommitRowCommitMessageStyle(
	maxWidth: CSSProperties["maxWidth"],
): CSSProperties {
	return {
		maxWidth: maxWidth,
	} as CSSProperties;
}
export function getCommitRowAuthorCellStyle(
	width: CSSProperties["width"],
): CSSProperties {
	return {
		width: width,
	} as CSSProperties;
}
export function getCommitRowShaCellStyle(
	width: CSSProperties["width"],
): CSSProperties {
	return {
		width: width,
	} as CSSProperties;
}
export function getCommitRowRowEndPadStyle(
	width: CSSProperties["width"],
): CSSProperties {
	return {
		width: width,
	} as CSSProperties;
}
export function getHeaderRowHeaderStyle(
	width: CSSProperties["width"],
): CSSProperties {
	return {
		width: width,
	} as CSSProperties;
}
export function getHeaderRowHeaderCellStyle(
	width: CSSProperties["width"],
): CSSProperties {
	return {
		width: width,
	} as CSSProperties;
}

export function getMergeNodeMergeNodeStyle(
	left: CSSProperties["left"],
	top: CSSProperties["top"],
	backgroundColor: CSSProperties["backgroundColor"],
	boxShadow: CSSProperties["boxShadow"],
): CSSProperties {
	return {
		left: left,
		top: top,
		backgroundColor: backgroundColor,
		boxShadow: boxShadow,
	} as CSSProperties;
}
export function getRefBadgeRefBadgeStyle(
	backgroundColor: CSSProperties["backgroundColor"],
	color: CSSProperties["color"],
): CSSProperties {
	return {
		border: "none",
		backgroundColor: backgroundColor,
		color: color,
	} as CSSProperties;
}
export function getCommitGraphDivStyle(): CSSProperties {
	return {
		padding: 24,
	} as CSSProperties;
}
export function getCommitGraphRowsLayerStyle(
	height: CSSProperties["height"],
	width: CSSProperties["width"],
): CSSProperties {
	return {
		height: height,
		width: width,
	} as CSSProperties;
}
export function getCommitGraphRefContextMenuStyle(
	left: CSSProperties["left"],
	top: CSSProperties["top"],
): CSSProperties {
	return {
		left: left,
		top: top,
	} as CSSProperties;
}
export function getGraphLineLayerStyle(
	left: number,
	top: number,
): CSSProperties {
	return {
		zIndex: 0,
		left,
		top,
	};
}
