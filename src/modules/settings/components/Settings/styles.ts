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
		minWidth: {
			default: controlSize._0,
			[breakpoint.tablet]: "11rem",
		},
	},
	noShrink: {
		flexShrink: 0,
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
		backgroundColor: color.background,
		borderColor: {
			default: color.border,
			":focus": color.focusRing,
		},
		borderRadius: radius.md,
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
		backgroundColor: color.background,
		borderColor: {
			default: color.border,
			":focus": color.focusRing,
		},
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMain,
		fontSize: font.size_2,
		height: controlSize._7,
		minWidth: controlSize._0,
		outline: "none",
		paddingInline: controlSize._2,
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
