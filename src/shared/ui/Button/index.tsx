import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { createMemo, omit } from "solid-js";
import { styles } from "./styles.ts";

export function Button(
	props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
		variant?: "primary" | "secondary" | "ghost" | "danger";
		size?: "sm" | "md" | "lg";
	},
) {
	const nativeProps = omit(props, "variant", "size", "class", "children");
	const appearance = createMemo(() =>
		stylex.attrs(
			styles.base,
			styles[props.size ?? "md"],
			styles[props.variant ?? "secondary"],
		),
	);
	return (
		<button
			{...appearance()}
			{...nativeProps}
			class={`${appearance().class ?? ""} ${props.class ?? ""}`}
			type={nativeProps.type ?? "button"}
		>
			{props.children}
		</button>
	);
}
