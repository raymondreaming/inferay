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
import { noop } from "../../lib/data.ts";
import { indexedValues } from "../../lib/indexed-values.ts";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
} from "../../tokens.stylex.ts";
import { IconCheck, IconCopy, IconHelpCircle, IconSend } from "../ui/Icons.tsx";
import {
	formatAskUserAnswer,
	hasAskUserSelections,
	parseAskUserQuestions,
} from "./chat-message-render-utils.ts";
import { parseInlineTokens, parseMarkdownBlocks } from "./chat-text.ts";

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
			{copied ? <IconCheck size={10} /> : <IconCopy size={10} />}
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
	text,
	onMdFileClick,
}: {
	text: string;
	onMdFileClick?: (path: string) => void;
}) {
	const tokens = useMemo(() => parseInlineTokens(text), [text]);
	return (
		<>
			{tokens.map((token, i) => {
				const partKey = `${i}-${token.type}`;
				if (token.type === "code") {
					return (
						<code key={partKey} {...stylex.props(styles.inlineCode)}>
							{token.value}
						</code>
					);
				}
				if (token.type === "bold") {
					return (
						<strong key={partKey} {...stylex.props(styles.strong)}>
							{token.value}
						</strong>
					);
				}
				if (token.type === "italic") {
					return (
						<em key={partKey} {...stylex.props(styles.em)}>
							{token.value}
						</em>
					);
				}
				if (token.type === "markdown_link") {
					return (
						<a
							key={partKey}
							href={token.href}
							target="_blank"
							rel="noopener noreferrer"
							{...stylex.props(styles.link)}
						>
							{token.label}
						</a>
					);
				}
				if (token.type === "markdown_path" && onMdFileClick) {
					return (
						<button
							key={partKey}
							type="button"
							onClick={() => onMdFileClick(token.value)}
							{...stylex.props(styles.inlinePathButton)}
						>
							{token.value}
						</button>
					);
				}
				if (token.type === "url") {
					return (
						<a
							key={partKey}
							href={token.href}
							target="_blank"
							rel="noopener noreferrer"
							{...stylex.props(styles.linkUnderlined)}
						>
							{token.value}
						</a>
					);
				}
				return <Fragment key={partKey}>{token.value}</Fragment>;
			})}
		</>
	);
});

export const Markdown = memo(function Markdown({
	text,
	onMdFileClick,
	streaming = false,
}: {
	text: string;
	onMdFileClick?: (path: string) => void;
	streaming?: boolean;
}) {
	// Streaming and completed messages use the same block projection. Switching
	// from a raw streaming tail to parsed markdown at an arbitrary length caused
	// paragraphs to change height and made the pinned viewport jump.
	const blocks = useMemo(
		() => parseMarkdownBlocks(text, streaming),
		[streaming, text],
	);
	const handleTableWheel = useCallback(
		(event: WheelEvent & { currentTarget: HTMLDivElement }) => {
			if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) {
				return;
			}

			const parentScroller = findParentScrollContainer(event.currentTarget);
			if (!parentScroller) return;

			parentScroller.scrollTop += event.deltaY;
			event.preventDefault();
		},
		[],
	);

	return (
		<div {...stylex.props(styles.markdownRoot)}>
			{indexedValues(blocks).map(({ index: blockIndex, value: b }) => {
				const blockKey = `${b.type}-${blockIndex}`;
				if (b.type === "code") {
					return (
						<CopyablePre
							key={blockKey}
							text={b.content}
							preStyle={styles.codeBlock}
						/>
					);
				}
				if (b.type === "heading") {
					return (
						<p key={blockKey} {...stylex.props(styles.heading)}>
							{b.content}
						</p>
					);
				}
				if (b.type === "list-item") {
					return (
						<div key={blockKey} {...stylex.props(styles.listItem)}>
							<span {...stylex.props(styles.listBullet)}>{b.bullet}</span>
							<span {...stylex.props(styles.listContent)}>
								<Inline text={b.content} onMdFileClick={onMdFileClick} />
							</span>
						</div>
					);
				}
				if (b.type === "table") {
					return (
						<div
							key={blockKey}
							{...stylex.props(styles.tableWrap)}
							onWheel={handleTableWheel}
						>
							<table {...stylex.props(styles.table)}>
								<thead>
									<tr>
										{indexedValues(b.headers).map(({ index, value: h }) => (
											<th key={index} {...stylex.props(styles.tableHeadCell)}>
												{h}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{indexedValues(b.rows).map(
										({ index: rowIndex, value: row }) => (
											<tr key={rowIndex}>
												{indexedValues(row).map(({ index, value: cell }) => (
													<td
														key={index}
														{...stylex.props(styles.tableCell)}
														style={{
															borderBottom:
																rowIndex < b.rows.length - 1
																	? "1px solid var(--color-inferay-gray-border)"
																	: "none",
															color: "var(--color-inferay-white)",
														}}
													>
														<Inline text={cell} onMdFileClick={onMdFileClick} />
													</td>
												))}
											</tr>
										),
									)}
								</tbody>
							</table>
						</div>
					);
				}
				return (
					<p key={blockKey} {...stylex.props(styles.paragraph)}>
						<Inline text={b.content} onMdFileClick={onMdFileClick} />
					</p>
				);
			})}
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
		minWidth: 0,
		width: "100%",
		wordBreak: "normal",
	},
	codeWrap: {
		minWidth: 0,
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
		margin: 0,
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
		margin: 0,
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
		minWidth: 0,
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
		margin: 0,
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
		margin: 0,
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
		minWidth: 0,
	},
	optionLabel: {
		fontSize: font.size_4,
		fontWeight: font.weight_5,
	},
	optionDescription: {
		fontSize: font.size_1,
		lineHeight: 1.375,
		marginBlockEnd: 0,
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
	isStreaming,
	onSendMessage,
}: {
	content: string;
	isStreaming?: boolean;
	onSendMessage?: (text: string) => void;
}) {
	const parsed = useMemo(() => parseAskUserQuestions(content), [content]);
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
							<IconHelpCircle size={12} style={{ color: accentColor }} />
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
														<IconCheck size={8} />
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
					<IconSend size={10} />
					Send selections
				</button>
			)}
		</div>
	);
}
