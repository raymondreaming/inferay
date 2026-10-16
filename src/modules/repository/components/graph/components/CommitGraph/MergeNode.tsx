import { px } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import { AVATAR_SIZE, styles } from "./styles.ts";
import { hexToRgba } from "./useCommitGraphState.tsx";
export function MergeNode(_props: {
	color: string;
	left: number;
	top: number;
}) {
	return (
		<span
			aria-hidden="true"
			data-graph-merge-node="true"
			class={stylex.attrs(styles.mergeNode).class}
			style={{
				left: px(_props.left + AVATAR_SIZE / 2 - 5),
				top: px(_props.top + AVATAR_SIZE / 2 - 5),
				"background-color": _props.color,
				"box-shadow": `0 0 0 1px ${hexToRgba(_props.color, 0.32)}`,
			}}
		/>
	);
}
