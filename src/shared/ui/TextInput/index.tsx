import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { createMemo, omit } from "solid-js";
import { styles } from "./styles.ts";

interface TextInputProps
	extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "size"> {
	size?: "sm" | "md";
	fullWidth?: boolean;
}
export function TextInput(_props: TextInputProps) {
	const inputProps = createMemo(() =>
		stylex.attrs(
			styles.base,
			styles[_props.size === undefined ? "md" : _props.size],
			(_props.fullWidth === undefined ? false : _props.fullWidth)
				? styles.fullWidth
				: null,
		),
	);
	return (
		<input
			{...inputProps()}
			class={`${inputProps().class ?? ""} ${_props.class === undefined ? "" : _props.class}`}
			{...omit(_props, "size", "fullWidth", "class")}
		/>
	);
}
