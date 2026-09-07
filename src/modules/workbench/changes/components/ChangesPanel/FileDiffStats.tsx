import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import type { GitFileEntry } from "../../../../../../build/presentation/contracts/GitFileEntry.ts";
import { styles } from "./styles.ts";
export function FileDiffStats(_props: { file: GitFileEntry }) {
	const additions = createMemo(() => _props.file.additions ?? 0);
	const deletions = createMemo(() => _props.file.deletions ?? 0);
	return (
		<>
			{(() => {
				if (additions() === 0 && deletions() === 0) return null;
				return (
					<span {...stylex.attrs(styles.fileStats)}>
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
