import * as stylex from "@stylexjs/stylex";
import { styles } from "./styles.ts";
export function DiffFallback() {
	return (
		<div {...stylex.attrs(styles.fallback)}>
			<div>
				<div {...stylex.attrs(styles.title)}>
					Diff viewer could not render this file.
				</div>
				<div {...stylex.attrs(styles.description)}>
					Select another file, then return to this one. The raw git diff is
					still available from the agent.
				</div>
			</div>
		</div>
	);
}
