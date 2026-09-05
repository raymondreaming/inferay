import * as stylex from "@octanejs/stylex";
import type { Octane } from "octane/jsx-runtime";
import { runtimeColor } from "../../../design-system/styles.stylex.ts";
import { LiquidAction } from "../gooey/LiquidAction/index.tsx";
import { styles } from "./styles.ts";

interface ButtonProps extends Octane.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: "primary" | "secondary" | "ghost" | "danger";
	size?: "sm" | "md" | "lg";
	/** Visual-only liquid surface. Ghost and rapid controls stay plain by default. */
	liquid?: boolean;
	/** Use when the button intentionally fills its container. */
	liquidFullWidth?: boolean;
}

export function Button({
	variant = "secondary",
	size = "md",
	liquid = variant !== "ghost",
	liquidFullWidth = false,
	className = "",
	children,
	...props
}: ButtonProps) {
	const buttonProps = stylex.props(styles.base, styles[size], styles[variant]);

	const button = (
		<button
			{...buttonProps}
			className={`${buttonProps.className ?? ""} ${className}`}
			{...props}
			type={props.type ?? "button"}
		>
			{children}
		</button>
	);
	if (!liquid) return button;
	const fill =
		variant === "primary"
			? runtimeColor.accent
			: variant === "danger"
				? runtimeColor.dangerWash
				: runtimeColor.backgroundRaised;
	return (
		<LiquidAction
			fill={fill}
			fullWidth={liquidFullWidth}
			intense={variant === "primary"}
		>
			{button}
		</LiquidAction>
	);
}
