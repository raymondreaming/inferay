import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import type { Element } from "solid-js";
import { createMemo, omit } from "solid-js";
import { styles } from "./styles.ts";

export function Notice(
	props: JSX.HTMLAttributes<HTMLDivElement> & {
		tone?: "warning" | "success" | "info";
		icon?: Element;
		children: Element;
	},
) {
	const noticeProps = createMemo(() =>
		stylex.attrs(
			styles.notice,
			styles[props.tone === undefined ? "info" : props.tone],
		),
	);
	return (
		<div
			{...noticeProps()}
			class={`${noticeProps().class ?? ""} ${props.class === undefined ? "" : props.class}`}
			{...omit(props, "tone", "icon", "children", "class")}
		>
			{props.icon ? (
				<span {...stylex.attrs(styles.noticeIcon)}>{props.icon}</span>
			) : null}
			<span {...stylex.attrs(styles.noticeContent)}>{props.children}</span>
		</div>
	);
}
