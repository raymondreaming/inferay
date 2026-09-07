import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import type { Element } from "solid-js";
import { createMemo, omit } from "solid-js";
import { styles } from "./styles.ts";

interface WorkspaceEmptyStateProps
	extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
	icon?: Element;
	title: import("solid-js").Element;
	description?: import("solid-js").Element;
	action?: import("solid-js").Element;
}
export function WorkspaceEmptyState(_props: WorkspaceEmptyStateProps) {
	const emptyProps = createMemo(() => stylex.attrs(styles.emptyState));
	return (
		<div
			{...emptyProps()}
			class={`${emptyProps().class ?? ""} ${_props.class === undefined ? "" : _props.class}`}
			{...omit(_props, "icon", "title", "description", "action", "class")}
		>
			{_props.icon ? (
				<span {...stylex.attrs(styles.emptyIcon)}>{_props.icon}</span>
			) : null}
			<div {...stylex.attrs(styles.emptyText)}>
				<span {...stylex.attrs(styles.emptyTitle)}>{_props.title}</span>
				{_props.description ? (
					<span {...stylex.attrs(styles.emptyDescription)}>
						{_props.description}
					</span>
				) : null}
			</div>
			{_props.action ? (
				<div {...stylex.attrs(styles.emptyAction)}>{_props.action}</div>
			) : null}
		</div>
	);
}
