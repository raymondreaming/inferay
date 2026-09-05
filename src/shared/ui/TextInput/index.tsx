import * as stylex from "@octanejs/stylex";
import type { Octane } from "octane/jsx-runtime";
import { styles } from "./styles.ts";

interface TextInputProps
	extends Omit<Octane.InputHTMLAttributes<HTMLInputElement>, "size"> {
	size?: "sm" | "md";
	fullWidth?: boolean;
}

export function TextInput({
	size = "md",
	fullWidth = false,
	className = "",
	...props
}: TextInputProps) {
	const inputProps = stylex.props(
		styles.base,
		styles[size],
		fullWidth ? styles.fullWidth : null,
	);

	return (
		<input
			{...inputProps}
			className={`${inputProps.className ?? ""} ${className}`}
			{...props}
		/>
	);
}
