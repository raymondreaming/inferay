import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For } from "solid-js";
import type { AskUserQuestion } from "../../../../../build/presentation/contracts/AskUserQuestion.ts";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import { domStyle } from "../../../../shared/lib/dom.tsx";
import { project as rustProject } from "../../../../shared/lib/native.tsx";
import {
	IconCheck,
	IconHelpCircle,
	IconSend,
} from "../../../../shared/ui/Icons/index.tsx";
import { CopyablePre } from "./CopyablePre.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";
export function AskUserQuestionCard(_props: {
	content: string;
	nativeQuestions?: AskUserQuestion[] | null;
	isStreaming?: boolean;
	onSendMessage?: (text: string) => void;
}) {
	const parsed = createMemo(() => _props.nativeQuestions ?? null);
	const [selections, setSelections] = createSignal<Map<number, Set<number>>>(
		new Map(),
	);
	const [submitted, setSubmitted] = createSignal(false);
	const accentColor = "var(--color-inferay-accent)";
	const accentForeground = "var(--color-inferay-accent-foreground)";
	const fgMuted = "var(--color-inferay-soft-white)";
	const fgDim = "var(--color-inferay-muted-gray)";
	const toggleOption = (qi: number, oi: number, multiSelect: boolean) => {
		if (submitted()) return;
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
	};
	const hasSelections = createMemo(() => {
		const _parsedValue = parsed();
		if (!_parsedValue) return false;
		return hasAskUserSelections(_parsedValue, selections());
	});
	const handleSubmit = () => {
		const _parsedValue2 = parsed();
		if (!_parsedValue2 || !_props.onSendMessage || submitted()) return;
		setSubmitted(true);
		_props.onSendMessage(formatAskUserAnswer(_parsedValue2, selections()));
	};
	return (
		<>
			{(() => {
				const _parsedValue3 = parsed();
				if (_props.isStreaming) {
					return (
						<div {...stylex.attrs(styles.questionPending)}>
							<span
								{...stylex.attrs(styles.questionStreamingDot)}
								style={domStyle(
									inlineStyles.getAskUserQuestionCardQuestionStreamingDotStyle(
										accentColor,
									),
								)}
							/>
							<span>Preparing question</span>
						</div>
					);
				}
				if (!_parsedValue3) {
					return (
						<CopyablePre text={_props.content} preStyle={styles.rawToolPre} />
					);
				}
				return (
					<div {...stylex.attrs(styles.questionStack)}>
						{
							<For each={parsed() ?? []} keyed={false}>
								{(q, questionIndex) => {
									const qSelections = createMemo(
										() => selections().get(questionIndex) ?? new Set<number>(),
									);
									return (
										<div {...stylex.attrs(styles.questionCard)}>
											<div {...stylex.attrs(styles.questionHeader)}>
												<IconHelpCircle
													size={iconSize.md}
													style={domStyle(
														inlineStyles.getChatRichContentIconHelpCircleStyle(
															accentColor,
														),
													)}
												/>
												{q().multiSelect && (
													<span
														{...stylex.attrs(styles.multiSelectLabel)}
														style={domStyle(
															inlineStyles.getChatRichContentMultiSelectLabelStyle(
																fgDim,
															),
														)}
													>
														multi-select
													</span>
												)}
												{_props.isStreaming && (
													<span
														{...stylex.attrs(styles.questionStreamingDot)}
														style={domStyle(
															inlineStyles.getChatRichContentQuestionStreamingDotStyle(
																accentColor,
															),
														)}
													/>
												)}
											</div>
											<div {...stylex.attrs(styles.questionBody)}>
												<p {...stylex.attrs(styles.questionText)}>
													{q().question}
												</p>
											</div>
											{q().options && q().options!.length > 0 && (
												<div {...stylex.attrs(styles.optionStack)}>
													{
														<For each={q().options} keyed={false}>
															{(opt, optionIndex) => {
																const isSelected = createMemo(() =>
																	qSelections().has(optionIndex),
																);
																return (
																	<button
																		type="button"
																		onClick={() =>
																			toggleOption(
																				questionIndex,
																				optionIndex,
																				!!q().multiSelect,
																			)
																		}
																		disabled={submitted()}
																		{...stylex.attrs(
																			styles.optionButton,
																			isSelected()
																				? styles.optionSelected
																				: null,
																			submitted() && !isSelected()
																				? styles.optionDisabled
																				: null,
																		)}
																		style={domStyle(
																			inlineStyles.getChatRichContentOptionButtonStyle(
																				isSelected()
																					? `${accentColor}50`
																					: "var(--color-inferay-gray-border)",
																				submitted() ? "default" : "pointer",
																			),
																		)}
																	>
																		<span
																			{...stylex.attrs(styles.optionMarker)}
																			style={domStyle(
																				inlineStyles.getChatRichContentOptionMarkerStyle(
																					isSelected()
																						? accentColor
																						: `${accentColor}20`,
																					isSelected()
																						? accentForeground
																						: accentColor,
																				),
																			)}
																		>
																			{isSelected() ? (
																				<IconCheck size={iconSize.xs} />
																			) : (
																				String.fromCharCode(65 + optionIndex)
																			)}
																		</span>
																		<div
																			{...stylex.attrs(styles.optionTextWrap)}
																		>
																			<span
																				{...stylex.attrs(styles.optionLabel)}
																			>
																				{opt().label}
																			</span>
																			{opt().description && (
																				<p
																					{...stylex.attrs(
																						styles.optionDescription,
																					)}
																					style={domStyle(
																						inlineStyles.getChatRichContentOptionDescriptionStyle(
																							fgMuted,
																						),
																					)}
																				>
																					{opt().description}
																				</p>
																			)}
																		</div>
																	</button>
																);
															}}
														</For>
													}
												</div>
											)}
										</div>
									);
								}}
							</For>
						}
						{!submitted() && !_props.isStreaming && _props.onSendMessage && (
							<button
								type="button"
								onClick={handleSubmit}
								disabled={!hasSelections()}
								{...stylex.attrs(styles.sendSelectionsButton)}
								style={domStyle(
									inlineStyles.getAskUserQuestionCardSendSelectionsButtonStyle(
										hasSelections() ? accentColor : `${accentColor}30`,
										hasSelections() ? accentForeground : fgDim,
										hasSelections() ? "pointer" : "not-allowed",
										hasSelections() ? 1 : 0.6,
									),
								)}
							>
								<IconSend size={iconSize.sm} />
								Send selections
							</button>
						)}
					</div>
				);
			})()}
		</>
	);
}
export { CopyButton } from "./CopyButton.tsx";
export { Markdown } from "./Markdown.tsx";
export function formatAskUserAnswer(
	questions: AskUserQuestion[],
	selections: Map<number, Set<number>>,
): string {
	return rustProject("askAnswer", {
		questions,
		selections: Object.fromEntries(
			[...selections].map(([key, indexes]) => [key, [...indexes]]),
		),
	});
}
export function hasAskUserSelections(
	questions: AskUserQuestion[],
	selections: Map<number, Set<number>>,
) {
	return questions.every((_, qi) => !!selections.get(qi)?.size);
}
