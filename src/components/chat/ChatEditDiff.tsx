import * as stylex from "@stylexjs/stylex";
import { useMemo, useState } from "react";
import { useShikiSnippet } from "../../hooks/useShikiHighlighter.ts";
import { contentOf } from "../../lib/data.ts";
import { color, controlSize, font } from "../../tokens.stylex.ts";
import { IconChevronRight, IconFilePlus } from "../ui/Icons.tsx";
import {
	applyEditsSequentially,
	computeDiffHunks,
	type DiffLine,
	summarizeHunks,
} from "./chat-edit-diff-utils.ts";

type EditMessage = {
	content: string;
};

function EditDiffCard({
	fileName,
	hunks,
	stats,
	allLines,
	isStreaming,
}: {
	fileName: string;
	hunks: DiffLine[][];
	stats: { added: number; removed: number };
	allLines: string[];
	isStreaming?: boolean;
}) {
	const { highlighted, isReady } = useShikiSnippet(allLines, fileName, true);
	const [isExpanded, setIsExpanded] = useState(true);

	const removedBg = "rgba(248,81,73,0.08)";
	const removedBorder = "rgba(248,81,73,0.32)";
	const addedBg = "rgba(46,160,67,0.08)";
	const addedBorder = "rgba(46,160,67,0.32)";
	let globalLineIdx = 0;

	return (
		<div {...stylex.props(styles.card)}>
			<button
				type="button"
				onClick={() => setIsExpanded(!isExpanded)}
				{...stylex.props(styles.header)}
				style={{
					borderBottom: isExpanded
						? "1px solid var(--color-inferay-gray-border)"
						: "none",
				}}
			>
				<IconChevronRight
					size={10}
					{...stylex.props(
						styles.chevron,
						isExpanded ? styles.chevronExpanded : null
					)}
				/>
				{isStreaming ? (
					<span {...stylex.props(styles.streamingDot)} />
				) : (
					<IconFilePlus size={10} {...stylex.props(styles.headerIcon)} />
				)}
				<span {...stylex.props(styles.fileName)}>{fileName}</span>
				<span {...stylex.props(styles.stats)}>
					{stats.added > 0 && (
						<span {...stylex.props(styles.addedStat)}>+{stats.added}</span>
					)}
					{stats.removed > 0 && (
						<span {...stylex.props(styles.removedStat)}>−{stats.removed}</span>
					)}
				</span>
			</button>
			{isExpanded && (
				<div {...stylex.props(styles.body)}>
					{hunks.map((hunk, hunkIdx) => {
						let hunkLineIdx = globalLineIdx;
						const changedLines = hunk.filter(
							(line) => line.type !== "context" && line.text.trim() !== ""
						);

						return (
							<div key={hunkIdx}>
								{hunkIdx > 0 && <div {...stylex.props(styles.hunkDivider)} />}
								{changedLines.map((line, lineIdx) => {
									const currentLineIdx = hunkLineIdx++;
									const highlightedHtml = highlighted.get(currentLineIdx);
									const isRemoved = line.type === "removed";
									const isAdded = line.type === "added";

									if (
										hunkIdx === hunks.length - 1 &&
										lineIdx === changedLines.length - 1
									) {
										globalLineIdx = currentLineIdx + 1;
									}

									const lineContent =
										isReady && highlightedHtml ? (
											<span
												{...stylex.props(styles.lineText)}
												// biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki returns escaped syntax-highlighted HTML.
												dangerouslySetInnerHTML={{ __html: highlightedHtml }}
											/>
										) : (
											<span {...stylex.props(styles.lineText)}>
												{line.text || " "}
											</span>
										);

									return (
										<div
											key={`${hunkIdx}-${lineIdx}`}
											{...stylex.props(styles.diffLine)}
											style={{
												backgroundColor: isRemoved
													? removedBg
													: isAdded
														? addedBg
														: "transparent",
												borderLeft: `2px solid ${isRemoved ? removedBorder : isAdded ? addedBorder : "transparent"}`,
											}}
										>
											<span
												{...stylex.props(styles.sign)}
												style={{
													color: isRemoved
														? "rgba(248,81,73,0.7)"
														: "rgba(46,160,67,0.7)",
												}}
											>
												{isRemoved ? "−" : "+"}
											</span>
											{lineContent}
										</div>
									);
								})}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

const styles = stylex.create({
	card: {
		backgroundColor: color.backgroundRaised,
		borderColor: color.border,
		borderRadius: 8,
		borderStyle: "solid",
		borderWidth: 1,
		fontSize: "0.6875rem",
		overflow: "hidden",
	},
	header: {
		alignItems: "center",
		backgroundColor: color.backgroundRaised,
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
		display: "flex",
		fontSize: "0.6875rem",
		fontWeight: font.weight_5,
		gap: "0.375rem",
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		textAlign: "left",
		transitionDuration: "150ms",
		transitionProperty: "color, opacity",
		transitionTimingFunction: "ease",
		width: "100%",
		":hover": {
			opacity: 0.8,
		},
	},
	chevron: {
		opacity: 0.4,
		transitionDuration: "150ms",
		transitionProperty: "transform",
		transitionTimingFunction: "ease",
	},
	chevronExpanded: {
		transform: "rotate(90deg)",
	},
	streamingDot: {
		backgroundColor: "currentColor",
		borderRadius: 999,
		height: controlSize._2,
		opacity: 0.5,
		width: controlSize._2,
	},
	headerIcon: {
		opacity: 0.4,
	},
	fileName: {
		flex: 1,
		minWidth: 0,
		opacity: 0.8,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	stats: {
		alignItems: "center",
		display: "flex",
		fontSize: font.size_2,
		gap: controlSize._1,
	},
	addedStat: {
		color: "rgba(46,160,67,0.68)",
	},
	removedStat: {
		color: "rgba(248,81,73,0.68)",
	},
	body: {
		fontFamily: "var(--font-diff)",
		maxHeight: 240,
		overflow: "auto",
	},
	hunkDivider: {
		backgroundColor: color.border,
		height: 1,
		marginBlock: "0.125rem",
		opacity: 0.3,
	},
	diffLine: {
		display: "flex",
		lineHeight: "15px",
		minWidth: "100%",
		width: "fit-content",
	},
	sign: {
		flexShrink: 0,
		fontSize: font.size_2,
		textAlign: "center",
		userSelect: "none",
		width: controlSize._5,
	},
	lineText: {
		color: color.textMain,
		flex: 1,
		fontSize: font.size_2,
		paddingRight: controlSize._2,
		whiteSpace: "pre",
	},
});

export function MiniEditDiff({
	oldStr,
	newStr,
	filePath,
	isStreaming,
}: {
	oldStr: string;
	newStr: string;
	filePath: string;
	isStreaming?: boolean;
}) {
	const fileName = filePath.split("/").pop() || filePath;
	const { hunks, stats, allLines } = useMemo(() => {
		return summarizeHunks(computeDiffHunks(oldStr, newStr, 1));
	}, [newStr, oldStr]);

	return (
		<EditDiffCard
			key={`${filePath}:${oldStr}:${newStr}:${isStreaming ? "streaming" : "done"}`}
			fileName={fileName}
			hunks={hunks}
			stats={stats}
			allLines={allLines}
			isStreaming={isStreaming}
		/>
	);
}

export function GroupedEditDiff({
	filePath,
	edits,
}: {
	filePath: string;
	edits: EditMessage[];
}) {
	const fileName = filePath.split("/").pop() || filePath;
	const { hunks, stats, allLines } = useMemo(() => {
		const parsedEdits: { old_string: string; new_string: string }[] = [];

		for (const edit of edits) {
			if (!edit.content) continue;
			try {
				const parsed = JSON.parse(edit.content);
				if (
					parsed.old_string !== undefined &&
					parsed.new_string !== undefined
				) {
					parsedEdits.push({
						old_string: parsed.old_string,
						new_string: parsed.new_string,
					});
				}
			} catch {}
		}

		const result = applyEditsSequentially(parsedEdits);
		if (!result) {
			return { hunks: [], stats: { added: 0, removed: 0 }, allLines: [] };
		}

		return summarizeHunks(
			computeDiffHunks(result.originalText, result.finalText, 1)
		);
	}, [edits]);

	if (hunks.length === 0) return null;

	return (
		<EditDiffCard
			key={`${filePath}:${edits.length}:${edits.map(contentOf).join("\u0000")}`}
			fileName={fileName}
			hunks={hunks}
			stats={stats}
			allLines={allLines}
		/>
	);
}
