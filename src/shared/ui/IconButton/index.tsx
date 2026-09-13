import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { createMemo, omit } from "solid-js";
import { styles } from "./styles.ts";

interface IconButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: "ghost" | "danger" | "subtle";
	size?: "xs" | "sm" | "md";
}
export function IconButton(props: IconButtonProps) {
	const nativeProps = omit(props, "variant", "size", "class", "children");
	const appearance = createMemo(() =>
		stylex.attrs(
			styles.base,
			styles[props.size ?? "sm"],
			styles[props.variant ?? "ghost"],
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
