import * as stylex from "@octanejs/stylex";
import { memo } from "octane";
import type { DiffLine } from "../../../../repository/model/types.ts";
import { DiffGutterCells } from "./DiffGutterCells.tsx";
import { diffStyles } from "./styles.ts";

export const DiffGutterRow = memo(function DiffGutterRow({
	line,
}: {
	line: DiffLine;
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
