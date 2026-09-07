import * as stylex from "@octanejs/stylex";
import { memo } from "octane";
import type { GitDiffLine } from "../../../../../../build/presentation/contracts/GitDiffLine.ts";
import { DiffGutterCells } from "./DiffGutterCells.tsx";
import { diffStyles } from "./styles.ts";

export const DiffGutterRow = memo(function DiffGutterRow({
	line,
}: {
	line: GitDiffLine;
}) {
	if (line.type === "hunk" || line.type === "spacer") {
		return <div {...stylex.props(diffStyles.gutterRow)} />;
	}
	return (
		<div {...stylex.props(diffStyles.gutterRow)}>
			<DiffGutterCells line={line} />
		</div>
	);
});
