import * as stylex from "@stylexjs/stylex";
import {
	color,
	controlSize,
	effect,
	font,
	motion,
	radius,
	shadow,
} from "../../../design-system/styles.stylex.ts";
export const styles = stylex.create({
	base: {
		alignItems: "center",
		borderRadius: radius.lg,
		display: "inline-flex",
		fontWeight: font.weight_5,
		gap: controlSize._1_5,
		justifyContent: "center",
		boxShadow: shadow.controlDepth,
		transitionDuration: motion.durationBase,
		transitionProperty:
			"background-color, border-color, box-shadow, color, transform, opacity",
		transitionTimingFunction: motion.ease,
		":active": {
			transform: "scale(0.97)",
		},
		":disabled": {
			opacity: 0.4,
			pointerEvents: "none",
		},
	},
	sm: {
		fontSize: font.size_3,
		height: controlSize._7,
		paddingInline: controlSize._2_5,
	},
	md: {
		fontSize: font.size_5,
		height: controlSize._8,
		paddingInline: controlSize._3,
	},
	lg: {
		fontSize: font.size_5,
		height: controlSize._9,
		paddingInline: controlSize._4,
	},
	primary: {
		backgroundColor: {
			default: color.controlActive,
			":hover": color.controlHover,
		},
		backgroundImage: "none",
		borderColor: color.borderStrong,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.none,
		color: color.textMain,
	},
	secondary: {
		backgroundColor: {
			default: color.backgroundRaised,
			":hover": color.controlActive,
		},
		backgroundImage: "none",
		borderColor: {
			default: color.border,
			":hover": color.borderStrong,
		},
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: shadow.none,
		color: color.textSoft,
	},
	ghost: {
		backdropFilter: "blur(8px)",
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlActive,
		},
		backgroundImage: {
			default: "none",
			":hover": effect.controlDepth,
		},
		boxShadow: {
			default: shadow.none,
			":hover": shadow.controlDepth,
		},
		color: {
			default: color.textMuted,
			":hover": color.textMain,
		},
	},
	danger: {
		backgroundColor: {
			default: color.dangerWash,
			":hover": color.dangerHover,
		},
		backgroundImage:
			"linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.01) 46%, rgba(0, 0, 0, 0.18))",
		borderColor: color.dangerBorder,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.danger,
	},
});
