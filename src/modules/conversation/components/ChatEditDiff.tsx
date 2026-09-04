import * as stylex from "@octanejs/stylex";
import { useMemo, useState } from "octane";
import {
	color,
	controlSize,
	font,
	iconSize,
	motion,
	radius,
} from "../../../design-system/styles.stylex.ts";
import {
	useShikiSnippet,
	useSyntaxHighlightTheme,
} from "../../../shared/hooks/useShikiHighlighter.tsx";
import { indexedValues } from "../../../shared/lib/indexed-values.ts";
import { IconChevronRight, IconFilePlus } from "../../../shared/ui/Icons.tsx";
import {
	applyEditsSequentially,
	type DiffHunk,
	type DiffLine,
	diffLineTextSegments,
	type LineTextSegment,
	summarizeDiff,
} from "../model/chat-edit-diff-utils.ts";
import { getEditToolPayload } from "../model/chat-message-render-utils.ts";

type EditMessage = {
	content: string;
	isStreaming?: boolean;
};

function EditDiffCard({
	fileName,
	filePath,
	hunks,
	isStreaming,
}: {
	fileName: string;
	filePath: string;
	hunks: DiffHunk[];
	isStreaming?: boolean;
}) {
	const changedHunks = useMemo(
		() =>
			hunks
				.map((hunk) => ({
					...hunk,
					lines: hunk.lines.filter((line) => line.type !== "context"),
				}))
				.filter((hunk) => hunk.lines.length > 0),
		[hunks],
	);
	const changedLines = useMemo(
		() => changedHunks.flatMap((hunk) => hunk.lines.map((line) => line.text)),
		[changedHunks],
	);
	const [syntaxTheme] = useSyntaxHighlightTheme();
	const { highlighted, isReady } = useShikiSnippet(
		changedLines,
		fileName,
		!isStreaming,
		syntaxTheme,
	);
	const [isExpanded, setIsExpanded] = useState(true);
	const [isScrollActive, setIsScrollActive] = useState(false);

	const removedBg =
		"color-mix(in srgb, var(--color-git-deleted) 12%, transparent)";
	const removedBorder =
		"color-mix(in srgb, var(--color-git-deleted) 42%, transparent)";
	const addedBg = "color-mix(in srgb, var(--color-git-added) 12%, transparent)";
	const addedBorder =
		"color-mix(in srgb, var(--color-git-added) 42%, transparent)";
	const lineLengths: number[] = [];
	for (const hunk of changedHunks) {
		for (const line of hunk.lines) {
			lineLengths.push(line.text.replace(/\t/g, "    ").length);
		}
	}
	const maxLineChars = Math.max(24, ...lineLengths);
	const contentWidth = `max(100%, ${maxLineChars + 10}ch)`;
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
					size={iconSize.sm}
					{...stylex.props(
						styles.chevron,
						isExpanded ? styles.chevronExpanded : null,
					)}
				/>
				{isStreaming ? (
					<span {...stylex.props(styles.streamingDot)} />
				) : (
					<IconFilePlus
						size={iconSize.sm}
						{...stylex.props(styles.headerIcon)}
					/>
				)}
				<span {...stylex.props(styles.fileName)} title={filePath}>
					{fileName}
				</span>
			</button>
			{isExpanded && (
				<div
					{...stylex.props(
						styles.body,
						isScrollActive && styles.bodyScrollActive,
					)}
					onPointerDown={() => setIsScrollActive(true)}
					onMouseLeave={() => setIsScrollActive(false)}
				>
					<div
						{...stylex.props(styles.bodyInner)}
						style={{ width: contentWidth }}
					>
						{indexedValues(changedHunks).map((hunkEntry) => {
							const hunk = hunkEntry.value;
							const segmentMap = buildChangedLineSegmentMap(hunk.lines);
							return (
								<div key={hunkEntry.index} {...stylex.props(styles.hunkBlock)}>
									{indexedValues(hunk.lines).map((lineEntry) => {
										const line = lineEntry.value;
										const lineIdx = lineEntry.index;
										const isRemoved = line.type === "removed";
										const isAdded = line.type === "added";
										const highlightedHtml = highlighted.get(globalLineIdx);
										const lineSegments = segmentMap.get(lineIdx);

										globalLineIdx++;

										const lineContent = lineSegments ? (
											<span {...stylex.props(styles.lineText)}>
												{indexedValues(lineSegments).map((segmentEntry) => (
													<span
														key={segmentEntry.index}
														{...stylex.props(
															segmentEntry.value.changed &&
																(isRemoved
																	? styles.inlineRemoved
																	: styles.inlineAdded),
														)}
													>
														{segmentEntry.value.text || " "}
													</span>
												))}
											</span>
										) : isReady && highlightedHtml ? (
											<span
												{...stylex.props(styles.lineText)}
												// biome-ignore lint/security/noDangerouslySetInnerHtml: useShikiSnippet returns Shiki-generated markup or HTML-escaped fallback text.
												dangerouslySetInnerHTML={{ __html: highlightedHtml }}
											/>
										) : (
											<span {...stylex.props(styles.lineText)}>
												{line.text || " "}
											</span>
										);

										return (
											<div
												key={`${hunkEntry.index}-${lineEntry.index}`}
												{...stylex.props(
													styles.diffLine,
													isRemoved && styles.removedLine,
													isAdded && styles.addedLine,
												)}
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
															: isAdded
																? "rgba(46,160,67,0.7)"
																: "rgba(255,255,255,0.22)",
													}}
												>
													{isRemoved ? "−" : isAdded ? "+" : " "}
												</span>
												<span {...stylex.props(styles.lineNumber)}>
													{isRemoved ? line.oldLineNum : line.newLineNum}
												</span>
												{lineContent}
											</div>
										);
									})}
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}

function buildChangedLineSegmentMap(lines: DiffLine[]) {
	const map = new Map<number, LineTextSegment[]>();
	let index = 0;

	while (index < lines.length) {
		if (lines[index]?.type === "context") {
			index++;
			continue;
		}

		const removed: Array<{ line: DiffLine; index: number }> = [];
		const added: Array<{ line: DiffLine; index: number }> = [];
		while (lines[index]?.type === "removed") {
			removed.push({ line: lines[index]!, index });
			index++;
		}
		while (lines[index]?.type === "added") {
			added.push({ line: lines[index]!, index });
			index++;
		}

		const pairCount = Math.min(removed.length, added.length);
		for (let pairIdx = 0; pairIdx < pairCount; pairIdx++) {
			const oldLine = removed[pairIdx]!;
			const newLine = added[pairIdx]!;
			const segments = diffLineTextSegments(
				oldLine.line.text,
				newLine.line.text,
			);
			map.set(oldLine.index, segments.oldSegments);
			map.set(newLine.index, segments.newSegments);
		}
	}

	return map;
}

const styles = stylex.create({
	card: {
		backgroundColor: color.transparent,
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		fontSize: font.size_2_75,
		overflow: "hidden",
	},
	header: {
		alignItems: "center",
		backgroundColor: color.transparent,
		color: {
			default: color.textSoft,
			":hover": color.textMain,
		},
		display: "flex",
		fontSize: font.size_2_75,
		fontWeight: font.weight_5,
		gap: "0.375rem",
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		textAlign: "left",
		transitionDuration: motion.durationBase,
		transitionProperty: "color, opacity",
		transitionTimingFunction: "ease",
		width: "100%",
		":hover": {
			opacity: 0.8,
		},
	},
	chevron: {
		opacity: 0.4,
		transitionDuration: motion.durationBase,
		transitionProperty: "transform",
		transitionTimingFunction: "ease",
	},
	chevronExpanded: {
		transform: "rotate(90deg)",
	},
	streamingDot: {
		backgroundColor: "currentColor",
		borderRadius: radius.pill,
		height: controlSize._2,
		opacity: 0.5,
		width: controlSize._2,
	},
	headerIcon: {
		opacity: 0.4,
	},
	fileName: {
		flex: 1,
		minWidth: controlSize._0,
		opacity: 0.8,
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	body: {
		cursor: "pointer",
		fontFamily: "var(--font-diff)",
		maxHeight: 240,
		overflow: "hidden",
	},
	bodyScrollActive: {
		cursor: "auto",
		overflow: "auto",
	},
	bodyInner: {
		minWidth: "100%",
	},
	hunkBlock: {
		minWidth: "100%",
	},
	diffLine: {
		display: "flex",
		lineHeight: "15px",
		minWidth: "100%",
		width: "100%",
	},
	removedLine: {
		color: "var(--color-git-deleted)",
	},
	addedLine: {
		color: "var(--color-git-added)",
	},
	sign: {
		flexShrink: 0,
		fontSize: font.size_2,
		textAlign: "center",
		userSelect: "none",
		width: controlSize._4,
	},
	lineNumber: {
		color: color.textFaint,
		flexShrink: 0,
		fontSize: font.size_1,
		paddingRight: controlSize._2,
		textAlign: "right",
		userSelect: "none",
		width: controlSize._6,
	},
	lineText: {
		color: color.textMain,
		flex: 1,
		fontSize: font.size_2,
		paddingRight: controlSize._2,
		whiteSpace: "pre",
	},
	inlineRemoved: {
		backgroundColor:
			"color-mix(in srgb, var(--color-git-deleted) 24%, transparent)",
		borderRadius: radius.xs,
		color: color.textMain,
	},
	inlineAdded: {
		backgroundColor:
			"color-mix(in srgb, var(--color-git-added) 24%, transparent)",
		borderRadius: radius.xs,
		color: color.textMain,
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
	const { hunks } = useMemo(() => {
		return summarizeDiff(oldStr, newStr, 0);
	}, [newStr, oldStr]);

	return (
		<EditDiffCard
			fileName={fileName}
			filePath={filePath}
			hunks={hunks}
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
	const isStreaming = edits.some((edit) => edit.isStreaming);
	const { hunks } = useMemo(() => {
		const parsedEdits: { old_string: string; new_string: string }[] = [];

		for (const edit of edits) {
			if (!edit.content) continue;
			const parsed = getEditToolPayload(edit.content);
			if (parsed) {
				parsedEdits.push({
					old_string: parsed.oldString,
					new_string: parsed.newString,
				});
			}
		}

		const result = applyEditsSequentially(parsedEdits);
		if (!result) {
			return {
				hunks: [],
			};
		}

		return summarizeDiff(result.originalText, result.finalText, 0);
	}, [edits]);

	if (hunks.length === 0) return null;

	return (
		<EditDiffCard
			fileName={fileName}
			filePath={filePath}
			hunks={hunks}
			isStreaming={isStreaming}
		/>
	);
}
