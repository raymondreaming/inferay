import * as stylex from "@octanejs/stylex";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
	shadow,
} from "../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
	base: {
		backgroundColor: color.background,
		borderColor: {
			default: color.border,
			":focus": color.focusRing,
		},
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.none,
		color: color.textMain,
		minWidth: controlSize._0,
		outline: shadow.none,
		transitionDuration: motion.durationBase,
		transitionProperty: "border-color, background-color, color",
		transitionTimingFunction: motion.ease,
		"::placeholder": {
			color: color.textMuted,
		},
	},
	sm: {
		fontSize: font.size_2,
		height: controlSize._7,
		paddingInline: controlSize._2,
	},
	md: {
		fontSize: font.size_2,
		height: controlSize._8,
		paddingInline: controlSize._2_5,
	},
	fullWidth: {
		width: "100%",
	},
});
