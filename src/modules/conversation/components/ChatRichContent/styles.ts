import * as stylex from "@octanejs/stylex";
import type { CSSProperties } from "react";
import {
	color,
	controlSize,
	font,
	motion,
	radius,
} from "../../../../design-system/styles.stylex.ts";

export const styles = stylex.create({
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

export function getInlineImgStyle(): CSSProperties {
	return { maxWidth: "100%" } as CSSProperties;
}

export function getMarkdownParagraphStyle(): CSSProperties {
	return { whiteSpace: "pre-wrap" } as CSSProperties;
}

export function getMarkdownBlocksListItemStyle(
	paddingLeft: CSSProperties["paddingLeft"],
): CSSProperties {
	return { paddingLeft: paddingLeft } as CSSProperties;
}

export function getMarkdownBlocksTableCellStyle(
	borderBottom: CSSProperties["borderBottom"],
): CSSProperties {
	return {
		borderBottom: borderBottom,
		color: "var(--color-inferay-white)",
	} as CSSProperties;
}

export function getAskUserQuestionCardQuestionStreamingDotStyle(
	backgroundColor: CSSProperties["backgroundColor"],
): CSSProperties {
	return { backgroundColor: backgroundColor } as CSSProperties;
}

export function getChatRichContentIconHelpCircleStyle(
	color: CSSProperties["color"],
): CSSProperties {
	return { color: color } as CSSProperties;
}

export function getChatRichContentMultiSelectLabelStyle(
	color: CSSProperties["color"],
): CSSProperties {
	return { color: color } as CSSProperties;
}

export function getChatRichContentQuestionStreamingDotStyle(
	backgroundColor: CSSProperties["backgroundColor"],
): CSSProperties {
	return { backgroundColor: backgroundColor } as CSSProperties;
}

export function getChatRichContentOptionButtonStyle(
	borderColor: CSSProperties["borderColor"],
	cursor: CSSProperties["cursor"],
): CSSProperties {
	return { borderColor: borderColor, cursor: cursor } as CSSProperties;
}

export function getChatRichContentOptionMarkerStyle(
	backgroundColor: CSSProperties["backgroundColor"],
	color: CSSProperties["color"],
): CSSProperties {
	return { backgroundColor: backgroundColor, color: color } as CSSProperties;
}

export function getChatRichContentOptionDescriptionStyle(
	color: CSSProperties["color"],
): CSSProperties {
	return { color: color } as CSSProperties;
}

export function getAskUserQuestionCardSendSelectionsButtonStyle(
	backgroundColor: CSSProperties["backgroundColor"],
	color: CSSProperties["color"],
	cursor: CSSProperties["cursor"],
	opacity: CSSProperties["opacity"],
): CSSProperties {
	return {
		backgroundColor: backgroundColor,
		color: color,
		cursor: cursor,
		opacity: opacity,
	} as CSSProperties;
}
