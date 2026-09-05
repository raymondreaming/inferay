import * as stylex from "@octanejs/stylex";
import type { CSSProperties } from "react";
import {
	color,
	controlSize,
	font,
	layer,
	motion,
	radius,
} from "../../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	root: {
		boxSizing: "border-box",
		flex: 1,
		minHeight: controlSize._0,
		overflowY: "auto",
		overscrollBehavior: "contain",
		paddingTop: controlSize._0,
		paddingBottom: controlSize._1,
		paddingInline: controlSize._3,
	},
	project: { marginBottom: controlSize._1 },
	projectName: {
		boxSizing: "border-box",
		borderRadius: radius.md,
		position: "sticky",
		top: controlSize._0,
		zIndex: layer.sticky,
		display: "flex",
		alignItems: "center",
		gap: controlSize._2,
		height: 26,
		paddingInline: controlSize._2,
		color: color.textMain,
		fontSize: font.size_2,
		fontWeight: font.weight_6,
	},
	entryGroup: { position: "relative" },
	row: {
		display: "flex",
		alignItems: "center",
		gap: controlSize._1,
		width: "100%",
		height: controlSize._6,
		paddingRight: controlSize._2,
		borderRadius: radius.sm,
		color: { default: color.textMain, ":hover": color.textMain },
		textAlign: "left",
	},
	stickyFolderRow: {
		position: "sticky",
	},
	chevron: {
		flexShrink: 0,
		color: color.textSoft,
		transitionDuration: motion.durationFast,
		transitionProperty: "transform",
	},
	chevronOpen: { transform: "rotate(90deg)" },
	spacer: { width: controlSize._3, flexShrink: 0 },
	name: {
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		fontSize: font.size_2,
	},
	status: {
		display: "block",
		paddingBlock: controlSize._2,
		paddingLeft: controlSize._8,
		color: color.textMuted,
		fontSize: font.size_1,
	},
	error: {
		display: "block",
		paddingBlock: controlSize._2,
		paddingLeft: controlSize._8,
		color: color.danger,
		fontSize: font.size_1,
		textAlign: "left",
	},
	empty: {
		padding: controlSize._4,
		color: color.textMuted,
		fontSize: font.size_2,
		lineHeight: 1.5,
	},
});

export function getEntryRowStyle(
	paddingLeft: CSSProperties["paddingLeft"],
	top: CSSProperties["top"],
	zIndex: CSSProperties["zIndex"],
): CSSProperties {
	return {
		paddingLeft: paddingLeft,
		top: top,
		zIndex: zIndex,
	} as CSSProperties;
}
