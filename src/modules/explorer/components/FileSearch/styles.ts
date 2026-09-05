import * as stylex from "@octanejs/stylex";
import type { CSSProperties } from "react";
import {
	color,
	controlSize,
	effect,
	font,
	layer,
	radius,
} from "../../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	root: { position: "relative", minWidth: controlSize._0 },
	rootShellClosed: {
		width: controlSize._6,
	},
	rootShellOpen: {
		width: "clamp(160px, 18vw, 240px)",
		zIndex: layer.searchPopover,
	},
	rootPanel: {
		position: "static",
		width: controlSize._6,
		flexShrink: 0,
	},
	rootSidebar: {
		flex: 1,
		width: "auto",
	},
	inputFrame: {
		display: "flex",
		height: controlSize._6,
		alignItems: "center",
		gap: controlSize._1_5,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: radius.md,
		backgroundColor: color.backgroundRaised,
		backgroundImage: effect.controlDepth,
		paddingInline: controlSize._2,
	},
	searchIcon: { flexShrink: 0, color: color.textMuted },
	panelTrigger: {
		display: "flex",
		width: controlSize._6,
		height: controlSize._6,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: radius.md,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
	},
	shellTrigger: {
		display: "flex",
		width: controlSize._6,
		height: controlSize._6,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: radius.md,
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
		backgroundColor: {
			default: color.transparent,
			":hover": color.surfaceWhite06,
		},
	},
	input: {
		minWidth: controlSize._0,
		flex: 1,
		borderWidth: 0,
		outline: "none",
		backgroundColor: color.transparent,
		color: color.textMain,
		fontSize: font.size_2,
		"::placeholder": { color: color.textMuted },
	},
	menuAnchor: {
		position: "absolute",
		top: "calc(100% + 5px)",
		zIndex: layer.searchPopover,
	},
	menu: {
		display: "flex",
		width: "100%",
		maxHeight: 320,
		flexDirection: "column",
		gap: controlSize._0_5,
		overflowY: "auto",
		borderWidth: 0,
		borderRadius: radius.lg,
		backgroundColor: color.transparent,
		boxShadow: "none",
		padding: controlSize._1,
	},
	menuShell: { left: controlSize._0, width: "max(100%, 330px)" },
	menuPanel: {
		left: controlSize._2,
		right: controlSize._2,
		width: "auto",
	},
	menuSidebar: {
		left: controlSize._0,
		right: controlSize._0,
		width: "auto",
	},
	menuSearch: {
		display: "flex",
		height: controlSize._8,
		flexShrink: 0,
		alignItems: "center",
		gap: controlSize._2,
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: color.border,
		paddingInline: controlSize._2,
		marginBottom: controlSize._1,
	},
	result: {
		display: "flex",
		width: "100%",
		minWidth: controlSize._0,
		alignItems: "center",
		gap: controlSize._2,
		borderRadius: radius.md,
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
		color: color.textSoft,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		textAlign: "left",
	},
	resultActive: {
		backgroundColor: color.controlActive,
		backgroundImage: effect.controlDepthHover,
		color: color.textMain,
	},
	resultText: {
		display: "flex",
		minWidth: controlSize._0,
		flex: 1,
		flexDirection: "column",
	},
	resultName: {
		overflow: "hidden",
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	resultPath: {
		overflow: "hidden",
		color: color.textMuted,
		fontSize: font.size_1,
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	empty: {
		paddingBlock: controlSize._5,
		color: color.textMuted,
		fontSize: font.size_2,
		textAlign: "center",
	},
});

export function getFileSearchLiquidStyle(): CSSProperties {
	return { display: "flex", width: "100%" } as CSSProperties;
}

export function getFileSearchElementStyle(): CSSProperties {
	return { width: "100%" } as CSSProperties;
}
