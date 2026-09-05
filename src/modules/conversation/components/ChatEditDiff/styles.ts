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

export function getEditDiffCardHeaderStyle(
	borderBottom: CSSProperties["borderBottom"],
): CSSProperties {
	return { borderBottom: borderBottom } as CSSProperties;
}

export function getEditDiffCardBodyInnerStyle(
	width: CSSProperties["width"],
	paddingTop: CSSProperties["paddingTop"],
	paddingBottom: CSSProperties["paddingBottom"],
): CSSProperties {
	return {
		width: width,
		paddingTop: paddingTop,
		paddingBottom: paddingBottom,
	} as CSSProperties;
}

export function getEditDiffCardDiffLineStyle(
	backgroundColor: CSSProperties["backgroundColor"],
	borderLeft: CSSProperties["borderLeft"],
): CSSProperties {
	return {
		backgroundColor: backgroundColor,
		borderLeft: borderLeft,
	} as CSSProperties;
}

export function getEditDiffCardSignStyle(
	color: CSSProperties["color"],
): CSSProperties {
	return { color: color } as CSSProperties;
}

export function getMiniEditDiffDivStyle(
	minHeight: CSSProperties["minHeight"],
): CSSProperties {
	return { minHeight: minHeight } as CSSProperties;
}

export function getGroupedEditDiffDivStyle(
	minHeight: CSSProperties["minHeight"],
): CSSProperties {
	return { minHeight: minHeight } as CSSProperties;
}
