import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import type { Element } from "solid-js";
import { createMemo, omit } from "solid-js";
import { styles } from "./styles.ts";

export function WorkspaceEmptyState(
	props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> & {
		icon?: Element;
		title: import("solid-js").Element;
		description?: import("solid-js").Element;
		action?: import("solid-js").Element;
	},
) {
	const emptyProps = createMemo(() => stylex.attrs(styles.emptyState));
	return (
		<div
			{...emptyProps()}
			class={`${emptyProps().class ?? ""} ${props.class === undefined ? "" : props.class}`}
			{...omit(props, "icon", "title", "description", "action", "class")}
		>
			{props.icon ? (
				<span {...stylex.attrs(styles.emptyIcon)}>{props.icon}</span>
			) : null}
			<div {...stylex.attrs(styles.emptyText)}>
				<span {...stylex.attrs(styles.emptyTitle)}>{props.title}</span>
				{props.description ? (
					<span {...stylex.attrs(styles.emptyDescription)}>
						{props.description}
					</span>
				) : null}
			</div>
			{props.action ? (
				<div {...stylex.attrs(styles.emptyAction)}>{props.action}</div>
			) : null}
		</div>
	);
}
