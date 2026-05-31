import * as stylex from "@stylexjs/stylex";
import type { ButtonHTMLAttributes } from "react";
import {
	color,
	controlSize,
	effect,
	motion,
	radius,
	shadow,
} from "../../tokens.stylex.ts";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: "ghost" | "danger" | "subtle";
	size?: "xs" | "sm" | "md";
}

export function IconButton({
	variant = "ghost",
	size = "sm",
	className = "",
	children,
	...props
}: IconButtonProps) {
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
		borderRadius: radius.md,
		display: "inline-flex",
		justifyContent: "center",
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, box-shadow, color, opacity",
		transitionTimingFunction: motion.ease,
		":disabled": {
			opacity: 0.4,
			pointerEvents: "none",
		},
	},
	xs: {
		padding: controlSize._0_5,
	},
	sm: {
		padding: controlSize._1,
	},
	md: {
		padding: controlSize._1_5,
	},
	ghost: {
		backgroundColor: {
			default: color.transparent,
			":hover": color.controlHover,
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
			":hover": color.textSoft,
		},
	},
	danger: {
		backgroundColor: {
			default: color.transparent,
			":hover": color.dangerWash,
		},
		boxShadow: {
			default: shadow.none,
			":hover":
				"inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 12px 26px rgba(0, 0, 0, 0.28)",
		},
		color: {
			default: color.textMuted,
			":hover": color.danger,
		},
	},
	subtle: {
		backgroundColor: {
			default: color.surfaceControl,
			":hover": color.surfaceControlHover,
		},
		backgroundImage: {
			default: effect.controlDepth,
			":hover": effect.controlDepthHover,
		},
		boxShadow: {
			default: shadow.controlDepth,
			":hover": shadow.controlDepthHover,
		},
		color: {
			default: color.textMuted,
			":hover": color.textSoft,
		},
	},
});
