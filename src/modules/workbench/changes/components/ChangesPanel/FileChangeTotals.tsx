import * as stylex from "@stylexjs/stylex";
import { styles } from "./styles.ts";
export function FileChangeTotals(_props: {
	additions: number;
	deletions: number;
}) {
	return (
		<div
			{...stylex.attrs(styles.changeTotals)}
			title="Total additions and deletions"
		>
			<span {...stylex.attrs(styles.addedText)}>+{_props.additions}</span>
			<span {...stylex.attrs(styles.deletedText)}>-{_props.deletions}</span>
		</div>
	);
}
