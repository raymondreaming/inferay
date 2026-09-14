import type { EditDiffWindow, PreparedEditDiff } from "@contracts";
import { iconSize } from "@design-system/styles.stylex.ts";
import { useSyntaxHighlight } from "@shared/hooks/useSyntaxHighlight.tsx";
import { domStyle } from "@shared/lib/dom.tsx";
import { project } from "@shared/lib/native.tsx";
import { IconChevronRight, IconFilePlus } from "@shared/ui/Icons/index.tsx";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, onSettled } from "solid-js";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
export function EditDiffCard(_props: {
	filePath: string;
	prepared: PreparedEditDiff;
	isStreaming?: boolean;
	error?: string;
}) {
	const fileName = () => _props.filePath.split("/").pop() || _props.filePath;
	const [isExpanded, setIsExpanded] = createSignal(true);
	const _source = useSyntaxHighlight(() => ({
		filePath: fileName(),
		lines: _props.prepared.lines.map((line) => line.text),
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
	const [firstVisible, setFirstVisible] = createSignal(0);
	const scrollFrame = {
		current: null,
	} as {
		current: number | null;
	};
	onSettled(() => () => {
		if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
	});
	const window = createMemo(() =>
		project<EditDiffWindow>("editDiffWindow", {
			count: _props.prepared.lineCount,
			virtualized: _props.prepared.virtualized,
			first: firstVisible(),
		}),
	);
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
					{fileName()}
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
						if (!window().virtual || scrollFrame.current !== null) return;
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
								`max(100%, ${_props.prepared.contentWidthChars}ch)`,
								window().paddingTop,
								window().paddingBottom,
							),
						)}
					>
						<For
							each={_props.prepared.lines.slice(window().start, window().end)}
							keyed={false}
						>
							{(line, lineIndex) => {
								const globalLineIdx = () => window().start + lineIndex;
								const isRemoved = createMemo(() => line().type === "remove");
								const isAdded = createMemo(() => line().type === "add");
								const highlightedTokens = createMemo(() =>
									_source.getLineTokens(globalLineIdx()),
								);
								const lineSegments = createMemo(() => line().segments);
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
											{isRemoved() ? "−" : isAdded() ? "+" : " "}
										</span>
										<span {...stylex.attrs(styles.lineNumber)}>
											{isRemoved() ? line().oldLineNum : line().newLineNum}
										</span>
										{lineSegments() ? (
											<span {...stylex.attrs(styles.lineText)}>
												{
													<For each={lineSegments()} keyed={false}>
														{(segment) => (
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
										) : _source.isReady && highlightedTokens()?.length ? (
											<span {...stylex.attrs(styles.lineText)}>
												{
													<For each={highlightedTokens()} keyed={false}>
														{(token) => (
															<span class={`syntax-${token().kind}`}>
																{token().text}
															</span>
														)}
													</For>
												}
											</span>
										) : (
											<span {...stylex.attrs(styles.lineText)}>
												{line().text || " "}
											</span>
										)}
									</div>
								);
							}}
						</For>
					</div>
				</div>
			)}
		</div>
	);
}
