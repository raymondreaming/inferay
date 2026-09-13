import type { GitFileEntry } from "@contracts";
import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import { styles } from "./styles.ts";
export function FileDiffStats(_props: {
	file: GitFileEntry;
	hidden?: boolean;
}) {
	const additions = createMemo(() => _props.file.additions ?? 0);
	const deletions = createMemo(() => _props.file.deletions ?? 0);
	return (
		<>
			{(() => {
				if (additions() === 0 && deletions() === 0) return null;
				return (
					<span
						{...stylex.attrs(
							styles.fileStats,
							_props.hidden && styles.fileStatsHidden,
						)}
					>
						{additions() > 0 && (
							<span {...stylex.attrs(styles.addedText)}>+{additions()}</span>
						)}
						{deletions() > 0 && (
							<span {...stylex.attrs(styles.deletedText)}>-{deletions()}</span>
						)}
					</span>
				);
			})()}
		</>
	);
}
