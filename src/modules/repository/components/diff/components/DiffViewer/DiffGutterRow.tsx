import type { GitDiffLine } from "@contracts";
import { px } from "@shared/lib/dom.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, Show } from "solid-js";
import { DIFF_CONFIG, diffStyles } from "./styles.ts";
export const DiffGutterRow = function DiffGutterRow(_props: {
	line: GitDiffLine;
}) {
	const isAdd = createMemo(() => _props.line.type === "add");
	const isRemove = createMemo(() => _props.line.type === "remove");
	return (
		<div {...stylex.attrs(diffStyles.gutterRow)}>
			<Show when={_props.line.type !== "hunk" && _props.line.type !== "spacer"}>
				<span
					{...stylex.attrs(diffStyles.lineNumber)}
					style={{
						"font-size": px(DIFF_CONFIG.lineNumFontSize),
						color: isAdd()
							? DIFF_CONFIG.addLineNumColor
							: isRemove()
								? DIFF_CONFIG.removeLineNumColor
								: DIFF_CONFIG.lineNumColor,
					}}
				>
					{_props.line.number ?? ""}
				</span>
				<span
					{...stylex.attrs(diffStyles.sign)}
					style={{
						"font-size": px(DIFF_CONFIG.signFontSize),
						color: isAdd()
							? DIFF_CONFIG.addSignColor
							: isRemove()
								? DIFF_CONFIG.removeSignColor
								: undefined,
					}}
				>
					{isAdd() ? "+" : isRemove() ? "-" : ""}
				</span>
			</Show>
		</div>
	);
};
