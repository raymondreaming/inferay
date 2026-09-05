import * as stylex from "@octanejs/stylex";
import { AVATAR_SIZE, hexToRgba } from "../../model/graph-model.ts";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

export function MergeNode({
	color,
	left,
	top,
}: {
	color: string;
	left: number;
	top: number;
}) {
	return (
		<span
			aria-hidden="true"
			data-graph-merge-node="true"
			{...stylex.props(styles.mergeNode)}
			style={inlineStyles.getMergeNodeMergeNodeStyle(
				left + AVATAR_SIZE / 2 - 5,
				top + AVATAR_SIZE / 2 - 5,
				color,
				`0 0 0 1px ${hexToRgba(color, 0.32)}`,
			)}
		/>
	);
}
