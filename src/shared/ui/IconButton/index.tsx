import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { createMemo, omit, Show } from "solid-js";
import { runtimeColor } from "../../../design-system/styles.stylex.ts";
import { LiquidAction } from "../gooey/LiquidAction/index.tsx";
import { styles } from "./styles.ts";

interface IconButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: "ghost" | "danger" | "subtle";
	size?: "xs" | "sm" | "md";
	/** Defaults to the raised `subtle` treatment only. */
	liquid?: boolean;
}
export function IconButton(props: IconButtonProps) {
	const nativeProps = omit(
		props,
		"variant",
		"size",
		"liquid",
		"class",
		"children",
	);
	const variant = createMemo(() => props.variant ?? "ghost");
	const liquid = createMemo(() => props.liquid ?? variant() === "subtle");
	const appearance = createMemo(() =>
		stylex.attrs(styles.base, styles[props.size ?? "sm"], styles[variant()]),
	);
	const NativeButton = () => (
		<button
			{...appearance()}
			{...nativeProps}
			class={`${appearance().class ?? ""} ${props.class ?? ""}`}
			type={nativeProps.type ?? "button"}
		>
			{props.children}
		</button>
	);
	return (
		<Show when={liquid()} fallback={<NativeButton />}>
			<LiquidAction fill={runtimeColor.surfaceControl}>
				<NativeButton />
			</LiquidAction>
		</Show>
	);
}
