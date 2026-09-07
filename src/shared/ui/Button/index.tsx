import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { createMemo, omit, Show } from "solid-js";
import { runtimeColor } from "../../../design-system/styles.stylex.ts";
import { LiquidAction } from "../gooey/LiquidAction/index.tsx";
import { styles } from "./styles.ts";

interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: "primary" | "secondary" | "ghost" | "danger";
	size?: "sm" | "md" | "lg";
	/** Visual-only liquid surface. Ghost and rapid controls stay plain by default. */
	liquid?: boolean;
	/** Use when the button intentionally fills its container. */
	liquidFullWidth?: boolean;
}
export function Button(props: ButtonProps) {
	const nativeProps = omit(
		props,
		"variant",
		"size",
		"liquid",
		"liquidFullWidth",
		"class",
		"children",
	);
	const variant = createMemo(() => props.variant ?? "secondary");
	const liquid = createMemo(() => props.liquid ?? variant() !== "ghost");
	const appearance = createMemo(() =>
		stylex.attrs(styles.base, styles[props.size ?? "md"], styles[variant()]),
	);
	const fill = createMemo(() =>
		variant() === "primary"
			? runtimeColor.accent
			: variant() === "danger"
				? runtimeColor.dangerWash
				: runtimeColor.backgroundRaised,
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
			<LiquidAction
				fill={fill()}
				fullWidth={props.liquidFullWidth ?? false}
				intense={variant() === "primary"}
			>
				<NativeButton />
			</LiquidAction>
		</Show>
	);
}
