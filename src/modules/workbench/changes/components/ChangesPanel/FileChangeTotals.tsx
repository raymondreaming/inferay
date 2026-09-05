import * as stylex from "@octanejs/stylex";
import { styles } from "./styles.ts";

export function FileChangeTotals({
	additions,
	deletions,
}: {
	additions: number;
	deletions: number;
}) {
	return (
		<div
			{...stylex.props(styles.changeTotals)}
			title="Total additions and deletions"
		>
			<span {...stylex.props(styles.addedText)}>+{additions}</span>
			<span {...stylex.props(styles.deletedText)}>-{deletions}</span>
		</div>
	);
}
