import * as stylex from "@stylexjs/stylex";
import type { ButtonHTMLAttributes } from "react";
import {
	color,
	controlSize,
	effect,
	font,
	motion,
	radius,
	shadow,
} from "../../tokens.stylex.ts";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: "primary" | "secondary" | "ghost" | "danger";
	size?: "sm" | "md" | "lg";
}

export function Button({
	variant = "secondary",
	size = "md",
	className = "",
	children,
	...props
}: ButtonProps) {
	const buttonProps = stylex.props(styles.base, styles[size], styles[variant]);

	return (
		<button
			{...buttonProps}
			className={`${buttonProps.className ?? ""} ${className}`}
			{...props}
		>
			{children}
		</button>
	);
}

const styles = stylex.create({
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
			default: color.accent,
			":hover": color.accentHover,
		},
		backgroundImage: {
			default:
				"linear-gradient(180deg, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0.05) 45%, rgba(0, 0, 0, 0.16))",
			":hover":
				"linear-gradient(180deg, rgba(255, 255, 255, 0.26), rgba(255, 255, 255, 0.08) 45%, rgba(0, 0, 0, 0.18))",
		},
		boxShadow: {
			default: shadow.controlDepth,
			":hover": shadow.controlDepthHover,
		},
		color: color.accentForeground,
	},
	secondary: {
		backgroundColor: {
			default: color.surfaceControl,
			":hover": color.surfaceControlHover,
		},
		backgroundImage: {
			default: effect.controlDepth,
			":hover": effect.controlDepthHover,
		},
		borderColor: color.border,
		borderStyle: "solid",
		borderWidth: 1,
		boxShadow: {
			default: shadow.controlDepth,
			":hover": shadow.controlDepthHover,
		},
		color: color.textSoft,
	},
	ghost: {
		backdropFilter: "blur(8px)",
		backgroundColor: {
			default: "transparent",
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
