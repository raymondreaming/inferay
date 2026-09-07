import * as stylex from "@stylexjs/stylex";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onSettled,
} from "solid-js";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { useSyntaxHighlight } from "../../../../shared/hooks/useSyntaxHighlight.tsx";
import { domStyle } from "../../../../shared/lib/dom.tsx";
import {
	IconChevronRight,
	IconFilePlus,
} from "../../../../shared/ui/Icons/index.tsx";
import type { DiffHunk } from "../../hooks/useNativeEditDiff.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
export function EditDiffCard(_props: {
	fileName: string;
	filePath: string;
	hunks: DiffHunk[];
	isStreaming?: boolean;
	error?: string;
}) {
	const changedHunks = createMemo(() => _props.hunks);
	const changedLines = createMemo(() =>
		changedHunks().flatMap((hunk) => hunk.lines.map((line) => line.text)),
	);
	const [isExpanded, setIsExpanded] = createSignal(true);
	const _source = useSyntaxHighlight(() => ({
		filePath: _props.fileName,
		lines: changedLines(),
		enabled: !_props.isStreaming && isExpanded(),
	}));
	const [isScrollActive, setIsScrollActive] = createSignal(false);
	const removedBg =
		"color-mix(in srgb, var(--color-git-deleted) 12%, transparent)";
	const removedBorder =
		"color-mix(in srgb, var(--color-git-deleted) 42%, transparent)";
	const addedBg = "color-mix(in srgb, var(--color-git-added) 12%, transparent)";
	const addedBorder =
		"color-mix(in srgb, var(--color-git-added) 42%, transparent)";
	const maxLineChars = createMemo(() => {
		let max = 24;
		for (const line of changedLines())
			max = Math.max(max, line.replace(/\t/g, "    ").length);
		return Math.min(max, 8000);
	});
	const contentWidth = () => `max(100%, ${maxLineChars() + 10}ch)`;
	const [firstVisible, setFirstVisible] = createSignal(0);
	const scrollFrame = {
		current: null,
	} as {
		current: number | null;
	};
	onSettled(() => () => {
		if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
	});
	const virtual = createMemo(() => changedLines().length > 80);
	const startLine = createMemo(() =>
		virtual()
			? Math.max(0, Math.min(firstVisible(), changedLines().length - 1) - 8)
			: 0,
	);
	const endLine = createMemo(() => {
		const _changedLinesValue = changedLines();
		return virtual()
			? Math.min(_changedLinesValue.length, startLine() + 40)
			: _changedLinesValue.length;
	});
	const hunkOffsets = createMemo(() => {
		let offset = 0;
		return changedHunks().map((hunk) => {
			const start = offset;
			offset += hunk.lines.length;
			return start;
		});
	});
	return (
		<div {...stylex.attrs(styles.card)}>
			<button
				type="button"
				onClick={() => setIsExpanded(!isExpanded())}
				{...stylex.attrs(styles.header)}
				style={domStyle(
					inlineStyles.getEditDiffCardHeaderStyle(
						isExpanded()
							? "1px solid var(--color-inferay-gray-border)"
							: "none",
					),
				)}
			>
				<IconChevronRight
					size={iconSize.sm}
					{...stylex.attrs(
						styles.chevron,
						isExpanded() ? styles.chevronExpanded : null,
					)}
				/>
				{_props.isStreaming ? (
					<span {...stylex.attrs(styles.streamingDot)} />
				) : (
					<IconFilePlus
						size={iconSize.sm}
						{...stylex.attrs(styles.headerIcon)}
					/>
				)}
				<span {...stylex.attrs(styles.fileName)} title={_props.filePath}>
					{_props.fileName}
				</span>
			</button>
			{_props.error && (
				<div role="status" {...stylex.attrs(styles.lineText)}>
					{_props.error}
				</div>
			)}
			{isExpanded() && (
				<div
					{...stylex.attrs(
						styles.body,
						isScrollActive() && styles.bodyScrollActive,
					)}
					onScroll={(event) => {
						if (!virtual() || scrollFrame.current !== null) return;
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
						{...stylex.attrs(styles.bodyInner)}
						style={domStyle(
							inlineStyles.getEditDiffCardBodyInnerStyle(
								contentWidth(),
								startLine() * 15,
								(changedLines().length - endLine()) * 15,
							),
						)}
					>
						{
							<For each={changedHunks()} keyed={false}>
								{(hunk, hunkIndex) => (
									<>
										{(() => {
											const offset = createMemo(
												() => hunkOffsets()[hunkIndex]!,
											);
											if (
												offset() >= endLine() ||
												offset() + hunk().lines.length <= startLine()
											)
												return null;
											const rowStart = createMemo(() =>
												Math.max(0, startLine() - offset()),
											);
											const rowEnd = createMemo(() =>
												Math.min(hunk().lines.length, endLine() - offset()),
											);
											return (
												<div {...stylex.attrs(styles.hunkBlock)}>
													{
														<For
															each={hunk().lines.slice(rowStart(), rowEnd())}
															keyed={false}
														>
															{(line, lineIndex) => (
																<>
																	{(() => {
																		const globalLineIdx = createMemo(
																			() => offset() + rowStart() + lineIndex,
																		);
																		if (
																			globalLineIdx() < startLine() ||
																			globalLineIdx() >= endLine()
																		)
																			return null;
																		const isRemoved = createMemo(
																			() => line().type === "removed",
																		);
																		const isAdded = createMemo(
																			() => line().type === "added",
																		);
																		const highlightedTokens = createMemo(() =>
																			_source.getLineTokens(globalLineIdx()),
																		);
																		const lineSegments = createMemo(
																			() => line().segments,
																		);
																		return (
																			<div
																				data-edit-diff-line={globalLineIdx()}
																				{...stylex.attrs(
																					styles.diffLine,
																					isRemoved() && styles.removedLine,
																					isAdded() && styles.addedLine,
																				)}
																				style={domStyle(
																					inlineStyles.getEditDiffCardDiffLineStyle(
																						isRemoved()
																							? removedBg
																							: isAdded()
																								? addedBg
																								: "transparent",
																						`2px solid ${isRemoved() ? removedBorder : isAdded() ? addedBorder : "transparent"}`,
																					),
																				)}
																			>
																				<span
																					{...stylex.attrs(styles.sign)}
																					style={domStyle(
																						inlineStyles.getEditDiffCardSignStyle(
																							isRemoved()
																								? "rgba(248,81,73,0.7)"
																								: isAdded()
																									? "rgba(46,160,67,0.7)"
																									: "rgba(255,255,255,0.22)",
																						),
																					)}
																				>
																					{isRemoved()
																						? "−"
																						: isAdded()
																							? "+"
																							: " "}
																				</span>
																				<span
																					{...stylex.attrs(styles.lineNumber)}
																				>
																					{isRemoved()
																						? line().oldLineNum
																						: line().newLineNum}
																				</span>
																				{lineSegments() ? (
																					<span
																						{...stylex.attrs(styles.lineText)}
																					>
																						{
																							<For
																								each={lineSegments()}
																								keyed={false}
																							>
																								{(segment, segmentIndex) => (
																									<span
																										{...stylex.attrs(
																											segment().changed &&
																												(isRemoved()
																													? styles.inlineRemoved
																													: styles.inlineAdded),
																										)}
																									>
																										{segment().text || " "}
																									</span>
																								)}
																							</For>
																						}
																					</span>
																				) : _source.isReady &&
																					highlightedTokens()?.length ? (
																					<span
																						{...stylex.attrs(styles.lineText)}
																					>
																						{
																							<For
																								each={highlightedTokens()}
																								keyed={false}
																							>
																								{(token, tokenIndex) => (
																									<span
																										class={`syntax-${token().kind}`}
																									>
																										{token().text}
																									</span>
																								)}
																							</For>
																						}
																					</span>
																				) : (
																					<span
																						{...stylex.attrs(styles.lineText)}
																					>
																						{line().text || " "}
																					</span>
																				)}
																			</div>
																		);
																	})()}
																</>
															)}
														</For>
													}
												</div>
											);
										})()}
									</>
								)}
							</For>
						}
					</div>
				</div>
			)}
		</div>
	);
}
