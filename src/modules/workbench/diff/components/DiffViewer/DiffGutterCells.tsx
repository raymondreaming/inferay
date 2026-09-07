import * as stylex from "@stylexjs/stylex";
import { createMemo } from "solid-js";
import type { GitDiffLine } from "../../../../../../build/presentation/contracts/GitDiffLine.ts";
import { domStyle } from "../../../../../shared/lib/dom.tsx";
import * as inlineStyles from "./styles.ts";
import { DIFF_CONFIG, diffStyles } from "./styles.ts";
export const DiffGutterCells = function DiffGutterCells(_props: {
	line: GitDiffLine;
}) {
	const isAdd = createMemo(() => _props.line.type === "add");
	const isRemove = createMemo(() => _props.line.type === "remove");
	return (
		<>
			<span
				{...stylex.attrs(diffStyles.lineNumber)}
				style={domStyle(
					inlineStyles.getDiffGutterCellsLineNumberStyle(
						DIFF_CONFIG.lineNumFontSize,
						isAdd()
							? DIFF_CONFIG.addLineNumColor
							: isRemove()
								? DIFF_CONFIG.removeLineNumColor
								: DIFF_CONFIG.lineNumColor,
					),
				)}
			>
				{_props.line.number ?? ""}
			</span>
			<span
				{...stylex.attrs(diffStyles.sign)}
				style={domStyle(
					inlineStyles.getDiffGutterCellsSignStyle(
						DIFF_CONFIG.signFontSize,
						isAdd()
							? DIFF_CONFIG.addSignColor
							: isRemove()
								? DIFF_CONFIG.removeSignColor
								: undefined,
					),
				)}
			>
				{isAdd() ? "+" : isRemove() ? "-" : ""}
			</span>
		</>
	);
};
