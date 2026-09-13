import * as stylex from "@stylexjs/stylex";
import {
	breakpoint,
	color,
	controlSize,
	font,
	motion,
	radius,
} from "../../../../design-system/styles.stylex.ts";
import type { CSSProperties } from "../../../../shared/lib/dom.tsx";
export const styles = stylex.create({
	control: {
		backgroundColor: color.surfaceWhite04,
		backgroundImage: "none",
		borderColor: color.border,
		borderRadius: radius.lg,
		boxShadow: "none",
		color: color.textSoft,
		fontSize: font.size_2,
		height: controlSize._8,
		minWidth: {
			default: controlSize._0,
			[breakpoint.tablet]: "11rem",
		},
	},
	controlLabel: {
		fontSize: font.size_2,
	},
	noShrink: {
		flexShrink: 0,
	},
	themeGrid: {
		display: "flex",
		gap: controlSize._2,
		overflowX: "auto",
		overscrollBehaviorX: "contain",
		paddingBlock: controlSize._2,
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
	hiddenFileInput: {
		display: "none",
	},
	sceneArea: {
		paddingBlock: controlSize._3,
	},
	backgroundGrid: {
		display: "grid",
		gap: controlSize._2,
		gridTemplateColumns: {
			default: "repeat(2, minmax(0, 1fr))",
			[breakpoint.tablet]: "repeat(3, minmax(0, 1fr))",
		},
	},
	backgroundCard: {
		backgroundColor: color.transparent,
		borderColor: color.transparent,
		borderRadius: radius.lg,
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
		transitionProperty: "border-color, background-color, color",
		":hover": {
			backgroundColor: color.surfaceWhite04,
			color: color.textMain,
		},
	},
	backgroundCardSelected: {
		backgroundColor: color.surfaceWhite06,
		borderColor: color.borderStrong,
		color: color.textMain,
	},
	backgroundPreview: {
		backgroundColor: color.background,
		backgroundPosition: "center",
		backgroundRepeat: "no-repeat",
		backgroundSize: "cover",
		borderRadius: radius.md,
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
		paddingBlock: controlSize._2,
	},
	backgroundRange: {
		accentColor: color.accent,
		margin: controlSize._0,
		width: {
			default: "7rem",
			[breakpoint.tablet]: "11rem",
		},
	},
	backgroundValue: {
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		minWidth: controlSize._8,
		textAlign: "right",
	},
	instructionsEditor: {
		backgroundColor: color.surfaceWhite02,
		borderColor: {
			default: color.border,
			":focus-visible": color.borderStrong,
		},
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
		lineHeight: 1.6,
		minHeight: 148,
		outline: "none",
		padding: controlSize._3,
		resize: "vertical",
		width: "100%",
		"::placeholder": {
			color: color.textMuted,
		},
	},
	instructionsActions: {
		alignItems: "center",
		display: "flex",
		gap: controlSize._3,
		justifyContent: "flex-end",
		paddingBlockStart: controlSize._2,
	},
	instructionsError: {
		color: color.danger,
		flex: 1,
		fontSize: font.size_1,
		margin: controlSize._0,
	},
	folderPath: {
		color: color.textSoft,
		flex: 1,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
		minWidth: controlSize._0,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	folderInput: {
		backgroundColor: color.surfaceWhite04,
		borderColor: {
			default: color.border,
			":focus": color.borderStrong,
		},
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		fontSize: font.size_2,
		height: controlSize._8,
		minWidth: controlSize._0,
		outline: "none",
		paddingInline: controlSize._2_5,
		width: {
			default: "9rem",
			[breakpoint.tablet]: "14rem",
		},
		"::placeholder": {
			color: color.textMuted,
		},
	},
});
export function getBackgroundScenePickerBackgroundPreviewStyle(
	backgroundImage: CSSProperties["backgroundImage"],
): CSSProperties {
	return {
		backgroundImage: backgroundImage,
	} as CSSProperties;
}
export function getThemeOrbThemeOrbStyle(
	backgroundColor: CSSProperties["backgroundColor"],
): CSSProperties {
	return {
		backgroundColor: backgroundColor,
	} as CSSProperties;
}
export function getThemeOrbThemeOrbFillStyle(
	background: CSSProperties["background"],
): CSSProperties {
	return {
		background: background,
	} as CSSProperties;
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
