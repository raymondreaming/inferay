import * as stylex from "@octanejs/stylex";
import { useEffect, useMemo, useRef, useState } from "octane";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { useSyntaxHighlight } from "../../../../shared/hooks/useSyntaxHighlight.tsx";
import {
	IconChevronRight,
	IconFilePlus,
} from "../../../../shared/ui/Icons/index.tsx";
import type { DiffHunk } from "../../hooks/useNativeEditDiff.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

export function EditDiffCard({
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
	const { getLineTokens, isReady } = useSyntaxHighlight({
		filePath: fileName,
		lines: changedLines,
		enabled: !isStreaming && isExpanded,
	});
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
				style={inlineStyles.getEditDiffCardHeaderStyle(
					isExpanded ? "1px solid var(--color-inferay-gray-border)" : "none",
				)}
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
						style={inlineStyles.getEditDiffCardBodyInnerStyle(
							contentWidth,
							startLine * 15,
							(changedLines.length - endLine) * 15,
						)}
					>
						{changedHunks.map((hunk, hunkIndex) => {
							const offset = hunkOffsets[hunkIndex]!;
							if (offset >= endLine || offset + hunk.lines.length <= startLine)
								return null;
							const rowStart = Math.max(0, startLine - offset);
							const rowEnd = Math.min(hunk.lines.length, endLine - offset);
							return (
								<div key={hunkIndex} {...stylex.props(styles.hunkBlock)}>
									{hunk.lines.slice(rowStart, rowEnd).map((line, lineIndex) => {
										const globalLineIdx = offset + rowStart + lineIndex;
										if (globalLineIdx < startLine || globalLineIdx >= endLine)
											return null;
										const isRemoved = line.type === "removed";
										const isAdded = line.type === "added";
										const highlightedTokens = getLineTokens(globalLineIdx);
										const lineSegments = line.segments;

										const lineContent = lineSegments ? (
											<span {...stylex.props(styles.lineText)}>
												{lineSegments.map((segment, segmentIndex) => (
													<span
														key={segmentIndex}
														{...stylex.props(
															segment.changed &&
																(isRemoved
																	? styles.inlineRemoved
																	: styles.inlineAdded),
														)}
													>
														{segment.text || " "}
													</span>
												))}
											</span>
										) : isReady && highlightedTokens?.length ? (
											<span {...stylex.props(styles.lineText)}>
												{highlightedTokens.map((token, tokenIndex) => (
													<span
														key={tokenIndex}
														className={`syntax-${token.kind}`}
													>
														{token.text}
													</span>
												))}
											</span>
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
												style={inlineStyles.getEditDiffCardDiffLineStyle(
													isRemoved
														? removedBg
														: isAdded
															? addedBg
															: "transparent",
													`2px solid ${isRemoved ? removedBorder : isAdded ? addedBorder : "transparent"}`,
												)}
											>
												<span
													{...stylex.props(styles.sign)}
													style={inlineStyles.getEditDiffCardSignStyle(
														isRemoved
															? "rgba(248,81,73,0.7)"
															: isAdded
																? "rgba(46,160,67,0.7)"
																: "rgba(255,255,255,0.22)",
													)}
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
