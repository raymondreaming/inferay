import * as stylex from "@stylexjs/stylex";
import { domStyle } from "../../../../../shared/lib/dom.tsx";
import * as inlineStyles from "./styles.ts";
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
			{...stylex.attrs(styles.mergeNode)}
			style={domStyle(
				inlineStyles.getMergeNodeMergeNodeStyle(
					_props.left + AVATAR_SIZE / 2 - 5,
					_props.top + AVATAR_SIZE / 2 - 5,
					_props.color,
					`0 0 0 1px ${hexToRgba(_props.color, 0.32)}`,
				),
			)}
		/>
	);
}
