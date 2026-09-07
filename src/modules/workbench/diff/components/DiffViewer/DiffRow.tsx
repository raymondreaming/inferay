import * as stylex from "@stylexjs/stylex";
import { createMemo, For } from "solid-js";
import type { GitDiffLine } from "../../../../../../build/presentation/contracts/GitDiffLine.ts";
import type { SyntaxToken } from "../../../../../shared/hooks/useSyntaxHighlight.tsx";
import {
	type CSSProperties,
	domStyle,
} from "../../../../../shared/lib/dom.tsx";
import { DiffGutterCells } from "./DiffGutterCells.tsx";
import { MAX_RENDERED_LINE_CHARS } from "./index.tsx";
import * as inlineStyles from "./styles.ts";
import { DIFF_CONFIG, diffStyles, LINE_H } from "./styles.ts";

type DiffRowStyle = CSSProperties & {
	"--hover-bg"?: string;
};
function getDiffRowBg(line: GitDiffLine, isHighlighted?: boolean) {
	const isAdd = line.type === "add";
	const isRemove = line.type === "remove";
	if (isHighlighted) {
		return isAdd
			? DIFF_CONFIG.addBgHighlight
			: isRemove
				? DIFF_CONFIG.removeBgHighlight
				: "color-mix(in srgb, var(--color-inferay-accent) 22%, transparent)";
	}
	return isAdd
		? DIFF_CONFIG.addBg
		: isRemove
			? DIFF_CONFIG.removeBg
			: "transparent";
}
export const DiffRow = function DiffRow(_props: {
	clipContent?: boolean;
	line: GitDiffLine;
	highlightedTokens?: SyntaxToken[];
	isHighlighted?: boolean;
	minWidth?: number;
	hideGutter?: boolean;
	gutterOffset?: number;
}) {
	const kind = createMemo(() => _props.line.type);
	return (
		<>
			{(() => {
				if (kind() === "hunk") {
					return (
						<div
							{...stylex.attrs(diffStyles.hunkSeparator)}
							style={domStyle(
								inlineStyles.getDiffRowHunkSeparatorStyle(
									_props.minWidth || "100%",
									_props.hideGutter
										? (_props.gutterOffset === undefined
												? 0
												: _props.gutterOffset) + 8
										: undefined,
								),
							)}
						>
							<span {...stylex.attrs(diffStyles.hunkText)}>
								{_props.line.content}
							</span>
						</div>
					);
				}
				if (kind() === "spacer") {
					return (
						<div
							{...stylex.attrs(diffStyles.spacer)}
							style={domStyle(
								inlineStyles.getDiffRowSpacerStyle(_props.minWidth || "100%"),
							)}
						/>
					);
				}
				const isAdd = createMemo(() => _props.line.type === "add");
				const isRemove = createMemo(() => _props.line.type === "remove");
				const hoverBg = createMemo(() =>
					isAdd()
						? DIFF_CONFIG.addBgHover
						: isRemove()
							? DIFF_CONFIG.removeBgHover
							: undefined,
				);
				const bgColor = createMemo(() =>
					getDiffRowBg(_props.line, _props.isHighlighted),
				);
				const rowProps = createMemo(() => stylex.attrs(diffStyles.row));
				const content = createMemo(() =>
					_props.line.content.length > MAX_RENDERED_LINE_CHARS
						? `${_props.line.content.slice(0, MAX_RENDERED_LINE_CHARS)} ... [line truncated for display]`
						: _props.line.content,
				);
				return (
					<div
						{...rowProps()}
						class={`diff-row ${rowProps().class ?? ""}`}
						style={domStyle(
							inlineStyles.getDiffRowDivStyle(
								`${LINE_H}px`,
								bgColor(),
								_props.isHighlighted
									? "inset 2px 0 0 var(--color-inferay-accent)"
									: undefined,
								_props.minWidth || "100%",
								_props.hideGutter &&
									(_props.gutterOffset === undefined ? 0 : _props.gutterOffset)
									? _props.gutterOffset === undefined
										? 0
										: _props.gutterOffset
									: undefined,
								hoverBg(),
							) as DiffRowStyle,
						)}
					>
						{!_props.hideGutter && <DiffGutterCells line={_props.line} />}

						<span
							{...stylex.attrs(diffStyles.content)}
							style={domStyle(
								inlineStyles.getDiffRowContentStyle(
									DIFF_CONFIG.contentFontSize,
									(
										_props.clipContent === undefined
											? false
											: _props.clipContent
									)
										? 0
										: undefined,
									_props.highlightedTokens
										? undefined
										: "var(--color-syntax-plain)",
								),
							)}
						>
							{_props.highlightedTokens ? (
								<For each={_props.highlightedTokens} keyed={false}>
									{(token, index) => (
										<span class={`syntax-${token().kind}`}>{token().text}</span>
									)}
								</For>
							) : (
								content()
							)}
						</span>
					</div>
				);
			})()}
		</>
	);
};
