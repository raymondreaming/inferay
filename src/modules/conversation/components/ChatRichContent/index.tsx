import * as stylex from "@octanejs/stylex";
import { useCallback, useMemo, useState } from "octane";
import { iconSize } from "../../../../design-system/styles.stylex.ts";
import {
	IconCheck,
	IconHelpCircle,
	IconSend,
} from "../../../../shared/ui/Icons/index.tsx";
import type { AskUserQuestion } from "../../model/agent-chat-shared.ts";
import {
	formatAskUserAnswer,
	hasAskUserSelections,
} from "../../model/agent-chat-shared.ts";
import { CopyablePre } from "./CopyablePre.tsx";
import * as inlineStyles from "./styles.ts";
import { styles } from "./styles.ts";

export function AskUserQuestionCard({
	content,
	nativeQuestions,
	isStreaming,
	onSendMessage,
}: {
	content: string;
	nativeQuestions?: AskUserQuestion[] | null;
	isStreaming?: boolean;
	onSendMessage?: (text: string) => void;
}) {
	const parsed = nativeQuestions ?? null;
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
					style={inlineStyles.getAskUserQuestionCardQuestionStreamingDotStyle(
						accentColor,
					)}
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
			{parsed.map((q, questionIndex) => {
				const qSelections = selections.get(questionIndex) ?? new Set<number>();
				return (
					<div key={questionIndex} {...stylex.props(styles.questionCard)}>
						<div {...stylex.props(styles.questionHeader)}>
							<IconHelpCircle
								size={iconSize.md}
								style={inlineStyles.getChatRichContentIconHelpCircleStyle(
									accentColor,
								)}
							/>
							{q.multiSelect && (
								<span
									{...stylex.props(styles.multiSelectLabel)}
									style={inlineStyles.getChatRichContentMultiSelectLabelStyle(
										fgDim,
									)}
								>
									multi-select
								</span>
							)}
							{isStreaming && (
								<span
									{...stylex.props(styles.questionStreamingDot)}
									style={inlineStyles.getChatRichContentQuestionStreamingDotStyle(
										accentColor,
									)}
								/>
							)}
						</div>
						<div {...stylex.props(styles.questionBody)}>
							<p {...stylex.props(styles.questionText)}>{q.question}</p>
						</div>
						{q.options && q.options.length > 0 && (
							<div {...stylex.props(styles.optionStack)}>
								{q.options.map((opt, optionIndex) => {
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
												submitted && !isSelected ? styles.optionDisabled : null,
											)}
											style={inlineStyles.getChatRichContentOptionButtonStyle(
												isSelected
													? `${accentColor}50`
													: "var(--color-inferay-gray-border)",
												submitted ? "default" : "pointer",
											)}
										>
											<span
												{...stylex.props(styles.optionMarker)}
												style={inlineStyles.getChatRichContentOptionMarkerStyle(
													isSelected ? accentColor : `${accentColor}20`,
													isSelected ? accentForeground : accentColor,
												)}
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
														style={inlineStyles.getChatRichContentOptionDescriptionStyle(
															fgMuted,
														)}
													>
														{opt.description}
													</p>
												)}
											</div>
										</button>
									);
								})}
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
					style={inlineStyles.getAskUserQuestionCardSendSelectionsButtonStyle(
						hasSelections ? accentColor : `${accentColor}30`,
						hasSelections ? accentForeground : fgDim,
						hasSelections ? "pointer" : "not-allowed",
						hasSelections ? 1 : 0.6,
					)}
				>
					<IconSend size={iconSize.sm} />
					Send selections
				</button>
			)}
		</div>
	);
}

export { CopyButton } from "./CopyButton.tsx";

export { Markdown } from "./Markdown.tsx";
