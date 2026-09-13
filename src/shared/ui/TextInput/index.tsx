import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { createMemo, omit } from "solid-js";
import { styles } from "./styles.ts";

export function TextInput(
	props: Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "size"> & {
		size?: "sm" | "md";
		fullWidth?: boolean;
	},
) {
	const inputProps = createMemo(() =>
		stylex.attrs(
			styles.base,
			styles[props.size === undefined ? "md" : props.size],
			(props.fullWidth === undefined ? false : props.fullWidth)
				? styles.fullWidth
				: null,
		),
	);
	return (
		<input
			{...inputProps()}
			class={`${inputProps().class ?? ""} ${props.class === undefined ? "" : props.class}`}
			{...omit(props, "size", "fullWidth", "class")}
		/>
	);
}
