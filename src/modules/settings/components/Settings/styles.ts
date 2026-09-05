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
	overlay: {
		position: "fixed",
		inset: controlSize._0,
		zIndex: layer.panelOverlay,
		display: "flex",
		alignItems: "flex-start",
		justifyContent: "flex-end",
		backgroundColor: color.backgroundOverlay,
		padding: controlSize._4,
	},
	backdrop: {
		position: "absolute",
		inset: controlSize._0,
		borderWidth: 0,
		padding: controlSize._0,
		backgroundColor: color.transparent,
	},
	panel: {
		position: "relative",
		width: "min(22rem, 100%)",
		maxHeight: "calc(100vh - 2rem)",
		overflowY: "auto",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: color.border,
		borderRadius: controlSize._3,
		backgroundColor: color.backgroundRaised,
		boxShadow: "0 24px 54px rgba(0, 0, 0, 0.64)",
	},
	panelBody: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._5,
		paddingBlock: controlSize._4,
		paddingInline: controlSize._4,
		paddingBottom: controlSize._6,
	},
	panelBodyEmbedded: {
		gap: controlSize._3,
		paddingBlock: controlSize._0,
		paddingInline: controlSize._0,
		paddingBottom: controlSize._0,
	},
	themeGrid: {
		display: "flex",
		gap: controlSize._2,
		overflowX: "auto",
		overscrollBehaviorX: "contain",
		paddingBottom: controlSize._1,
		scrollSnapType: "x proximity",
		scrollbarWidth: "none",
	},
	themeOrbButton: {
		display: "flex",
		flex: "0 0 4.5rem",
		flexDirection: "column",
		alignItems: "center",
		gap: "0.375rem",
		borderWidth: 0,
		borderRadius: controlSize._2,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._0,
		scrollSnapAlign: "start",
		transitionProperty: "opacity, color",
		transitionDuration: motion.durationBase,
		backgroundColor: color.transparent,
		opacity: {
			default: 0.72,
			":hover": 1,
		},
	},
	themeOrbSelected: {
		opacity: 1,
	},
	themeOrb: {
		position: "relative",
		width: controlSize._10,
		height: controlSize._10,
		borderRadius: radius.pill,
	},
	themeOrbDashed: {
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: color.border,
	},
	themeOrbSelectedRing: {
		outlineColor: color.borderStrong,
		outlineOffset: controlSize._1,
		outlineStyle: "solid",
		outlineWidth: 1,
	},
	themeOrbFill: {
		position: "absolute",
		inset: controlSize._0,
		borderRadius: radius.pill,
		transitionProperty: "transform",
		transitionDuration: motion.durationBase,
	},
	themeOrbGlow: {
		position: "absolute",
		borderRadius: radius.pill,
	},
	themeOrbHighlight: {
		position: "absolute",
		borderRadius: radius.pill,
	},
	themeOrbLabel: {
		color: color.textMuted,
		fontSize: font.size_1,
		lineHeight: 1,
	},
	themeOrbLabelSelected: {
		color: color.textMain,
		fontWeight: font.weight_6,
	},
	backgroundHeadingRow: {
		alignItems: "flex-start",
		display: "flex",
		gap: controlSize._3,
		justifyContent: "space-between",
	},
	hiddenFileInput: {
		display: "none",
	},
	backgroundGrid: {
		display: "grid",
		gap: controlSize._2,
		gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
	},
	backgroundCard: {
		backgroundColor: color.surfaceWhite025,
		borderColor: color.border,
		borderRadius: controlSize._2,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMuted,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1_5,
		overflow: "hidden",
		padding: controlSize._1,
		textAlign: "left",
		transitionDuration: motion.durationBase,
		transitionProperty: "border-color, background-color, color, transform",
		":hover": {
			backgroundColor: color.surfaceSubtle,
			borderColor: color.borderStrong,
			color: color.textMain,
			transform: "translateY(-1px)",
		},
	},
	backgroundCardSelected: {
		backgroundColor: color.surfaceSubtle,
		borderColor: color.accent,
		color: color.textMain,
	},
	backgroundPreview: {
		backgroundColor: color.background,
		backgroundPosition: "center",
		backgroundRepeat: "no-repeat",
		backgroundSize: "cover",
		borderRadius: radius.px5,
		display: "block",
		height: controlSize._16,
		width: "100%",
	},
	backgroundName: {
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		paddingInline: controlSize._1,
		paddingBottom: controlSize._1,
	},
	backgroundError: {
		color: color.danger,
		fontSize: font.size_2,
		lineHeight: 1.4,
		margin: controlSize._0,
	},
	backgroundControls: {
		backgroundColor: color.surfaceWhite025,
		borderColor: color.border,
		borderRadius: controlSize._2,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		padding: controlSize._2,
	},
	colorSourceOptions: {
		backgroundColor: color.surfaceInset,
		borderColor: color.border,
		borderRadius: controlSize._1_5,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		flexShrink: 0,
		gap: controlSize._0_5,
		padding: controlSize._0_5,
	},
	colorSourceButton: {
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlActive,
		},
		borderWidth: 0,
		borderRadius: controlSize._1,
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
		minHeight: controlSize._6,
		paddingInline: controlSize._2,
		":disabled": {
			opacity: 0.35,
		},
	},
	colorSourceButtonSelected: {
		backgroundColor: color.backgroundRaised,
		color: color.textMain,
	},
	backgroundControl: {
		alignItems: "center",
		color: color.textMuted,
		display: "grid",
		fontSize: font.size_2,
		gap: controlSize._2,
		gridTemplateColumns: "6.5rem 1fr 2.5rem",
	},
	backgroundRange: {
		accentColor: color.accent,
		margin: controlSize._0,
		width: "100%",
	},
	backgroundValue: {
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		textAlign: "right",
	},
	divider: {
		height: 1,
		backgroundColor: color.border,
	},
	section: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		padding: "18px 0",
	},
	sectionContained: {
		backgroundColor: color.surfaceWhite025,
		borderColor: color.border,
		borderRadius: radius.xl,
		borderStyle: "solid",
		borderWidth: 1,
		gap: controlSize._3,
		padding: controlSize._4,
	},
	sectionHeading: {
		margin: controlSize._0,
		color: color.textMain,
		fontSize: font.size_3,
		fontWeight: font.weight_6,
	},
	sectionDescription: {
		margin: controlSize._0,
		color: color.textMuted,
		fontSize: font.size_2,
		lineHeight: 1.4,
	},
	layoutControls: {
		display: "flex",
		flexWrap: "wrap",
		gap: controlSize._4,
	},
	layoutControlGroup: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._2,
	},
	layoutControlLabel: {
		color: color.textMuted,
		fontSize: font.size_1,
		fontWeight: font.weight_5,
	},
	agentInstructionsHeading: {
		alignItems: "flex-start",
		display: "flex",
		gap: controlSize._3,
		justifyContent: "space-between",
	},
	agentInstructionsEditor: {
		backgroundColor: color.transparent,
		borderColor: color.border,
		borderRadius: controlSize._2,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		fontFamily: "var(--font-mono)",
		fontSize: font.size_2,
		lineHeight: 1.5,
		minHeight: 132,
		outline: "none",
		padding: controlSize._2_5,
		resize: "vertical",
	},
	agentInstructionsActions: {
		display: "flex",
		justifyContent: "flex-end",
	},
	syntaxThemeButton: {
		height: controlSize._8,
		borderColor: color.border,
		borderRadius: radius.sm,
		backgroundColor: color.transparent,
		backgroundImage: "none",
		boxShadow: "none",
		color: color.textSoft,
		fontSize: font.size_2,
		maxWidth: "24rem",
	},
	syntaxThemeLabel: {
		fontSize: font.size_2,
	},
	folderList: {
		display: "flex",
		maxHeight: "8rem",
		flexDirection: "column",
		gap: controlSize._1,
		overflowY: "auto",
	},
	folderRow: {
		display: "flex",
		alignItems: "center",
		gap: "0.375rem",
		borderRadius: radius.sm,
		paddingBlock: "0.125rem",
		paddingInline: "0.375rem",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
		},
	},
	folderPath: {
		minWidth: controlSize._0,
		flex: 1,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: color.textSoft,
		fontFamily:
			"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
		fontSize: font.size_2,
	},
	browseButton: {
		flexShrink: 0,
		fontSize: font.size_2,
	},
	folderActionButton: {
		flexShrink: 0,
		fontSize: font.size_2,
	},
	folderInputRow: {
		display: "flex",
		gap: "0.375rem",
		alignItems: "center",
	},
	folderInput: {
		minWidth: controlSize._0,
		flex: 1,
		height: controlSize._7,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: {
			default: color.border,
			":focus": color.borderStrong,
		},
		borderRadius: radius.md,
		backgroundColor: color.background,
		color: color.textSoft,
		fontSize: font.size_2,
		outline: "none",
		paddingInline: controlSize._2,
		"::placeholder": {
			color: color.textMuted,
		},
	},
	versionText: {
		color: color.textMuted,
		fontSize: font.size_1,
		textAlign: "center",
	},
});

export function getBackgroundScenePickerBackgroundPreviewStyle(
	backgroundImage: CSSProperties["backgroundImage"],
): CSSProperties {
	return { backgroundImage: backgroundImage } as CSSProperties;
}

export function getThemeOrbThemeOrbStyle(
	backgroundColor: CSSProperties["backgroundColor"],
): CSSProperties {
	return { backgroundColor: backgroundColor } as CSSProperties;
}

export function getThemeOrbThemeOrbFillStyle(
	background: CSSProperties["background"],
): CSSProperties {
	return { background: background } as CSSProperties;
}

export function getThemeOrbThemeOrbGlowStyle(
	background: CSSProperties["background"],
): CSSProperties {
	return {
		top: "15%",
		left: "20%",
		width: "30%",
		height: "24%",
		background: background,
		filter: "blur(2px)",
	} as CSSProperties;
}

export function getThemeOrbThemeOrbHighlightStyle(): CSSProperties {
	return {
		top: "18%",
		left: "24%",
		width: "22%",
		height: "18%",
		background: `radial-gradient(ellipse at center, rgba(255,255,255,0.45), transparent 70%)`,
		filter: "blur(1.5px)",
	} as CSSProperties;
}
