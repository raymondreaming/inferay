import * as stylex from "@octanejs/stylex";
import type { GitFileEntry } from "../../../../../../build/presentation/contracts/GitFileEntry.ts";
import { styles } from "./styles.ts";

export function FileDiffStats({ file }: { file: GitFileEntry }) {
	const additions = file.additions ?? 0;
	const deletions = file.deletions ?? 0;
	if (additions === 0 && deletions === 0) return null;

	return (
		<span {...stylex.props(styles.fileStats)}>
			{additions > 0 && (
				<span {...stylex.props(styles.addedText)}>+{additions}</span>
			)}
			{deletions > 0 && (
				<span {...stylex.props(styles.deletedText)}>-{deletions}</span>
			)}
		</span>
	);
}
