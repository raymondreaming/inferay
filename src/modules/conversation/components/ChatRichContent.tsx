import * as stylex from "@octanejs/stylex";
import {
	Fragment,
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "octane";
import {
	color,
	controlSize,
	font,
	iconSize,
	motion,
	radius,
} from "../../../design-system/styles.stylex.ts";
import { useNativeMarkdown } from "../../../shared/hooks/useNativeMarkdown.tsx";
import { noop } from "../../../shared/lib/data.ts";
import { indexedValues } from "../../../shared/lib/indexed-values.ts";
import type { MdBlock, MdInlineToken } from "../../../shared/lib/markdown.ts";
import {
	IconCheck,
	IconCopy,
	IconHelpCircle,
	IconSend,
} from "../../../shared/ui/Icons.tsx";
import type { AskUserQuestion } from "../model/agent-chat-shared.ts";
import {
	formatAskUserAnswer,
	hasAskUserSelections,
	parseAskUserQuestions,
} from "../model/chat-message-render-utils.ts";

function findParentScrollContainer(
	node: HTMLElement | null,
): HTMLElement | null {
	let current = node?.parentElement ?? null;
	while (current) {
		const style = window.getComputedStyle(current);
		const canScrollY =
			(style.overflowY === "auto" || style.overflowY === "scroll") &&
			current.scrollHeight > current.clientHeight;
		if (canScrollY) return current;
		current = current.parentElement;
	}
	return null;
}

export function CopyButton({
	text,
	className,
}: {
	text: string;
	className?: string;
}) {
	const [copied, setCopied] = useState(false);
	const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
		},
		[],
	);

	const handleCopy = useCallback(() => {
		navigator.clipboard
			.writeText(text)
			.then(() => {
				setCopied(true);
				if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
				copiedTimerRef.current = setTimeout(() => {
					copiedTimerRef.current = null;
					setCopied(false);
				}, 1500);
			})
			.catch(noop);
	}, [text]);
	const copyButtonProps = stylex.props(
		styles.copyButton,
		copied ? styles.copyButtonCopied : null,
	);

	return (
		<button
			type="button"
			onClick={handleCopy}
			{...copyButtonProps}
			className={`${copyButtonProps.className ?? ""} ${className ?? ""}`}
			title={copied ? "Copied!" : "Copy"}
		>
			{copied ? (
				<IconCheck size={iconSize.sm} />
			) : (
				<IconCopy size={iconSize.sm} />
			)}
		</button>
	);
}

function CopyablePre({ text, preStyle }: { text: string; preStyle: unknown }) {
	return (
		<div {...stylex.props(styles.codeWrap)}>
			<pre {...stylex.props(preStyle as never)}>{text}</pre>
			<div {...stylex.props(styles.copyOverlay)}>
				<CopyButton text={text} />
			</div>
		</div>
	);
}

const Inline = memo(function Inline({
	tokens,
	onMdFileClick,
}: {
	tokens: MdInlineToken[];
	onMdFileClick?: (path: string) => void;
}) {
	return (
		<>
			{tokens.map((token, index) => {
				const children = token.children ? (
					<Inline
						key={index}
						tokens={token.children}
						onMdFileClick={onMdFileClick}
					/>
				) : (
					token.text
				);
				switch (token.type) {
					case "code":
						return (
							<code key={index} {...stylex.props(styles.inlineCode)}>
								{token.text}
							</code>
						);
					case "bold":
						return (
							<strong key={index} {...stylex.props(styles.strong)}>
								{children}
							</strong>
						);
					case "italic":
						return (
							<em key={index} {...stylex.props(styles.em)}>
								{children}
							</em>
						);
					case "bold-italic":
						return (
							<strong key={index} {...stylex.props(styles.strong)}>
								<em>{children}</em>
							</strong>
						);
					case "strikethrough":
						return <del key={index}>{children}</del>;
					case "linebreak":
						return <br key={index} />;
					case "image":
						return (
							<img
								key={index}
								src={token.href}
								alt={token.alt ?? token.text}
								style={{ maxWidth: "100%" }}
							/>
						);
					case "markdown_path":
						if (onMdFileClick)
							return (
								<button
									key={index}
									type="button"
									onClick={() => onMdFileClick(token.text)}
									{...stylex.props(styles.inlinePathButton)}
								>
									{token.text}
								</button>
							);
						return <Fragment key={index}>{token.text}</Fragment>;
					case "link":
					case "url":
						return (
							<a
								key={index}
								href={token.href}
								target="_blank"
								rel="noopener noreferrer"
								{...stylex.props(
									token.type === "url" ? styles.linkUnderlined : styles.link,
								)}
							>
								{children}
							</a>
						);
					default:
						return <Fragment key={index}>{token.text}</Fragment>;
				}
			})}
		</>
	);
});

function MarkdownBlocks({
	blocks,
	onMdFileClick,
	onTableWheel,
}: {
	blocks: MdBlock[];
	onMdFileClick?: (path: string) => void;
	onTableWheel: (event: WheelEvent & { currentTarget: HTMLDivElement }) => void;
}) {
	return (
		<>
			{indexedValues(blocks).map(({ index, value: block }) => {
				switch (block.type) {
					case "code":
					case "mermaid":
						return (
							<CopyablePre
								key={index}
								text={block.content}
								preStyle={styles.codeBlock}
							/>
						);
					case "heading":
						return (
							<p key={index} {...stylex.props(styles.heading)}>
								<Inline
									tokens={block.tokens ?? []}
									onMdFileClick={onMdFileClick}
								/>
							</p>
						);
					case "hr":
						return <hr key={index} />;
					case "blockquote":
						return (
							<blockquote key={index}>
								<MarkdownBlocks
									blocks={block.children ?? []}
									onMdFileClick={onMdFileClick}
									onTableWheel={onTableWheel}
								/>
							</blockquote>
						);
					case "ul":
					case "ol":
					case "checklist":
						return (
							<div key={index}>
								{indexedValues(block.items ?? []).map(
									({ index: itemIndex, value: item }) => (
										<div
											key={itemIndex}
											{...stylex.props(styles.listItem)}
											style={{ paddingLeft: item.indent * 4 }}
										>
											<span {...stylex.props(styles.listBullet)}>
												{item.checked !== undefined
													? item.checked
														? "✓"
														: "□"
													: block.type === "ol"
														? (item.bullet ?? `${itemIndex + 1}.`)
														: (item.bullet ?? "-")}
											</span>
											<span {...stylex.props(styles.listContent)}>
												<Inline
													tokens={item.tokens}
													onMdFileClick={onMdFileClick}
												/>
											</span>
										</div>
									),
								)}
							</div>
						);
					case "table": {
						const [headers = [], ...rows] = block.rows ?? [];
						return (
							<div
								key={index}
								{...stylex.props(styles.tableWrap)}
								onWheel={onTableWheel}
							>
								<table {...stylex.props(styles.table)}>
									<thead>
										<tr>
											{indexedValues(headers).map(
												({ index: cellIndex, value: cell }) => (
													<th
														key={cellIndex}
														{...stylex.props(styles.tableHeadCell)}
													>
														<Inline
															tokens={cell}
															onMdFileClick={onMdFileClick}
														/>
													</th>
												),
											)}
										</tr>
									</thead>
									<tbody>
										{indexedValues(rows).map(
											({ index: rowIndex, value: row }) => (
												<tr key={rowIndex}>
													{indexedValues(row).map(
														({ index: cellIndex, value: cell }) => (
															<td
																key={cellIndex}
																{...stylex.props(styles.tableCell)}
																style={{
																	borderBottom:
																		rowIndex < rows.length - 1
																			? "1px solid var(--color-inferay-gray-border)"
																			: "none",
																	color: "var(--color-inferay-white)",
																}}
															>
																<Inline
																	tokens={cell}
																	onMdFileClick={onMdFileClick}
																/>
															</td>
														),
													)}
												</tr>
											),
										)}
									</tbody>
								</table>
							</div>
						);
					}
					default:
						return (
							<p key={index} {...stylex.props(styles.paragraph)}>
								<Inline
									tokens={block.tokens ?? []}
									onMdFileClick={onMdFileClick}
								/>
							</p>
						);
				}
			})}
		</>
	);
}

export const Markdown = memo(function Markdown({
	text,
	onMdFileClick,
	streaming = false,
}: {
	text: string;
	onMdFileClick?: (path: string) => void;
	streaming?: boolean;
}) {
	const { blocks, loading, error } = useNativeMarkdown(text, streaming, true);
	const handleTableWheel = useCallback(
		(event: WheelEvent & { currentTarget: HTMLDivElement }) => {
			if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey)
				return;
			const parentScroller = findParentScrollContainer(event.currentTarget);
			if (!parentScroller) return;
			parentScroller.scrollTop += event.deltaY;
			event.preventDefault();
		},
		[],
	);
	return (
		<div {...stylex.props(styles.markdownRoot)}>
			{loading || error ? (
				<p
					{...stylex.props(styles.paragraph)}
					style={{ whiteSpace: "pre-wrap" }}
				>
					{text}
				</p>
			) : (
				<MarkdownBlocks
					blocks={blocks}
					onMdFileClick={onMdFileClick}
					onTableWheel={handleTableWheel}
				/>
			)}
			{error && <span role="status">Formatting unavailable: {error}</span>}
		</div>
	);
});

const styles = stylex.create({
	copyButton: {
		alignItems: "center",
		backgroundColor: color.backgroundRaised,
		borderRadius: radius.sm,
		color: color.textMuted,
		display: "flex",
		height: controlSize._5,
		justifyContent: "center",
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, color",
		transitionTimingFunction: motion.ease,
		width: controlSize._5,
	},
	copyButtonCopied: {
		color: color.success,
	},
	inlineCode: {
		color: color.accent,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
	},
	strong: {
		color: color.textMain,
		fontWeight: font.weight_5,
	},
	em: {
		color: color.textSoft,
	},
	link: {
		color: color.accent,
		textDecorationLine: {
			default: "none",
			":hover": "underline",
		},
	},
	linkUnderlined: {
		color: color.accent,
		cursor: "pointer",
		textDecorationColor: {
			default: color.accentBorder,
			":hover": color.accent,
		},
		textDecorationLine: "underline",
	},
	inlinePathButton: {
		backgroundColor: color.transparent,
		color: color.accent,
		cursor: "pointer",
		textDecorationColor: {
			default: color.accentBorder,
			":hover": color.accent,
		},
		textDecorationLine: "underline",
	},
	markdownRoot: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		lineHeight: 1.6,
		minWidth: controlSize._0,
		width: "100%",
		wordBreak: "normal",
	},
	codeWrap: {
		minWidth: controlSize._0,
		position: "relative",
	},
	codeBlock: {
		backgroundColor: color.backgroundRaised,
		borderColor: color.accentBorder,
		borderRadius: radius.sm,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textSoft,
		fontFamily: font.familyMono,
		fontSize: font.size_2,
		lineHeight: 1.625,
		margin: controlSize._0,
		overflowX: "auto",
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._2,
	},
	copyOverlay: {
		opacity: {
			default: 0,
			":hover": 1,
		},
		position: "absolute",
		right: controlSize._1,
		top: controlSize._1,
		transitionDuration: motion.durationBase,
		transitionProperty: "opacity",
		transitionTimingFunction: motion.ease,
	},
	heading: {
		color: color.textMain,
		fontSize: font.size_4,
		fontWeight: font.weight_5,
		lineHeight: 1.45,
		margin: controlSize._0,
	},
	listItem: {
		display: "flex",
		fontSize: font.size_3,
		gap: controlSize._1,
		lineHeight: 1.6,
		paddingLeft: controlSize._0_5,
	},
	listBullet: {
		color: color.textMuted,
		flexShrink: 0,
		userSelect: "none",
	},
	listContent: {
		minWidth: controlSize._0,
		overflowWrap: "break-word",
		wordBreak: "normal",
	},
	tableWrap: {
		backgroundColor: color.backgroundRaised,
		borderColor: color.accentBorder,
		borderRadius: radius.sm,
		borderStyle: "solid",
		borderWidth: 1,
		fontSize: font.size_2,
		maxWidth: "100%",
		overflow: "auto",
	},
	table: {
		borderCollapse: "collapse",
		tableLayout: "fixed",
		width: "100%",
	},
	tableHeadCell: {
		backgroundColor: color.accentWash,
		borderBottomColor: color.accentBorder,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		color: color.textMain,
		fontWeight: font.weight_6,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		textAlign: "left",
		whiteSpace: "nowrap",
	},
	tableCell: {
		color: color.textMain,
		paddingBlock: controlSize._1,
		paddingInline: controlSize._2,
		whiteSpace: "pre-wrap",
	},
	paragraph: {
		lineHeight: 1.6,
		margin: controlSize._0,
		overflowWrap: "break-word",
		wordBreak: "normal",
	},
	rawToolPre: {
		backgroundColor: color.backgroundRaised,
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		color: color.textMuted,
		fontFamily: font.familyMono,
		fontSize: font.size_1,
		lineHeight: 1.625,
		marginTop: controlSize._0_5,
		maxHeight: 160,
		overflow: "auto",
		overflowWrap: "break-word",
		paddingBlock: controlSize._2,
		paddingInline: controlSize._3,
		whiteSpace: "pre-wrap",
		wordBreak: "break-all",
	},
	questionStack: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._2,
		paddingBlock: controlSize._1,
	},
	questionPending: {
		alignItems: "center",
		color: color.textMuted,
		display: "flex",
		fontSize: font.size_2,
		gap: controlSize._2,
		minHeight: controlSize._6,
	},
	questionCard: {
		backgroundColor: color.backgroundRaised,
		borderColor: color.border,
		borderRadius: radius.lg,
		borderStyle: "solid",
		borderWidth: 1,
		overflow: "hidden",
	},
	questionHeader: {
		alignItems: "center",
		borderBottomColor: color.border,
		borderBottomStyle: "solid",
		borderBottomWidth: 1,
		display: "flex",
		gap: controlSize._2,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._3,
	},
	multiSelectLabel: {
		fontSize: font.size_0_5,
		letterSpacing: 0,
		textTransform: "uppercase",
	},
	questionStreamingDot: {
		borderRadius: radius.pill,
		height: controlSize._1_5,
		marginLeft: "auto",
		width: controlSize._1_5,
	},
	questionBody: {
		paddingBottom: controlSize._1_5,
		paddingInline: controlSize._3,
		paddingTop: controlSize._2,
	},
	questionText: {
		color: color.textMain,
		fontSize: font.size_4,
		fontWeight: font.weight_5,
		lineHeight: 1.375,
		margin: controlSize._0,
	},
	optionStack: {
		display: "flex",
		flexDirection: "column",
		gap: controlSize._1,
		paddingBottom: controlSize._2_5,
		paddingInline: controlSize._3,
	},
	optionButton: {
		alignItems: "flex-start",
		backgroundColor: color.surfaceInset,
		borderRadius: radius.md,
		borderStyle: "solid",
		borderWidth: 1,
		display: "flex",
		gap: controlSize._2,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._2_5,
		textAlign: "left",
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, border-color, opacity",
		transitionTimingFunction: motion.ease,
		width: "100%",
	},
	optionSelected: {
		backgroundColor: color.surfaceControl,
	},
	optionDisabled: {
		opacity: 0.4,
	},
	optionMarker: {
		alignItems: "center",
		borderRadius: radius.pill,
		display: "flex",
		flexShrink: 0,
		fontSize: font.size_0_5,
		fontWeight: font.weight_6,
		height: controlSize._4,
		justifyContent: "center",
		marginTop: controlSize._0_5,
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, color",
		transitionTimingFunction: motion.ease,
		width: controlSize._4,
	},
	optionTextWrap: {
		minWidth: controlSize._0,
	},
	optionLabel: {
		fontSize: font.size_4,
		fontWeight: font.weight_5,
	},
	optionDescription: {
		fontSize: font.size_1,
		lineHeight: 1.375,
		marginBlockEnd: controlSize._0,
		marginBlockStart: controlSize._0_5,
	},
	sendSelectionsButton: {
		alignItems: "center",
		borderRadius: radius.lg,
		display: "flex",
		fontSize: font.size_2,
		fontWeight: font.weight_5,
		gap: controlSize._1_5,
		paddingBlock: controlSize._1_5,
		paddingInline: controlSize._3,
		transitionDuration: motion.durationBase,
		transitionProperty: "background-color, color, opacity",
		transitionTimingFunction: motion.ease,
	},
});

export function AskUserQuestionCard({
	content,
	nativeInput,
	nativeQuestions,
	isStreaming,
	onSendMessage,
}: {
	content: string;
	nativeInput?: Record<string, unknown> | null;
	nativeQuestions?: AskUserQuestion[] | null;
	isStreaming?: boolean;
	onSendMessage?: (text: string) => void;
}) {
	const parsed = useMemo(
		() => parseAskUserQuestions(content, nativeQuestions, nativeInput),
		[content, nativeQuestions, nativeInput],
	);
	const [selections, setSelections] = useState<Map<number, Set<number>>>(
		new Map(),
	);
	const [submitted, setSubmitted] = useState(false);
	const accentColor = "var(--color-inferay-accent)";
	const accentForeground = "var(--color-inferay-accent-foreground)";
	const fgMuted = "var(--color-inferay-soft-white)";
	const fgDim = "var(--color-inferay-muted-gray)";

	const toggleOption = useCallback(
		(qi: number, oi: number, multiSelect: boolean) => {
			if (submitted) return;
			setSelections((prev) => {
				const next = new Map(prev);
				const current = new Set(prev.get(qi) ?? []);
				if (multiSelect) {
					current.has(oi) ? current.delete(oi) : current.add(oi);
				} else {
					current.clear();
					current.add(oi);
				}
				next.set(qi, current);
				return next;
			});
		},
		[submitted],
	);

	const hasSelections = useMemo(() => {
		if (!parsed) return false;
		return hasAskUserSelections(parsed, selections);
	}, [parsed, selections]);

	const handleSubmit = useCallback(() => {
		if (!parsed || !onSendMessage || submitted) return;
		setSubmitted(true);
		onSendMessage(formatAskUserAnswer(parsed, selections));
	}, [onSendMessage, parsed, selections, submitted]);

	if (isStreaming) {
		return (
			<div {...stylex.props(styles.questionPending)}>
				<span
					{...stylex.props(styles.questionStreamingDot)}
					style={{ backgroundColor: accentColor }}
				/>
				<span>Preparing question</span>
			</div>
		);
	}

	if (!parsed) {
		return <CopyablePre text={content} preStyle={styles.rawToolPre} />;
	}

	return (
		<div {...stylex.props(styles.questionStack)}>
			{indexedValues(parsed).map(({ index: questionIndex, value: q }) => {
				const qSelections = selections.get(questionIndex) ?? new Set<number>();
				return (
					<div key={questionIndex} {...stylex.props(styles.questionCard)}>
						<div {...stylex.props(styles.questionHeader)}>
							<IconHelpCircle
								size={iconSize.md}
								style={{ color: accentColor }}
							/>
							{q.multiSelect && (
								<span
									{...stylex.props(styles.multiSelectLabel)}
									style={{ color: fgDim }}
								>
									multi-select
								</span>
							)}
							{isStreaming && (
								<span
									{...stylex.props(styles.questionStreamingDot)}
									style={{ backgroundColor: accentColor }}
								/>
							)}
						</div>
						<div {...stylex.props(styles.questionBody)}>
							<p {...stylex.props(styles.questionText)}>{q.question}</p>
						</div>
						{q.options && q.options.length > 0 && (
							<div {...stylex.props(styles.optionStack)}>
								{indexedValues(q.options).map(
									({ index: optionIndex, value: opt }) => {
										const isSelected = qSelections.has(optionIndex);
										return (
											<button
												type="button"
												key={optionIndex}
												onClick={() =>
													toggleOption(
														questionIndex,
														optionIndex,
														!!q.multiSelect,
													)
												}
												disabled={submitted}
												{...stylex.props(
													styles.optionButton,
													isSelected ? styles.optionSelected : null,
													submitted && !isSelected
														? styles.optionDisabled
														: null,
												)}
												style={{
													borderColor: isSelected
														? `${accentColor}50`
														: "var(--color-inferay-gray-border)",
													cursor: submitted ? "default" : "pointer",
												}}
											>
												<span
													{...stylex.props(styles.optionMarker)}
													style={{
														backgroundColor: isSelected
															? accentColor
															: `${accentColor}20`,
														color: isSelected ? accentForeground : accentColor,
													}}
												>
													{isSelected ? (
														<IconCheck size={iconSize.xs} />
													) : (
														String.fromCharCode(65 + optionIndex)
													)}
												</span>
												<div {...stylex.props(styles.optionTextWrap)}>
													<span {...stylex.props(styles.optionLabel)}>
														{opt.label}
													</span>
													{opt.description && (
														<p
															{...stylex.props(styles.optionDescription)}
															style={{ color: fgMuted }}
														>
															{opt.description}
														</p>
													)}
												</div>
											</button>
										);
									},
								)}
							</div>
						)}
					</div>
				);
			})}
			{!submitted && !isStreaming && onSendMessage && (
				<button
					type="button"
					onClick={handleSubmit}
					disabled={!hasSelections}
					{...stylex.props(styles.sendSelectionsButton)}
					style={{
						backgroundColor: hasSelections ? accentColor : `${accentColor}30`,
						color: hasSelections ? accentForeground : fgDim,
						cursor: hasSelections ? "pointer" : "not-allowed",
						opacity: hasSelections ? 1 : 0.6,
					}}
				>
					<IconSend size={iconSize.sm} />
					Send selections
				</button>
			)}
		</div>
	);
}
