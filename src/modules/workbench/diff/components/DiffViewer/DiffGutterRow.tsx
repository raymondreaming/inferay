import * as stylex from "@stylexjs/stylex";
import type { GitDiffLine } from "../../../../../../build/presentation/contracts/GitDiffLine.ts";
import { DiffGutterCells } from "./DiffGutterCells.tsx";
import { diffStyles } from "./styles.ts";
export const DiffGutterRow = function DiffGutterRow(_props: {
	line: GitDiffLine;
}) {
	return (
		<>
			{(() => {
				if (_props.line.type === "hunk" || _props.line.type === "spacer") {
					return <div {...stylex.attrs(diffStyles.gutterRow)} />;
				}
				return (
					<div {...stylex.attrs(diffStyles.gutterRow)}>
						<DiffGutterCells line={_props.line} />
					</div>
				);
			})()}
		</>
	);
};
