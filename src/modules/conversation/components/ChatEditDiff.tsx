import * as stylex from "@octanejs/stylex";
import { useEffect, useMemo, useRef, useState } from "octane";
import {
	color,
	controlSize,
	font,
	iconSize,
	motion,
	radius,
} from "../../../design-system/styles.stylex.ts";
import { useNearViewport } from "../../../shared/hooks/useNearViewport.tsx";
import {
	useShikiSnippet,
	useSyntaxHighlightTheme,
} from "../../../shared/hooks/useShikiHighlighter.tsx";
import { indexedValues } from "../../../shared/lib/indexed-values.ts";
import { IconChevronRight, IconFilePlus } from "../../../shared/ui/Icons.tsx";
import {
	type DiffHunk,
	useNativeEditDiff,
} from "../hooks/useNativeEditDiff.tsx";
import { getEditToolPayload } from "../model/chat-message-render-utils.ts";

type EditMessage = {
	content: string;
	render?: { toolInput?: Record<string, unknown> | null };
	isStreaming?: boolean;
};

function EditDiffCard({
	fileName,
	filePath,
	hunks,
	isStreaming,
	error,
}: {
	fileName: string;
	filePath: string;
	hunks: DiffHunk[];
	isStreaming?: boolean;
	error?: string;
}) {
	const changedHunks = hunks;
	const changedLines = useMemo(
		() => changedHunks.flatMap((hunk) => hunk.lines.map((line) => line.text)),
		[changedHunks],
	);
	const [isExpanded, setIsExpanded] = useState(true);
	const [syntaxTheme] = useSyntaxHighlightTheme();
	const { highlighted, isReady } = useShikiSnippet(
		changedLines,
		fileName,
		!isStreaming && isExpanded,
		syntaxTheme,
	);
	const [isScrollActive, setIsScrollActive] = useState(false);

	const removedBg =
		"color-mix(in srgb, var(--color-git-deleted) 12%, transparent)";
	const removedBorder =
		"color-mix(in srgb, var(--color-git-deleted) 42%, transparent)";
	const addedBg = "color-mix(in srgb, var(--color-git-added) 12%, transparent)";
	const addedBorder =
		"color-mix(in srgb, var(--color-git-added) 42%, transparent)";
	const maxLineChars = useMemo(() => {
		let max = 24;
		for (const line of changedLines)
			max = Math.max(max, line.replace(/\t/g, "    ").length);
		return Math.min(max, 8000);
	}, [changedLines]);

	const contentWidth = `max(100%, ${maxLineChars + 10}ch)`;
	const [firstVisible, setFirstVisible] = useState(0);
	const scrollFrame = useRef<number | null>(null);
	useEffect(
		() => () => {
			if (scrollFrame.current !== null)
				cancelAnimationFrame(scrollFrame.current);
		},
		[],
	);
	const virtual = changedLines.length > 80;
	const startLine = virtual
		? Math.max(0, Math.min(firstVisible, changedLines.length - 1) - 8)
		: 0;
	const endLine = virtual
		? Math.min(changedLines.length, startLine + 40)
		: changedLines.length;
	const hunkOffsets = useMemo(() => {
		let offset = 0;
		return changedHunks.map((hunk) => {
			const start = offset;
			offset += hunk.lines.length;
			return start;
		});
	}, [changedHunks]);

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
			{error && (
				<div role="status" {...stylex.props(styles.lineText)}>
					{error}
				</div>
			)}
			{isExpanded && (
				<div
					{...stylex.props(
						styles.body,
						isScrollActive && styles.bodyScrollActive,
					)}
					onScroll={(event) => {
						if (!virtual || scrollFrame.current !== null) return;
						const element = event.currentTarget;
						scrollFrame.current = requestAnimationFrame(() => {
							scrollFrame.current = null;
							setFirstVisible(Math.floor(element.scrollTop / 15));
						});
					}}
					onPointerDown={() => setIsScrollActive(true)}
					onMouseLeave={() => setIsScrollActive(false)}
				>
					<div
						{...stylex.props(styles.bodyInner)}
						style={{
							width: contentWidth,
							paddingTop: startLine * 15,
							paddingBottom: (changedLines.length - endLine) * 15,
						}}
					>
						{indexedValues(changedHunks).map((hunkEntry) => {
							const hunk = hunkEntry.value;
							const offset = hunkOffsets[hunkEntry.index]!;
							if (offset >= endLine || offset + hunk.lines.length <= startLine)
								return null;
							const rowStart = Math.max(0, startLine - offset);
							const rowEnd = Math.min(hunk.lines.length, endLine - offset);
							return (
								<div key={hunkEntry.index} {...stylex.props(styles.hunkBlock)}>
									{indexedValues(hunk.lines.slice(rowStart, rowEnd)).map(
										(lineEntry) => {
											const globalLineIdx = offset + rowStart + lineEntry.index;
											if (globalLineIdx < startLine || globalLineIdx >= endLine)
												return null;
											const line = lineEntry.value;
											const isRemoved = line.type === "removed";
											const isAdded = line.type === "added";
											const highlightedHtml = highlighted.get(globalLineIdx);
											const lineSegments = line.segments;

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
													key={globalLineIdx}
													data-edit-diff-line={globalLineIdx}
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
										},
									)}
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
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
	const { ref, visible } = useNearViewport();
	const { hunks, loading, error } = useNativeEditDiff(
		oldStr,
		newStr,
		isStreaming || !visible,
	);

	return (
		<div ref={ref} style={{ minHeight: hunks.length ? undefined : 28 }}>
			<EditDiffCard
				fileName={fileName}
				filePath={filePath}
				hunks={hunks}
				error={error}
				isStreaming={isStreaming || loading || !visible}
			/>
		</div>
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
	const { ref, visible } = useNearViewport();
	const isStreaming = edits.some((edit) => edit.isStreaming);
	const parsedEdits = useMemo(() => {
		const parsedEdits: { old_string: string; new_string: string }[] = [];

		for (const edit of edits) {
			if (!edit.content) continue;
			const parsed = getEditToolPayload(edit.content, edit.render?.toolInput);
			if (parsed) {
				parsedEdits.push({
					old_string: parsed.oldString,
					new_string: parsed.newString,
				});
			}
		}

		return parsedEdits;
	}, [edits]);
	const { hunks, loading, error } = useNativeEditDiff(
		"",
		"",
		isStreaming || !visible,
		parsedEdits,
	);

	const showCard =
		hunks.length > 0 || loading || error || isStreaming || !visible;
	return (
		<div
			ref={ref}
			style={{ minHeight: showCard && !hunks.length ? 28 : undefined }}
		>
			{showCard && (
				<EditDiffCard
					fileName={fileName}
					filePath={filePath}
					hunks={hunks}
					error={error}
					isStreaming={isStreaming || loading || !visible}
				/>
			)}
		</div>
	);
}
