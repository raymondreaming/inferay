import * as stylex from "@octanejs/stylex";
import { memo } from "octane";
import type { GitDiffLine } from "../../../../../../build/presentation/contracts/GitDiffLine.ts";
import * as inlineStyles from "./styles.ts";
import { DIFF_CONFIG, diffStyles } from "./styles.ts";

export const DiffGutterCells = memo(function DiffGutterCells({
	line,
}: {
	line: GitDiffLine;
}) {
	const isAdd = line.type === "add";
	const isRemove = line.type === "remove";
	return (
		<>
			<span
				{...stylex.props(diffStyles.lineNumber)}
				style={inlineStyles.getDiffGutterCellsLineNumberStyle(
					DIFF_CONFIG.lineNumFontSize,
					isAdd
						? DIFF_CONFIG.addLineNumColor
						: isRemove
							? DIFF_CONFIG.removeLineNumColor
							: DIFF_CONFIG.lineNumColor,
				)}
			>
				{line.number ?? ""}
			</span>
			<span
				{...stylex.props(diffStyles.sign)}
				style={inlineStyles.getDiffGutterCellsSignStyle(
					DIFF_CONFIG.signFontSize,
					isAdd
						? DIFF_CONFIG.addSignColor
						: isRemove
							? DIFF_CONFIG.removeSignColor
							: undefined,
				)}
			>
				{isAdd ? "+" : isRemove ? "-" : ""}
			</span>
		</>
	);
});
