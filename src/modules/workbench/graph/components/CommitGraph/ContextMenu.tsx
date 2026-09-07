import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";
import { ariaValue, domStyle } from "../../../../../shared/lib/dom.tsx";
import { getCommitGraphRefContextMenuStyle, styles } from "./styles.ts";
export interface ContextMenuEntry {
	label: string;
	run: () => void;
}
export function ContextMenu(_props: {
	title: string;
	label?: string;
	x: number;
	y: number;
	entries: ContextMenuEntry[];
	onClose: () => void;
}) {
	return (
		<div
			role="menu"
			aria-label={ariaValue(
				`Actions for ${_props.label === undefined ? _props.title : _props.label}`,
			)}
			{...stylex.attrs(styles.refContextMenu)}
			style={domStyle(getCommitGraphRefContextMenuStyle(_props.x, _props.y))}
			onPointerDown={(event) => event.stopPropagation()}
		>
			<div {...stylex.attrs(styles.refContextTitle)}>{_props.title}</div>
			{
				<For each={_props.entries} keyed={(row) => row.label}>
					{(_props2) => (
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								_props2().run();
								_props.onClose();
							}}
							{...stylex.attrs(styles.refContextItem)}
						>
							{_props2().label}
						</button>
					)}
				</For>
			}
		</div>
	);
}
