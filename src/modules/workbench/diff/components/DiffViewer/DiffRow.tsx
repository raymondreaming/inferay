import * as stylex from "@octanejs/stylex";
import { memo } from "octane";
import type { CSSProperties } from "react";
import type { SyntaxToken } from "../../../../../shared/hooks/useSyntaxHighlight.tsx";
import type { DiffLine } from "../../../../repository/model/types.ts";
import {
	DIFF_CONFIG,
	LINE_H,
	MAX_RENDERED_LINE_CHARS,
} from "../../../model/workbench-model.ts";
import { DiffGutterCells } from "./DiffGutterCells.tsx";
import * as inlineStyles from "./styles.ts";
import { diffStyles } from "./styles.ts";

type DiffRowStyle = CSSProperties & { "--hover-bg"?: string };

function getDiffRowBg(line: DiffLine, isHighlighted?: boolean) {
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

export const DiffRow = memo(function DiffRow({
	clipContent = false,
	line,
	highlightedTokens,
	isHighlighted,
	minWidth,
	hideGutter,
	gutterOffset = 0,
}: {
	clipContent?: boolean;
	line: DiffLine;
	highlightedTokens?: SyntaxToken[];
	isHighlighted?: boolean;
	minWidth?: number;
	hideGutter?: boolean;
	gutterOffset?: number;
}) {
	if (line.type === "hunk") {
		return (
			<div
				{...stylex.props(diffStyles.hunkSeparator)}
				style={inlineStyles.getDiffRowHunkSeparatorStyle(
					minWidth || "100%",
					hideGutter ? gutterOffset + 8 : undefined,
				)}
			>
				<span {...stylex.props(diffStyles.hunkText)}>{line.content}</span>
			</div>
		);
	}

	if (line.type === "spacer") {
		return (
			<div
				{...stylex.props(diffStyles.spacer)}
				style={inlineStyles.getDiffRowSpacerStyle(minWidth || "100%")}
			/>
		);
	}

	const isAdd = line.type === "add";
	const isRemove = line.type === "remove";
	const hoverBg = isAdd
		? DIFF_CONFIG.addBgHover
		: isRemove
			? DIFF_CONFIG.removeBgHover
			: undefined;
	const bgColor = getDiffRowBg(line, isHighlighted);

	const rowProps = stylex.props(diffStyles.row);
	const content =
		line.content.length > MAX_RENDERED_LINE_CHARS
			? `${line.content.slice(0, MAX_RENDERED_LINE_CHARS)} ... [line truncated for display]`
			: line.content;
	const lineContent = highlightedTokens
		? highlightedTokens.map((token, index) => (
				<span key={`${index}-${token.text}`} className={`syntax-${token.kind}`}>
					{token.text}
				</span>
			))
		: content;

	return (
		<div
			{...rowProps}
			className={`diff-row ${rowProps.className ?? ""}`}
			style={
				inlineStyles.getDiffRowDivStyle(
					`${LINE_H}px`,
					bgColor,
					isHighlighted
						? "inset 2px 0 0 var(--color-inferay-accent)"
						: undefined,
					minWidth || "100%",
					hideGutter && gutterOffset ? gutterOffset : undefined,
					hoverBg,
				) as DiffRowStyle
			}
		>
			{!hideGutter && <DiffGutterCells line={line} />}

			<span
				{...stylex.props(diffStyles.content)}
				style={inlineStyles.getDiffRowContentStyle(
					DIFF_CONFIG.contentFontSize,
					clipContent ? 0 : undefined,
					highlightedTokens ? undefined : "#f2f4f7",
				)}
			>
				{lineContent}
			</span>
		</div>
	);
});
