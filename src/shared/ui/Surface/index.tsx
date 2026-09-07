import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import type { Element } from "solid-js";
import { createMemo, omit } from "solid-js";
import { styles } from "./styles.ts";

interface NoticeProps extends JSX.HTMLAttributes<HTMLDivElement> {
	tone?: "warning" | "success" | "info";
	icon?: Element;
	children: Element;
}
export function Notice(_props: NoticeProps) {
	const noticeProps = createMemo(() =>
		stylex.attrs(
			styles.notice,
			styles[_props.tone === undefined ? "info" : _props.tone],
		),
	);
	return (
		<div
			{...noticeProps()}
			class={`${noticeProps().class ?? ""} ${_props.class === undefined ? "" : _props.class}`}
			{...omit(_props, "tone", "icon", "children", "class")}
		>
			{_props.icon ? (
				<span {...stylex.attrs(styles.noticeIcon)}>{_props.icon}</span>
			) : null}
			<span {...stylex.attrs(styles.noticeContent)}>{_props.children}</span>
		</div>
	);
}
