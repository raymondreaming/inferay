import * as stylex from "@octanejs/stylex";
import type { Octane } from "octane/jsx-runtime";
import { runtimeColor } from "../../../design-system/styles.stylex.ts";
import { LiquidAction } from "../gooey/LiquidAction/index.tsx";
import { styles } from "./styles.ts";

interface IconButtonProps
	extends Octane.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: "ghost" | "danger" | "subtle";
	size?: "xs" | "sm" | "md";
	/** Defaults to the raised `subtle` treatment only. */
	liquid?: boolean;
}

export function IconButton({
	variant = "ghost",
	size = "sm",
	liquid = variant === "subtle",
	className = "",
	children,
	...props
}: IconButtonProps) {
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
	return (
		<LiquidAction fill={runtimeColor.surfaceControl}>{button}</LiquidAction>
	);
}
