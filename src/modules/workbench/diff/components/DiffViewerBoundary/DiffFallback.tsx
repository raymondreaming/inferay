import * as stylex from "@octanejs/stylex";
import { styles } from "./styles.ts";

export function DiffFallback() {
	return (
		<div {...stylex.props(styles.fallback)}>
			<div>
				<div {...stylex.props(styles.title)}>
					Diff viewer could not render this file.
				</div>
				<div {...stylex.props(styles.description)}>
					Select another file, then return to this one. The raw git diff is
					still available from the agent.
				</div>
			</div>
		</div>
	);
}
